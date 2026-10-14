import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { Hono } from "hono";
import { jwtVerify } from "jose";
import { getAppUrl, PLATFORM_AUDIENCE, PLATFORM_ISSUER } from "./config.js";
import { CARTS_TABLE, getDoc, putDoc } from "./db.js";
import type { PlatformKey } from "./platform.js";
import { getProduct, type Product } from "./products.js";
import {
  createPayPalClientFromEnv,
  missingPayPalCredentials,
  PayPalApiError,
  type CartTotals,
} from "./paypal.js";

const defaultShipping = [
  { id: "standard", name: "Standard", description: "Standard delivery", price: { currency_code: "USD", value: "5.00" }, is_selected: true },
  { id: "express", name: "Express", description: "Expedited delivery", price: { currency_code: "USD", value: "15.00" }, is_selected: false },
];

export function createMerchantRoutes(db: Db, key: PlatformKey) {
  const app = new Hono();

  const authenticate = async (c: any, next: () => Promise<void>) => {
    const token = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return c.json(errorBody("UNAUTHORIZED", "A valid Bearer token is required."), 401);
    try {
      const { payload } = await jwtVerify(token, key.publicKey, {
        algorithms: ["RS256"],
        issuer: PLATFORM_ISSUER,
        audience: PLATFORM_AUDIENCE,
      });
      const scope = payload.scope;
      if (
        typeof payload.merchant_id !== "string" ||
        !(Array.isArray(scope) ? scope.includes("cart") : typeof scope === "string" && scope.split(/\s+/).includes("cart"))
      ) {
        return c.json(errorBody("UNAUTHORIZED", "The token is not authorized for Cart API access."), 401);
      }
    } catch {
      return c.json(errorBody("UNAUTHORIZED", "The Bearer token is invalid or expired."), 401);
    }
    await next();
  };
  app.use("/merchant-cart", authenticate);
  app.use("/merchant-cart/*", authenticate);

  app.get("/merchant-cart", (c) =>
    c.json(errorBody("METHOD_NOT_ALLOWED", "Use POST to create a cart."), 405),
  );
  app.post("/merchant-cart", async (c) => {
    const paypal = createPayPalClientFromEnv();
    const input = await readBody(c);
    if (!input.ok) return c.json(errorBody("INVALID_REQUEST", "Request body must be valid JSON."), 400);
    const built = await buildCart(db, input.body, randomUUID());
    if (built instanceof Response) return built;
    const invalid = validateShippingDestination(built.shipping_address);
    if (invalid) return invalid;

    if (paypal && built.payment_method) {
      try {
        const order = await paypal.createOrder(built.totals, {
          returnUrl: c.req.header("x-agentshelf-return-url"),
          cancelUrl: c.req.header("x-agentshelf-cancel-url"),
        }, `agentshelf-create-${built.id}`);
        built.payment_method.token = String(order.id);
        const approval = getApprovalUrl(order);
        if (approval) built.payment_method.approval_url = approval;
      } catch (error) {
        return paypalFailure(c, error);
      }
    }
    await saveCart(db, built);
    return c.json(built, 201);
  });

  app.get("/merchant-cart/:cartId", async (c) => {
    const stored = await getDoc<{ cart: Record<string, any> }>(
      db,
      CARTS_TABLE,
      c.req.param("cartId"),
    );
    return stored
      ? c.json(stored.cart)
      : c.json(errorBody("RESOURCE_NOT_FOUND", "Cart was not found."), 404);
  });

  app.put("/merchant-cart/:cartId", async (c) => {
    const paypal = createPayPalClientFromEnv();
    const id = c.req.param("cartId");
    const previous = await getDoc<{ cart: Record<string, any> }>(db, CARTS_TABLE, id);
    if (!previous) return c.json(errorBody("RESOURCE_NOT_FOUND", "Cart was not found."), 404);
    const input = await readBody(c);
    if (!input.ok) return c.json(errorBody("INVALID_REQUEST", "Request body must be valid JSON."), 400);
    const built = await buildCart(db, input.body, id);
    if (built instanceof Response) return built;
    const invalid = validateShippingDestination(built.shipping_address);
    if (invalid) return invalid;
    const orderId = previous.cart.payment_method?.token;
    if (paypal && orderId) {
      if (built.payment_method?.token && built.payment_method.token !== orderId) {
        return paymentError("The PayPal payment token does not match this cart.", built.payment_method.token);
      }
      try {
        await paypal.patchOrderAmount(orderId, built.totals);
        if (built.payment_method) built.payment_method.token = orderId;
      } catch (error) {
        return paypalFailure(c, error);
      }
    }
    await saveCart(db, built);
    return c.json(built);
  });

  app.post("/merchant-cart/:cartId/checkout", async (c) => {
    const id = c.req.param("cartId");
    const previous = await getDoc<{ cart: Record<string, any> }>(db, CARTS_TABLE, id);
    if (!previous) return c.json(errorBody("RESOURCE_NOT_FOUND", "Cart was not found."), 404);
    const input = await readBody(c);
    if (!input.ok) return c.json(errorBody("INVALID_REQUEST", "Request body must be valid JSON."), 400);
    const token = input.body.payment_method?.token ?? previous.cart.payment_method?.token;
    const paypal = createPayPalClientFromEnv();
    if (!paypal) {
      const missing = missingPayPalCredentials();
      return c.json(errorBody(
        "SERVICE_UNAVAILABLE",
        `PayPal sandbox checkout is unavailable. Missing environment variables: ${missing.join(", ")}.`,
      ), 503);
    }
    if (typeof token !== "string" || token.length === 0) {
      return paymentError("The cart has no PayPal order token to capture.");
    }
    try {
      const capture = await paypal.captureOrder(token, `agentshelf-capture-${token}`);
      const completed = { ...previous.cart, status: "COMPLETED" };
      await saveCart(db, completed);
      const capturedAmount = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
      return c.json({
        ...completed,
        payment_confirmation: {
          merchant_order_number: String(capture.id ?? token),
          ...(capture.status ? { status: capture.status } : {}),
          ...(capturedAmount ? { amount: capturedAmount } : {}),
        },
      });
    } catch (error) {
      return paypalFailure(c, error);
    }
  });
  return app;
}

