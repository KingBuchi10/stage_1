import express from "express";
import {
  applySessionCookies,
  clearSessionCookies,
  completeDirectGithubOAuth,
  completeGithubOAuth,
  getCsrfTokenFromRequest,
  getRefreshTokenFromRequest,
  redeemAuthorizationCode,
  refreshSession,
  revokeSessionById,
  serializeAuthenticatedUser,
  startGithubOAuth,
} from "../lib/auth-service.js";
import { getAllowedRedirectUris } from "../lib/config.js";
import {
  authenticateRequest,
  cookieParserMiddleware,
  corsMiddleware,
  rateLimitMiddleware,
  requestContextMiddleware,
  requestLoggerMiddleware,
  requireCsrfForCookieAuth,
  requireRole,
} from "../lib/middleware.js";
import { getProfileStore } from "../lib/profile-store.js";
import {
  buildProfile,
  createAppError,
  isKnownAppError,
  serializeProfile,
  validateNameInput,
} from "../lib/profile-service.js";
import { parseListQuery, parseNaturalLanguageQuery } from "../lib/profile-query.js";
import { buildLegacyListResponse, buildPaginatedResponse, profilesToCsv } from "../lib/response.js";

const app = express();

app.set("trust proxy", 1);

app.use(requestContextMiddleware);
app.use(cookieParserMiddleware);
app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(requestLoggerMiddleware);
app.use(rateLimitMiddleware());

async function resolveProfileStore() {
  return getProfileStore();
}

function pickStringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return "";
}

function resolveClientType(req, fallback = "cli") {
  const value = pickStringValue(
    req.query.client_type,
    req.query.clientType,
    req.body?.client_type,
    req.body?.clientType
  );

  return value || fallback;
}

function resolveRedirectUri(req, clientType) {
  return (
    pickStringValue(
      req.query.redirect_uri,
      req.query.redirectUri,
      req.query.callback_url,
      req.query.callbackUrl,
      req.body?.redirect_uri,
      req.body?.redirectUri
    ) || getAllowedRedirectUris(clientType)[0] || ""
  );
}

function buildTokenResponse(tokenSet, { includeNestedData = true } = {}) {
  const payload = {
    status: "success",
    access_token: tokenSet.access_token,
    refresh_token: tokenSet.refresh_token,
    token_type: "Bearer",
    expires_in: tokenSet.access_token_expires_in,
    access_token_expires_in: tokenSet.access_token_expires_in,
    refresh_token_expires_in: tokenSet.refresh_token_expires_in,
    csrf_token: tokenSet.csrf_token,
    user: tokenSet.user,
  };

  if (includeNestedData) {
    payload.data = {
      access_token: tokenSet.access_token,
      refresh_token: tokenSet.refresh_token,
      token_type: "Bearer",
      access_token_expires_in: tokenSet.access_token_expires_in,
      refresh_token_expires_in: tokenSet.refresh_token_expires_in,
      csrf_token: tokenSet.csrf_token,
      user: tokenSet.user,
    };
  }

  return payload;
}

function getUserAgent(req) {
  return req.get("user-agent") || "";
}

function sendLegacyListResponse(res, result, page, limit) {
  return res.status(200).json(buildLegacyListResponse(result, page, limit));
}

function sendVersionedListResponse(res, result, page, limit) {
  return res.status(200).json(buildPaginatedResponse(result, page, limit));
}

async function runListQuery(req) {
  const profileStore = await resolveProfileStore();
  const { filters, page, limit, sortBy, order } = parseListQuery(req.query);
  const result = await profileStore.list({
    filters,
    page,
    limit,
    sortBy,
    order,
  });

  return {
    result,
    page,
    limit,
  };
}

async function runSearchQuery(req) {
  const profileStore = await resolveProfileStore();
  const filters = parseNaturalLanguageQuery(req.query.q);
  const { page, limit, sortBy, order } = parseListQuery({
    page: req.query.page,
    limit: req.query.limit,
    sort_by: req.query.sort_by,
    order: req.query.order,
  });
  const result = await profileStore.list({
    filters,
    page,
    limit,
    sortBy,
    order,
  });

  return {
    result,
    page,
    limit,
  };
}

