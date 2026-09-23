import {
  isGoogleClientId,
  normalizeGoogleClientId,
  type ExtensionSettings,
  type SupportedLanguage,
} from "@channelpilot/shared";

const TOKEN_KEY = "googleOAuthToken";
const ACCOUNT_HINT_KEY = "googleOAuthAccountHintV1";
const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
const SCOPES = ["openid", "email", ...YOUTUBE_SCOPES];

interface StoredToken {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  clientId: string;
}

interface StoredAccountHint {
  clientId: string;
  authUser?: string;
  email?: string;
  subject?: string;
}

const silentTokenRequests = new Map<string, Promise<string>>();
let tokenGeneration = 0;
let tokenStorageQueue: Promise<void> = Promise.resolve();

function queueTokenStorage<T>(operation: () => Promise<T>): Promise<T> {
  const task = tokenStorageQueue.then(operation);
  tokenStorageQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function randomBase64Url(bytes = 24): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function validatedIdentity(
  idToken: string,
  clientId: string,
  nonce: string,
): { email?: string; subject?: string } {
  const payload = decodeJwtPayload(idToken);
  const audience = payload?.aud;
  const audienceMatches =
    audience === clientId || (Array.isArray(audience) && audience.includes(clientId));
  const issuer = payload?.iss;
  const issuerMatches =
    issuer === "https://accounts.google.com" || issuer === "accounts.google.com";
  const expiresAt = Number(payload?.exp ?? 0) * 1_000;
  if (
    !payload ||
    !audienceMatches ||
    !issuerMatches ||
    payload.nonce !== nonce ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error("Google OpenID token validation failed");
  }
  const email =
    typeof payload.email === "string" &&
    payload.email.length <= 254 &&
    /^[^\s@]+@[^\s@]+$/.test(payload.email)
      ? payload.email
      : undefined;
  const subject =
    typeof payload.sub === "string" && payload.sub.length <= 255
      ? payload.sub
      : undefined;
  return {
    ...(email ? { email } : {}),
    ...(subject ? { subject } : {}),
  };
}

function tr(language: SupportedLanguage, ru: string, en: string): string {
  return language === "ru" ? ru : en;
}

function oauthErrorMessage(
  error: unknown,
  redirectUri: string,
  language: SupportedLanguage,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown_error";
  const normalized = raw.toLowerCase();

  if (/bad client id|invalid_client|client id.*(invalid|unknown)/i.test(raw)) {
    return tr(
      language,
      "Google отклонил OAuth Client ID. Вставьте идентификатор клиента типа «Веб-приложение» вида ….apps.googleusercontent.com — не Gemini API key и не Client secret.",
      "Google rejected the OAuth Client ID. Enter a Web application client ID ending in .apps.googleusercontent.com — not a Gemini API key or client secret.",
    );
  }
  if (
    normalized.includes("redirect_uri_mismatch") ||
    normalized.includes("redirect uri mismatch")
  ) {
    return tr(
      language,
      `Redirect URI не зарегистрирован в Google Cloud. Добавьте его без изменений: ${redirectUri}`,
      `The redirect URI is not registered in Google Cloud. Add it exactly as shown: ${redirectUri}`,
    );
  }
  if (
    normalized.includes("access_denied") ||
    normalized.includes("did not approve") ||
    normalized.includes("user denied")
  ) {
    return tr(
      language,
      "Google не выдал доступ. Подтвердите оба read-only разрешения YouTube; если приложение в режиме Testing — добавьте аккаунт в Test users.",
      "Google did not grant access. Approve both read-only YouTube permissions; if the app is in Testing, add the account under Test users.",
    );
  }
  if (
    normalized.includes("interaction_required") ||
    normalized.includes("login_required")
  ) {
    return tr(
      language,
      "Google требует повторный интерактивный вход. Нажмите «Войти через Google» ещё раз.",
      "Google requires an interactive sign-in. Click “Sign in with Google” again.",
    );
  }
  if (
    normalized.includes("authorization page could not be loaded") ||
    normalized.includes("network") ||
    normalized.includes("net::")
  ) {
    return tr(
      language,
      "Страница Google OAuth не загрузилась. Проверьте интернет, VPN/прокси и блокировщики, затем повторите вход.",
      "The Google OAuth page could not load. Check your network, VPN/proxy and blockers, then try again.",
    );
  }
  if (
    normalized.includes("canceled") ||
    normalized.includes("cancelled") ||
    normalized.includes("closed")
  ) {
    return tr(
      language,
      "Окно Google было закрыто до завершения входа.",
      "The Google window was closed before sign-in completed.",
    );
  }

  return `Google OAuth: ${raw.slice(0, 500)}`;
}

function responseParameters(url: URL): URLSearchParams {
  const result = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  fragment.forEach((value, key) => result.set(key, value));
  return result;
}

async function readStoredToken(
  expectedClientId: string,
): Promise<StoredToken | undefined> {
  await tokenStorageQueue;
  const value = await chrome.storage.session.get(TOKEN_KEY);
  const token = value[TOKEN_KEY] as StoredToken | undefined;
  if (
    !token ||
    typeof token.accessToken !== "string" ||
    !Array.isArray(token.scopes) ||
    token.clientId !== expectedClientId ||
    token.expiresAt <= Date.now() + 60_000 ||
    !YOUTUBE_SCOPES.every((scope) => token.scopes.includes(scope))
  ) {
    return undefined;
  }
  return token;
}

async function readAnyStoredToken(): Promise<StoredToken | undefined> {
  await tokenStorageQueue;
  const value = await chrome.storage.session.get(TOKEN_KEY);
  const token = value[TOKEN_KEY] as StoredToken | undefined;
  return token && typeof token.accessToken === "string" ? token : undefined;
}

export function getGoogleRedirectUri(): string {
  return chrome.identity.getRedirectURL("google");
}

async function readAccountHint(
  clientId: string,
): Promise<StoredAccountHint | undefined> {
  const stored = await chrome.storage.local.get(ACCOUNT_HINT_KEY);
  const hint = stored[ACCOUNT_HINT_KEY] as StoredAccountHint | undefined;
  if (!hint || hint.clientId !== clientId) return undefined;
  const authUser =
    typeof hint.authUser === "string" && /^\d+$/.test(hint.authUser)
      ? hint.authUser
      : undefined;
  const email =
    typeof hint.email === "string" &&
    hint.email.length <= 254 &&
    /^[^\s@]+@[^\s@]+$/.test(hint.email)
      ? hint.email
      : undefined;
  if (!authUser && !email) return undefined;
  return {
    clientId,
    ...(authUser ? { authUser } : {}),
    ...(email ? { email } : {}),
    ...(typeof hint.subject === "string"
      ? { subject: hint.subject.slice(0, 255) }
      : {}),
  };
}

async function requestGoogleToken(
  interactive: boolean,
  settings: ExtensionSettings,
  requestGeneration: number,
): Promise<string> {
  const clientId = normalizeGoogleClientId(settings.googleClientId);
  if (!isGoogleClientId(clientId)) {
    throw new Error(
      tr(
        settings.interfaceLanguage,
        "Введите OAuth Client ID типа «Веб-приложение» вида ….apps.googleusercontent.com. Gemini API key сюда не подходит.",
        "Enter a Web application OAuth Client ID ending in .apps.googleusercontent.com. A Gemini API key cannot be used here.",
      ),
    );
  }
  // A user pressing “Reconnect” expects the account chooser even when the
  // current access token is still valid. Silent calls reuse the stored token.
  if (!interactive) {
    const stored = await readStoredToken(clientId);
    if (stored) return stored.accessToken;
  }

  const redirectUri = getGoogleRedirectUri();
  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const accountHint = await readAccountHint(clientId);
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "token id_token",
    response_mode: "fragment",
    scope: SCOPES.join(" "),
    include_granted_scopes: "true",
    prompt: interactive ? "select_account" : "none",
    state,
    nonce,
  });
  if (!interactive && accountHint?.authUser) {
    query.set("authuser", accountHint.authUser);
  }
  if (accountHint?.email) {
    query.set("login_hint", accountHint.email);
  }

  let finalUrl: string | undefined;
  try {
    finalUrl = await chrome.identity.launchWebAuthFlow({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${query}`,
      interactive,
      ...(interactive
        ? {}
        : {
            abortOnLoadForNonInteractive: false,
            timeoutMsForNonInteractive: 20_000,
          }),
    });
  } catch (error) {
    if (!interactive) {
      throw new Error(
        tr(
          settings.interfaceLanguage,
          "Фоновая Google-сессия недоступна. Откройте расширение и войдите снова.",
          "The background Google session is unavailable. Open the extension and sign in again.",
        ),
      );
    }
    throw new Error(oauthErrorMessage(error, redirectUri, settings.interfaceLanguage));
  }
  if (!finalUrl) {
    throw new Error(
      tr(
        settings.interfaceLanguage,
        "Google не вернул результат авторизации.",
        "Google did not return an authorization result.",
      ),
    );
  }

  const responseUrl = new URL(finalUrl);
  const expectedRedirect = new URL(redirectUri);
  if (
    responseUrl.origin !== expectedRedirect.origin ||
    responseUrl.pathname !== expectedRedirect.pathname
  ) {
    throw new Error(
      tr(
        settings.interfaceLanguage,
        "Google вернул результат на неожиданный адрес. Авторизация отменена.",
        "Google returned the result to an unexpected address. Authorization was cancelled.",
      ),
    );
  }
  const params = responseParameters(responseUrl);
  if (params.get("state") !== state) {
    throw new Error(
      tr(
        settings.interfaceLanguage,
        "Проверка безопасности OAuth не пройдена. Повторите вход.",
        "The OAuth security check failed. Try signing in again.",
      ),
    );
  }
  const oauthError = params.get("error");
  if (oauthError) {
    throw new Error(
      oauthErrorMessage(
        `${oauthError}: ${params.get("error_description") ?? ""}`,
        redirectUri,
        settings.interfaceLanguage,
      ),
    );
  }
  const accessToken = params.get("access_token");
  if (!accessToken) {
    throw new Error(
      tr(
        settings.interfaceLanguage,
        "Google не вернул access token. Проверьте тип OAuth-клиента и Redirect URI.",
        "Google did not return an access token. Check the OAuth client type and redirect URI.",
      ),
    );
  }
  const idToken = params.get("id_token");
  if (!idToken) {
    throw new Error(
      tr(
        settings.interfaceLanguage,
        "Google не вернул OpenID token. Повторите вход и подтвердите доступ к адресу аккаунта.",
        "Google did not return an OpenID token. Sign in again and approve access to the account email.",
      ),
    );
  }
  let identity: { email?: string; subject?: string };
  try {
    identity = validatedIdentity(idToken, clientId, nonce);
  } catch {
    throw new Error(
      tr(
        settings.interfaceLanguage,
        "Проверка личности Google не пройдена. Авторизация отменена; повторите вход.",
        "Google identity validation failed. Authorization was cancelled; try again.",
      ),
    );
  }

  const parsedExpiresIn = Number(params.get("expires_in") ?? 3_600);
  const expiresIn =
    Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0
      ? Math.max(60, Math.min(parsedExpiresIn, 86_400))
      : 3_600;
  const grantedScopes = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);
  const effectiveScopes = grantedScopes.length > 0 ? grantedScopes : SCOPES;
  const missingScopes = YOUTUBE_SCOPES.filter(
    (scope) => !effectiveScopes.includes(scope),
  );
  if (missingScopes.length > 0) {
    throw new Error(
      tr(
        settings.interfaceLanguage,
        "Google не предоставил оба read-only разрешения YouTube. Повторите вход и подтвердите доступ.",
        "Google did not grant both read-only YouTube permissions. Sign in again and approve access.",
      ),
    );
  }
  const authUser = params.get("authuser");
  const storedAccountHint =
    (authUser && /^\d+$/.test(authUser)) || identity.email
      ? ({
          clientId,
          ...(authUser && /^\d+$/.test(authUser) ? { authUser } : {}),
          ...identity,
        } satisfies StoredAccountHint)
      : undefined;
  await queueTokenStorage(async () => {
    if (requestGeneration !== tokenGeneration) {
      throw new Error(
        tr(
          settings.interfaceLanguage,
          "Google-сессия изменилась во время входа. Повторите попытку.",
          "The Google session changed during sign-in. Try again.",
        ),
      );
    }
    await chrome.storage.session.set({
      [TOKEN_KEY]: {
        accessToken,
        expiresAt: Date.now() + expiresIn * 1_000,
        scopes: effectiveScopes,
        clientId,
      } satisfies StoredToken,
    });
    if (storedAccountHint) {
      await chrome.storage.local.set({
        [ACCOUNT_HINT_KEY]: storedAccountHint,
      });
    }
  });
  return accessToken;
}

export async function getGoogleToken(
  interactive: boolean,
  settings: ExtensionSettings,
): Promise<string> {
  const clientId = normalizeGoogleClientId(settings.googleClientId);
  if (interactive) {
    const requestGeneration = ++tokenGeneration;
    return requestGoogleToken(true, settings, requestGeneration);
  }
  const existing = silentTokenRequests.get(clientId);
  if (existing) return existing;
  const requestGeneration = tokenGeneration;
  const request = requestGoogleToken(false, settings, requestGeneration);
  silentTokenRequests.set(clientId, request);
  try {
    return await request;
  } finally {
    if (silentTokenRequests.get(clientId) === request) {
      silentTokenRequests.delete(clientId);
    }
  }
}

export async function invalidateGoogleToken(): Promise<void> {
  // A silent refresh may still be in flight when YouTube rejects the current
  // token. Invalidate its generation as well, otherwise that older request can
  // write a token back after this removal and make the account appear to log
  // out and reconnect unpredictably.
  tokenGeneration += 1;
  silentTokenRequests.clear();
  await queueTokenStorage(() => chrome.storage.session.remove(TOKEN_KEY));
}

export async function hasGoogleSession(settings: ExtensionSettings): Promise<boolean> {
  const clientId = normalizeGoogleClientId(settings.googleClientId);
  return isGoogleClientId(clientId) ? Boolean(await readStoredToken(clientId)) : false;
}

export async function signOutGoogle(): Promise<void> {
  const stored = await readAnyStoredToken();
  tokenGeneration += 1;
  silentTokenRequests.clear();
  await queueTokenStorage(async () => {
    await Promise.all([
      chrome.storage.session.remove(TOKEN_KEY),
      chrome.storage.local.remove(ACCOUNT_HINT_KEY),
    ]);
  });
  if (!stored) return;
  // The token goes in the form body, not the query string: URLs end up in
  // proxy and network logs, request bodies normally do not.
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: stored.accessToken }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}
