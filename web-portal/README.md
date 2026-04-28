# Insighta Web Portal

This package is the browser interface for the Insighta Labs+ platform.

## Run

```bash
npm start
```

By default the portal serves on `http://localhost:4173` and points at `http://localhost:3000`.

Override the backend target with:

```bash
INSIGHTA_API_BASE_URL=http://localhost:3000 npm start
```

## Browser auth model

- GitHub OAuth + PKCE
- HTTP-only access and refresh cookies
- Readable CSRF cookie paired with the `X-CSRF-Token` header
- Automatic refresh retry when the access cookie expires
