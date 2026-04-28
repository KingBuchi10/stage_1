const config = window.__INSIGHTA_CONFIG__ || {};
const apiBaseUrl = config.apiBaseUrl || "http://localhost:3000";
const oauthStorageKey = "insighta.pendingOAuth";

const state = {
  mode: "list",
  currentPage: 1,
  totalPages: 0,
  query: new URLSearchParams("page=1&limit=10&sort_by=created_at&order=asc"),
  user: null,
};

const elements = {
  authState: document.getElementById("authState"),
  workspace: document.getElementById("workspace"),
  loginButton: document.getElementById("loginButton"),
  logoutButton: document.getElementById("logoutButton"),
  userSummary: document.getElementById("userSummary"),
  statusBanner: document.getElementById("statusBanner"),
  filtersForm: document.getElementById("filtersForm"),
  resetFiltersButton: document.getElementById("resetFiltersButton"),
  searchForm: document.getElementById("searchForm"),
  naturalQuery: document.getElementById("naturalQuery"),
  clearSearchButton: document.getElementById("clearSearchButton"),
  profilesTable: document.getElementById("profilesTable"),
  resultsMeta: document.getElementById("resultsMeta"),
  pageIndicator: document.getElementById("pageIndicator"),
  previousPageButton: document.getElementById("previousPageButton"),
  nextPageButton: document.getElementById("nextPageButton"),
  roleBadge: document.getElementById("roleBadge"),
  exportButton: document.getElementById("exportButton"),
  adminTools: document.getElementById("adminTools"),
  createProfileForm: document.getElementById("createProfileForm"),
  actionsHeader: document.getElementById("actionsHeader"),
};

function getCookie(name) {
  return document.cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => pair.split("="))
    .find(([key]) => key === name)?.[1];
}

function decodeCookie(name) {
  const value = getCookie(name);
  return value ? decodeURIComponent(value) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(message, tone = "success") {
  elements.statusBanner.textContent = message;
  elements.statusBanner.className = `status ${tone}`;
}

function clearStatus() {
  elements.statusBanner.textContent = "";
  elements.statusBanner.className = "status hidden";
}

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomVerifier() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function createPkceChallenge(verifier) {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64url(digest);
}

async function beginLogin() {
  clearStatus();
  const stateToken = crypto.randomUUID();
  const codeVerifier = randomVerifier();
  const codeChallenge = await createPkceChallenge(codeVerifier);
  const redirectUri = `${window.location.origin}/auth/callback`;

  sessionStorage.setItem(
    oauthStorageKey,
    JSON.stringify({
      state: stateToken,
      codeVerifier,
      redirectUri,
    })
  );

  const url = new URL("/api/v1/auth/oauth/github/start", apiBaseUrl);
  url.searchParams.set("client_type", "web");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", stateToken);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
}

async function refreshSession() {
  const csrfToken = decodeCookie("insighta_csrf");
  const response = await fetch(new URL("/api/v1/auth/refresh", apiBaseUrl), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    return false;
  }

  return true;
}

async function apiRequest(pathname, { method = "GET", body, retry = true } = {}) {
  const headers = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (!["GET", "HEAD"].includes(method)) {
    const csrfToken = decodeCookie("insighta_csrf");

    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
  }

  const response = await fetch(new URL(pathname, apiBaseUrl), {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && retry) {
    const refreshed = await refreshSession();

    if (refreshed) {
      return apiRequest(pathname, { method, body, retry: false });
    }
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || `Request failed with status ${response.status}`);
  }

  return payload;
}

async function fetchCurrentUser() {
  const payload = await apiRequest("/api/v1/auth/me", { retry: true });
  return payload.data.user;
}

function renderUser() {
  const user = state.user;
  const isAdmin = user?.role === "admin";

  if (!user) {
    elements.userSummary.classList.add("hidden");
    elements.logoutButton.classList.add("hidden");
    elements.loginButton.classList.remove("hidden");
    elements.workspace.classList.add("hidden");
    elements.authState.classList.remove("hidden");
    return;
  }

  elements.userSummary.innerHTML = `
    <strong>${escapeHtml(user.github_login)}</strong><br />
    <span>${escapeHtml(user.role)}</span>
  `;
  elements.userSummary.classList.remove("hidden");
  elements.logoutButton.classList.remove("hidden");
  elements.loginButton.classList.add("hidden");
  elements.workspace.classList.remove("hidden");
  elements.authState.classList.add("hidden");
  elements.roleBadge.textContent = user.role.toUpperCase();

  if (isAdmin) {
    elements.adminTools.classList.remove("hidden");
    elements.actionsHeader.classList.remove("hidden");
  } else {
    elements.adminTools.classList.add("hidden");
    elements.actionsHeader.classList.add("hidden");
  }
}

function buildListQueryFromFilters() {
  const formData = new FormData(elements.filtersForm);
  const query = new URLSearchParams();

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value.trim() !== "") {
      query.set(key, value.trim());
    }
  }

  query.set("page", String(state.currentPage));

  if (!query.has("limit")) {
    query.set("limit", "10");
  }

  if (!query.has("sort_by")) {
    query.set("sort_by", "created_at");
  }

  if (!query.has("order")) {
    query.set("order", "asc");
  }

  return query;
}

