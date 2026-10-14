import { randomUUID } from "node:crypto";
import {
  PAYPAL_API_BASE_URL,
} from "./config.js";

export interface Money {
  currency_code: string;
  value: string;
}

export interface CartTotals {
  subtotal?: Money;
  discount?: Money;
  shipping?: Money;
  tax?: Money;
  handling?: Money;
  insurance?: Money;
  shipping_discount?: Money;
  custom_charges?: Money;
  total: Money;
}

export class PayPalApiError extends Error {
  readonly issue: string | undefined;
  readonly plainReason: string;

  constructor(
    readonly status: number,
    readonly payload: Record<string, any>,
  ) {
    super(String(payload.message ?? payload.name ?? "PayPal API request failed"));
    this.issue = payload.details?.[0]?.issue ?? payload.name;
    this.plainReason = paypalIssueReasons[this.issue ?? ""] ?? this.message;
  }
}

const paypalIssueReasons: Record<string, string> = {
  INSTRUMENT_DECLINED: "PayPal declined the payment method. Choose a different payment method.",
  PAYER_ACTION_REQUIRED: "PayPal requires the buyer to take another action to continue.",
  ORDER_NOT_APPROVED: "The PayPal order has not been approved by the buyer.",
  ORDER_ALREADY_CAPTURED: "The PayPal order has already been captured.",
  PAYER_CANNOT_PAY: "The buyer cannot pay with this PayPal account.",
  UNPROCESSABLE_ENTITY: "PayPal could not process the request. Check the order details.",
  PERMISSION_DENIED: "PayPal denied access to this operation.",
};

export class PayPalClient {
  private cachedAccessToken?: string;
  private tokenExpiresAt = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async createOrder(
    totals: CartTotals,
    urls?: { returnUrl?: string; cancelUrl?: string },
    requestId: string = randomUUID(),
  ) {
    requestId ||= randomUUID();
    return this.apiRequest("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: "default",
          amount: this.orderAmount(totals),
        }],
        application_context: {
          return_url: urls?.returnUrl,
          cancel_url: urls?.cancelUrl,
          user_action: "PAY_NOW",
        },
      }),
    }, requestId);
  }

  async patchOrderAmount(orderId: string, totals: CartTotals) {
    return this.apiRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: JSON.stringify([{
        op: "replace",
        path: "/purchase_units/@reference_id=='default'/amount",
        value: this.orderAmount(totals),
      }]),
    });
  }

  async getOrder(orderId: string) {
    return this.apiRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
    });
  }

  async captureOrder(orderId: string, requestId: string = randomUUID()) {
    requestId ||= randomUUID();
    return this.apiRequest(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: "POST", body: "{}" },
      requestId,
    );
  }

  private orderAmount(totals: CartTotals) {
    const breakdown: Record<string, Money> = {};
    if (totals.subtotal) breakdown.item_total = totals.subtotal;
    if (totals.shipping) breakdown.shipping = totals.shipping;
    if (totals.tax) breakdown.tax_total = totals.tax;
    if (totals.handling) breakdown.handling = totals.handling;
    if (totals.insurance) breakdown.insurance = totals.insurance;
    if (totals.shipping_discount) breakdown.shipping_discount = totals.shipping_discount;
    if (totals.discount) breakdown.discount = totals.discount;
    return {
      currency_code: totals.total.currency_code,
      value: totals.total.value,
      breakdown,
    };
  }

  private async apiRequest(path: string, init: RequestInit, requestId?: string) {
    const token = await this.accessToken();
    const response = await fetch(`${PAYPAL_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = await readJson(response);
    if (!response.ok) throw new PayPalApiError(response.status, payload);
    return payload;
  }

  async accessToken() {
    if (this.cachedAccessToken && this.tokenExpiresAt > Date.now() + 30_000) {
      return this.cachedAccessToken;
    }
    const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const payload = await readJson(response);
    if (!response.ok) throw new PayPalApiError(response.status, payload);
    this.cachedAccessToken = String(payload.access_token);
    this.tokenExpiresAt = Date.now() + Number(payload.expires_in ?? 300) * 1000;
    return this.cachedAccessToken;
  }
}

export function createPayPalClientFromEnv() {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
  return PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET
    ? new PayPalClient(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET)
    : null;
}

export function missingPayPalCredentials() {
  return (["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] as const)
    .filter((key) => !process.env[key]);
}

async function readJson(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return { message: text };
  }
}
