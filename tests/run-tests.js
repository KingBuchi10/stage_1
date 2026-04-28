import assert from "node:assert/strict";
import { parseListQuery, parseNaturalLanguageQuery } from "../lib/profile-query.js";
import { buildPaginatedResponse, profilesToCsv } from "../lib/response.js";

const checks = [];

function test(name, fn) {
  checks.push({ name, fn });
}

const profile = {
  id: "018fe6f1-bc54-72d4-8f4b-08a9f0c5b247",
  name: "emmanuel",
  gender: "male",
  gender_probability: 0.99,
  age: 34,
  age_group: "adult",
  country_id: "NG",
  country_name: "Nigeria",
  country_probability: 0.85,
  created_at: "2026-04-01T12:00:00.000Z",
};

test("parseListQuery preserves Stage 2 filtering and pagination rules", () => {
  const parsed = parseListQuery({
    gender: "female",
    age_group: "adult",
    country_id: "ng",
    min_age: "24",
    max_age: "40",
    min_gender_probability: "0.7",
    min_country_probability: "0.6",
    sort_by: "age",
    order: "desc",
    page: "2",
    limit: "20",
  });

  assert.deepEqual(parsed, {
    filters: {
      gender: "female",
      age_group: "adult",
      country_id: "NG",
      min_age: 24,
      max_age: 40,
      min_gender_probability: 0.7,
      min_country_probability: 0.6,
    },
    sortBy: "age",
    order: "desc",
    page: 2,
    limit: 20,
  });
});

test("parseListQuery rejects invalid pagination inputs", () => {
  assert.throws(
    () =>
      parseListQuery({
        page: "0",
        limit: "100",
      }),
    {
      message: "Invalid query parameters",
    }
  );
});

test("parseNaturalLanguageQuery preserves young male nigeria parsing", () => {
  assert.deepEqual(parseNaturalLanguageQuery("young males from nigeria"), {
    gender: "male",
    min_age: 16,
    max_age: 24,
    country_id: "NG",
  });
});

test("parseNaturalLanguageQuery combines age ranges and age groups", () => {
  assert.deepEqual(parseNaturalLanguageQuery("adult females between 30 and 40 from kenya"), {
    gender: "female",
    age_group: "adult",
    min_age: 30,
    max_age: 40,
    country_id: "KE",
  });
});

test("parseNaturalLanguageQuery rejects unsupported text", () => {
  assert.throws(() => parseNaturalLanguageQuery("show me interesting people"), {
    message: "Unable to interpret query",
  });
});

test("buildPaginatedResponse returns the Stage 3 pagination envelope", () => {
  const response = buildPaginatedResponse(
    {
      total: 25,
      data: [profile],
    },
    2,
    10
  );

  assert.deepEqual(response.pagination, {
    page: 2,
    limit: 10,
    total_items: 25,
    total_pages: 3,
    has_next_page: true,
    has_previous_page: true,
  });
});

test("profilesToCsv produces a header row and serialized profile data", () => {
  const csv = profilesToCsv([profile]);
  const lines = csv.split("\n");

  assert.equal(lines.length, 2);
  assert.match(lines[0], /"id","name","gender"/);
  assert.match(lines[1], /"emmanuel"/);
  assert.match(lines[1], /"Nigeria"/);
});

let failures = 0;

for (const check of checks) {
  try {
    await check.fn();
    console.log(`PASS ${check.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`All ${checks.length} checks passed.`);
}
