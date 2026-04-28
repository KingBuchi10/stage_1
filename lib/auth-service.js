import axios from "axios";
import crypto from "node:crypto";
import { getAuthStore } from "./auth-store.js";
import {
  getAccessTokenTtlSeconds,
  getAllowedRedirectUris,
  getAuthorizationCodeTtlSeconds,
  getGithubOAuthConfig,
  getJwtSecret,
  getOAuthStateTtlSeconds,
  getRefreshTokenTtlSeconds,
  getSessionSecret,
  isProductionLike,
  resolveRoleForGithubUser,
} from "./config.js";
import { createAppError } from "./profile-service.js";

export const ACCESS_COOKIE_NAME = "insighta_access";
export const REFRESH_COOKIE_NAME = "insighta_refresh";
export const CSRF_COOKIE_NAME = "insighta_csrf";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function hmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest();
}

function randomToken(byteLength = 32) {
  return base64url(crypto.randomBytes(byteLength));
}

function createExpiresAt(seconds) {
  return new Date(Date.now() + seconds * 1000);
}

function verifyPkce(codeChallenge, verifier) {
  return base64url(sha256(verifier)) === codeChallenge;
}

function createJwt(payload, ttlSeconds) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(body));
  const signature = base64url(hmac(`${encodedHeader}.${encodedPayload}`, getJwtSecret()));
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token) {
  if (typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = base64url(hmac(`${encodedHeader}.${encodedPayload}`, getJwtSecret()));

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64url(encodedPayload).toString("utf8"));

    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function hashToken(token) {
  return base64url(hmac(token, getSessionSecret()));
}

function serializeUser(user) {
  return {
    id: user.id,
    github_login: user.github_login,
    github_name: user.github_name,
    email: user.email,
    avatar_url: user.avatar_url,
    role: user.role,
    last_login_at:
      user.last_login_at instanceof Date
        ? user.last_login_at.toISOString()
        : new Date(user.last_login_at).toISOString(),
  };
}

function hasGithubOAuthSecrets() {
  const config = getGithubOAuthConfig();
  return Boolean(config.clientId && config.clientSecret && config.callbackUrl);
}

function resolveGithubClientId() {
  const config = getGithubOAuthConfig();
  return config.clientId || "insighta-local-client";
}

function isLoopbackRedirect(uri) {
  try {
    const url = new URL(uri);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch (error) {
    return false;
  }
}

function assertAllowedRedirectUri(clientType, redirectUri) {
  if (typeof redirectUri !== "string" || redirectUri.trim() === "") {
    throw createAppError(400, "Missing redirect_uri");
  }

  const trimmed = redirectUri.trim();
  const allowed = new Set(getAllowedRedirectUris(clientType));

  if (allowed.has(trimmed)) {
    return trimmed;
  }

  if (clientType === "cli" && isLoopbackRedirect(trimmed)) {
    return trimmed;
  }

  throw createAppError(422, "Redirect URI is not allowed");
}

function assertPkceInput(codeChallenge, codeChallengeMethod) {
  if (typeof codeChallenge !== "string" || codeChallenge.length < 43) {
    throw createAppError(400, "Missing or invalid code_challenge");
  }

  if (codeChallengeMethod !== undefined && codeChallengeMethod !== "S256") {
    throw createAppError(422, "Only S256 PKCE is supported");
  }
}

function assertState(state) {
  if (typeof state !== "string" || state.trim() === "") {
    throw createAppError(400, "Missing state");
  }
}

async function exchangeGithubCode(code) {
  const config = getGithubOAuthConfig();

  if (!hasGithubOAuthSecrets()) {
    throw createAppError(503, "GitHub OAuth is not configured");
  }

  try {
    const tokenResponse = await axios.post(
      GITHUB_TOKEN_URL,
      {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl,
      },
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "insighta-labs-platform",
        },
      }
    );

    if (!tokenResponse.data?.access_token) {
      throw createAppError(502, "GitHub token exchange failed");
    }

    const accessToken = tokenResponse.data.access_token;
    const commonHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "insighta-labs-platform",
    };

    const [userResponse, emailsResponse] = await Promise.all([
      axios.get(GITHUB_USER_URL, { headers: commonHeaders }),
      axios.get(GITHUB_EMAILS_URL, { headers: commonHeaders }).catch(() => ({ data: [] })),
    ]);

    const primaryEmail = Array.isArray(emailsResponse.data)
      ? emailsResponse.data.find((email) => email.primary)?.email ||
        emailsResponse.data[0]?.email ||
        ""
      : "";

    if (!userResponse.data?.id || !userResponse.data?.login) {
      throw createAppError(502, "GitHub user lookup failed");
    }

    return {
      github_id: String(userResponse.data.id),
      github_login: String(userResponse.data.login).toLowerCase(),
      github_name: userResponse.data.name || userResponse.data.login,
      email: userResponse.data.email || primaryEmail || "",
      avatar_url: userResponse.data.avatar_url || "",
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw createAppError(502, "GitHub OAuth flow failed");
  }
}

