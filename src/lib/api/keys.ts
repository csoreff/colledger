/**
 * API key minting and verification.
 *
 * A key is shown to its owner exactly once, at creation. Only the SHA-256 of
 * the plaintext is stored, so the database never holds anything that can be
 * replayed against the API.
 *
 * SHA-256 rather than bcrypt, deliberately, and the reasoning differs from
 * passwords: an API key is 32 bytes of CSPRNG output with no guessable
 * structure, so there is nothing for a slow hash to protect against — and
 * verification happens on every API request, where bcrypt's cost would be paid
 * over and over. The flat hash also means a lookup is a single indexed read
 * instead of a scan-and-compare across every stored key.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { ApiKey, ApiScope, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Visible marker so a leaked key is recognizable in logs and search. */
const KEY_PREFIX = "cl_";
const PREFIX_DISPLAY_LENGTH = 11;

export type MintedKey = {
  /** The only time the caller will ever see this. */
  plaintext: string;
  prefix: string;
  hash: string;
};

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function mintApiKey(): MintedKey {
  // base64url over hex: same entropy in fewer characters, and no padding to
  // trip up whoever pastes it into a config file.
  const plaintext = KEY_PREFIX + randomBytes(32).toString("base64url");
  return {
    plaintext,
    prefix: plaintext.slice(0, PREFIX_DISPLAY_LENGTH),
    hash: hashApiKey(plaintext),
  };
}

export type VerifiedKey = ApiKey & { user: User };

export type KeyFailure =
  | "malformed"
  | "unknown"
  | "revoked"
  | "expired"
  | "user_disabled";

/**
 * Looks up a presented key and confirms it is still usable.
 *
 * `lastUsedAt` is updated fire-and-forget: it is bookkeeping for the
 * management UI, and making every API request wait on that write would add a
 * round trip to the hot path for no benefit to the caller.
 */
export async function verifyApiKey(
  plaintext: string,
): Promise<{ ok: true; key: VerifiedKey } | { ok: false; reason: KeyFailure }> {
  if (!plaintext || !plaintext.startsWith(KEY_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }

  const hash = hashApiKey(plaintext);
  const key = await prisma.apiKey.findUnique({ where: { hash }, include: { user: true } });
  if (!key) return { ok: false, reason: "unknown" };

  // The lookup above already matched on the full hash, so this comparison can
  // only succeed; it is here so the code path never grows a short-circuiting
  // string compare on secret material.
  const presented = Buffer.from(hash, "hex");
  const stored = Buffer.from(key.hash, "hex");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    return { ok: false, reason: "unknown" };
  }

  if (key.revokedAt) return { ok: false, reason: "revoked" };
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (!key.user.isActive) return { ok: false, reason: "user_disabled" };

  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      // A failed timestamp update must not fail the request it belongs to.
    });

  return { ok: true, key };
}

/**
 * Creates a key for a user.
 *
 * ADMIN_ALL is refused to non-admins here rather than only in the UI: this is
 * the one function that writes scopes, so it is the only place the rule can't
 * be bypassed.
 */
export async function createApiKeyFor(params: {
  userId: string;
  name: string;
  scopes: ApiScope[];
  expiresAt?: Date | null;
}): Promise<{ ok: true; plaintext: string; key: ApiKey } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) return { ok: false, error: "No such user." };

  const scopes = Array.from(new Set(params.scopes));
  if (scopes.length === 0) return { ok: false, error: "Choose at least one scope." };
  if (scopes.includes("ADMIN_ALL") && user.role !== "ADMIN") {
    return { ok: false, error: "Only an admin can create a key with the admin scope." };
  }

  const minted = mintApiKey();
  const key = await prisma.apiKey.create({
    data: {
      userId: params.userId,
      name: params.name,
      prefix: minted.prefix,
      hash: minted.hash,
      scopes,
      expiresAt: params.expiresAt ?? null,
    },
  });

  return { ok: true, plaintext: minted.plaintext, key };
}
