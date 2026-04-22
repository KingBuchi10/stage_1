# Insighta Labs Profile API

An Express + MongoDB API for storing demographic profiles and querying them with exact filters or rule-based natural language search.

## Features

- `GET /api/profiles` with combined filtering, sorting, and pagination
- `GET /api/profiles/search` with rule-based natural language parsing
- `POST /api/profiles` for single profile creation from upstream demographic APIs
- `GET /api/profiles/:id` and `DELETE /api/profiles/:id`
- UUID v7 profile IDs
- CORS enabled with `Access-Control-Allow-Origin: *`
- Idempotent seed flow for 2026 profiles

## Profile schema

Each profile is stored with:

- `id` - UUID v7
- `name` - unique lowercase full name
- `gender` - `male` or `female`
- `gender_probability` - float
- `age` - integer
- `age_group` - `child`, `teenager`, `adult`, or `senior`
- `country_id` - ISO alpha-2 code
- `country_name` - full country name
- `country_probability` - float
- `created_at` - UTC ISO 8601 timestamp

## Setup

1. Install dependencies:

```bash
npm install
```

2. Add environment variables in `.env`:

```env
PORT=3000
DATABASE_URL=mongodb://localhost:27017
DATABASE_NAME=insighta_labs
DATABASE_COLLECTION=profiles
PROFILES_SEED_FILE=./data/profiles-2026.json
AUTO_SEED_PROFILES=false
```

3. Start the server:

```bash
npm run dev
```

## Seeding 2026 profiles

Place the provided JSON file at `data/profiles-2026.json` or point `PROFILES_SEED_FILE` / `PROFILES_SEED_SOURCE` to the correct path or URL.

Run the seed manually:

```bash
npm run seed
```

Or pass a source directly:

```bash
node scripts/seed-profiles.js ./data/profiles-2026.json
```

Seed behavior:

- Uses profile `name` as the idempotent key
- Re-running the seed updates existing matching names instead of inserting duplicates
- Accepts a top-level array or `{ "data": [...] }` / `{ "profiles": [...] }`

## Endpoints

### `GET /api/profiles`

Supported filters:

- `gender`
- `age_group`
- `country_id`
- `min_age`
- `max_age`
- `min_gender_probability`
- `min_country_probability`

Sorting:

- `sort_by=age|created_at|gender_probability`
- `order=asc|desc`

Pagination:

- `page` defaults to `1`
- `limit` defaults to `10`
- `limit` max is `50`

Example:

```http
GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10
```

Success response:

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "data": [
    {
      "id": "018fe6f1-bc54-72d4-8f4b-08a9f0c5b247",
      "name": "emmanuel",
      "gender": "male",
      "gender_probability": 0.99,
      "age": 34,
      "age_group": "adult",
      "country_id": "NG",
      "country_name": "Nigeria",
      "country_probability": 0.85,
      "created_at": "2026-04-01T12:00:00.000Z"
    }
  ]
}
```

### `GET /api/profiles/search`

Example:

```http
GET /api/profiles/search?q=young males from nigeria&page=1&limit=10
```

This endpoint converts a plain-English query into the same structured filters used by `GET /api/profiles`.

## Natural language parsing approach

The parser is intentionally rule-based. It does not call any AI model or external NLP service.

Parsing flow:

1. Lowercase the query and remove punctuation.
2. Scan for supported gender, age, age-group, and country keywords.
3. Convert matches into structured filters.
4. Merge overlapping age constraints.
5. Reject queries where no supported rule can be mapped.

Supported keyword mapping:

- `male`, `males`, `man`, `men`, `boy`, `boys` -> `gender=male`
- `female`, `females`, `woman`, `women`, `girl`, `girls` -> `gender=female`
- `young` -> `min_age=16`, `max_age=24`
- `child`, `children` -> `age_group=child`
- `teen`, `teens`, `teenager`, `teenagers` -> `age_group=teenager`
- `adult`, `adults` -> `age_group=adult`
- `senior`, `seniors`, `elderly` -> `age_group=senior`
- `above 30`, `over 30`, `older than 30`, `at least 30` -> `min_age=30`
- `below 20`, `under 20`, `younger than 20`, `at most 20` -> `max_age=20`
- `between 18 and 25` -> `min_age=18`, `max_age=25`
- country names such as `nigeria`, `kenya`, `angola` -> mapped to ISO country codes like `NG`, `KE`, `AO`

Examples:

- `young males` -> `gender=male`, `min_age=16`, `max_age=24`
- `females above 30` -> `gender=female`, `min_age=30`
- `people from angola` -> `country_id=AO`
- `adult males from kenya` -> `gender=male`, `age_group=adult`, `country_id=KE`
- `male and female teenagers above 17` -> `age_group=teenager`, `min_age=17`

### Limitations

- The parser only supports the explicit keyword patterns listed above.
- It does not understand misspellings, abbreviations beyond the hardcoded rules, or arbitrary sentence structure.
- It does not resolve contradictory phrases semantically beyond numeric validation.
- It does not support OR logic such as "males from nigeria or kenya".
- It currently ships with an African country name map because the project examples and expected dataset use African ISO codes.
- Queries with no recognized supported keywords return:

```json
{
  "status": "error",
  "message": "Unable to interpret query"
}
```

## Error responses

All errors use this shape:

```json
{
  "status": "error",
  "message": "<error message>"
}
```

Common responses:

- `400` - missing or empty required parameter
- `422` - invalid query parameters or invalid parameter type
- `404` - profile not found
- `500` - internal server error
- `502` - upstream demographic API failure

Invalid list/search query parameters return:

```json
{
  "status": "error",
  "message": "Invalid query parameters"
}
```

## Notes on query performance

- MongoDB indexes are defined for `name`, `gender`, `age_group`, `country_id`, `age`, `gender_probability`, and `created_at`
- Filtered reads use MongoDB query operators with `skip` and `limit`
- The API avoids fetching the full result set before pagination when MongoDB is configured
