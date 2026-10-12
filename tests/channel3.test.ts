import { Channel3 } from "@channel3/sdk";
import { describe, expect, it } from "vitest";
import { mapChannel3Product } from "../server/channel3.js";

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
