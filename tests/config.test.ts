import { afterEach, describe, expect, it } from "vitest";
import { getAppUrl } from "../server/config.js";

const ENV_KEYS = ["APP_URL", "APP_HOST", "RENDER_EXTERNAL_URL", "NODE_ENV"] as const;

describe("getAppUrl", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function setEnv(overrides: Record<string, string | undefined>) {
    for (const key of ENV_KEYS) {
      if (!(key in saved)) saved[key] = process.env[key];
      const value = overrides[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  it("prefers APP_URL and strips a trailing slash", () => {
    setEnv({
      APP_URL: "https://app.example.com/",
      RENDER_EXTERNAL_URL: "https://render.example.com",
      APP_HOST: "host.example.com",
      NODE_ENV: "production",
    });
    expect(getAppUrl()).toBe("https://app.example.com");
  });

  it("uses RENDER_EXTERNAL_URL when APP_URL is unset", () => {
    setEnv({ RENDER_EXTERNAL_URL: "https://agentshelf.onrender.com/", NODE_ENV: "production" });
    expect(getAppUrl()).toBe("https://agentshelf.onrender.com");
  });

  it("builds an https URL from APP_HOST", () => {
    setEnv({ APP_HOST: "agentshelf.onrender.com", NODE_ENV: "production" });
    expect(getAppUrl()).toBe("https://agentshelf.onrender.com");
  });

  it("falls back to the local dev URL outside production", () => {
    setEnv({ NODE_ENV: "development" });
    expect(getAppUrl()).toBe("http://127.0.0.1:3000");
  });

  it("throws in production when no URL source is set", () => {
    setEnv({ NODE_ENV: "production" });
    expect(() => getAppUrl()).toThrow("APP_URL is not set");
  });
});
