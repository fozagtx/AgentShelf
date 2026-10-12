import type { Client } from "@elastic/elasticsearch";
import { Hono } from "hono";
import { getAppUrl } from "./config.js";
import {
  EXPERIMENTS_INDEX,
  PRODUCTS_INDEX,
  RUNS_INDEX,
  getDocument,
} from "./elastic.js";
import { writeEvent } from "./events.js";
import { mintPlatformToken } from "./platform.js";
import { missingPayPalCredentials } from "./paypal.js";
import { getProduct } from "./products.js";
import { shuffleShelf, type ShelfEntry } from "./shelf.js";

const selectedShipping = [
  { id: "standard", name: "Standard Shipping", price: { currency_code: "USD", value: "5.00" }, is_selected: true },
  { id: "express", name: "Express Shipping", price: { currency_code: "USD", value: "15.00" }, is_selected: false },
];

export function createPageRoutes(client: Client) {
  const app = new Hono();

  app.get("/shelf/:experimentId", async (c) => {
    const experimentId = c.req.param("experimentId");
    const runId = c.req.query("run") ?? "";
    const [experiment, run] = await Promise.all([
      getDocument<Record<string, any>>(client, EXPERIMENTS_INDEX, experimentId),
      getDocument<Record<string, any>>(client, RUNS_INDEX, runId),
    ]);
    if (!experiment || !run || run.experiment_id !== experimentId) {
      return page(c, "Shelf unavailable", `<main><h1>Shelf unavailable</h1><p>This experiment run was not found.</p></main>`, 404);
    }
    const product = await getProduct(client, String(experiment.product_id));
    if (!product) return page(c, "Shelf unavailable", `<main><h1>Shelf unavailable</h1><p>The merchant product is no longer available.</p></main>`, 404);
    const competitors = Array.isArray(experiment.competitors) ? experiment.competitors : [];
    const order = Array.isArray(run.shelf_order) && run.shelf_order.length
      ? run.shelf_order as ShelfEntry[]
      : shuffleShelf(product, competitors, runId);
    await client.update({
      index: RUNS_INDEX,
      id: runId,
      doc: { shelf_order: order },
      refresh: "wait_for",
    });
    await writeEvent(client, { experimentId, runId, stage: "shelf_viewed", ok: true });

    const fixed = run.variant === "fixed" && product.fixed_variant;
    const shown = fixed
      ? { ...product, ...product.fixed_variant }
      : product;
    const items = order.map((entry, index) => {
      const position = index + 1;
      if (entry.type === "merchant") {
        return `<article class="shelf-item merchant-product" data-position="${position}"><h2>${escapeHtml(shown.title)}</h2><p>${escapeHtml(shown.description)}</p><p class="price">$${Number(product.price).toFixed(2)} USD</p><ul>${(shown.key_features ?? []).map((feature: string) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul><a class="offer-link" href="/store/${encodeURIComponent(product.id)}?run=${encodeURIComponent(runId)}">View / Buy</a></article>`;
      }
      const competitor = competitors[Number(entry.competitorIndex)];
      if (!competitor) return "";
      const offer = competitor.offers?.[0] ?? {
        url: competitor.url,
        domain: competitor.domain,
        price: { amount: competitor.price, currency: "USD" },
      };
      return `<article class="shelf-item competitor-product" data-position="${position}"><h2>${escapeHtml(competitor.title)}</h2>${competitor.image_url ? `<img src="${escapeHtml(competitor.image_url)}" alt="">` : ""}<p class="price">$${Number(offer.price?.amount ?? 0).toFixed(2)} USD</p><p>${escapeHtml(offer.domain ?? competitor.domain ?? "")}</p><a class="offer-link" href="/out/${encodeURIComponent(runId)}/${Number(entry.competitorIndex)}">View / Buy</a></article>`;
    }).join("");
    return page(c, "Product shelf", `<main class="shelf-page"><h1>Compare products</h1><section class="shelf" aria-label="Product choices">${items}</section></main>`);
  });

  app.get("/out/:runId/:offerIndex", async (c) => {
    const runId = c.req.param("runId");
    const offerIndex = Number(c.req.param("offerIndex"));
    const run = await getDocument<Record<string, any>>(client, RUNS_INDEX, runId);
    if (!run || !Number.isInteger(offerIndex)) {
      return page(c, "Selection unavailable", `<main><h1>Selection unavailable</h1></main>`, 404);
    }
    const experiment = await getDocument<Record<string, any>>(
      client,
      EXPERIMENTS_INDEX,
      String(run.experiment_id),
    );
    const competitor = experiment?.competitors?.[offerIndex];
    if (!competitor) return page(c, "Selection unavailable", `<main><h1>Selection unavailable</h1></main>`, 404);
    const shelfOrder = (run.shelf_order ?? []) as ShelfEntry[];
    const position = shelfOrder.findIndex((entry) =>
      entry.type === "competitor" && Number(entry.competitorIndex) === offerIndex,
    ) + 1;
    const offer = competitor.offers?.[0] ?? {};
    await client.update({
      index: RUNS_INDEX,
      id: runId,
      doc: {
        status: "complete",
        chosen_offer: offer.url ?? competitor.url,
        chosen_title: competitor.title,
        chosen_is_merchant: false,
        chosen_position: position,
        completed_at: new Date().toISOString(),
      },
      refresh: "wait_for",
    });
    await writeEvent(client, {
      experimentId: String(run.experiment_id),
      runId,
      stage: "offer_selected",
      ok: true,
      position,
      is_merchant: false,
      chosen_offer: offer.url ?? competitor.url,
      chosen_title: competitor.title,
    });
    return page(c, "Selection recorded", `<main class="selection-page"><h1>Selection recorded</h1><p>Your run is complete.</p></main>`);
  });

  app.get("/store/:productId", async (c) => {
    const product = await getProduct(client, c.req.param("productId"));
    const runId = c.req.query("run") ?? "";
    if (!product) return page(c, "Product unavailable", `<main><h1>Product unavailable</h1></main>`, 404);
    const run = await getDocument<Record<string, any>>(client, RUNS_INDEX, runId);
    const fixed = run?.variant === "fixed" && product.fixed_variant;
    const shown = fixed ? { ...product, ...product.fixed_variant } : product;
    const shelfOrder = (run?.shelf_order ?? []) as ShelfEntry[];
    const position = shelfOrder.findIndex((entry) => entry.type === "merchant") + 1;
    if (run) {
      await client.update({
        index: RUNS_INDEX,
        id: runId,
        doc: {
          chosen_offer: product.url,
          chosen_title: shown.title,
          chosen_is_merchant: true,
          chosen_position: position,
        },
        refresh: "wait_for",
      });
      await writeEvent(client, {
        runId,
        experimentId: String(run.experiment_id),
        stage: "offer_selected",
        ok: true,
        position,
        is_merchant: true,
        chosen_offer: product.url,
        chosen_title: shown.title,
      });
    }
    await writeEvent(client, {
      runId,
      experimentId: String(run?.experiment_id ?? ""),
      stage: "product_viewed",
      ok: true,
    });
    return page(c, shown.title, `<main class="store-page"><h1>${escapeHtml(shown.title)}</h1><p>${escapeHtml(shown.description)}</p><p class="price">$${Number(product.price).toFixed(2)} USD</p><form method="post" action="/store/${encodeURIComponent(product.id)}/checkout?run=${encodeURIComponent(runId)}"><label>Quantity <input name="quantity" type="number" min="1" max="${Number(product.inventory)}" value="1" required></label><fieldset><legend>US shipping address</legend><label>Address <input name="address_line_1" autocomplete="address-line1" required></label><label>City <input name="admin_area_2" autocomplete="address-level2" required></label><label>State <input name="admin_area_1" autocomplete="address-level1" maxlength="2" required></label><label>ZIP code <input name="postal_code" autocomplete="postal-code" required></label><input type="hidden" name="country_code" value="US"></fieldset><label>Shipping option <select name="shipping_option"><option value="standard">Standard Shipping, $5.00</option><option value="express">Express Shipping, $15.00</option></select></label><button type="submit">Continue to PayPal</button></form></main>`);
  });

  app.post("/store/:productId/checkout", async (c) => {
    const runId = c.req.query("run") ?? "";
    const product = await getProduct(client, c.req.param("productId"));
    if (!product) return page(c, "Checkout unavailable", `<main><h1>Product unavailable</h1></main>`, 404);
    const missing = missingPayPalCredentials();
    if (missing.length) {
      const message = `PayPal sandbox checkout is unavailable. Missing environment variables: ${missing.join(", ")}.`;
      await writeEvent(client, {
        runId,
        stage: "cart_create_failed",
        ok: false,
        error: message,
      });
      return page(c, "Checkout unavailable", `<main><h1>Checkout unavailable</h1><p>${escapeHtml(message)}</p></main>`, 503);
    }
    const form = await c.req.parseBody();
    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.inventory) {
      return page(c, "Invalid quantity", `<main><h1>Invalid quantity</h1></main>`, 400);
    }
    const state = String(form.admin_area_1 ?? "").toUpperCase();
    const shipping = form.shipping_option === "express" ? "express" : "standard";
    const shippingOptions = selectedShipping.map((option) => ({
      ...option,
      is_selected: option.id === shipping,
    }));
    const cartInput = {
      items: [{ variant_id: product.id, quantity }],
      shipping_address: {
        address_line_1: String(form.address_line_1 ?? ""),
        admin_area_2: String(form.admin_area_2 ?? ""),
        admin_area_1: state,
        postal_code: String(form.postal_code ?? ""),
        country_code: "US",
      },
      payment_method: { type: "paypal" },
      available_shipping_options: shippingOptions,
    };
    try {
      const token = await mintPlatformToken(client);
      const returnUrl = `${getAppUrl()}/checkout/return?run=${encodeURIComponent(runId)}`;
      const cancelUrl = `${getAppUrl()}/store/${encodeURIComponent(product.id)}?run=${encodeURIComponent(runId)}`;
      const createdResponse = await cartRequest(
        "/api/paypal/v1/merchant-cart",
        token,
        "POST",
        cartInput,
        { returnUrl, cancelUrl },
      );
      if (!createdResponse.ok) throw new Error(await apiError(createdResponse));
      const created = await createdResponse.json() as Record<string, any>;
      await writeEvent(client, { runId, stage: "cart_created", ok: true });

      const updatedResponse = await cartRequest(
        `/api/paypal/v1/merchant-cart/${encodeURIComponent(String(created.id))}`,
        token,
        "PUT",
        cartInput,
        { returnUrl, cancelUrl },
      );
      if (!updatedResponse.ok) throw new Error(await apiError(updatedResponse));
      const updated = await updatedResponse.json() as Record<string, any>;
      await writeEvent(client, { runId, stage: "cart_updated", ok: true });
      const approvalUrl = updated.payment_method?.approval_url;
      if (!approvalUrl || !updated.payment_method?.token) {
        throw new Error("PayPal did not return an approval URL for the sandbox order.");
      }
      const run = await getDocument<Record<string, any>>(client, RUNS_INDEX, runId);
      const merchantIndex = (run?.shelf_order as ShelfEntry[] | undefined)
        ?.findIndex((entry) => entry.type === "merchant") ?? -1;
      await client.update({
        index: RUNS_INDEX,
        id: runId,
        doc: {
          cart_id: created.id,
          paypal_order_id: updated.payment_method.token,
          chosen_title: product.title,
          chosen_is_merchant: true,
          chosen_position: merchantIndex + 1,
        },
        refresh: "wait_for",
      });
      await writeEvent(client, {
        runId,
        stage: "approval_redirected",
        ok: true,
        is_merchant: true,
        chosen_title: product.title,
      });
      return c.redirect(approvalUrl, 302);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cart checkout failed.";
      await writeEvent(client, { runId, stage: "checkout_failed", ok: false, error: message });
      return page(c, "Checkout failed", `<main><h1>Checkout failed</h1><p>${escapeHtml(message)}</p></main>`, 502);
    }
  });

  app.get("/checkout/return", async (c) => {
    const runId = c.req.query("run") ?? "";
    const run = await getDocument<Record<string, any>>(client, RUNS_INDEX, runId);
    if (!run?.cart_id) return page(c, "Checkout unavailable", `<main><h1>Checkout unavailable</h1><p>No cart is linked to this run.</p></main>`, 404);
    await writeEvent(client, { runId, stage: "approval_returned", ok: true });
    try {
      const token = await mintPlatformToken(client);
      const result = await cartRequest(
        `/api/paypal/v1/merchant-cart/${encodeURIComponent(String(run.cart_id))}/checkout`,
        token,
        "POST",
        { payment_method: { type: "paypal", token: c.req.query("token") ?? run.paypal_order_id } },
      );
      if (!result.ok) throw new Error(await apiError(result));
      const confirmation = await result.json() as Record<string, any>;
      const captureStatus = confirmation.payment_confirmation?.status ?? confirmation.status;
      await client.update({
        index: RUNS_INDEX,
        id: runId,
        doc: {
          status: "complete",
          capture_status: captureStatus,
          chosen_is_merchant: true,
          chosen_title: run.chosen_title,
          furthest_stage: "captured",
          completed_at: new Date().toISOString(),
        },
        refresh: "wait_for",
      });
      await writeEvent(client, { runId, stage: "captured", ok: true, capture_status: captureStatus });
      return page(c, "Order confirmed", `<main class="confirmation-page"><h1>Order confirmed</h1><p>Your PayPal sandbox order has been captured.</p><p>Order ${escapeHtml(String(confirmation.payment_confirmation?.merchant_order_number ?? run.paypal_order_id))}</p><p>Status: ${escapeHtml(String(captureStatus ?? "captured"))}</p></main>`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "PayPal capture failed.";
      await writeEvent(client, { runId, stage: "capture_failed", ok: false, error: message });
      return page(c, "Capture failed", `<main><h1>Capture failed</h1><p>${escapeHtml(message)}</p></main>`, 502);
    }
  });

  return app;
}

async function cartRequest(
  path: string,
  token: string,
  method: string,
  body: unknown,
  checkoutUrls?: { returnUrl: string; cancelUrl: string },
) {
  return fetch(new URL(path, getAppUrl()), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(checkoutUrls ? {
        "x-agentshelf-return-url": checkoutUrls.returnUrl,
        "x-agentshelf-cancel-url": checkoutUrls.cancelUrl,
      } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function apiError(response: Response) {
  try {
    const body = await response.json() as Record<string, unknown>;
    return String(body.message ?? body.error ?? `Cart API returned ${response.status}.`);
  } catch {
    return `Cart API returned ${response.status}.`;
  }
}

function page(c: any, title: string, content: string, status = 200) {
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/pages.css"></head><body>${content}</body></html>`, status);
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
