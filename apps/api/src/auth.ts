import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export interface TokenInfo {
  aud?: string;
  azp?: string;
  sub?: string;
  audience?: string;
  issued_to?: string;
  user_id?: string;
  scope?: string;
  expires_in?: string | number;
}

interface CacheEntry {
  expiresAt: number;
  subject: string;
}

export interface ValidatedTokenInfo {
  subject: string;
  ttlSeconds: number;
}

const tokenCache = new Map<string, CacheEntry>();
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const MAX_CACHE_ENTRIES = 500;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Google tokeninfo uses two slightly different response shapes:
 * access tokens commonly expose issued_to/audience/user_id, while OpenID
 * responses use azp/aud/sub. Accept both, but never relax audience, scope or
 * expiry validation.
 */
export function validateGoogleTokenInfo(
  info: TokenInfo,
  expectedClientId: string,
): ValidatedTokenInfo | undefined {
  const intendedClients = new Set(
    [info.azp, info.aud, info.issued_to, info.audience].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  );
  const subject = info.sub ?? info.user_id;
  const scopes = new Set((info.scope ?? "").split(/\s+/).filter(Boolean));
  const parsedTtl = Number(info.expires_in ?? 0);
  if (
    !subject ||
    !expectedClientId ||
    !intendedClients.has(expectedClientId) ||
    !scopes.has(REQUIRED_SCOPE) ||
    !Number.isFinite(parsedTtl) ||
    parsedTtl <= 0
  ) {
    return undefined;
  }
  return {
    subject,
    ttlSeconds: Math.min(parsedTtl, 300),
  };
}

export async function requireGoogleAccessToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (config.devBypassAuth && config.nodeEnv !== "production") return;

  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    await reply.code(401).send({ error: "Google access token required" });
    return;
  }

  const key = digest(token);
  const now = Date.now();
  for (const [cacheKey, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(cacheKey);
  }
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > now) {
    request.user = { subject: cached.subject };
    return;
  }

  let response: Response;
  try {
    // The token goes in the form body, not the query string, for the same
    // reason the extension revokes it that way: request URLs are what proxies
    // and outbound-traffic logs record. tokeninfo accepts either.
    response = await fetch("https://oauth2.googleapis.com/tokeninfo", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: token }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    await reply
      .code(503)
      .send({ error: "Google token validation is temporarily unavailable" });
    return;
  }
  if (!response.ok) {
    await reply.code(401).send({ error: "Invalid or expired Google access token" });
    return;
  }

  let info: TokenInfo;
  try {
    info = (await response.json()) as TokenInfo;
  } catch {
    await reply.code(503).send({
      error: "Google token validation returned an invalid response",
    });
    return;
  }
  const validated = validateGoogleTokenInfo(info, config.googleClientId);
  if (!validated) {
    await reply.code(403).send({ error: "Token audience or YouTube scope is invalid" });
    return;
  }

  const cacheTtl = Math.max(1_000, validated.ttlSeconds * 1_000 - 5_000);
  tokenCache.set(key, {
    subject: validated.subject,
    expiresAt: Date.now() + cacheTtl,
  });
  while (tokenCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = tokenCache.keys().next().value;
    if (!oldestKey) break;
    tokenCache.delete(oldestKey);
  }
  request.user = { subject: validated.subject };
}

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      subject: string;
    };
  }
}
