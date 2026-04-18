# Stage 0 Profile Classification API

An Express-based API that accepts a person's name, calls three public APIs, derives profile metadata, stores the result, and exposes endpoints to create, retrieve, filter, and delete profiles.

This project is set up to run locally with Node.js and deploy on Vercel.

## Overview

When a client submits a name, the API calls:

- `Genderize` to estimate gender and confidence
- `Agify` to estimate age
- `Nationalize` to estimate nationality

The service then:

- normalizes the name to lowercase
- classifies the age into an age group
- picks the nationality with the highest probability
- generates a UUID v7 profile ID
- stores the result in a repository layer

At the moment, the repository uses in-memory storage so the app works without a database. The storage logic is isolated behind a small abstraction so a real database can be added later without rewriting the route handlers.

## External APIs Used

- Genderize: `https://api.genderize.io?name={name}`
- Agify: `https://api.agify.io?name={name}`
- Nationalize: `https://api.nationalize.io?name={name}`

No API key is required for these services.

## Tech Stack

- Node.js
- Express
- Axios
- Vercel serverless deployment

## Project Structure

```text
.
|-- api/
|   `-- index.js
|-- lib/
|   |-- profile-service.js
|   `-- profile-store.js
|-- server.js
|-- vercel.json
|-- package.json
`-- README.md
```

## How It Works

### Request Flow

1. A client sends a request to create a profile with a `name`.
2. The API validates the input.
3. The service checks whether that normalized name already exists.
4. If it exists, the existing record is returned.
5. If it does not exist, the app calls the three upstream APIs in parallel.
6. The responses are validated.
7. The profile is built and stored.
8. The created profile is returned to the client.

### Classification Logic

- Age `0-12` -> `child`
- Age `13-19` -> `teenager`
- Age `20-59` -> `adult`
- Age `60+` -> `senior`

For nationality, the app selects the country with the highest probability from the `Nationalize` response.

## Data Model

A stored profile contains:

```json
{
  "id": "019da0f6-62b4-798a-a924-fdb3223c435c",
  "name": "ella",
  "gender": "female",
  "gender_probability": 0.99,
  "sample_size": 1234,
  "age": 46,
  "age_group": "adult",
  "country_id": "DRC",
  "country_probability": 0.85,
  "created_at": "2026-04-18T14:19:54.932Z"
}
```

Notes:

- `id` is generated as UUID v7
- `created_at` is UTC ISO 8601
- `name` is stored in lowercase

## API Base URL

Local development:

```text
http://localhost:3000
```

Production:

```text
https://your-vercel-deployment-url.vercel.app
```

## Endpoints

### Health Check

`GET /`

`GET /api`

Returns a simple status payload and a list of available endpoints.

Example response:

```json
{
  "status": "success",
  "message": "API is running, HNG14",
  "endpoints": {
    "create_profile": "POST /api/profiles",
    "get_profile": "GET /api/profiles/:id",
    "list_profiles": "GET /api/profiles",
    "delete_profile": "DELETE /api/profiles/:id"
  }
}
```

### Create Profile

`POST /api/profiles`

Request body:

```json
{
  "name": "ella"
}
```

Success response when a new profile is created:

```json
{
  "status": "success",
  "data": {
    "id": "019da0f6-62b4-798a-a924-fdb3223c435c",
    "name": "ella",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 1234,
    "age": 46,
    "age_group": "adult",
    "country_id": "DRC",
    "country_probability": 0.85,
    "created_at": "2026-04-18T14:19:54.932Z"
  }
}
```

Response when the profile already exists:

```json
{
  "status": "success",
  "message": "Profile already exists",
  "data": {
    "id": "019da0f6-62b4-798a-a924-fdb3223c435c",
    "name": "ella",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 1234,
    "age": 46,
    "age_group": "adult",
    "country_id": "DRC",
    "country_probability": 0.85,
    "created_at": "2026-04-18T14:19:54.932Z"
  }
}
```

### Get Single Profile

`GET /api/profiles/:id`

Example response:

```json
{
  "status": "success",
  "data": {
    "id": "019da0f6-62b4-798a-a924-fdb3223c435c",
    "name": "ella",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 1234,
    "age": 46,
    "age_group": "adult",
    "country_id": "DRC",
    "country_probability": 0.85,
    "created_at": "2026-04-18T14:19:54.932Z"
  }
}
```

### Get All Profiles

`GET /api/profiles`

Supported optional query parameters:

- `gender`
- `country_id`
- `age_group`

Filtering is case-insensitive.

Example:

```text
/api/profiles?gender=male&country_id=NG
```

Example response:

```json
{
  "status": "success",
  "count": 2,
  "data": [
    {
      "id": "id-1",
      "name": "emmanuel",
      "gender": "male",
      "age": 25,
      "age_group": "adult",
      "country_id": "NG"
    },
    {
      "id": "id-2",
      "name": "sarah",
      "gender": "female",
      "age": 28,
      "age_group": "adult",
      "country_id": "US"
    }
  ]
}
```

### Delete Profile

`DELETE /api/profiles/:id`

Success response:

- `204 No Content`

## Error Handling

All error responses follow this format:

```json
{
  "status": "error",
  "message": "Error message"
}
```

### Validation Errors

- `400 Bad Request` -> missing or empty `name`
- `422 Unprocessable Entity` -> invalid `name` type

Examples:

```json
{
  "status": "error",
  "message": "Missing or empty name"
}
```

```json
{
  "status": "error",
  "message": "Invalid type"
}
```

### Not Found

- `404 Not Found` -> profile does not exist

Example:

```json
{
  "status": "error",
  "message": "Profile not found"
}
```

### Upstream API Errors

If any external API returns invalid data, the profile is not stored and the API returns `502`.

Possible messages:

- `Genderize returned an invalid response`
- `Agify returned an invalid response`
- `Nationalize returned an invalid response`

Example:

```json
{
  "status": "error",
  "message": "Genderize returned an invalid response"
}
```

### Generic Server Error

Unexpected internal failures return:

```json
{
  "status": "error",
  "message": "Internal server error"
}
```

## Edge Cases Covered

- Duplicate names do not create duplicate records
- `Genderize` returning `gender: null` or `count: 0` returns `502`
- `Agify` returning `age: null` returns `502`
- `Nationalize` returning no country data returns `502`
- Query filtering is case-insensitive
- Unknown routes return `404`
- Unsupported preflight requests are handled through `OPTIONS`

## CORS

The API sends:

```text
Access-Control-Allow-Origin: *
```

It also allows:

- `GET`
- `POST`
- `DELETE`
- `OPTIONS`

This is important for external clients and automated grading scripts.

## Local Development

### Prerequisites

- Node.js 18+ recommended
- npm

### Install Dependencies

```bash
npm install
```

### Run Locally

```bash
npm start
```

The server starts on:

```text
http://localhost:3000
```

There is also a development script configured:

```bash
npm run dev
```

Note:

- `package.json` includes a `dev` script using `nodemon`
- if `nodemon` is not installed in your environment, install it first or keep using `npm start`

## Example Requests

### Postman

Create:

- Method: `POST`
- URL: `http://localhost:3000/api/profiles`
- Body type: `raw`
- Body format: `JSON`

