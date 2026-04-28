import crypto from "node:crypto";
import {
  ACCESS_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  authenticateAccessToken,
  extractBearerToken,
  getCsrfTokenFromRequest,
  getTokenFromCookies,
  validateCsrfToken,
} from "./auth-service.js";
import { getAllowedOrigins, getRateLimitMaxRequests, getRateLimitWindowMs } from "./config.js";
import { createAppError } from "./profile-service.js";

const globalRateLimitBucketsKey = "__insightaRateLimitBuckets__";

function getRateLimitBuckets() {
  if (!globalThis[globalRateLimitBucketsKey]) {
    globalThis[globalRateLimitBucketsKey] = new Map();
  }

  return globalThis[globalRateLimitBucketsKey];
}

function getClientIp(req) {
  const forwarded = req.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket?.remoteAddress || "unknown";
}

function parseCookies(header) {
  const cookies = {};

  if (!header) {
    return cookies;
  }

  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }

  return cookies;
}

export function cookieParserMiddleware(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

export function corsMiddleware(req, res, next) {
  const origin = req.get("origin");
  const allowedOrigins = new Set(getAllowedOrigins());
  const isAuthRedirectRoute =
    req.path === "/auth/github" || req.path === "/api/v1/auth/oauth/github/start";

  if (origin && (allowedOrigins.has(origin) || isAuthRedirectRoute)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-CSRF-Token,X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
}

export function requestContextMiddleware(req, res, next) {
  req.requestId = crypto.randomUUID();
  req.clientIp = getClientIp(req);
  res.setHeader("x-request-id", req.requestId);
  next();
}

export function requestLoggerMiddleware(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const entry = {
      level: "info",
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status_code: res.statusCode,
      duration_ms: durationMs,
      ip: req.clientIp,
      user_id: req.auth?.user?.id || null,
      role: req.auth?.user?.role || null,
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify(entry));
  });

  next();
}

export function rateLimitMiddleware(options = {}) {
  const windowMs = options.windowMs || getRateLimitWindowMs();
  const maxRequests = options.maxRequests || getRateLimitMaxRequests();
  const namespace = options.namespace || "global";
  const buckets = getRateLimitBuckets();

  return (req, res, next) => {
    const keyFactory =
      options.keyFactory ||
      ((request) => `${namespace}:${request.clientIp}:${request.path}:${request.method}`);
    const key = keyFactory(req);
    const currentTime = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= currentTime) {
      buckets.set(key, {
        count: 1,
        resetAt: currentTime + windowMs,
      });
      res.setHeader("x-ratelimit-limit", maxRequests);
      res.setHeader("x-ratelimit-remaining", maxRequests - 1);
      return next();
    }

    if (bucket.count >= maxRequests) {
      res.setHeader("x-ratelimit-limit", maxRequests);
      res.setHeader("x-ratelimit-remaining", 0);
      res.setHeader("retry-after", Math.ceil((bucket.resetAt - currentTime) / 1000));
      return next(createAppError(429, "Rate limit exceeded"));
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader("x-ratelimit-limit", maxRequests);
    res.setHeader("x-ratelimit-remaining", maxRequests - bucket.count);
    return next();
  };
}

export function authenticateRequest(options = {}) {
  return async (req, res, next) => {
    try {
      const bearerToken = extractBearerToken(req);
      const cookieToken = getTokenFromCookies(req);
      const token = bearerToken || cookieToken;

      if (!token) {
        if (options.optional) {
          return next();
        }

        throw createAppError(401, "Authentication required");
      }

      const context = await authenticateAccessToken(token);
      req.auth = {
        ...context,
        via: bearerToken ? "bearer" : "cookie",
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth?.user) {
      return next(createAppError(401, "Authentication required"));
    }

    if (!roles.includes(req.auth.user.role)) {
      return next(createAppError(403, "Insufficient permissions"));
    }

    return next();
  };
}

export function requireCsrfForCookieAuth(req, res, next) {
  if (!req.auth?.user || req.auth.via !== "cookie") {
    return next();
  }

  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const csrfToken = getCsrfTokenFromRequest(req);

  validateCsrfToken({
    sessionId: req.auth.session.id,
    csrfToken,
  })
    .then(() => next())
    .catch((error) => next(error));
}

export function authCookiePresence(req) {
  return Boolean(req.cookies?.[ACCESS_COOKIE_NAME] || req.cookies?.[REFRESH_COOKIE_NAME]);
}

export function csrfCookieValue(req) {
  return req.cookies?.[CSRF_COOKIE_NAME] || null;
}
