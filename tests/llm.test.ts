import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, missingLlmCredentials } from "../server/llm.js";
import { createApp } from "../server/app.js";
import { ensureSchema } from "../server/db.js";
import { db, productInput, request, testPrefix } from "./helpers.js";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "NEBIUS_API_KEY",
  "CHANNEL3_API_KEY",
  "RENDER_API_KEY",
  "KERNEL_API_KEY",
] as const;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubEnv(overrides: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

describe("listModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("filters OpenAI ids down to chat-capable models", async () => {
    const restore = stubEnv({ OPENAI_API_KEY: "test-key-openai-1", NEBIUS_API_KEY: undefined });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("api.openai.com");
      return jsonResponse({
        data: [
          { id: "gpt-4o" },
          { id: "o3-mini" },
          { id: "gpt-4o-mini" },
          { id: "text-embedding-3-large" },
          { id: "gpt-image-1" },
          { id: "whisper-1" },
          { id: "gpt-4o-realtime-preview" },
          { id: "dall-e-3" },
          { id: "davinci-002" },
        ],
      });
    }));
    try {
      const { models, errors } = await listModels();
      expect(errors).toEqual([]);
      expect(models.map((model) => model.id)).toEqual([
        "gpt-4o",
        "gpt-4o-mini",
        "o3-mini",
      ]);
      expect(models.every((model) => model.provider === "openai")).toBe(true);
    } finally {
      restore();
    }
  });

  it("keeps only text->text Nebius models and labels them by name", async () => {
    const restore = stubEnv({ NEBIUS_API_KEY: "test-key-nebius-1", OPENAI_API_KEY: undefined });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("api.tokenfactory.nebius.com");
      return jsonResponse({
        data: [
          { id: "qwen-text", name: "Qwen3 235B", architecture: { modality: "text->text" }, context_length: 262144 },
          { id: "flux-img", name: "Flux Image", architecture: { modality: "text->image" } },
          { id: "llama-text", name: "Llama 3.3 70B", architecture: { modality: "text->text" } },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { models, errors } = await listModels();
      expect(errors).toEqual([]);
      expect(models).toEqual([
        { id: "qwen-text", provider: "nebius", label: "Qwen3 235B", contextLength: 262144 },
        { id: "llama-text", provider: "nebius", label: "Llama 3.3 70B" },
      ]);
      // Cached on a second call for the same provider+key.
      await listModels();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("captures a provider failure without throwing", async () => {
    const restore = stubEnv({ NEBIUS_API_KEY: "test-key-nebius-2", OPENAI_API_KEY: undefined });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { message: "bad key" } }, 401)));
    try {
      const { models, errors } = await listModels();
      expect(models).toEqual([]);
      expect(errors).toEqual([{ provider: "nebius", message: "bad key" }]);
    } finally {
      restore();
    }
  });

  it("names both keys when no provider is configured", () => {
    const restore = stubEnv({ OPENAI_API_KEY: undefined, NEBIUS_API_KEY: undefined });
    try {
      expect(missingLlmCredentials()).toEqual(["OPENAI_API_KEY", "NEBIUS_API_KEY"]);
    } finally {
      restore();
    }
  });
});

describe("POST /api/experiments model validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects an unknown model with a named 400", async () => {
    const restore = stubEnv({
      OPENAI_API_KEY: "test-key-openai-2",
      CHANNEL3_API_KEY: "test-channel3",
      RENDER_API_KEY: "test-render",
      KERNEL_API_KEY: "test-kernel",
    });
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ data: [{ id: "gpt-4o" }] })));
    try {
      await ensureSchema(db);
      const app = await createApp({ db });
      const created = await request(app, "POST", "/api/products", undefined, {
        ...productInput(),
        id: `${testPrefix}-models-product`,
      });
      expect(created.status).toBe(201);

      const missing = await request(app, "POST", "/api/experiments", undefined, {
        productId: `${testPrefix}-models-product`,
        query: "insulated water bottle",
        models: [],
      });
      expect(missing.status).toBe(400);

      const unknown = await request(app, "POST", "/api/experiments", undefined, {
        productId: `${testPrefix}-models-product`,
        query: "insulated water bottle",
        models: [{ id: "bogus-model", provider: "openai" }],
      });
      expect(unknown.status).toBe(400);
      expect((await unknown.json()).message).toContain("bogus-model");
    } finally {
      restore();
    }
  });
});
