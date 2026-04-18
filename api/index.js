import express from "express";
import { getProfileStore } from "../lib/profile-store.js";
import {
  buildProfile,
  isKnownAppError,
  toProfileListItem,
  validateNameInput,
} from "../lib/profile-service.js";

const app = express();
const profileStore = getProfileStore();

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
    message: "API is running, HNG14",
    endpoints: {
      create_profile: "POST /api/profiles",
      get_profile: "GET /api/profiles/:id",
      list_profiles: "GET /api/profiles",
      delete_profile: "DELETE /api/profiles/:id",
    },
  });
});

app.post("/api/profiles", async (req, res, next) => {
  try {
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
        data: existingProfile,
      });
    }

    const profile = await buildProfile(validation.value);
    await profileStore.create(profile);

    return res.status(201).json({
      status: "success",
      data: profile,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/profiles/:id", async (req, res) => {
  const profile = await profileStore.findById(req.params.id);

  if (!profile) {
    return res.status(404).json({
      status: "error",
      message: "Profile not found",
    });
  }

  return res.status(200).json({
    status: "success",
    data: profile,
  });
});

app.get("/api/profiles", async (req, res) => {
  const profiles = await profileStore.list({
    gender: req.query.gender,
    country_id: req.query.country_id,
    age_group: req.query.age_group,
  });

  return res.status(200).json({
    status: "success",
    count: profiles.length,
    data: profiles.map(toProfileListItem),
  });
});

app.delete("/api/profiles/:id", async (req, res) => {
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

  return res.status(500).json({
    status: "error",
    message: "Internal server error",
  });
});

export default app;