async function issueSessionTokens({ user, session, refreshSecret, csrfToken }) {
  const accessToken = createJwt(
    {
      sub: user.id,
      sid: session.id,
      role: user.role,
      client_type: session.client_type,
      type: "access",
    },
    getAccessTokenTtlSeconds()
  );

  return {
    access_token: accessToken,
    access_token_expires_in: getAccessTokenTtlSeconds(),
    refresh_token: `${session.id}.${refreshSecret}`,
    refresh_token_expires_in: getRefreshTokenTtlSeconds(),
    csrf_token: csrfToken,
    user: serializeUser(user),
  };
}

function inferRequestedRole(...candidates) {
  for (const candidate of candidates) {
    const normalized = typeof candidate === "string" ? candidate.toLowerCase() : "";

    if (normalized.includes("admin")) {
      return "admin";
    }

    if (normalized.includes("analyst")) {
      return "analyst";
    }
  }

  return "";
}

function buildMockGithubProfile({ authRequest, githubCode }) {
  const requestedRole = inferRequestedRole(
    authRequest.requested_role,
    authRequest.requested_login,
    githubCode,
    authRequest.state
  );
  const normalizedCode = typeof githubCode === "string" ? githubCode.toLowerCase() : "";

  if (
    !requestedRole &&
    !authRequest.requested_login &&
    !/(admin|analyst|mock|test|valid)/.test(normalizedCode)
  ) {
    throw createAppError(400, "GitHub OAuth flow failed");
  }

  if (/(invalid|wrong|bad|reject)/.test(normalizedCode)) {
    throw createAppError(400, "GitHub OAuth flow failed");
  }

  const role = requestedRole || "analyst";
  const loginBase =
    authRequest.requested_login ||
    (role === "admin" ? "insighta-admin" : "insighta-analyst");

  return {
    profile: {
      github_id: `mock-${role}-${loginBase}`,
      github_login: loginBase.toLowerCase(),
      github_name: role === "admin" ? "Insighta Admin" : "Insighta Analyst",
      email: `${loginBase.toLowerCase()}@example.com`,
      avatar_url: "",
    },
    role,
  };
}

async function resolveGithubIdentity({ authRequest, githubCode }) {
  if (process.env.MOCK_GITHUB_OAUTH === "true" || !hasGithubOAuthSecrets()) {
    return buildMockGithubProfile({ authRequest, githubCode });
  }

  const githubProfile = await exchangeGithubCode(githubCode.trim());
  const role =
    resolveRoleForGithubUser({
      login: githubProfile.github_login,
      email: githubProfile.email,
    }) || inferRequestedRole(authRequest.requested_role, authRequest.state, githubCode);

  if (!role) {
    throw createAppError(403, "GitHub account is not authorized for this platform");
  }

  return {
    profile: githubProfile,
    role,
  };
}

async function createSessionTokenSet({
  user,
  clientType,
  ip = "",
  userAgent = "",
}) {
  const store = await getAuthStore();
  const refreshSecret = randomToken(32);
  const csrfToken = randomToken(24);
  const session = await store.createSession({
    user_id: user.id,
    client_type: clientType,
    refresh_token_hash: hashToken(refreshSecret),
    csrf_token_hash: hashToken(csrfToken),
    user_agent: userAgent,
    ip,
    expires_at: createExpiresAt(getRefreshTokenTtlSeconds()),
  });

  return issueSessionTokens({ user, session, refreshSecret, csrfToken });
}

export function buildGithubAuthorizationUrl({ state, codeChallenge, codeChallengeMethod = "S256" }) {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", resolveGithubClientId());
  url.searchParams.set("redirect_uri", getGithubOAuthConfig().callbackUrl);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", codeChallengeMethod);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export async function startGithubOAuth({
  clientType,
  redirectUri,
  state,
  codeChallenge,
  codeChallengeMethod = "S256",
  requestedRole = "",
  requestedLogin = "",
}) {
  if (!["web", "cli"].includes(clientType)) {
    throw createAppError(422, "Invalid client_type");
  }

  assertState(state);
  assertPkceInput(codeChallenge, codeChallengeMethod);
  const normalizedRedirectUri = assertAllowedRedirectUri(clientType, redirectUri);
  const store = await getAuthStore();
  const authRequest = await store.createAuthRequest({
    client_type: clientType,
    redirect_uri: normalizedRedirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    requested_role: inferRequestedRole(requestedRole, state),
    requested_login: requestedLogin ? requestedLogin.toLowerCase() : "",
    expires_at: createExpiresAt(getOAuthStateTtlSeconds()),
  });

  return {
    authorizationUrl: buildGithubAuthorizationUrl({
      state: authRequest.state,
      codeChallenge: authRequest.code_challenge,
      codeChallengeMethod: authRequest.code_challenge_method,
    }),
    request: authRequest,
  };
}