function renderProfiles(payload) {
  const isAdmin = state.user?.role === "admin";
  const profiles = payload.data || [];
  const pagination = payload.pagination || {};

  state.totalPages = pagination.total_pages || 0;
  state.currentPage = pagination.page || 1;

  elements.pageIndicator.textContent = `Page ${state.currentPage}`;
  elements.resultsMeta.textContent = `${pagination.total_items || 0} results`;
  elements.previousPageButton.disabled = !pagination.has_previous_page;
  elements.nextPageButton.disabled = !pagination.has_next_page;

  if (profiles.length === 0) {
    elements.profilesTable.innerHTML = `
      <tr>
        <td colspan="${isAdmin ? 9 : 8}">No profiles matched the current view.</td>
      </tr>
    `;
    return;
  }

  elements.profilesTable.innerHTML = profiles
    .map((profile) => {
      const actionCell = isAdmin
        ? `<td><button class="danger-link" data-delete-id="${profile.id}">Delete</button></td>`
        : "";

      return `
        <tr>
          <td>${escapeHtml(profile.name)}</td>
          <td>${escapeHtml(profile.gender)}</td>
          <td>${escapeHtml(profile.age)}</td>
          <td>${escapeHtml(profile.age_group)}</td>
          <td>${escapeHtml(profile.country_name)} (${escapeHtml(profile.country_id)})</td>
          <td>${escapeHtml(profile.gender_probability)}</td>
          <td>${escapeHtml(profile.country_probability)}</td>
          <td>${escapeHtml(new Date(profile.created_at).toLocaleString())}</td>
          ${actionCell}
        </tr>
      `;
    })
    .join("");
}

async function loadProfiles() {
  const query = new URLSearchParams(state.query.toString());
  query.set("page", String(state.currentPage));
  const pathname =
    state.mode === "search"
      ? `/api/v1/profiles/search?${query.toString()}`
      : `/api/v1/profiles?${query.toString()}`;
  const payload = await apiRequest(pathname);
  renderProfiles(payload);
}

async function submitFilters(event) {
  event.preventDefault();
  clearStatus();
  state.mode = "list";
  state.currentPage = 1;
  state.query = buildListQueryFromFilters();
  await loadProfiles();
}

async function submitSearch(event) {
  event.preventDefault();
  const queryText = elements.naturalQuery.value.trim();

  if (!queryText) {
    setStatus("Enter a natural language query first.", "error");
    return;
  }

  clearStatus();
  state.mode = "search";
  state.currentPage = 1;
  const query = buildListQueryFromFilters();
  query.set("q", queryText);
  state.query = query;
  await loadProfiles();
}

async function exportProfiles() {
  clearStatus();
  const response = await fetch(
    new URL(
      `/api/v1/profiles/export${state.query.toString() ? `?${state.query.toString()}` : ""}`,
      apiBaseUrl
    ),
    {
      method: "GET",
      credentials: "include",
    }
  );

  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload?.message || "Export failed");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "profiles-export.csv";
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("CSV export downloaded.");
}

