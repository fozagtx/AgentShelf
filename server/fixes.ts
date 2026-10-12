import { FIX_MODEL } from "./config.js";
import { gateway, hasGateway } from "./gateway.js";

export interface ProductFix {
  fixed: {
    title: string;
    description: string;
    key_features: string[];
  };
  rationale: string[];
}

export function missingGatewayCredentials() {
  return hasGateway() ? [] : ["ASTRO_GATEWAY_API_KEY"];
}

export async function generateProductFix(
  product: Record<string, any>,
  competitors: unknown[],
): Promise<ProductFix> {
  const missing = missingGatewayCredentials();
  if (missing.length) {
    throw new Error(`Product copy fixes are unavailable. Missing environment variables: ${missing.join(", ")}.`);
  }
  const result = await gateway().chat.completions.create({
    model: FIX_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Improve product copy using only supported product facts. Compare it with competitors and satisfy PayPal's required catalog fields. Do not invent certifications, materials, dimensions, or performance claims. Return only a JSON object with this shape: {\"fixed\":{\"title\":\"string\",\"description\":\"string\",\"key_features\":[\"string\"]},\"rationale\":[\"string\"]}.",
      },
      {
        role: "user",
        content: JSON.stringify({
          product: {
            title: product.title,
            description: product.description,
            key_features: product.key_features,
            paypal_catalog_requirements: [
              "A descriptive title",
              "A description of at least 25 characters",
              "Accurate seller and product information",
            ],
          },
          competitors,
        }),
      },
    ],
  });
  const content = result.choices[0]?.message.content;
  if (!content) throw new Error("Astropods gateway returned no product copy.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Astropods gateway returned invalid JSON product copy.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("fixed" in parsed) ||
    typeof parsed.fixed !== "object" ||
    parsed.fixed === null ||
    !("title" in parsed.fixed) ||
    !("description" in parsed.fixed) ||
    !("key_features" in parsed.fixed) ||
    !("rationale" in parsed) ||
    typeof parsed.fixed.title !== "string" ||
    typeof parsed.fixed.description !== "string" ||
    !Array.isArray(parsed.fixed.key_features) ||
    !Array.isArray(parsed.rationale) ||
    !parsed.rationale.every((item) => typeof item === "string")
  ) {
    throw new Error("Astropods gateway returned invalid product copy.");
  }
  if (
    !parsed.fixed.title.trim() ||
    parsed.fixed.description.trim().length < 25 ||
    !parsed.fixed.key_features.every((feature) => typeof feature === "string" && feature.trim())
  ) {
    throw new Error("Astropods gateway product copy did not satisfy PayPal catalog requirements.");
  }
  return parsed as ProductFix;
}
