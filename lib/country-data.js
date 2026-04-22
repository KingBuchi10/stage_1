const AFRICAN_COUNTRIES = [
  ["DZ", "Algeria", ["algeria"]],
  ["AO", "Angola", ["angola"]],
  ["BJ", "Benin", ["benin"]],
  ["BW", "Botswana", ["botswana"]],
  ["BF", "Burkina Faso", ["burkina faso"]],
  ["BI", "Burundi", ["burundi"]],
  ["CM", "Cameroon", ["cameroon"]],
  ["CV", "Cape Verde", ["cape verde", "cabo verde"]],
  ["CF", "Central African Republic", ["central african republic"]],
  ["TD", "Chad", ["chad"]],
  ["KM", "Comoros", ["comoros"]],
  ["CG", "Congo", ["congo", "republic of the congo", "congo brazzaville"]],
  [
    "CD",
    "Democratic Republic of the Congo",
    ["democratic republic of the congo", "dr congo", "drc", "congo kinshasa"],
  ],
  ["DJ", "Djibouti", ["djibouti"]],
  ["EG", "Egypt", ["egypt"]],
  ["GQ", "Equatorial Guinea", ["equatorial guinea"]],
  ["ER", "Eritrea", ["eritrea"]],
  ["SZ", "Eswatini", ["eswatini", "swaziland"]],
  ["ET", "Ethiopia", ["ethiopia"]],
  ["GA", "Gabon", ["gabon"]],
  ["GM", "Gambia", ["gambia", "the gambia"]],
  ["GH", "Ghana", ["ghana"]],
  ["GN", "Guinea", ["guinea"]],
  ["GW", "Guinea-Bissau", ["guinea bissau", "guinea-bissau"]],
  ["CI", "Cote d'Ivoire", ["cote d'ivoire", "ivory coast"]],
  ["KE", "Kenya", ["kenya"]],
  ["LS", "Lesotho", ["lesotho"]],
  ["LR", "Liberia", ["liberia"]],
  ["LY", "Libya", ["libya"]],
  ["MG", "Madagascar", ["madagascar"]],
  ["MW", "Malawi", ["malawi"]],
  ["ML", "Mali", ["mali"]],
  ["MR", "Mauritania", ["mauritania"]],
  ["MU", "Mauritius", ["mauritius"]],
  ["MA", "Morocco", ["morocco"]],
  ["MZ", "Mozambique", ["mozambique"]],
  ["NA", "Namibia", ["namibia"]],
  ["NE", "Niger", ["niger"]],
  ["NG", "Nigeria", ["nigeria"]],
  ["RW", "Rwanda", ["rwanda"]],
  ["ST", "Sao Tome and Principe", ["sao tome and principe"]],
  ["SN", "Senegal", ["senegal"]],
  ["SC", "Seychelles", ["seychelles"]],
  ["SL", "Sierra Leone", ["sierra leone"]],
  ["SO", "Somalia", ["somalia"]],
  ["ZA", "South Africa", ["south africa"]],
  ["SS", "South Sudan", ["south sudan"]],
  ["SD", "Sudan", ["sudan"]],
  ["TZ", "Tanzania", ["tanzania"]],
  ["TG", "Togo", ["togo"]],
  ["TN", "Tunisia", ["tunisia"]],
  ["UG", "Uganda", ["uganda"]],
  ["ZM", "Zambia", ["zambia"]],
  ["ZW", "Zimbabwe", ["zimbabwe"]],
];

function normalizeCountryText(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const countryAliasToCode = new Map();
const countryCodeToName = new Map();

for (const [code, name, aliases] of AFRICAN_COUNTRIES) {
  countryCodeToName.set(code, name);

  for (const alias of [name, ...aliases]) {
    countryAliasToCode.set(normalizeCountryText(alias), code);
  }
}

const countryMatchers = Array.from(countryAliasToCode.entries())
  .sort((left, right) => right[0].length - left[0].length)
  .map(([alias, code]) => ({
    alias,
    code,
  }));

export function countryNameFromId(countryId) {
  if (typeof countryId !== "string" || countryId.trim() === "") {
    return "Unknown";
  }

  const normalizedCode = countryId.trim().toUpperCase();
  return countryCodeToName.get(normalizedCode) ?? normalizedCode;
}

export function resolveCountryCode(text) {
  const normalized = normalizeCountryText(text);

  if (!normalized) {
    return null;
  }

  for (const matcher of countryMatchers) {
    const pattern = new RegExp(`(^|\\s)${matcher.alias.replace(/\s+/g, "\\s+")}($|\\s)`, "i");

    if (pattern.test(normalized)) {
      return matcher.code;
    }
  }

  return null;
}
