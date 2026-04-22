import axios from "axios";
import crypto from "node:crypto";
import { countryNameFromId } from "./country-data.js";

const genderizeUrl = "https://api.genderize.io";
const agifyUrl = "https://api.agify.io";
const nationalizeUrl = "https://api.nationalize.io";

function uuidv7() {
  const timestamp = BigInt(Date.now());
  const random = crypto.randomBytes(10);
  const bytes = Buffer.alloc(16);

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = 0x70 | (random[0] & 0x0f);
  bytes[7] = random[1];
  bytes[8] = 0x80 | (random[2] & 0x3f);
  bytes[9] = random[3];
  bytes[10] = random[4];
  bytes[11] = random[5];
  bytes[12] = random[6];
  bytes[13] = random[7];
  bytes[14] = random[8];
  bytes[15] = random[9];

  const hex = bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function createAppError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

export function getAgeGroup(age) {
  if (age <= 12) {
    return "child";
  }

  if (age <= 19) {
    return "teenager";
  }

  if (age <= 59) {
    return "adult";
  }

  return "senior";
}

function createUpstreamError(externalApi) {
  return createAppError(502, `${externalApi} returned an invalid response`);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeName(name) {
  return name.trim().toLowerCase();
}

export function validateNameInput(name) {
  if (name === undefined || name === null || name === "") {
    return {
      ok: false,
      statusCode: 400,
      message: "Missing or empty name",
    };
  }

  if (typeof name !== "string") {
    return {
      ok: false,
      statusCode: 422,
      message: "Invalid type",
    };
  }

  if (name.trim() === "") {
    return {
      ok: false,
      statusCode: 400,
      message: "Missing or empty name",
    };
  }

  return {
    ok: true,
    value: normalizeName(name),
  };
}

async function fetchClassification(name) {
  let responses;

  try {
    responses = await Promise.all([
      axios.get(genderizeUrl, { params: { name } }),
      axios.get(agifyUrl, { params: { name } }),
      axios.get(nationalizeUrl, { params: { name } }),
    ]);
  } catch (error) {
    if (error.config?.url?.includes("genderize")) {
      throw createUpstreamError("Genderize");
    }

    if (error.config?.url?.includes("agify")) {
      throw createUpstreamError("Agify");
    }

    if (error.config?.url?.includes("nationalize")) {
      throw createUpstreamError("Nationalize");
    }

    throw error;
  }

  const [genderizeResponse, agifyResponse, nationalizeResponse] = responses;
  const genderize = genderizeResponse.data;
  const agify = agifyResponse.data;
  const nationalize = nationalizeResponse.data;

  if (
    typeof genderize.gender !== "string" ||
    !isFiniteNumber(genderize.probability) ||
    !isFiniteNumber(genderize.count) ||
    genderize.count === 0
  ) {
    throw createUpstreamError("Genderize");
  }

  if (!isFiniteNumber(agify.age)) {
    throw createUpstreamError("Agify");
  }

  if (!Array.isArray(nationalize.country) || nationalize.country.length === 0) {
    throw createUpstreamError("Nationalize");
  }

  const topCountry = nationalize.country.reduce((best, current) => {
    if (!best || current.probability > best.probability) {
      return current;
    }

    return best;
  }, null);

  if (!topCountry?.country_id || !isFiniteNumber(topCountry.probability)) {
    throw createUpstreamError("Nationalize");
  }

  return {
    gender: genderize.gender,
    gender_probability: genderize.probability,
    age: agify.age,
    age_group: getAgeGroup(agify.age),
    country_id: topCountry.country_id,
    country_name: countryNameFromId(topCountry.country_id),
    country_probability: topCountry.probability,
  };
}

export async function buildProfile(name) {
  const classification = await fetchClassification(name);

  return {
    id: uuidv7(),
    name,
    ...classification,
    created_at: new Date().toISOString(),
  };
}

export function serializeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    gender: profile.gender,
    gender_probability: profile.gender_probability,
    age: profile.age,
    age_group: profile.age_group,
    country_id: profile.country_id,
    country_name: profile.country_name,
    country_probability: profile.country_probability,
    created_at:
      profile.created_at instanceof Date
        ? profile.created_at.toISOString()
        : new Date(profile.created_at).toISOString(),
  };
}

export function isKnownAppError(error) {
  return Number.isInteger(error?.statusCode) && typeof error?.message === "string";
}

export { uuidv7 };
