import express from "express";
import { getProfileStore } from "../lib/profile-store.js";
import {
  buildProfile,
  isKnownAppError,
  serializeProfile,
  validateNameInput,
} from "../lib/profile-service.js";
import { parseListQuery, parseNaturalLanguageQuery } from "../lib/profile-query.js";

const app = express();

async function resolveProfileStore() {
  return getProfileStore();
}

function sendListResponse(res, result, page, limit) {
  return res.status(200).json({
    status: "success",
    page,
    limit,
    total: result.total,
    data: result.data.map(serializeProfile),
  });
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
});

app.use(express.json());

app.get(["/", "/api"], (req, res) => {
  res.status(200).json({
    status: "success",
    message: "API is running",
    endpoints: {
      create_profile: "POST /api/profiles",
      get_profile: "GET /api/profiles/:id",
      list_profiles: "GET /api/profiles",
      search_profiles: "GET /api/profiles/search",
      delete_profile: "DELETE /api/profiles/:id",
    },
  });
});

app.post("/api/profiles", async (req, res, next) => {
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
});

app.get("/api/profiles/search", async (req, res, next) => {
  try {
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

    return sendListResponse(res, result, page, limit);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/profiles/:id", async (req, res) => {
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
});

app.get("/api/profiles", async (req, res, next) => {
  try {
    const profileStore = await resolveProfileStore();
    const { filters, page, limit, sortBy, order } = parseListQuery(req.query);
    const result = await profileStore.list({
      filters,
      page,
      limit,
      sortBy,
      order,
    });

    return sendListResponse(res, result, page, limit);
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/profiles/:id", async (req, res) => {
  const profileStore = await resolveProfileStore();
  const deleted = await profileStore.delete(req.params.id);

  if (!deleted) {
    return res.status(404).json({
      status: "error",
      message: "Profile not found",
    });
  }

  return res.status(204).end();
});

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