async function buildCart(db: Db, input: Record<string, any>, id: string) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return businessError("DATA_ERROR", "MISSING_FIELD", "At least one cart item is required.", {
      specific_issue: "REQUIRED_FIELD_MISSING",
      field_name: "items",
      required_fields: ["items"],
    });
  }
  const items: Record<string, any>[] = [];
  const productIds: string[] = [];
  for (const requested of input.items) {
    const product = await getProduct(db, String(requested.variant_id ?? ""));
    if (!product) {
      return businessError("DATA_ERROR", "INVALID_DATA", "The requested product variant was not found.", {
        specific_issue: "ITEM_NOT_FOUND",
        field_name: "variant_id",
        provided_value: String(requested.variant_id ?? ""),
      });
    }
    if (!Number.isInteger(requested.quantity) || requested.quantity < 1) {
      return businessError("DATA_ERROR", "INVALID_DATA", "Item quantity must be a positive integer.", {
        specific_issue: "INVALID_ITEM_DATA",
        field_name: "quantity",
      });
    }
    if (product.inventory < requested.quantity) {
      return businessError("INVENTORY_ISSUE", "BUSINESS_RULE", "The requested quantity is not in stock.", {
        specific_issue: "ITEM_OUT_OF_STOCK",
        item_id: product.id,
        variant_id: product.id,
        available_quantity: product.inventory,
        requested_quantity: requested.quantity,
      });
    }
    productIds.push(product.id);
    items.push({
      ...requested,
      item_id: product.id,
      variant_id: product.id,
      parent_id: product.id,
      name: product.title,
      description: product.description,
      price: { currency_code: "USD", value: money(Number(product.price)) },
    });
  }
  const paymentMethod = input.payment_method;
  if (paymentMethod && String(paymentMethod.type).toLowerCase() !== "paypal") {
    return businessError("DATA_ERROR", "INVALID_DATA", "Only PayPal payment methods are supported.", {
      specific_issue: "INVALID_CUSTOMER_DATA",
      field_name: "payment_method.type",
    });
  }
  const shippingAddress = input.shipping_address;
  const options = normalizeShipping(input.available_shipping_options);
  const totals = calculateTotals(items, options, shippingAddress);
  const validationIssues = [];
  if (!shippingAddress) {
    validationIssues.push({
      code: "SHIPPING_ERROR",
      type: "MISSING_FIELD",
      message: "A shipping address is required to complete this physical-goods order.",
      user_message: "Add a shipping address to continue.",
      field: "shipping_address",
      context: { specific_issue: "MISSING_SHIPPING_ADDRESS" },
    });
  }
  if (!paymentMethod) {
    validationIssues.push({
      code: "DATA_ERROR",
      type: "MISSING_FIELD",
      message: "A PayPal payment method is required to complete checkout.",
      user_message: "Choose PayPal as the payment method to continue.",
      field: "payment_method",
      context: { specific_issue: "MISSING_PAYMENT_METHOD", field_name: "payment_method" },
    });
  }
  return {
    id,
    status: "CREATED",
    validation_status: validationIssues.length ? "REQUIRES_ADDITIONAL_INFORMATION" : "VALID",
    validation_issues: validationIssues,
    items,
    totals,
    applied_coupons: [],
    available_shipping_options: options,
    ...(input.customer === undefined ? {} : { customer: input.customer }),
    ...(shippingAddress === undefined ? {} : { shipping_address: shippingAddress }),
    ...(input.billing_address === undefined ? {} : { billing_address: input.billing_address }),
    ...(paymentMethod === undefined ? {} : { payment_method: { ...paymentMethod, type: "paypal" } }),
    product_ids: productIds,
  };
}

