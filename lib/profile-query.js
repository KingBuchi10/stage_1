import { createAppError } from "./profile-service.js";
import { resolveCountryCode } from "./country-data.js";

const VALID_GENDERS = new Set(["male", "female"]);
const VALID_AGE_GROUPS = new Set(["child", "teenager", "adult", "senior"]);
const VALID_SORT_BY = new Set(["age", "created_at", "gender_probability"]);
const VALID_ORDER = new Set(["asc", "desc"]);

function hasEmptyValue(value) {
  return typeof value === "string" && value.trim() === "";
}

function parseInteger(value) {
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) {
    return null;
  }

  return Number.parseInt(value, 10);
}

function parseFloatValue(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQueryText(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeMinAge(target, value) {
  target.min_age = target.min_age === undefined ? value : Math.max(target.min_age, value);
}

function mergeMaxAge(target, value) {
  target.max_age = target.max_age === undefined ? value : Math.min(target.max_age, value);
}

export function parseListQuery(query) {
  const optionalParams = [
    "gender",
    "age_group",
    "country_id",
    "min_age",
    "max_age",
    "min_gender_probability",
    "min_country_probability",
    "sort_by",
    "order",
    "page",
    "limit",
  ];

  for (const key of optionalParams) {
    if (hasEmptyValue(query[key])) {
      throw createAppError(422, "Invalid query parameters");
    }
  }

  const filters = {};

  if (query.gender !== undefined) {
    const gender = String(query.gender).toLowerCase();

    if (!VALID_GENDERS.has(gender)) {
      throw createAppError(422, "Invalid query parameters");
    }

    filters.gender = gender;
  }

  if (query.age_group !== undefined) {
    const ageGroup = String(query.age_group).toLowerCase();

    if (!VALID_AGE_GROUPS.has(ageGroup)) {
      throw createAppError(422, "Invalid query parameters");
    }

    filters.age_group = ageGroup;
  }

  if (query.country_id !== undefined) {
    const countryId = String(query.country_id).toUpperCase();

    if (!/^[A-Z]{2}$/.test(countryId)) {
      throw createAppError(422, "Invalid query parameters");
    }

    filters.country_id = countryId;
  }

  if (query.min_age !== undefined) {
    const minAge = parseInteger(String(query.min_age));

    if (minAge === null) {
      throw createAppError(422, "Invalid query parameters");
    }

    filters.min_age = minAge;
  }

  if (query.max_age !== undefined) {
    const maxAge = parseInteger(String(query.max_age));

    if (maxAge === null) {
      throw createAppError(422, "Invalid query parameters");
    }

    filters.max_age = maxAge;
  }

  if (
    filters.min_age !== undefined &&
    filters.max_age !== undefined &&
    filters.min_age > filters.max_age
  ) {
    throw createAppError(422, "Invalid query parameters");
  }

  if (query.min_gender_probability !== undefined) {
    const minGenderProbability = parseFloatValue(String(query.min_gender_probability));

    if (
      minGenderProbability === null ||
      minGenderProbability < 0 ||
      minGenderProbability > 1
    ) {
      throw createAppError(422, "Invalid query parameters");
    }

    filters.min_gender_probability = minGenderProbability;
  }

  if (query.min_country_probability !== undefined) {
    const minCountryProbability = parseFloatValue(String(query.min_country_probability));

    if (
      minCountryProbability === null ||
      minCountryProbability < 0 ||
      minCountryProbability > 1
    ) {
      throw createAppError(422, "Invalid query parameters");
    }

    filters.min_country_probability = minCountryProbability;
  }

  const sortBy =
    query.sort_by === undefined ? "created_at" : String(query.sort_by).toLowerCase();
  const order = query.order === undefined ? "asc" : String(query.order).toLowerCase();
  const page = query.page === undefined ? 1 : parseInteger(String(query.page));
  const limit = query.limit === undefined ? 10 : parseInteger(String(query.limit));

  if (!VALID_SORT_BY.has(sortBy) || !VALID_ORDER.has(order)) {
    throw createAppError(422, "Invalid query parameters");
  }

  if (page === null || limit === null || page < 1 || limit < 1 || limit > 50) {
    throw createAppError(422, "Invalid query parameters");
  }

  return {
    filters,
    sortBy,
    order,
    page,
    limit,
  };
}

export function parseNaturalLanguageQuery(rawQuery) {
  if (rawQuery === undefined || rawQuery === null || rawQuery === "") {
    throw createAppError(400, "Missing or empty parameter");
  }

  if (typeof rawQuery !== "string" || rawQuery.trim() === "") {
    throw createAppError(400, "Missing or empty parameter");
  }

  const query = normalizeQueryText(rawQuery);
  const filters = {};
  let interpreted = false;

  const hasMale = /\b(male|males|man|men|boy|boys)\b/.test(query);
  const hasFemale = /\b(female|females|woman|women|girl|girls)\b/.test(query);

  if (hasMale || hasFemale) {
    interpreted = true;
  }

  if (hasMale && !hasFemale) {
    filters.gender = "male";
  }

  if (hasFemale && !hasMale) {
    filters.gender = "female";
  }

  if (/\byoung\b/.test(query)) {
    mergeMinAge(filters, 16);
    mergeMaxAge(filters, 24);
    interpreted = true;
  }

  const ageGroupMatchers = [
    { pattern: /\b(children|child)\b/, value: "child" },
    { pattern: /\b(teenager|teenagers|teen|teens)\b/, value: "teenager" },
    { pattern: /\b(adult|adults)\b/, value: "adult" },
    { pattern: /\b(senior|seniors|elderly)\b/, value: "senior" },
  ];

  for (const matcher of ageGroupMatchers) {
    if (matcher.pattern.test(query)) {
      filters.age_group = matcher.value;
      interpreted = true;
      break;
    }
  }

  const minAgePatterns = [
    /\b(?:above|over|older than|age(?:d)? at least|at least)\s+(\d+)\b/,
    /\b(?:from)\s+age\s+(\d+)\s+(?:and up|upwards)\b/,
  ];

  for (const pattern of minAgePatterns) {
    const match = query.match(pattern);

    if (match) {
      mergeMinAge(filters, Number.parseInt(match[1], 10));
      interpreted = true;
      break;
    }
  }

  const maxAgePatterns = [
    /\b(?:below|under|younger than|at most)\s+(\d+)\b/,
  ];

  for (const pattern of maxAgePatterns) {
    const match = query.match(pattern);

    if (match) {
      mergeMaxAge(filters, Number.parseInt(match[1], 10));
      interpreted = true;
      break;
    }
  }

  const betweenMatch = query.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\b/);

  if (betweenMatch) {
    mergeMinAge(filters, Number.parseInt(betweenMatch[1], 10));
    mergeMaxAge(filters, Number.parseInt(betweenMatch[2], 10));
    interpreted = true;
  }

  const countryId = resolveCountryCode(query);

  if (countryId) {
    filters.country_id = countryId;
    interpreted = true;
  }

  if (
    filters.min_age !== undefined &&
    filters.max_age !== undefined &&
    filters.min_age > filters.max_age
  ) {
    throw createAppError(422, "Invalid query parameters");
  }

  if (!interpreted || Object.keys(filters).length === 0) {
    throw createAppError(400, "Unable to interpret query");
  }

  return filters;
}