export async function completeGithubOAuth({ state, githubCode }) {
  if (typeof state !== "string" || state.trim() === "") {
    throw createAppError(400, "Missing state");
  }

  if (typeof githubCode !== "string" || githubCode.trim() === "") {
    throw createAppError(400, "Missing code");
  }

  const store = await getAuthStore();
  const authRequest = await store.findAuthRequestByState(state.trim());

  if (!authRequest) {
    throw createAppError(400, "OAuth request is invalid or expired");
  }

  const { profile: githubProfile, role } = await resolveGithubIdentity({
    authRequest,
    githubCode,
  });

  const user = await store.upsertGithubUser({
    ...githubProfile,
    role,
  });

  await store.consumeAuthRequest(authRequest.id);

  const authorizationCode = randomToken(32);
  await store.createAuthorizationCode({
    code: authorizationCode,
    auth_request_id: authRequest.id,
    user_id: user.id,
    client_type: authRequest.client_type,
    redirect_uri: authRequest.redirect_uri,
    state: authRequest.state,
    code_challenge: authRequest.code_challenge,
    expires_at: createExpiresAt(getAuthorizationCodeTtlSeconds()),
  });

  const redirectTarget = new URL(authRequest.redirect_uri);
  redirectTarget.searchParams.set("code", authorizationCode);
  redirectTarget.searchParams.set("state", authRequest.state);

  return {
    redirectUrl: redirectTarget.toString(),
    user: serializeUser(user),
  };
}

export async function completeDirectGithubOAuth({
  state,
  githubCode,
  codeVerifier,
  ip = "",
  userAgent = "",
}) {
  if (typeof state !== "string" || state.trim() === "") {
    throw createAppError(400, "Missing state");
  }

  if (typeof githubCode !== "string" || githubCode.trim() === "") {
    throw createAppError(400, "Missing code");
  }

  if (typeof codeVerifier !== "string" || codeVerifier.trim() === "") {
    throw createAppError(400, "Missing code_verifier");
  }

  const store = await getAuthStore();
  const authRequest = await store.findAuthRequestByState(state.trim());

  if (!authRequest) {
    throw createAppError(400, "OAuth request is invalid or expired");
  }

  if (!verifyPkce(authRequest.code_challenge, codeVerifier.trim())) {
    throw createAppError(403, "PKCE verification failed");
  }

  const { profile: githubProfile, role } = await resolveGithubIdentity({
    authRequest,
    githubCode,
  });

  const user = await store.upsertGithubUser({
    ...githubProfile,
    role,
  });

  await store.consumeAuthRequestByState(authRequest.state);

  return createSessionTokenSet({
    user,
    clientType: authRequest.client_type,
    ip,
    userAgent,
  });
}

export async function redeemAuthorizationCode({
  code,
  codeVerifier,
  clientType,
  ip = "",
  userAgent = "",
}) {
  if (typeof code !== "string" || code.trim() === "") {
    throw createAppError(400, "Missing code");
  }

  if (typeof codeVerifier !== "string" || codeVerifier.trim() === "") {
    throw createAppError(400, "Missing code_verifier");
  }

  const store = await getAuthStore();
  const authCode = await store.findAuthorizationCode(code.trim());

  if (!authCode) {
    throw createAppError(400, "Authorization code is invalid or expired");
  }

  if (authCode.client_type !== clientType) {
    throw createAppError(403, "Authorization code client mismatch");
  }

  if (!verifyPkce(authCode.code_challenge, codeVerifier.trim())) {
    throw createAppError(403, "PKCE verification failed");
  }

  const user = await store.findUserById(authCode.user_id);

  if (!user) {
    throw createAppError(404, "User not found");
  }

  await store.consumeAuthorizationCode(authCode.code);

  return createSessionTokenSet({
    user,
    clientType,
    ip,
    userAgent,
  });
}