function normalizeShipping(value: unknown) {
  const options = Array.isArray(value) && value.length
    ? value
    : structuredClone(defaultShipping);
  let selected = false;
  const normalized = options.map((option: Record<string, any>) => {
    const isSelected = option.is_selected === true && !selected;
    selected ||= isSelected;
    return {
      ...option,
      price: { currency_code: "USD", value: money(Number(option.price?.value ?? 0)) },
      is_selected: isSelected,
    };
  });
  if (!normalized.some((option: { is_selected: boolean }) => option.is_selected)) {
    normalized[0].is_selected = true;
  }
  return normalized;
}

function calculateTotals(items: Record<string, any>[], options: Record<string, any>[], address?: Record<string, any>): CartTotals {
  const subtotalCents = items.reduce(
    (sum, item) => sum + cents(item.price.value) * item.quantity,
    0,
  );
  const selected = options.find((option) => option.is_selected);
  const shippingCents = cents(selected?.price.value ?? "0");
  const state = String(address?.admin_area_1 ?? "").toUpperCase();
  const rate = state === "OR" ? 0 : state === "CA" ? 0.0825 : state === "NY" ? 0.08875 : state === "WA" ? 0.065 : 0;
  const taxCents = Math.round((subtotalCents + shippingCents) * rate);
  const zero = { currency_code: "USD", value: "0.00" };
  const subtotal = { currency_code: "USD", value: money(subtotalCents / 100) };
  const shipping = { currency_code: "USD", value: money(shippingCents / 100) };
  const tax = { currency_code: "USD", value: money(taxCents / 100) };
  return {
    subtotal,
    discount: zero,
    shipping,
    tax,
    handling: zero,
    insurance: zero,
    shipping_discount: zero,
    custom_charges: zero,
    total: { currency_code: "USD", value: money((subtotalCents + shippingCents + taxCents) / 100) },
  };
}

async function saveCart(db: Db, cart: Record<string, any>) {
  await putDoc(db, CARTS_TABLE, cart.id, {
      id: cart.id,
      status: cart.status,
      product_ids: cart.product_ids,
      paypal_order_id: cart.payment_method?.token,
      created_at: cart.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      cart,
  });
}

function validateShippingDestination(address?: Record<string, any>) {
  if (!address?.country_code || address.country_code.toUpperCase() === "US") return null;
  return businessError("SHIPPING_ERROR", "BUSINESS_RULE", "Shipping is available only within the US.", {
    specific_issue: "INTERNATIONAL_SHIPPING_RESTRICTED",
    destination_country: address.country_code,
    supported_countries: ["US"],
  }, "shipping_address");
}

function businessError(code: string, type: string, message: string, context: Record<string, unknown>, field?: string) {
  return Response.json({
    name: "UNPROCESSABLE_ENTITY",
    message,
    business_context: { code, type, message, context, ...(field ? { field } : {}) },
  }, { status: 422 });
}

function paymentError(message: string, token?: string) {
  return businessError("PAYMENT_ERROR", "BUSINESS_RULE", message, {
    specific_issue: "PAYMENT_DECLINED",
    payment_method: "paypal",
    ...(token ? { payment_token: token } : {}),
  });
}

function errorBody(name: string, message: string) {
  return { name, message };
}

async function readBody(c: { req: { json: () => Promise<unknown> } }) {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? { ok: true as const, body: body as Record<string, any> }
      : { ok: false as const, body: {} };
  } catch {
    return { ok: false as const, body: {} };
  }
}

function paypalFailure(c: { json: (body: unknown, status: number) => Response }, error: unknown) {
  if (error instanceof PayPalApiError) {
    const description = error.plainReason;
    if (error.status === 422) {
      return c.json({
        name: "UNPROCESSABLE_ENTITY",
        message: description,
        issue: error.issue,
        business_context: {
          code: "PAYMENT_ERROR",
          type: "BUSINESS_RULE",
          message: description,
          context: { specific_issue: error.issue, payment_method: "paypal" },
        },
      }, 422);
    }
    return c.json({ name: String(error.payload.name ?? "PAYPAL_API_ERROR"), message: description, issue: error.issue }, error.status >= 400 && error.status < 500 ? error.status : 502);
  }
  return c.json(errorBody("PAYPAL_API_ERROR", error instanceof Error ? error.message : "PayPal request failed."), 502);
}

function getApprovalUrl(order: Record<string, any>) {
  return Array.isArray(order.links)
    ? order.links.find((link: Record<string, any>) => ["approve", "payer-action"].includes(link.rel))?.href
    : undefined;
}

function cents(value: string) {
  return Math.round(Number(value) * 100);
}

function money(value: number) {
  return value.toFixed(2);
}