async function createProfile(event) {
  event.preventDefault();
  const formData = new FormData(elements.createProfileForm);
  const name = String(formData.get("name") || "").trim();

  if (!name) {
    setStatus("Enter a name to create a profile.", "error");
    return;
  }

  await apiRequest("/api/v1/profiles", {
    method: "POST",
    body: { name },
  });
  elements.createProfileForm.reset();
  setStatus("Profile created.");
  await loadProfiles();
}

async function deleteProfile(id) {
  await apiRequest(`/api/v1/profiles/${id}`, {
    method: "DELETE",
  });
  setStatus("Profile deleted.");
  await loadProfiles();
}

async function handleLogout() {
  try {
    await apiRequest("/api/v1/auth/logout", {
      method: "POST",
      body: {},
    });
  } catch (error) {
    setStatus(error.message, "error");
  }

  state.user = null;
  renderUser();
  setStatus("Logged out.");
}

async function maybeHandleOAuthCallback() {
  if (window.location.pathname !== "/auth/callback") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const stateToken = params.get("state");
  const pending = sessionStorage.getItem(oauthStorageKey);

  if (!pending) {
    setStatus("OAuth session details were not found. Start login again.", "error");
    return true;
  }

  const payload = JSON.parse(pending);

  if (!code || !stateToken || payload.state !== stateToken) {
    setStatus("OAuth callback validation failed.", "error");
    return true;
  }

  try {
    await apiRequest("/api/v1/auth/token", {
      method: "POST",
      body: {
        grant_type: "authorization_code",
        client_type: "web",
        code,
        code_verifier: payload.codeVerifier,
      },
    });
    sessionStorage.removeItem(oauthStorageKey);
    window.history.replaceState({}, "", "/");
    setStatus("Login complete.");
    return false;
  } catch (error) {
    setStatus(error.message, "error");
    return true;
  }
}

function attachEvents() {
  elements.loginButton.addEventListener("click", () => {
    beginLogin().catch((error) => setStatus(error.message, "error"));
  });

  elements.logoutButton.addEventListener("click", () => {
    handleLogout().catch((error) => setStatus(error.message, "error"));
  });

  elements.filtersForm.addEventListener("submit", (event) => {
    submitFilters(event).catch((error) => setStatus(error.message, "error"));
  });

  elements.resetFiltersButton.addEventListener("click", () => {
    elements.filtersForm.reset();
    state.mode = "list";
    state.currentPage = 1;
    state.query = buildListQueryFromFilters();
    loadProfiles().catch((error) => setStatus(error.message, "error"));
  });

  elements.searchForm.addEventListener("submit", (event) => {
    submitSearch(event).catch((error) => setStatus(error.message, "error"));
  });

  elements.clearSearchButton.addEventListener("click", () => {
    elements.naturalQuery.value = "";
    state.mode = "list";
    state.currentPage = 1;
    state.query = buildListQueryFromFilters();
    loadProfiles().catch((error) => setStatus(error.message, "error"));
  });

  elements.previousPageButton.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage -= 1;
      loadProfiles().catch((error) => setStatus(error.message, "error"));
    }
  });

  elements.nextPageButton.addEventListener("click", () => {
    if (state.currentPage < state.totalPages) {
      state.currentPage += 1;
      loadProfiles().catch((error) => setStatus(error.message, "error"));
    }
  });

  elements.exportButton.addEventListener("click", () => {
    exportProfiles().catch((error) => setStatus(error.message, "error"));
  });

  elements.createProfileForm.addEventListener("submit", (event) => {
    createProfile(event).catch((error) => setStatus(error.message, "error"));
  });

  elements.profilesTable.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const id = target.getAttribute("data-delete-id");

    if (!id) {
      return;
    }

    deleteProfile(id).catch((error) => setStatus(error.message, "error"));
  });
}

async function bootstrap() {
  attachEvents();
  const callbackBlocked = await maybeHandleOAuthCallback();

  if (callbackBlocked) {
    return;
  }

  try {
    state.user = await fetchCurrentUser();
    renderUser();
    state.query = buildListQueryFromFilters();
    await loadProfiles();
  } catch (error) {
    state.user = null;
    renderUser();
  }
}

bootstrap().catch((error) => setStatus(error.message, "error"));
