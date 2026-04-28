import express from "express";
import {
  applySessionCookies,
  clearSessionCookies,
  completeGithubOAuth,
  getCsrfTokenFromRequest,
  getRefreshTokenFromRequest,
  redeemAuthorizationCode,
  refreshSession,
  revokeSessionById,
  serializeAuthenticatedUser,
  startGithubOAuth,
} from "../lib/auth-service.js";
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
  rateLimitMiddleware({ namespace: "auth-start", maxRequests: 20 }),
  async (req, res, next) => {
    try {
      const { authorizationUrl } = await startGithubOAuth({
        clientType: String(req.query.client_type || ""),
        redirectUri: String(req.query.redirect_uri || ""),
        state: String(req.query.state || ""),
        codeChallenge: String(req.query.code_challenge || ""),
        codeChallengeMethod:
          req.query.code_challenge_method === undefined
            ? "S256"
            : String(req.query.code_challenge_method),
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
        requestId: String(req.query.state || ""),
        githubCode: String(req.query.code || ""),
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

      return res.status(200).json({
        status: "success",
        data: {
          user: tokenSet.user,
          access_token: clientType === "cli" ? tokenSet.access_token : undefined,
          refresh_token: clientType === "cli" ? tokenSet.refresh_token : undefined,
          access_token_expires_in: tokenSet.access_token_expires_in,
          refresh_token_expires_in: tokenSet.refresh_token_expires_in,
          csrf_token: tokenSet.csrf_token,
        },
      });
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

      return res.status(200).json({
        status: "success",
        data: {
          user: tokenSet.user,
          access_token: clientType === "cli" ? tokenSet.access_token : undefined,
          refresh_token: clientType === "cli" ? tokenSet.refresh_token : undefined,
          access_token_expires_in: tokenSet.access_token_expires_in,
          refresh_token_expires_in: tokenSet.refresh_token_expires_in,
          csrf_token: tokenSet.csrf_token,
        },
      });
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
