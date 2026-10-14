import OpenAI from "openai";

export type Provider = "openai" | "nebius";

export interface ModelOption {
  id: string;
  provider: Provider;
  label: string;
  contextLength?: number;
}

export const PROVIDERS: Provider[] = ["openai", "nebius"];

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  nebius: "Nebius",
};

const PROVIDER_KEYS: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  nebius: "NEBIUS_API_KEY",
};

export const NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

const OPENAI_EXCLUDE =
  /embedding|tts|whisper|dall-e|image|audio|realtime|transcribe|moderation|search/i;

const modelCache = new Map<string, { at: number; models: ModelOption[]; error?: string }>();

export function llm(provider: Provider): OpenAI {
  if (provider === "nebius") {
    return new OpenAI({
      apiKey: process.env.NEBIUS_API_KEY,
      baseURL: NEBIUS_BASE_URL,
    });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export function configuredProviders(): Provider[] {
  return PROVIDERS.filter((provider) => Boolean(process.env[PROVIDER_KEYS[provider]]));
}

export function missingLlmCredentials(): string[] {
  return configuredProviders().length ? [] : ["OPENAI_API_KEY", "NEBIUS_API_KEY"];
}

export function hasLlm() {
  return configuredProviders().length > 0;
}

export async function listModels(): Promise<{
  models: ModelOption[];
  errors: { provider: Provider; message: string }[];
}> {
  const models: ModelOption[] = [];
  const errors: { provider: Provider; message: string }[] = [];
  for (const provider of configuredProviders()) {
    const key = process.env[PROVIDER_KEYS[provider]] ?? "";
    const cacheKey = `${provider}:${key}`;
    const cached = modelCache.get(cacheKey);
    if (cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS) {
      models.push(...cached.models);
      if (cached.error) errors.push({ provider, message: cached.error });
      continue;
    }
    try {
      const listed = provider === "nebius"
        ? await listNebiusModels(key)
        : await listOpenAiModels();
      modelCache.set(cacheKey, { at: Date.now(), models: listed });
      models.push(...listed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      modelCache.set(cacheKey, { at: Date.now(), models: [], error: message });
      errors.push({ provider, message });
    }
  }
  return { models, errors };
}

async function listOpenAiModels(): Promise<ModelOption[]> {
  const client = llm("openai");
  const page = await client.models.list();
  return page.data
    .map((model) => model.id)
    .filter((id) => (id.startsWith("gpt-") || /^o\d/.test(id)) && !OPENAI_EXCLUDE.test(id))
    .sort()
    .map((id) => ({ id, provider: "openai" as const, label: id }));
}

async function listNebiusModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch(`${NEBIUS_BASE_URL}models?verbose=true`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    throw new Error(String(payload.error?.message ?? payload.message ?? `Nebius model list failed (${response.status}).`));
  }
  const entries: Record<string, any>[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  return entries
    .filter((entry) => entry?.architecture?.modality === "text->text")
    .map((entry) => ({
      id: String(entry.id ?? entry.name),
      provider: "nebius" as const,
      label: String(entry.name ?? entry.id),
      ...(Number.isFinite(Number(entry.context_length))
        ? { contextLength: Number(entry.context_length) }
        : {}),
    }));
}
