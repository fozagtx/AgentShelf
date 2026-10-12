import { Channel3 } from "@channel3/sdk";
import type { Channel3Api } from "@channel3/sdk";
import { CHANNEL3_API_BASE_URL } from "./config.js";

export interface Competitor {
  id: string;
  title: string;
  brand?: string | null;
  description?: string | null;
  images?: Array<{
    url: string;
    cleaned_url?: string | null;
    alt_text?: string | null;
    shot_type?: string | null;
  }>;
  offers: Array<{
    url: string;
    domain: string;
    price: { amount: number; currency: string };
    availability: string;
  }>;
}

export function missingChannel3Credentials() {
  return process.env.CHANNEL3_API_KEY ? [] : ["CHANNEL3_API_KEY"];
}

export function createChannel3Client() {
  const missing = missingChannel3Credentials();
  if (missing.length) {
    throw new Error(`Channel3 is unavailable. Missing environment variables: ${missing.join(", ")}.`);
  }
  return new Channel3({
    apiKey: process.env.CHANNEL3_API_KEY,
    baseUrl: CHANNEL3_API_BASE_URL,
  });
}

export function firstInStockUsdOffer(product: Channel3Api.Product) {
  return product.offers?.find((candidate) =>
    candidate.availability === "InStock" &&
    candidate.price.currency === "USD" &&
    Number.isFinite(candidate.price.price),
  );
}

export function channel3ImageUrl(product: Channel3Api.Product) {
  const image = product.images?.find((candidate) => candidate.shot_type === "hero")
    ?? product.images?.[0];
  return image?.cleaned_url ?? image?.url ?? "";
}

export function mapChannel3Product(
  product: Channel3Api.Product,
  options: { inventory: number; sourceUrl?: string },
) {
  const offer = firstInStockUsdOffer(product);
  if (!offer) return { ok: false as const, error: "No USD price for this product" };

  const categoryPath = product.category?.path
    ?.map((part) => part.title)
    .filter(Boolean)
    .join(" / ");
  const attributes = Object.entries(product.structured_attributes ?? {})
    .flatMap(([name, values]) => values.map((value) => `${name}: ${value}`));
  return {
    ok: true as const,
    value: {
      title: product.title,
      description: product.description ?? "",
      brand: product.brands?.[0]?.name ?? "",
      price: offer.price.price,
      image_url: channel3ImageUrl(product),
      inventory: options.inventory,
      category: categoryPath || product.category?.title || "",
      key_features: [...(product.key_features ?? []), ...attributes],
      channel3_id: product.id,
      source_url: options.sourceUrl ?? offer.url,
    },
  };
}

export async function searchCompetitors(query: string): Promise<Competitor[]> {
  const missing = missingChannel3Credentials();
  if (missing.length) {
    throw new Error(`Channel3 search is unavailable. Missing environment variables: ${missing.join(", ")}.`);
  }
  const client = createChannel3Client();
  const response = await client.products.search({
    query,
    filters: { availability: ["InStock"] },
  });
  return response.data.flatMap((product) => {
    const offers = (product.offers ?? []).filter((offer) =>
      offer.availability === "InStock" &&
      offer.price.currency === "USD" &&
      Number.isFinite(offer.price.price) &&
      Boolean(offer.url && offer.domain),
    );
    return offers.length
      ? [{
          id: product.id,
          title: product.title,
          brand: product.brands?.[0]?.name ?? null,
          description: product.description,
          images: product.images?.map((image) => ({
            ...image,
            url: image.cleaned_url ?? image.url,
          })),
          offers: offers.map((offer) => ({
            url: offer.url,
            domain: offer.domain,
            price: { amount: offer.price.price, currency: offer.price.currency },
            availability: offer.availability,
          })),
        }]
      : [];
  }).slice(0, 5);
}
