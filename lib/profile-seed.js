import fs from "node:fs/promises";
import path from "node:path";
import { countryNameFromId } from "./country-data.js";
import { getAgeGroup, normalizeName, uuidv7 } from "./profile-service.js";

function pickArrayPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.profiles)) {
    return payload.profiles;
  }

  return null;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSeedRecord(record) {
  const name = typeof record?.name === "string" ? normalizeName(record.name) : null;
  const gender = typeof record?.gender === "string" ? record.gender.toLowerCase() : null;
  const age = toFiniteNumber(record?.age);
  const countryId = typeof record?.country_id === "string"
    ? record.country_id.toUpperCase()
    : typeof record?.countryCode === "string"
      ? record.countryCode.toUpperCase()
      : null;
  const genderProbability = toFiniteNumber(
    record?.gender_probability ?? record?.genderProbability
  );
  const countryProbability = toFiniteNumber(
    record?.country_probability ?? record?.countryProbability
  );

  if (!name || !gender || age === null || !countryId) {
    return null;
  }

  if (!["male", "female"].includes(gender)) {
    return null;
  }

  const createdAtSource = record?.created_at ?? record?.createdAt ?? new Date().toISOString();
  const createdAt = new Date(createdAtSource);

  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return {
    id: typeof record?.id === "string" && record.id ? record.id : uuidv7(),
    name,
    gender,
    gender_probability: genderProbability ?? 0,
    age: Math.trunc(age),
    age_group:
      typeof record?.age_group === "string" && record.age_group
        ? record.age_group.toLowerCase()
        : getAgeGroup(Math.trunc(age)),
    country_id: countryId,
    country_name:
      typeof record?.country_name === "string" && record.country_name.trim()
        ? record.country_name.trim()
        : countryNameFromId(countryId),
    country_probability: countryProbability ?? 0,
    created_at: createdAt.toISOString(),
  };
}

async function loadSeedPayload(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);

    if (!response.ok) {
      throw new Error(`Seed download failed with status ${response.status}`);
    }

    return response.json();
  }

  const absolutePath = path.isAbsolute(source)
    ? source
    : path.resolve(process.cwd(), source);
  const fileContent = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(fileContent);
}

export function resolveSeedSource(explicitSource) {
  return (
    explicitSource ||
    process.env.PROFILES_SEED_SOURCE ||
    process.env.PROFILES_SEED_FILE ||
    path.resolve(process.cwd(), "data", "profiles-2026.json")
  );
}

export async function seedProfiles({ store, source, strict = false }) {
  const payload = await loadSeedPayload(source);
  const records = pickArrayPayload(payload);

  if (!records) {
    throw new Error("Seed file must contain an array or a top-level data/profiles array");
  }

  const normalizedProfiles = records
    .map((record) => normalizeSeedRecord(record))
    .filter(Boolean);

  if (strict && normalizedProfiles.length !== records.length) {
    throw new Error("Some seed records are invalid");
  }

  return store.upsertMany(normalizedProfiles);
}
