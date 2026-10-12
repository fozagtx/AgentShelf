export interface Status {
  paypal: boolean;
  channel3: boolean;
  kernel: boolean;
  render: boolean;
  elastic: boolean;
  astropods: boolean;
}

export interface Channel3Hit { channel3Id: string; title: string; brand: string; price: number; imageUrl: string; url: string }

export interface Product {
  id: string;
  title: string;
  description: string;
  brand: string;
  price: number;
  image_url: string;
  inventory: number;
  category: string;
  key_features: string[];
  fixed_variant?: { title: string; description: string; key_features: string[]; rationale: string[] };
}

export interface Competitor {
  id: string;
  title: string;
  brand?: string;
  image_url?: string;
  price: number;
  domain: string;
  url: string;
}

export interface Experiment {
  id: string;
  product_id: string;
  query: string;
  reps: number;
  status: string;
  created_at: string;
  competitors: Competitor[];
  run_counts?: { total: number; done: number };
}

export interface Analytics {
  shareByModel: { model: string; variant: string; runs: number; merchantPicks: number; share: number }[];
  positionBias: { position: number; runs: number; picks: number; share: number }[];
  funnel: { model: string; stage: string; count: number }[];
  failures: { runId: string; model: string; variant: string; stage: string; reason: string; replayUrl?: string }[];
  takeaway: {
    headline: string | null;
    bestFix: { model: string; originalShare: number; fixedShare: number; delta: number } | null;
    topBreak: { model: string; stage: string; count: number } | null;
    overall: { originalShare: number; fixedShare: number } | null;
  };
}

export interface WhyHit {
  runId: string;
  model: string;
  variant: string;
  chosenTitle: string | null;
  outcome: string;
  reasoning: string;
  score: number;
}

export type RunRow = Record<string, string | number | boolean | null>;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? body?.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  status: () => call<Status>("/api/status"),
  products: () => call<Product[]>("/api/products"),
  createProduct: (p: Omit<Product, "id">) => call<Product>("/api/products", { method: "POST", body: JSON.stringify(p) }),
  updateProduct: (id: string, p: Partial<Product>) => call<Product>(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  fix: (id: string) => call<Product>(`/api/products/${id}/fix`, { method: "POST" }),
  importProduct: (body: { url?: string; channel3Id?: string; inventory?: number }) => call<Product>("/api/products/import", { method: "POST", body: JSON.stringify(body) }),
  searchChannel3: (q: string) => call<Channel3Hit[]>(`/api/products/search?q=${encodeURIComponent(q)}`),
  experiments: () => call<Experiment[]>("/api/experiments"),
  experiment: (id: string) => call<Experiment>(`/api/experiments/${id}`),
  createExperiment: (b: { productId: string; query: string; reps: number }) =>
    call<{ id: string }>("/api/experiments", { method: "POST", body: JSON.stringify(b) }),
  analytics: (id: string) => call<Analytics>(`/api/experiments/${id}/analytics`),
  runs: (id: string) => call<RunRow[]>(`/api/experiments/${id}/runs`),
  why: (id: string, query: string) =>
    call<{ hits: WhyHit[] }>(`/api/experiments/${id}/why?q=${encodeURIComponent(query)}`),
};
