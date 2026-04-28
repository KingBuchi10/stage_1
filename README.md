# Insighta Labs+ Platform

Stage 3 turns the Stage 2 Profile Intelligence System into a multi-interface platform with GitHub login, role-aware access control, short-lived sessions, CSV export, a browser portal, and an installable CLI.

The root of this workspace is the backend repo. The other two repo-ready projects live in:

- [`cli/`](./cli)
- [`web-portal/`](./web-portal)

## System architecture

The platform has three surfaces that talk to one backend:

1. `backend` (this repo root)
   Exposes the legacy Stage 2 API plus a new `/api/v1` surface with OAuth, session management, RBAC, CSV export, rate limiting, and request logging.
2. `cli`
   A globally installable Node CLI that authenticates with GitHub OAuth + PKCE and stores credentials at `~/.insighta/credentials.json`.
3. `web-portal`
   A standalone browser app that authenticates with GitHub OAuth + PKCE, receives HTTP-only auth cookies from the backend, and sends CSRF-protected requests.

Storage is split by concern:

- Profiles remain in the existing profile store and keep the Stage 2 query/parser behavior.
- Users, OAuth requests, one-time authorization codes, and refresh-token-backed sessions live in a dedicated auth store.
- If MongoDB is unavailable, both profile and auth stores fall back to in-memory implementations.

## Authentication flow

Both the CLI and web portal use the same high-level flow:

1. The client generates a PKCE verifier/challenge pair and a client `state`.
2. The client sends the browser to `GET /api/v1/auth/oauth/github/start`.
3. The backend stores the pending OAuth request and redirects to GitHub.
4. GitHub redirects back to `GET /api/v1/auth/oauth/github/callback`.
5. The backend exchanges the GitHub code, fetches the GitHub user, maps that account to a local role, and creates a short-lived one-time authorization code.
6. The backend redirects back to the original client redirect URI with the one-time authorization code and original client `state`.
7. The client redeems that code at `POST /api/v1/auth/token` using the original PKCE verifier.
8. The backend creates a session, issues a short-lived access token, a rotatable refresh token, and a CSRF token.

Client differences:

- CLI: receives access and refresh tokens in JSON and stores them in `~/.insighta/credentials.json`.
- Web portal: receives HTTP-only access and refresh cookies, plus a readable CSRF cookie used in the `X-CSRF-Token` header.

## Token handling approach

- Access token: signed JWT, default lifetime `300` seconds.
- Refresh token: opaque random secret bound to a persisted session, default lifetime `1800` seconds.
- Rotation: every successful refresh replaces both the refresh token and the CSRF token.
- Session validation: every authenticated request checks both the access token signature and the persisted session state.
- Logout: revokes the persisted session and clears cookies.

## Role enforcement logic

Roles are resolved from GitHub identity using environment-controlled allowlists:

- `ADMIN_GITHUB_USERS`
- `ANALYST_GITHUB_USERS`
- `ALLOW_UNLISTED_ANALYSTS=true` for local/demo mode if needed

Role policy:

- `admin`
  Can list, search, export, create, fetch, and delete profiles.
- `analyst`
  Can list, search, export, and fetch profiles.

Protected endpoints require authentication, and mutating cookie-authenticated requests also require a valid CSRF token.

## Natural language parsing approach

Stage 2 natural language search remains rule-based and unchanged in spirit:

1. Normalize query text.
2. Match supported gender, age-group, numeric age range, and country patterns.
3. Convert matches into structured filters.
4. Reject unsupported free text with `Unable to interpret query`.

No external NLP or LLM service is used for query parsing.

## API summary

Legacy routes remain available at `/api/profiles` and preserve the Stage 2 response shape.

Versioned routes live under `/api/v1`:

- `GET /api/v1/auth/oauth/github/start`
- `GET /api/v1/auth/oauth/github/callback`
- `POST /api/v1/auth/token`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `GET /api/v1/profiles`
- `GET /api/v1/profiles/search`
- `GET /api/v1/profiles/export`
- `GET /api/v1/profiles/:id`
- `POST /api/v1/profiles`
- `DELETE /api/v1/profiles/:id`

Compatibility auth and user routes are also exposed for external graders and simple clients:

- `GET /auth/github`
- `GET /auth/github/callback`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /api/users/me`

The Stage 3 pagination envelope is:

```json
{
  "status": "success",
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total_items": 2026,
    "total_pages": 203,
    "has_next_page": true,
    "has_previous_page": false
  }
}
```

## Local setup

1. Install backend dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and configure values.

3. Start the backend:

```bash
npm run dev
```

4. Start the web portal in a second terminal:

```bash
cd web-portal
npm start
```

5. Use the CLI from a third terminal:

```bash
cd cli
npm start -- help
```

## Environment variables

See [`.env.example`](./.env.example). The important Stage 3 values are:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL`
- `GITHUB_WEB_REDIRECT_URIS`
- `GITHUB_CLI_REDIRECT_URIS`
- `JWT_SECRET`
- `SESSION_SECRET`
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`
- `ADMIN_GITHUB_USERS`
- `ANALYST_GITHUB_USERS`
- `ALLOWED_ORIGINS`

## CLI usage

Examples:

```bash
cd cli
npm install -g .
insighta login http://localhost:3000
insighta whoami
insighta profiles list --gender male --country-id NG --limit 20
insighta profiles search "adult females from kenya"
insighta profiles export profiles.csv --country-id ZA
```

## Security controls

- GitHub OAuth with PKCE for both browser and CLI
- Short-lived access tokens plus rotatable refresh tokens
- HTTP-only cookies for browser auth
- CSRF validation on mutating cookie-authenticated requests
- Route-level RBAC
- Basic IP-based rate limiting
- Structured request logging with request IDs

## Testing

Run the local checks with:

```bash
npm test
```

The current checks pin the Stage 2 query parsing behavior and the Stage 3 pagination/CSV response utilities.

## Submission notes

- Backend repo: this root project
- CLI repo: `cli/`
- Web portal repo: `web-portal/`
- Live backend URL: not deployed from this workspace
- Live web portal URL: not deployed from this workspace
