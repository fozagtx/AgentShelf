import { randomUUID } from "node:crypto";
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type JWK,
} from "jose";
import { PLATFORM_AUDIENCE, PLATFORM_ISSUER } from "./config.js";
import type { Db } from "./db.js";
import { getDoc, KEYS_TABLE, putDoc } from "./db.js";

export interface PlatformKey {
  privateKey: Parameters<SignJWT["sign"]>[0];
  publicKey: Parameters<SignJWT["sign"]>[0];
  publicJwk: JWK;
  kid: string;
}

const KEY_ID = "agentshelf-platform-rs256";

export async function loadPlatformKey(db: Db): Promise<PlatformKey> {
  const stored = await getDoc<{ private_jwk?: JWK; public_jwk?: JWK }>(
    db,
    KEYS_TABLE,
    KEY_ID,
  );

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
    await putDoc(db, KEYS_TABLE, KEY_ID, {
      id: KEY_ID,
      private_jwk: privateJwk,
      public_jwk: publicJwk,
      created_at: new Date().toISOString(),
    });
    return loadPlatformKey(db);
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

export async function mintPlatformToken(db: Db, merchantId = "agentshelf") {
  const key = await loadPlatformKey(db);
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
