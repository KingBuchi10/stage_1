#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_API_BASE_URL = process.env.INSIGHTA_API_BASE_URL || "http://localhost:3000";
const DEFAULT_CALLBACK_PORT = Number.parseInt(process.env.INSIGHTA_CLI_PORT || "8787", 10);
const CREDENTIALS_PATH = path.join(os.homedir(), ".insighta", "credentials.json");

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function randomToken(byteLength = 32) {
  return base64url(crypto.randomBytes(byteLength));
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function credentialsDirectory() {
  return path.dirname(CREDENTIALS_PATH);
}

async function loadCredentials() {
  try {
    const raw = await fs.readFile(CREDENTIALS_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function saveCredentials(credentials) {
  await fs.mkdir(credentialsDirectory(), { recursive: true });
  await fs.writeFile(CREDENTIALS_PATH, `${formatJson(credentials)}\n`, "utf8");
}

async function clearCredentials() {
  try {
    await fs.rm(CREDENTIALS_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function expiresAtFromSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isExpiringSoon(isoTimestamp, thresholdMs = 30_000) {
  if (!isoTimestamp) {
    return true;
  }

  return new Date(isoTimestamp).getTime() - Date.now() <= thresholdMs;
}

function parseOptions(args) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { options, positionals };
}

function queryParamsFromOptions(options) {
  const keyMap = {
    gender: "gender",
    "age-group": "age_group",
    "country-id": "country_id",
    "min-age": "min_age",
    "max-age": "max_age",
    "min-gender-probability": "min_gender_probability",
    "min-country-probability": "min_country_probability",
    "sort-by": "sort_by",
    order: "order",
    page: "page",
    limit: "limit",
  };

  const params = new URLSearchParams();

  for (const [key, mapped] of Object.entries(keyMap)) {
    if (options[key] !== undefined) {
      params.set(mapped, options[key]);
    }
  }

  return params;
}

async function openBrowser(url) {
  const platform = process.platform;

  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  if (platform === "darwin") {
    spawn("open", [url], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  spawn("xdg-open", [url], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

async function requestJson(baseUrl, pathname, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers,
    body,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || `Request failed with status ${response.status}`);
  }

  return payload;
}

async function requestText(baseUrl, pathname, { headers = {} } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: "GET",
    headers,
  });
  const text = await response.text();

  if (!response.ok) {
    try {
      const payload = JSON.parse(text);
      throw new Error(payload?.message || `Request failed with status ${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      throw error;
    }
  }

  return text;
}

function buildAuthHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function refreshCredentials(credentials) {
  const payload = await requestJson(credentials.api_base_url, "/api/v1/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_type: "cli",
      refresh_token: credentials.refresh_token,
    }),
  });

  const nextCredentials = {
    ...credentials,
    access_token: payload.data.access_token,
    refresh_token: payload.data.refresh_token,
    access_token_expires_at: expiresAtFromSeconds(payload.data.access_token_expires_in),
    refresh_token_expires_at: expiresAtFromSeconds(payload.data.refresh_token_expires_in),
    user: payload.data.user,
    refreshed_at: nowIso(),
  };

  await saveCredentials(nextCredentials);
  return nextCredentials;
}

async function requireCredentials() {
  const credentials = await loadCredentials();

  if (!credentials) {
    throw new Error("No credentials found. Run `insighta login` first.");
  }

  if (isExpiringSoon(credentials.refresh_token_expires_at, 0)) {
    throw new Error("Stored refresh token has expired. Run `insighta login` again.");
  }

  if (isExpiringSoon(credentials.access_token_expires_at)) {
    return refreshCredentials(credentials);
  }

  return credentials;
}

async function waitForCallback({ port, expectedState, timeoutMs = 180_000 }) {
  const callbackPromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state || state !== expectedState) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end("<h1>Insighta login failed</h1><p>Invalid OAuth callback.</p>");
        server.close();
        reject(new Error("OAuth callback validation failed"));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<h1>Insighta login complete</h1><p>You can return to the terminal.</p>");
      server.close();
      resolve({ code, state });
    });

    server.listen(port, "127.0.0.1");
    server.on("error", reject);
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Timed out waiting for OAuth callback")), timeoutMs);
  });

  return Promise.race([callbackPromise, timeoutPromise]);
}

async function handleLogin(args) {
  const apiBaseUrl = args[0] || DEFAULT_API_BASE_URL;
  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const codeChallenge = base64url(sha256(codeVerifier));
  const redirectUri = `http://127.0.0.1:${DEFAULT_CALLBACK_PORT}/callback`;
  const authorizeUrl = new URL("/api/v1/auth/oauth/github/start", apiBaseUrl);

  authorizeUrl.searchParams.set("client_type", "cli");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const callbackWait = waitForCallback({
    port: DEFAULT_CALLBACK_PORT,
    expectedState: state,
  });

  console.log(`Opening browser for GitHub login...`);
  console.log(`If it does not open automatically, visit:\n${authorizeUrl.toString()}\n`);
  await openBrowser(authorizeUrl.toString());
  const callback = await callbackWait;

  const tokenPayload = await requestJson(apiBaseUrl, "/api/v1/auth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_type: "cli",
      code: callback.code,
      code_verifier: codeVerifier,
    }),
  });

  const credentials = {
    api_base_url: apiBaseUrl,
    access_token: tokenPayload.data.access_token,
    refresh_token: tokenPayload.data.refresh_token,
    access_token_expires_at: expiresAtFromSeconds(tokenPayload.data.access_token_expires_in),
    refresh_token_expires_at: expiresAtFromSeconds(tokenPayload.data.refresh_token_expires_in),
    user: tokenPayload.data.user,
    created_at: nowIso(),
  };

  await saveCredentials(credentials);
  console.log(`Logged in as ${credentials.user.github_login} (${credentials.user.role})`);
  console.log(`Credentials stored at ${CREDENTIALS_PATH}`);
}

async function handleWhoAmI() {
  const credentials = await requireCredentials();
  const payload = await requestJson(credentials.api_base_url, "/api/v1/auth/me", {
    headers: buildAuthHeaders(credentials.access_token),
  });
  console.log(formatJson(payload.data));
}

async function handleLogout() {
  const credentials = await loadCredentials();

  if (credentials?.access_token) {
    try {
      await requestJson(credentials.api_base_url, "/api/v1/auth/logout", {
        method: "POST",
        headers: buildAuthHeaders(credentials.access_token),
        body: JSON.stringify({}),
      });
    } catch (error) {
      console.error(`Logout request warning: ${error.message}`);
    }
  }

  await clearCredentials();
  console.log("Credentials cleared.");
}

async function handleProfilesList(args) {
  const credentials = await requireCredentials();
  const { options } = parseOptions(args);
  const query = queryParamsFromOptions(options);
  const pathname = `/api/v1/profiles${query.toString() ? `?${query.toString()}` : ""}`;
  const payload = await requestJson(credentials.api_base_url, pathname, {
    headers: buildAuthHeaders(credentials.access_token),
  });
  console.log(formatJson(payload));
}

async function handleProfilesSearch(args) {
  const credentials = await requireCredentials();
  const { options, positionals } = parseOptions(args);
  const queryText = positionals.join(" ").trim();

  if (!queryText) {
    throw new Error("Search query is required.");
  }

  const query = queryParamsFromOptions(options);
  query.set("q", queryText);
  const payload = await requestJson(
    credentials.api_base_url,
    `/api/v1/profiles/search?${query.toString()}`,
    {
      headers: buildAuthHeaders(credentials.access_token),
    }
  );
  console.log(formatJson(payload));
}

async function handleProfilesGet(args) {
  const credentials = await requireCredentials();
  const id = args[0];

  if (!id) {
    throw new Error("Profile id is required.");
  }

  const payload = await requestJson(credentials.api_base_url, `/api/v1/profiles/${id}`, {
    headers: buildAuthHeaders(credentials.access_token),
  });
  console.log(formatJson(payload));
}

async function handleProfilesCreate(args) {
  const credentials = await requireCredentials();
  const name = args.join(" ").trim();

  if (!name) {
    throw new Error("Profile name is required.");
  }

  const payload = await requestJson(credentials.api_base_url, "/api/v1/profiles", {
    method: "POST",
    headers: buildAuthHeaders(credentials.access_token),
    body: JSON.stringify({ name }),
  });
  console.log(formatJson(payload));
}

async function handleProfilesDelete(args) {
  const credentials = await requireCredentials();
  const id = args[0];

  if (!id) {
    throw new Error("Profile id is required.");
  }

  const response = await fetch(new URL(`/api/v1/profiles/${id}`, credentials.api_base_url), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    throw new Error(payload?.message || `Request failed with status ${response.status}`);
  }

  console.log(`Deleted profile ${id}`);
}

async function handleProfilesExport(args) {
  const credentials = await requireCredentials();
  const { options, positionals } = parseOptions(args);
  const query = queryParamsFromOptions(options);
  const outputPath = positionals[0] || path.resolve(process.cwd(), "profiles-export.csv");
  const csv = await requestText(
    credentials.api_base_url,
    `/api/v1/profiles/export${query.toString() ? `?${query.toString()}` : ""}`,
    {
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
      },
    }
  );

  await fs.writeFile(outputPath, csv, "utf8");
  console.log(`CSV export saved to ${outputPath}`);
}

function printHelp() {
  console.log(`Insighta CLI

Usage:
  insighta login [api-base-url]
  insighta whoami
  insighta logout
  insighta profiles list [--gender male --country-id NG --page 1 --limit 10]
  insighta profiles search "young males from nigeria" [--page 1 --limit 10]
  insighta profiles get <profile-id>
  insighta profiles create <name>
  insighta profiles delete <profile-id>
  insighta profiles export [output.csv] [--gender female]
`);
}

async function main() {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "login") {
    await handleLogin([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "whoami") {
    await handleWhoAmI();
    return;
  }

  if (command === "logout") {
    await handleLogout();
    return;
  }

  if (command === "profiles" && subcommand === "list") {
    await handleProfilesList(rest);
    return;
  }

  if (command === "profiles" && subcommand === "search") {
    await handleProfilesSearch(rest);
    return;
  }

  if (command === "profiles" && subcommand === "get") {
    await handleProfilesGet(rest);
    return;
  }

  if (command === "profiles" && subcommand === "create") {
    await handleProfilesCreate(rest);
    return;
  }

  if (command === "profiles" && subcommand === "delete") {
    await handleProfilesDelete(rest);
    return;
  }

  if (command === "profiles" && subcommand === "export") {
    await handleProfilesExport(rest);
    return;
  }

  throw new Error("Unknown command. Run `insighta help` for usage.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
