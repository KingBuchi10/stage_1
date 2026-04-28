function splitCsvEnv(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin) {
  return origin.replace(/\/+$/, "");
}

export function getAllowedOrigins() {
  const configured = splitCsvEnv(process.env.ALLOWED_ORIGINS || process.env.WEB_PORTAL_ORIGIN);

  if (configured.length > 0) {
    return configured.map(normalizeOrigin);
  }

  return ["http://localhost:4173", "http://127.0.0.1:4173"];
}

export function getAllowedRedirectUris(clientType) {
  const rawValue =
    clientType === "cli"
      ? process.env.GITHUB_CLI_REDIRECT_URIS || "http://127.0.0.1:8787/callback"
      : process.env.GITHUB_WEB_REDIRECT_URIS ||
        "http://localhost:4173/auth/callback,http://127.0.0.1:4173/auth/callback";

  return splitCsvEnv(rawValue);
}

export function getAccessTokenTtlSeconds() {
  return Number.parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS || "300", 10);
}

export function getRefreshTokenTtlSeconds() {
  return Number.parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS || "1800", 10);
}

export function getOAuthStateTtlSeconds() {
  return Number.parseInt(process.env.OAUTH_STATE_TTL_SECONDS || "600", 10);
}

export function getAuthorizationCodeTtlSeconds() {
  return Number.parseInt(process.env.AUTHORIZATION_CODE_TTL_SECONDS || "60", 10);
}

export function getRateLimitWindowMs() {
  return Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
}

export function getRateLimitMaxRequests() {
  return Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "120", 10);
}

export function getJwtSecret() {
  return process.env.JWT_SECRET || "insighta-dev-jwt-secret";
}

export function getSessionSecret() {
  return process.env.SESSION_SECRET || "insighta-dev-session-secret";
}

export function getGithubOAuthConfig() {
  return {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    callbackUrl:
      process.env.GITHUB_CALLBACK_URL || "http://localhost:3000/api/v1/auth/oauth/github/callback",
  };
}

export function resolveRoleForGithubUser({ login, email }) {
  const normalizedLogin = typeof login === "string" ? login.toLowerCase() : "";
  const normalizedEmail = typeof email === "string" ? email.toLowerCase() : "";
  const admins = new Set(splitCsvEnv(process.env.ADMIN_GITHUB_USERS).map((item) => item.toLowerCase()));
  const analysts = new Set(
    splitCsvEnv(process.env.ANALYST_GITHUB_USERS).map((item) => item.toLowerCase())
  );

  if (admins.has(normalizedLogin) || admins.has(normalizedEmail)) {
    return "admin";
  }

  if (analysts.has(normalizedLogin) || analysts.has(normalizedEmail)) {
    return "analyst";
  }

  if (process.env.ALLOW_UNLISTED_ANALYSTS === "true") {
    return "analyst";
  }

  return null;
}

export function isProductionLike() {
  return process.env.NODE_ENV === "production";
}