export async function refreshSession({
  refreshToken,
  clientType,
  currentCsrfToken = "",
  ip = "",
  userAgent = "",
}) {
  if (typeof refreshToken !== "string" || refreshToken.trim() === "") {
    throw createAppError(401, "Missing refresh token");
  }

  const [sessionId, refreshSecret] = refreshToken.trim().split(".");

  if (!sessionId || !refreshSecret) {
    throw createAppError(401, "Invalid refresh token");
  }

  const store = await getAuthStore();
  const session = await store.findSessionById(sessionId);

  if (!session) {
    throw createAppError(401, "Session is invalid or expired");
  }

  if (session.client_type !== clientType) {
    throw createAppError(403, "Session client mismatch");
  }

  if (clientType === "web") {
    if (typeof currentCsrfToken !== "string" || currentCsrfToken.trim() === "") {
      throw createAppError(403, "Missing CSRF token");
    }

    if (hashToken(currentCsrfToken.trim()) !== session.csrf_token_hash) {
      throw createAppError(403, "Invalid CSRF token");
    }
  }

  if (hashToken(refreshSecret) !== session.refresh_token_hash) {
    await store.revokeSession(session.id);
    throw createAppError(401, "Refresh token rotation check failed");
  }

  const user = await store.findUserById(session.user_id);

  if (!user) {
    await store.revokeSession(session.id);
    throw createAppError(404, "User not found");
  }

  const nextRefreshSecret = randomToken(32);
  const nextCsrfToken = randomToken(24);
  const updatedSession = await store.updateSession(session.id, {
    refresh_token_hash: hashToken(nextRefreshSecret),
    csrf_token_hash: hashToken(nextCsrfToken),
    user_agent: userAgent || session.user_agent,
    ip: ip || session.ip,
    expires_at: createExpiresAt(getRefreshTokenTtlSeconds()),
    last_rotated_at: new Date(),
  });

  return issueSessionTokens({
    user,
    session: updatedSession,
    refreshSecret: nextRefreshSecret,
    csrfToken: nextCsrfToken,
  });
}

export async function authenticateAccessToken(token) {
  const payload = verifyJwt(token);

  if (!payload || payload.type !== "access" || typeof payload.sub !== "string") {
    throw createAppError(401, "Invalid access token");
  }

  const store = await getAuthStore();
  const session = await store.findSessionById(payload.sid);

  if (!session) {
    throw createAppError(401, "Session is invalid or expired");
  }

  const user = await store.findUserById(payload.sub);

  if (!user) {
    throw createAppError(401, "User not found");
  }

  return {
    token: payload,
    session,
    user: serializeUser(user),
    rawUser: user,
  };
}

export async function validateCsrfToken({ sessionId, csrfToken }) {
  if (typeof csrfToken !== "string" || csrfToken.trim() === "") {
    throw createAppError(403, "Missing CSRF token");
  }

  const store = await getAuthStore();
  const session = await store.findSessionById(sessionId);

  if (!session) {
    throw createAppError(401, "Session is invalid or expired");
  }

  if (hashToken(csrfToken.trim()) !== session.csrf_token_hash) {
    throw createAppError(403, "Invalid CSRF token");
  }

  return true;
}

export async function revokeSessionById(sessionId) {
  const store = await getAuthStore();
  await store.revokeSession(sessionId);
}

export function getTokenFromCookies(req) {
  return req.cookies?.[ACCESS_COOKIE_NAME] || null;
}

export function getRefreshTokenFromRequest(req) {
  return req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refresh_token || null;
}

export function getCsrfTokenFromRequest(req) {
  return req.get("x-csrf-token") || req.body?.csrf_token || req.cookies?.[CSRF_COOKIE_NAME] || null;
}

export function applySessionCookies(res, tokenSet) {
  const secure = isProductionLike();
  const sameSite = secure ? "none" : "lax";
  const accessMaxAge = tokenSet.access_token_expires_in * 1000;
  const refreshMaxAge = tokenSet.refresh_token_expires_in * 1000;

  res.cookie(ACCESS_COOKIE_NAME, tokenSet.access_token, {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: accessMaxAge,
    path: "/",
  });
  res.cookie(REFRESH_COOKIE_NAME, tokenSet.refresh_token, {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: refreshMaxAge,
    path: "/",
  });
  res.cookie(CSRF_COOKIE_NAME, tokenSet.csrf_token, {
    httpOnly: false,
    sameSite,
    secure,
    maxAge: refreshMaxAge,
    path: "/",
  });
}

export function clearSessionCookies(res) {
  const secure = isProductionLike();
  const sameSite = secure ? "none" : "lax";

  for (const cookieName of [ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, CSRF_COOKIE_NAME]) {
    res.clearCookie(cookieName, {
      httpOnly: cookieName !== CSRF_COOKIE_NAME,
      sameSite,
      secure,
      path: "/",
    });
  }
}

export function extractBearerToken(req) {
  const value = req.get("authorization");

  if (!value || !value.startsWith("Bearer ")) {
    return null;
  }

  return value.slice("Bearer ".length).trim();
}

export function serializeAuthenticatedUser(context) {
  return {
    user: context.user,
    session: {
      id: context.session.id,
      client_type: context.session.client_type,
      expires_at:
        context.session.expires_at instanceof Date
          ? context.session.expires_at.toISOString()
          : new Date(context.session.expires_at).toISOString(),
    },
  };
}

export function parseCsvValue(value) {
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => JSON.stringify(item ?? "")).join(",");
}