```json
{
  "name": "ella"
}
```

List:

- `GET http://localhost:3000/api/profiles`
- `GET http://localhost:3000/api/profiles?gender=male`
- `GET http://localhost:3000/api/profiles?country_id=NG`
- `GET http://localhost:3000/api/profiles?age_group=adult`

Single profile:

- `GET http://localhost:3000/api/profiles/<profile-id>`

Delete:

- `DELETE http://localhost:3000/api/profiles/<profile-id>`

### cURL

Create a profile:

```bash
curl -X POST http://localhost:3000/api/profiles \
  -H "Content-Type: application/json" \
  -d '{"name":"ella"}'
```

Get all profiles:

```bash
curl http://localhost:3000/api/profiles
```

Filter profiles:

```bash
curl "http://localhost:3000/api/profiles?gender=male&country_id=NG"
```

Get one profile:

```bash
curl http://localhost:3000/api/profiles/<profile-id>
```

Delete a profile:

```bash
curl -X DELETE http://localhost:3000/api/profiles/<profile-id>
```

## Deployment on Vercel

The repository is configured for Vercel through [vercel.json](/c:/Users/nezia/Desktop/stage_0-main/vercel.json:1).

Current rewrite rules:

- `/` -> `/api/index.js`
- `/api/:path*` -> `/api/index.js`

This means Vercel routes incoming requests into the Express app exported from `api/index.js`.

### Deploy Steps

1. Push the repository to GitHub.
2. Import the project into Vercel.
3. Vercel will install dependencies from `package.json`.
4. Deploy.

After deployment, test:

- `GET /`
- `POST /api/profiles`
- `GET /api/profiles`

## Storage Design

The app currently uses an in-memory repository defined in [lib/profile-store.js](/c:/Users/nezia/Desktop/stage_0-main/lib/profile-store.js:1).

What that means:

- the app works without a database
- data is process-local
- data will not persist reliably across server restarts or serverless cold starts

This is acceptable for a no-database fallback, but not for durable production storage.

If you want persistence later, the easiest upgrade path is to replace the current store implementation with a database-backed version while preserving the same methods:

- `findById`
- `findByName`
- `list`
- `create`
- `delete`

## Internal Architecture

### `api/index.js`

Defines the Express app, middleware, routes, CORS handling, and error responses.

### `lib/profile-service.js`

Contains:

- input validation
- UUID v7 generation
- external API orchestration
- upstream response validation
- age-group classification logic
- response shaping for list endpoints

### `lib/profile-store.js`

Contains the current in-memory profile repository and case-insensitive filtering logic.

### `server.js`

Starts the Express app locally with `app.listen(...)`.

## Current Limitations

- No persistent database is connected yet
- Profiles are lost when in-memory state resets
- No automated test suite is included yet
- Live behavior depends on the availability of the three external APIs

## Possible Next Improvements

- Add a real database such as PostgreSQL or MongoDB
- Add automated tests for routes and service logic
- Add request logging
- Add rate limiting and timeout controls
- Add environment-based configuration

## License

ISC
