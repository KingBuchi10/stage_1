import assert from "node:assert/strict";
import crypto from "node:crypto";
import app from "../api/index.js";
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

async function startTestServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    redirect: "manual",
    ...options,
  });
  const text = await response.text();
  let json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      json = null;
    }
  }

  return { response, text, json };
}

function createCodeChallenge(verifier) {
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const { server, baseUrl } = await startTestServer();

test("GET /auth/github redirects with state and PKCE", async () => {
  const state = "state-admin-test";
  const codeChallenge = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const { response } = await request(
    baseUrl,
    `/auth/github?client_type=cli&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&role=admin`,
    {
      headers: {
        Origin: "http://localhost:4173",
      },
    }
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:4173");
  const location = response.headers.get("location");
  assert.ok(location);
  assert.match(location, /github\.com\/login\/oauth\/authorize/);
  assert.match(location, new RegExp(`state=${encodeURIComponent(state)}`));
  assert.match(location, /code_challenge=/);
});

test("GET /auth/github/callback rejects missing code", async () => {
  const { response, json } = await request(baseUrl, "/auth/github/callback?state=missing-code");
  assert.equal(response.status, 400);
  assert.equal(json?.message, "Missing code");
});

test("GET /auth/github/callback rejects missing state", async () => {
  const { response, json } = await request(
    baseUrl,
    "/auth/github/callback?code=mock-admin&code_verifier=test-verifier"
  );
  assert.equal(response.status, 400);
  assert.equal(json?.message, "Missing state");
});

test("GET /auth/github/callback returns tokens for admin mock flow", async () => {
  const state = "role-admin-state";
  const codeVerifier = "verifier-admin-abcdefghijklmnopqrstuvwxyz0123456789";
  const codeChallenge = createCodeChallenge(codeVerifier);

  const start = await request(
    baseUrl,
    `/auth/github?client_type=cli&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&role=admin`
  );
  assert.equal(start.response.status, 302);

  const callback = await request(
    baseUrl,
    `/auth/github/callback?state=${encodeURIComponent(state)}&code=mock-admin&code_verifier=${encodeURIComponent(codeVerifier)}`
  );

  assert.equal(callback.response.status, 200);
  assert.ok(callback.json?.access_token);
  assert.ok(callback.json?.refresh_token);
  assert.equal(callback.json?.user?.role, "admin");
});

test("POST /auth/refresh rotates refresh token", async () => {
  const state = "role-analyst-state";
  const codeVerifier = "verifier-analyst-abcdefghijklmnopqrstuvwxyz0123456789";
  const codeChallenge = createCodeChallenge(codeVerifier);

  await request(
    baseUrl,
    `/auth/github?client_type=cli&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&role=analyst`
  );

  const callback = await request(
    baseUrl,
    `/auth/github/callback?state=${encodeURIComponent(state)}&code=mock-analyst&code_verifier=${encodeURIComponent(codeVerifier)}`
  );
  const refreshToken = callback.json?.refresh_token;
  const accessToken = callback.json?.access_token;

  assert.ok(refreshToken);
  assert.equal(callback.json?.user?.role, "analyst");

  const me = await request(baseUrl, "/api/users/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.json?.user?.role, "analyst");

  const refreshed = await request(baseUrl, "/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_type: "cli",
      refresh_token: refreshToken,
    }),
  });

  assert.equal(refreshed.response.status, 200);
  assert.ok(refreshed.json?.refresh_token);
  assert.notEqual(refreshed.json?.refresh_token, refreshToken);
});

test("GET /auth/github enforces a 10 request rate limit", async () => {
  const headers = {
    "x-forwarded-for": "203.0.113.10",
  };

  for (let index = 0; index < 10; index += 1) {
    const state = `rate-limit-state-${index}`;
    const result = await request(
      baseUrl,
      `/auth/github?client_type=cli&state=${encodeURIComponent(state)}&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&role=admin`,
      { headers }
    );
    assert.equal(result.response.status, 302);
  }

  const blocked = await request(
    baseUrl,
    "/auth/github?client_type=cli&state=rate-limit-blocked&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&role=admin",
    { headers }
  );

  assert.equal(blocked.response.status, 429);
});

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

server.close();

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`All ${checks.length} checks passed.`);
}
