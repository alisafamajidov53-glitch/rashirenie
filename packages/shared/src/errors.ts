const SECRET_PATTERNS: RegExp[] = [
  /AIza[\w-]{16,}/gu,
  /(?:gsk|tlk)_[\w-]{8,}/gu,
  /Bearer\s+[\w.-]{8,}/giu,
  /client_secret["'=:\s]+[\w.-]{8,}/giu,
  // Google OAuth access tokens, and credentials carried in a URL query string
  // (an echoed request URL is the usual way they end up inside an error).
  /ya29\.[\w.-]{8,}/gu,
  /(?<=[?&#](?:access_token|id_token|refresh_token|key|token)=)[^&#\s"']+/giu,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[redacted]"),
    value,
  );
}

export function safeErrorMessage(
  error: unknown,
  fallback = "Unknown error",
  maximumLength = 1_000,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : fallback;
  return (
    redactSecrets(raw.replace(/\s+/gu, " ").trim()).slice(0, maximumLength) || fallback
  );
}