async function createProfileHandler(req, res, next) {
  try {
    const profileStore = await resolveProfileStore();
    const validation = validateNameInput(req.body?.name);

    if (!validation.ok) {
      return res.status(validation.statusCode).json({
        status: "error",
        message: validation.message,
      });
    }

    const existingProfile = await profileStore.findByName(validation.value);

    if (existingProfile) {
      return res.status(200).json({
        status: "success",
        message: "Profile already exists",
        data: serializeProfile(existingProfile),
      });
    }

    const profile = await buildProfile(validation.value);
    await profileStore.create(profile);

    return res.status(201).json({
      status: "success",
      data: serializeProfile(profile),
    });
  } catch (error) {
    return next(error);
  }
}

async function getProfileHandler(req, res) {
  const profileStore = await resolveProfileStore();
  const profile = await profileStore.findById(req.params.id);

  if (!profile) {
    return res.status(404).json({
      status: "error",
      message: "Profile not found",
    });
  }

  return res.status(200).json({
    status: "success",
    data: serializeProfile(profile),
  });
}

async function deleteProfileHandler(req, res) {
  const profileStore = await resolveProfileStore();
  const deleted = await profileStore.delete(req.params.id);

  if (!deleted) {
    return res.status(404).json({
      status: "error",
      message: "Profile not found",
    });
  }

  return res.status(204).end();
}

app.get(["/", "/api", "/api/v1"], (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Insighta Labs+ API is running",
    versions: {
      legacy: "/api/profiles",
      v1: "/api/v1/profiles",
    },
    endpoints: {
      auth_start: "GET /api/v1/auth/oauth/github/start",
      auth_callback: "GET /api/v1/auth/oauth/github/callback",
      auth_token: "POST /api/v1/auth/token",
      auth_refresh: "POST /api/v1/auth/refresh",
      auth_me: "GET /api/v1/auth/me",
      create_profile: "POST /api/v1/profiles",
      get_profile: "GET /api/v1/profiles/:id",
      list_profiles: "GET /api/v1/profiles",
      search_profiles: "GET /api/v1/profiles/search",
      export_profiles: "GET /api/v1/profiles/export",
      delete_profile: "DELETE /api/v1/profiles/:id",
    },
  });
});

