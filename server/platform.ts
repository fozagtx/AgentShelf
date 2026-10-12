import { randomUUID } from "node:crypto";
import type { Client } from "@elastic/elasticsearch";
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type JWK,
} from "jose";
import { PLATFORM_AUDIENCE, PLATFORM_ISSUER } from "./config.js";
import { KEYS_INDEX } from "./elastic.js";

export interface PlatformKey {
  privateKey: Parameters<SignJWT["sign"]>[0];
  publicKey: Parameters<SignJWT["sign"]>[0];
  publicJwk: JWK;
  kid: string;
}

const KEY_ID = "agentshelf-platform-rs256";

export async function loadPlatformKey(client: Client): Promise<PlatformKey> {
  let stored: { private_jwk?: JWK; public_jwk?: JWK } | null = null;
  try {
    const response = await client.get<{ private_jwk: JWK; public_jwk: JWK }>({
      index: KEYS_INDEX,
      id: KEY_ID,
    });
    stored = response._source ?? null;
  } catch (error) {
    if ((error as { meta?: { statusCode?: number } }).meta?.statusCode !== 404) {
      throw error;
    }
  }

  if (!stored) {
    const keys = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
    const privateJwk = await exportJWK(keys.privateKey);
    const publicJwk = await exportJWK(keys.publicKey);
    privateJwk.kid = KEY_ID;
    privateJwk.alg = "RS256";
    privateJwk.use = "sig";
    publicJwk.kid = KEY_ID;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    try {
      await client.index({
        index: KEYS_INDEX,
        id: KEY_ID,
        document: {
          id: KEY_ID,
          private_jwk: privateJwk,
          public_jwk: publicJwk,
          created_at: new Date().toISOString(),
        },
        refresh: "wait_for",
        op_type: "create",
      });
    } catch (error) {
      if ((error as { meta?: { statusCode?: number } }).meta?.statusCode !== 409) {
        throw error;
      }
    }
    return loadPlatformKey(client);
  }

  if (!stored.private_jwk || !stored.public_jwk) {
    throw new Error("The persisted AgentShelf platform signing key is incomplete.");
  }
  return {
    privateKey: await importJWK(stored.private_jwk, "RS256"),
    publicKey: await importJWK(stored.public_jwk, "RS256"),
    publicJwk: stored.public_jwk,
    kid: KEY_ID,
  };
}

export async function mintPlatformToken(client: Client, merchantId = "agentshelf") {
  const key = await loadPlatformKey(client);
  return new SignJWT({ merchant_id: merchantId, scope: ["cart"] })
    .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
    .setIssuer(PLATFORM_ISSUER)
    .setAudience(PLATFORM_AUDIENCE)
    .setSubject(merchantId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key.privateKey);
}
