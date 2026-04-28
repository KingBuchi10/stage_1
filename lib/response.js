import { serializeProfile } from "./profile-service.js";

export function buildLegacyListResponse(result, page, limit) {
  return {
    status: "success",
    page,
    limit,
    total: result.total,
    data: result.data.map(serializeProfile),
  };
}

export function buildPaginatedResponse(result, page, limit) {
  const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / limit);

  return {
    status: "success",
    data: result.data.map(serializeProfile),
    pagination: {
      page,
      limit,
      total_items: result.total,
      total_pages: totalPages,
      has_next_page: page < totalPages,
      has_previous_page: page > 1 && totalPages > 0,
    },
  };
}

export function sendError(res, statusCode, message) {
  return res.status(statusCode).json({
    status: "error",
    message,
  });
}

function escapeCsvValue(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, "\"\"")}"`;
}

export function profilesToCsv(profiles) {
  const rows = [
    [
      "id",
      "name",
      "gender",
      "gender_probability",
      "age",
      "age_group",
      "country_id",
      "country_name",
      "country_probability",
      "created_at",
    ],
    ...profiles.map((profile) => {
      const normalized = serializeProfile(profile);
      return [
        normalized.id,
        normalized.name,
        normalized.gender,
        normalized.gender_probability,
        normalized.age,
        normalized.age_group,
        normalized.country_id,
        normalized.country_name,
        normalized.country_probability,
        normalized.created_at,
      ];
    }),
  ];

  return rows.map((row) => row.map((value) => escapeCsvValue(value)).join(",")).join("\n");
}