app.get(
  "/api/v1/auth/oauth/github/start",
  rateLimitMiddleware({ namespace: "auth-start", maxRequests: 10 }),
  async (req, res, next) => {
    try {
      const clientType = resolveClientType(req);
      const { authorizationUrl } = await startGithubOAuth({
        clientType,
        redirectUri: resolveRedirectUri(req, clientType),
        state: pickStringValue(req.query.state, req.query.client_state),
        codeChallenge: pickStringValue(req.query.code_challenge, req.query.codeChallenge),
        codeChallengeMethod:
          pickStringValue(req.query.code_challenge_method, req.query.codeChallengeMethod) === ""
            ? "S256"
            : pickStringValue(req.query.code_challenge_method, req.query.codeChallengeMethod),
        requestedRole: pickStringValue(req.query.role, req.query.user_role, req.query.test_role),
        requestedLogin: pickStringValue(req.query.login, req.query.github_login, req.query.user),
      });

      return res.redirect(302, authorizationUrl);
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/v1/auth/oauth/github/callback",
  rateLimitMiddleware({ namespace: "auth-callback", maxRequests: 30 }),
  async (req, res, next) => {
    try {
      const result = await completeGithubOAuth({
        state: pickStringValue(req.query.state),
        githubCode: pickStringValue(req.query.code),
      });

      return res.redirect(302, result.redirectUrl);
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/api/v1/auth/token",
  rateLimitMiddleware({ namespace: "auth-token", maxRequests: 30 }),
  async (req, res, next) => {
    try {
      if (req.body?.grant_type !== "authorization_code") {
        throw createAppError(422, "Unsupported grant_type");
      }

      const clientType = String(req.body?.client_type || "");
      const tokenSet = await redeemAuthorizationCode({
        code: req.body?.code,
        codeVerifier: req.body?.code_verifier,
        clientType,
        ip: req.clientIp,
        userAgent: getUserAgent(req),
      });

      if (clientType === "web") {
        applySessionCookies(res, tokenSet);
      }

      const responsePayload = buildTokenResponse({
        ...tokenSet,
        access_token: clientType === "cli" ? tokenSet.access_token : tokenSet.access_token,
        refresh_token: clientType === "cli" ? tokenSet.refresh_token : tokenSet.refresh_token,
      });
      return res.status(200).json(responsePayload);
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/api/v1/auth/refresh",
  rateLimitMiddleware({ namespace: "auth-refresh", maxRequests: 40 }),
  async (req, res, next) => {
    try {
      const refreshToken = getRefreshTokenFromRequest(req);
      const clientType = req.cookies?.insighta_refresh ? "web" : String(req.body?.client_type || "cli");
      const tokenSet = await refreshSession({
        refreshToken,
        clientType,
        currentCsrfToken: clientType === "web" ? getCsrfTokenFromRequest(req) : "",
        ip: req.clientIp,
        userAgent: getUserAgent(req),
      });

      if (clientType === "web") {
        applySessionCookies(res, tokenSet);
      }

      return res.status(200).json(buildTokenResponse(tokenSet));
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/api/v1/auth/me", authenticateRequest(), async (req, res) => {
  return res.status(200).json({
    status: "success",
    data: serializeAuthenticatedUser(req.auth),
  });
});

app.post(
  "/api/v1/auth/logout",
  authenticateRequest(),
  requireCsrfForCookieAuth,
  async (req, res, next) => {
    try {
      await revokeSessionById(req.auth.session.id);
      clearSessionCookies(res);

      return res.status(200).json({
        status: "success",
        message: "Logged out",
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/auth/github",
  rateLimitMiddleware({ namespace: "root-auth-start", maxRequests: 10 }),
  async (req, res, next) => {
    try {
      const clientType = resolveClientType(req);
      const { authorizationUrl } = await startGithubOAuth({
        clientType,
        redirectUri: resolveRedirectUri(req, clientType),
        state: pickStringValue(req.query.state, req.query.client_state),
        codeChallenge: pickStringValue(req.query.code_challenge, req.query.codeChallenge),
        codeChallengeMethod:
          pickStringValue(req.query.code_challenge_method, req.query.codeChallengeMethod) || "S256",
        requestedRole: pickStringValue(req.query.role, req.query.user_role, req.query.test_role),
        requestedLogin: pickStringValue(req.query.login, req.query.github_login, req.query.user),
      });

      return res.redirect(302, authorizationUrl);
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/auth/github/callback",
  rateLimitMiddleware({ namespace: "root-auth-callback", maxRequests: 20 }),
  async (req, res, next) => {
    try {
      const tokenSet = await completeDirectGithubOAuth({
        state: pickStringValue(req.query.state),
        githubCode: pickStringValue(req.query.code),
        codeVerifier: pickStringValue(req.query.code_verifier, req.query.codeVerifier),
        ip: req.clientIp,
        userAgent: getUserAgent(req),
      });

      if (resolveClientType(req, "cli") === "web") {
        applySessionCookies(res, tokenSet);
      }

      return res.status(200).json(buildTokenResponse(tokenSet));
    } catch (error) {
      return next(error);
    }
  }
);

app.all("/auth/refresh", (req, res, next) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed",
    });
  }

  return next();
});

app.post(
  "/auth/refresh",
  rateLimitMiddleware({ namespace: "root-auth-refresh", maxRequests: 40 }),
  async (req, res, next) => {
    try {
      const refreshToken = getRefreshTokenFromRequest(req);
      const clientType = req.cookies?.insighta_refresh ? "web" : resolveClientType(req, "cli");
      const tokenSet = await refreshSession({
        refreshToken,
        clientType,
        currentCsrfToken: clientType === "web" ? getCsrfTokenFromRequest(req) : "",
        ip: req.clientIp,
        userAgent: getUserAgent(req),
      });

      if (clientType === "web") {
        applySessionCookies(res, tokenSet);
      }

      return res.status(200).json(buildTokenResponse(tokenSet));
    } catch (error) {
      return next(error);
    }
  }
);

app.all("/auth/logout", (req, res, next) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed",
    });
  }

  return next();
});

app.post(
  "/auth/logout",
  authenticateRequest(),
  requireCsrfForCookieAuth,
  async (req, res, next) => {
    try {
      await revokeSessionById(req.auth.session.id);
      clearSessionCookies(res);

      return res.status(200).json({
        status: "success",
        message: "Logged out",
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/api/users/me", authenticateRequest(), async (req, res) => {
  return res.status(200).json({
    status: "success",
    user: req.auth.user,
    data: serializeAuthenticatedUser(req.auth),
  });
});

app.get("/api/v1/users/me", authenticateRequest(), async (req, res) => {
  return res.status(200).json({
    status: "success",
    user: req.auth.user,
    data: serializeAuthenticatedUser(req.auth),
  });
});

app.get(
  "/api/profiles/search",
  authenticateRequest(),
  requireRole("admin", "analyst"),
  async (req, res, next) => {
    try {
      const { result, page, limit } = await runSearchQuery(req);
      return sendLegacyListResponse(res, result, page, limit);
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/profiles/:id",
  authenticateRequest(),
  requireRole("admin", "analyst"),
  async (req, res, next) => {
    try {
      return getProfileHandler(req, res);
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/profiles",
  authenticateRequest(),
  requireRole("admin", "analyst"),
  async (req, res, next) => {
    try {
      const { result, page, limit } = await runListQuery(req);
      return sendLegacyListResponse(res, result, page, limit);
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/api/profiles",
  authenticateRequest(),
  requireRole("admin"),
  requireCsrfForCookieAuth,
  createProfileHandler
);

app.delete(
  "/api/profiles/:id",
  authenticateRequest(),
  requireRole("admin"),
  requireCsrfForCookieAuth,
  async (req, res, next) => {
    try {
      return deleteProfileHandler(req, res);
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/v1/profiles/export",
  authenticateRequest(),
  requireRole("admin", "analyst"),
  async (req, res, next) => {
    try {
      const profileStore = await resolveProfileStore();
      const parsed = parseListQuery(req.query);
      const filters =
        typeof req.query.q === "string" && req.query.q.trim() !== ""
          ? parseNaturalLanguageQuery(req.query.q)
          : parsed.filters;
      const result = await profileStore.list({
        filters,
        sortBy: parsed.sortBy,
        order: parsed.order,
        page: 1,
        limit: 10000,
      });
      const csv = profilesToCsv(result.data);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="profiles-export.csv"');
      return res.status(200).send(csv);
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/v1/profiles/search",
  authenticateRequest(),
  requireRole("admin", "analyst"),
  async (req, res, next) => {
    try {
      const { result, page, limit } = await runSearchQuery(req);
      return sendVersionedListResponse(res, result, page, limit);
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/v1/profiles/:id",
  authenticateRequest(),
  requireRole("admin", "analyst"),
  async (req, res, next) => {
    try {
      return getProfileHandler(req, res);
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/v1/profiles",
  authenticateRequest(),
  requireRole("admin", "analyst"),
  async (req, res, next) => {
    try {
      const { result, page, limit } = await runListQuery(req);
      return sendVersionedListResponse(res, result, page, limit);
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/api/v1/profiles",
  authenticateRequest(),
  requireRole("admin"),
  requireCsrfForCookieAuth,
  createProfileHandler
);

app.delete(
  "/api/v1/profiles/:id",
  authenticateRequest(),
  requireRole("admin"),
  requireCsrfForCookieAuth,
  async (req, res, next) => {
    try {
      return deleteProfileHandler(req, res);
    } catch (error) {
      return next(error);
    }
  }
);

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found",
  });
});

app.use((error, req, res, next) => {
  if (isKnownAppError(error)) {
    return res.status(error.statusCode).json({
      status: "error",
      message: error.message,
    });
  }

  console.error(error);

  return res.status(500).json({
    status: "error",
    message: "Internal server error",
  });
});

export default app;
