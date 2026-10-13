import { Channel3 } from "@channel3/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapChannel3Product, searchCompetitors } from "../server/channel3.js";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("@channel3/sdk", () => ({
  Channel3: class {
    products = { search: searchMock };
  },
}));

type Channel3Product = Awaited<
  ReturnType<InstanceType<typeof Channel3>["products"]["retrieve"]>
>;

const product: Channel3Product = {
  id: "c3-product-1",
  title: "Merino Crew Sweater",
  description: "Soft merino wool crew sweater.",
  brands: [{ id: "brand-1", name: "North Trail" }],
  images: [
    { url: "https://images.example/regular.jpg", shot_type: "hero" },
    { url: "https://images.example/first.jpg", shot_type: "detail" },
  ],
  category: { slug: "sweaters", title: "Clothing / Sweaters", has_children: false },
  key_features: ["Merino wool", "Ribbed cuffs"],
  structured_attributes: { material: ["Merino wool"], color: ["Navy"] },
  offers: [
    {
      url: "https://shop.example/sweater",
      domain: "shop.example",
      price: { price: 88, currency: "USD" },
      availability: "InStock",
    },
  ],
};

function searchProduct(id: string, url: string, price = 100): Channel3Product {
  return {
    ...product,
    id,
    offers: [{
      url,
      domain: new URL(url).hostname,
      price: { price, currency: "USD" },
      availability: "InStock",
    }],
  };
}

describe("Channel3 competitor search", () => {
  beforeEach(() => {
    vi.stubEnv("CHANNEL3_API_KEY", "test-channel3-key");
    searchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("filters merchant matches and searches around the merchant price", async () => {
    searchMock.mockResolvedValue({
      data: [
        searchProduct("merchant-id", "https://own.example/product", 100),
        searchProduct("merchant-url", "https://merchant.example/product", 100),
        searchProduct("competitor-1", "https://one.example/item", 50),
        searchProduct("competitor-2", "https://two.example/item", 100),
        searchProduct("competitor-3", "https://three.example/item", 150),
      ],
    });

    const results = await searchCompetitors("bottle", {
      price: 100,
      channel3_id: "merchant-id",
      url: "https://merchant.example/product",
    });

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith({
      query: "bottle",
      filters: {
        availability: ["InStock"],
        price: { min_price: 50, max_price: 150 },
      },
    });
    expect(results.map((result) => result.id)).toEqual([
      "competitor-1",
      "competitor-2",
      "competitor-3",
    ]);
  });

  it("retries without the price range when fewer than three competitors remain", async () => {
    searchMock
      .mockResolvedValueOnce({
        data: [
          searchProduct("merchant-id", "https://own.example/product"),
          searchProduct("competitor-1", "https://one.example/item"),
        ],
      })
      .mockResolvedValueOnce({
        data: [
          searchProduct("merchant-id", "https://own.example/product"),
          searchProduct("merchant-url", "https://merchant.example/product"),
          ...Array.from({ length: 6 }, (_, index) =>
            searchProduct(`fallback-${index + 1}`, `https://fallback-${index + 1}.example/item`, 500 + index),
          ),
        ],
      });

    const results = await searchCompetitors("bottle", {
      price: 100,
      channel3_id: "merchant-id",
      url: "https://merchant.example/product",
    });

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock).toHaveBeenLastCalledWith({
      query: "bottle",
      filters: { availability: ["InStock"] },
    });
    expect(results.map((result) => result.id)).toEqual([
      "fallback-1",
      "fallback-2",
      "fallback-3",
      "fallback-4",
      "fallback-5",
    ]);
  });
});

describe("Channel3 product mapping", () => {
  it("maps typed product data, preferring the cleaned hero image", () => {
    const result = mapChannel3Product({
      ...product,
      images: [
        { url: "https://images.example/hero.jpg", cleaned_url: "https://images.example/clean.jpg", shot_type: "hero" },
        { url: "https://images.example/first.jpg", shot_type: "detail" },
      ],
    }, { inventory: 7, sourceUrl: "https://brand.example/sweater" });

    expect(result).toEqual({
      ok: true,
      value: {
        title: "Merino Crew Sweater",
        description: "Soft merino wool crew sweater.",
        brand: "North Trail",
        price: 88,
        image_url: "https://images.example/clean.jpg",
        inventory: 7,
        category: "Clothing / Sweaters",
        key_features: [
          "Merino wool",
          "Ribbed cuffs",
          "material: Merino wool",
          "color: Navy",
        ],
        channel3_id: "c3-product-1",
        source_url: "https://brand.example/sweater",
      },
    });
  });

  it("falls back to the first image and rejects products without an in-stock USD offer", () => {
    const result = mapChannel3Product({
      ...product,
      images: [{ url: "https://images.example/first.jpg", shot_type: "detail" }],
      offers: [{
        url: "https://shop.example/sweater",
        domain: "shop.example",
        price: { price: 88, currency: "EUR" },
        availability: "InStock",
      }],
    }, { inventory: 10 });

    expect(result).toEqual({ ok: false, error: "No USD price for this product" });
  });
});
