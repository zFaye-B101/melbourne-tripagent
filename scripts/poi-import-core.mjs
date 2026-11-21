import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

export const IMPORT_VERSION = "poi-import-v1";
export const REQUIRED_PIN_COUNT = 40;
export const LEGACY_PIN_IDS = Object.freeze([
  "mel-cbd-federation-square",
  "mel-cbd-acmi",
  "mel-arts-ngv-international",
  "mel-cbd-state-library",
  "mel-cbd-qvm",
  "mel-cbd-immigration-museum",
  "mel-carlton-melbourne-museum",
  "mel-carlton-royal-exhibition",
  "mel-east-fitzroy-gardens",
  "mel-south-royal-botanic-gardens",
  "mel-south-shrine",
  "mel-cbd-old-melbourne-gaol",
]);

export class PoiImportError extends Error {
  constructor(message, code = "INVALID_INPUT") {
    super(message);
    this.name = "PoiImportError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new PoiImportError(message, code);
}

// Deliberately small RFC-4180 parser: it preserves source cell text and handles escaped quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) fail("CSV contains an unterminated quoted cell", "CSV_PARSE");
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

function sourceRowKey(row) {
  return `${row.feature_name}|${row.co_ordinates.replaceAll(" ", "")}`;
}

function csvRows(text) {
  const rows = parseCsv(text);
  if (!rows.length) fail("CSV is empty", "CSV_HEADER");
  const expected = ["theme", "sub_theme", "feature_name", "co_ordinates"];
  if (rows[0].length !== expected.length || expected.some((h, i) => rows[0][i] !== h)) {
    fail(`CSV header must be exactly ${expected.join(",")}`, "CSV_HEADER");
  }
  return rows.slice(1).map((values, index) => {
    if (values.length !== expected.length)
      fail(`CSV row ${index + 2} has ${values.length} columns`, "CSV_ROW");
    return {
      theme: values[0],
      sub_theme: values[1],
      feature_name: values[2],
      co_ordinates: values[3],
      sourceRowNumber: index + 2,
    };
  });
}

function coordinates(text, key) {
  const parts = text.split(",").map((v) => Number(v.trim()));
  if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v)))
    fail(`${key}: invalid coordinates`, "COORDINATES");
  const [latitude, longitude] = parts;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    fail(`${key}: coordinates out of range`, "COORDINATES");
  return { latitude, longitude };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object")
    fail("manifest must be an object", "MANIFEST_SHAPE");
  if (manifest.manifestVersion !== IMPORT_VERSION)
    fail(`manifestVersion must be ${IMPORT_VERSION}`, "MANIFEST_VERSION");
  if (typeof manifest.dataVersion !== "string" || !manifest.dataVersion)
    fail("manifest.dataVersion is required", "MANIFEST_SHAPE");
  if (typeof manifest.generatedAt !== "string" || !manifest.generatedAt)
    fail("manifest.generatedAt is required", "MANIFEST_SHAPE");
  if (!manifest.source || typeof manifest.source !== "object")
    fail("manifest.source is required", "MANIFEST_SHAPE");
  for (const key of ["datasetId", "datasetUrl", "license", "attribution", "retrievedAt"]) {
    if (typeof manifest.source[key] !== "string" || !manifest.source[key])
      fail(`manifest.source.${key} is required`, "MANIFEST_SHAPE");
  }
  if (manifest.source.license !== "CC BY 4.0")
    fail("manifest source license must be CC BY 4.0", "MANIFEST_LICENSE");
  if (!Array.isArray(manifest.pins) || manifest.pins.length !== REQUIRED_PIN_COUNT)
    fail(`manifest.pins must contain exactly ${REQUIRED_PIN_COUNT} entries`, "MANIFEST_COUNT");
  const ids = new Set(),
    keys = new Set(),
    clusters = new Map(),
    categories = new Set(),
    displayNames = new Map();
  for (const [index, pin] of manifest.pins.entries()) {
    if (
      !pin ||
      typeof pin !== "object" ||
      typeof pin.id !== "string" ||
      !pin.id ||
      typeof pin.sourceRowKey !== "string" ||
      !pin.sourceRowKey
    )
      fail(`manifest.pins[${index}] requires id and sourceRowKey`, "MANIFEST_SHAPE");
    if (!/^mel-[a-z0-9-]+$/.test(pin.id)) fail(`invalid manifest id: ${pin.id}`, "ID");
    if (ids.has(pin.id)) fail(`duplicate manifest id: ${pin.id}`, "DUPLICATE_ID");
    if (keys.has(pin.sourceRowKey))
      fail(`duplicate manifest sourceRowKey: ${pin.sourceRowKey}`, "DUPLICATE_ROW_KEY");
    if (
      pin.aliases !== undefined &&
      (!Array.isArray(pin.aliases) || pin.aliases.some((a) => typeof a !== "string"))
    )
      fail(`manifest.pins[${index}].aliases must be strings`, "MANIFEST_SHAPE");
    for (const value of [pin.nameZh, pin.nameEn, ...(pin.aliases ?? [])].filter(Boolean)) {
      const normalized = String(value).trim().toLocaleLowerCase();
      const owner = displayNames.get(normalized);
      if (owner && owner !== pin.id)
        fail(`duplicate display name or alias: ${value}`, "DUPLICATE_ALIAS");
      displayNames.set(normalized, pin.id);
    }
    if (pin.category !== undefined && !PLANNER_CATEGORIES.includes(pin.category))
      fail(`invalid category: ${pin.category}`, "CATEGORY");
    if (pin.category) categories.add(pin.category);
    if (pin.cluster !== undefined) clusters.set(pin.cluster, (clusters.get(pin.cluster) ?? 0) + 1);
    if (!REFERENCE_KINDS.has(pin.referenceKind))
      fail(`invalid referenceKind: ${pin.referenceKind}`, "REFERENCE");
    if (!REFERENCE_STATUSES.has(pin.referenceStatus))
      fail(`invalid referenceStatus: ${pin.referenceStatus}`, "REFERENCE");
    if (typeof pin.referenceUrl !== "string" || !/^https:\/\//.test(pin.referenceUrl))
      fail(`invalid referenceUrl: ${pin.referenceUrl}`, "REFERENCE");
    if (pin.referenceStatus === "verified" && typeof pin.referenceVerifiedAt !== "string")
      fail(`verified reference requires referenceVerifiedAt: ${pin.id}`, "REFERENCE");
    if (pin.referenceStatus === "unverified" && pin.referenceVerifiedAt !== null)
      fail(`unverified referenceVerifiedAt must be null: ${pin.id}`, "REFERENCE");
    ids.add(pin.id);
    keys.add(pin.sourceRowKey);
  }
  for (const id of LEGACY_PIN_IDS)
    if (!ids.has(id)) fail(`manifest is missing legacy pin: ${id}`, "LEGACY_MISSING");
  if (categories.size !== PLANNER_CATEGORIES.length)
    fail("manifest must cover all six planner categories", "CATEGORY_COVERAGE");
  for (const [cluster, count] of clusters)
    if (count < 5) fail(`cluster ${cluster} must contain at least five pins`, "CLUSTER_COVERAGE");
  if (clusters.size < 4) fail("manifest must contain at least four clusters", "CLUSTER_COVERAGE");
  return manifest;
}

function textOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

const PLANNER_CATEGORIES = Object.freeze([
  "art_culture",
  "history",
  "nature",
  "city_landmark",
  "market_food",
  "family",
]);
const REFERENCE_KINDS = new Set(["venue_official", "government", "transport_official", "dataset"]);
const REFERENCE_STATUSES = new Set(["verified", "unverified"]);

function normalizedPin(pin, row, source, payloadHash, retrievedAt) {
  const { latitude, longitude } = coordinates(row.co_ordinates, pin.sourceRowKey);
  const tags = Array.isArray(pin.tags) ? [...new Set(pin.tags.map(String))].sort() : [];
  const nameEn = typeof pin.nameEn === "string" ? pin.nameEn : row.feature_name;
  const officialName = row.feature_name;
  const id = pin.id;
  const category = textOr(pin.category, "city_landmark");
  const canonicalCategory = category;
  const referenceUrl = typeof pin.referenceUrl === "string" ? pin.referenceUrl : null;
  const referenceKind = pin.referenceKind;
  const referenceStatus = pin.referenceStatus;
  const aliases = Array.isArray(pin.aliases) ? [...new Set(pin.aliases.map(String))].sort() : [];
  const canonical = {
    poi_id: id,
    name: { official: officialName, zh: pin.nameZh ?? null, aliases },
    category: { primary: canonicalCategory, secondary: [...new Set([row.theme, row.sub_theme])] },
    location: {
      address: null,
      suburb: null,
      city: "Melbourne",
      state: "VIC",
      country: "AU",
      area: textOr(pin.area, "unknown"),
      latitude,
      longitude,
    },
    facts: {
      official_url:
        referenceKind === "venue_official" && referenceStatus === "verified" ? referenceUrl : null,
      opening_hours_text: null,
      admission: {
        price_type: "unknown",
        currency: null,
        adult: null,
        child: null,
        concession: null,
        text: null,
      },
      booking_required: null,
      accessibility_features: [],
      temporary_closure: null,
    },
    fact_assertions: [],
    inferences: {
      recommended_visit_minutes: Number.isInteger(pin.suggestedMinutes)
        ? pin.suggestedMinutes
        : null,
      indoor_outdoor: ["indoor", "outdoor", "mixed", "conditional"].includes(pin.indoorOutdoor)
        ? pin.indoorOutdoor
        : "unknown",
      tags,
      rainy_day_suitability: "unknown",
      generation: {
        model: null,
        prompt_version: null,
        generated_at: null,
        evidence_fields: [],
        confidence: "not_generated",
        review_status: "not_generated",
      },
    },
    media: [],
    provenance: [
      {
        source_name: source.attribution,
        source_record_id: sourceRowKey(row),
        source_url: source.datasetUrl,
        license: source.license,
        retrieved_at: retrievedAt,
        payload_hash: payloadHash,
      },
    ],
    verification: {
      status: "verified_core",
      verified_at: null,
      verified_by: "poi-import-v1",
      valid_until: null,
      notes: "Name and coordinates matched the selected raw CSV row; dynamic facts remain unknown.",
    },
  };
  const planner = {
    id,
    nameZh: pin.nameZh ?? "",
    nameEn,
    category,
    tags,
    latitude,
    longitude,
    cluster: pin.cluster ?? "unknown",
    area: textOr(pin.area, "unknown"),
    suggestedMinutes: canonical.inferences.recommended_visit_minutes ?? 60,
    indoorOutdoor: canonical.inferences.indoor_outdoor,
    familyFriendly: typeof pin.familyFriendly === "boolean" ? pin.familyFriendly : null,
    lowWalkingFriendly: typeof pin.lowWalkingFriendly === "boolean" ? pin.lowWalkingFriendly : null,
    priceStatus: "not_verified",
    summary: pin.summary ?? "",
    sourceTheme: row.theme,
    sourceSubTheme: row.sub_theme,
    sourceRowKey: sourceRowKey(row),
    aliases,
    referenceUrl,
    referenceKind,
    referenceStatus,
    referenceVerifiedAt: pin.referenceVerifiedAt ?? null,
  };
  return { canonical, planner };
}

export function importPoiSnapshot({ csvText, metadata = {}, manifest }) {
  const validManifest = validateManifest(manifest);
  const metadataLicense = metadata?.metas?.default?.license;
  if (metadataLicense && metadataLicense !== "CC BY")
    fail("metadata license is not CC BY", "METADATA_LICENSE");
  const metadataLicenseUrl = metadata?.metas?.default?.license_url;
  if (metadataLicenseUrl && !metadataLicenseUrl.includes("creativecommons.org/licenses/by/4.0"))
    fail("metadata license URL is not CC BY 4.0", "METADATA_LICENSE");
  if (metadata?.dataset_id && validManifest.source.datasetId !== metadata.dataset_id)
    fail("manifest source datasetId does not match metadata", "METADATA_DATASET");
  const rows = csvRows(csvText);
  const byKey = new Map();
  for (const row of rows) {
    const key = sourceRowKey(row);
    if (byKey.has(key)) fail(`duplicate CSV sourceRowKey: ${key}`, "DUPLICATE_ROW_KEY");
    byKey.set(key, row);
  }
  const payloadHash = createHash("sha256").update(csvText, "utf8").digest("hex");
  const retrievedAt = validManifest.source.retrievedAt;
  if (typeof retrievedAt !== "string" || !retrievedAt)
    fail("manifest.source.retrievedAt is required", "MANIFEST_SHAPE");
  const selected = validManifest.pins.map((pin) => {
    const row = byKey.get(pin.sourceRowKey);
    if (!row)
      fail(`selected sourceRowKey not found in CSV: ${pin.sourceRowKey}`, "MISSING_SELECTED_ROW");
    return normalizedPin(pin, row, validManifest.source, payloadHash, retrievedAt);
  });
  const canonicalPois = selected.map((p) => p.canonical);
  const plannerPois = selected.map((p) => p.planner);
  const categoryCounts = Object.fromEntries(
    PLANNER_CATEGORIES.map((category) => [
      category,
      plannerPois.filter((p) => p.category === category).length,
    ]),
  );
  const clusterCounts = Object.fromEntries(
    [...new Set(plannerPois.map((p) => p.cluster))]
      .sort()
      .map((cluster) => [cluster, plannerPois.filter((p) => p.cluster === cluster).length]),
  );
  const qualityReport = {
    importVersion: IMPORT_VERSION,
    selectedCount: selected.length,
    rawRowCount: rows.length,
    dynamicFacts: "unknown",
    sourcePayloadHash: payloadHash,
    categoryCounts,
    clusterCounts,
    referenceCounts: {
      verified: plannerPois.filter((p) => p.referenceStatus === "verified").length,
      unverified: plannerPois.filter((p) => p.referenceStatus === "unverified").length,
    },
    missingReferenceCount: 0,
    duplicateIds: [],
    duplicateSourceRowKeys: [],
    legacyIdsRetained: LEGACY_PIN_IDS.every((id) => selected.some((p) => p.planner.id === id)),
    failures: [],
  };
  const normalized = {
    schemaVersion: IMPORT_VERSION,
    dataVersion: validManifest.dataVersion,
    source: validManifest.source,
    pois: canonicalPois,
  };
  const verified = {
    schemaVersion: IMPORT_VERSION,
    dataVersion: validManifest.dataVersion,
    pois: canonicalPois,
  };
  const plannerSnapshot = {
    sourceDatasetId: validManifest.source.datasetId,
    sourceDatasetUrl: validManifest.source.datasetUrl,
    license: validManifest.source.license,
    attribution: validManifest.source.attribution,
    generatedAt: validManifest.generatedAt,
    dataVersion: validManifest.dataVersion,
    pois: plannerPois,
  };
  return {
    schemaVersion: IMPORT_VERSION,
    dataVersion: validManifest.dataVersion,
    generatedAt: validManifest.generatedAt ?? null,
    source: validManifest.source,
    normalized,
    verified,
    plannerSnapshot,
    pois: plannerPois,
    qualityReport,
    quality: qualityReport,
  };
}

export function checkPoiSnapshot({ csvText, metadata = {}, snapshot }) {
  const failures = [];
  if (!snapshot || (snapshot.schemaVersion !== IMPORT_VERSION && !snapshot.sourceDatasetId))
    failures.push("snapshot schemaVersion is invalid");
  const pois = snapshot?.verified?.pois ?? snapshot?.plannerSnapshot?.pois ?? snapshot?.pois;
  if (!Array.isArray(pois)) failures.push("snapshot verified.pois is missing");
  if (pois && pois.length !== REQUIRED_PIN_COUNT)
    failures.push(`expected ${REQUIRED_PIN_COUNT} POIs, got ${pois.length}`);
  const ids = new Set(),
    keys = new Set();
  for (const poi of pois ?? []) {
    if (ids.has(poi.id)) failures.push(`duplicate POI id: ${poi.id}`);
    ids.add(poi.id);
    if (poi.id && !/^mel-[a-z0-9-]+$/.test(poi.id)) failures.push(`invalid POI id: ${poi.id}`);
    if (keys.has(poi.sourceRowKey)) failures.push(`duplicate sourceRowKey: ${poi.sourceRowKey}`);
    keys.add(poi.sourceRowKey);
    if (!Number.isFinite(poi.latitude) || !Number.isFinite(poi.longitude))
      failures.push(`${poi.id}: invalid coordinates`);
    if (
      snapshot?.sourceDatasetId &&
      (!PLANNER_CATEGORIES.includes(poi.category) ||
        !REFERENCE_KINDS.has(poi.referenceKind) ||
        !REFERENCE_STATUSES.has(poi.referenceStatus))
    )
      failures.push(`${poi.id}: invalid planner category or reference fields`);
    if (
      snapshot?.sourceDatasetId &&
      poi.referenceStatus === "verified" &&
      typeof poi.referenceVerifiedAt !== "string"
    )
      failures.push(`${poi.id}: verified reference missing date`);
    if (
      snapshot?.sourceDatasetId &&
      poi.referenceStatus === "unverified" &&
      poi.referenceVerifiedAt !== null
    )
      failures.push(`${poi.id}: unverified reference date must be null`);
  }
  if (pois && snapshot?.sourceDatasetId)
    for (const id of LEGACY_PIN_IDS)
      if (!ids.has(id)) failures.push(`missing legacy POI id: ${id}`);
  if (metadata?.metas?.default?.license && metadata.metas.default.license !== "CC BY")
    failures.push("metadata license is not CC BY");
  if (
    metadata?.metas?.default?.license_url &&
    !metadata.metas.default.license_url.includes("creativecommons.org/licenses/by/4.0")
  )
    failures.push("metadata license URL is not CC BY 4.0");
  if (csvText) {
    try {
      const byKey = new Map(csvRows(csvText).map((r) => [sourceRowKey(r), r]));
      for (const poi of pois ?? [])
        if (!byKey.has(poi.sourceRowKey)) failures.push(`${poi.id}: source row not found`);
    } catch (error) {
      failures.push(error.message);
    }
  }
  return { ok: failures.length === 0, failures, count: pois?.length ?? 0 };
}

export async function importPoiFiles({
  csvPath,
  metadataPath,
  manifestPath,
  outputPath,
  normalizedPath,
  verifiedPath,
  reportPath,
}) {
  const [csvText, metadataText, manifestText] = await Promise.all([
    readFile(csvPath, "utf8"),
    readFile(metadataPath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  const snapshot = importPoiSnapshot({
    csvText,
    metadata: JSON.parse(metadataText),
    manifest: JSON.parse(manifestText),
  });
  const targets = [
    [normalizedPath, snapshot.normalized],
    [verifiedPath, snapshot.verified],
    [reportPath, snapshot.qualityReport],
    [outputPath, snapshot.plannerSnapshot],
  ].filter(([path]) => path);
  const staged = [];
  try {
    for (const [target, value] of targets) {
      await mkdir(dirname(target), { recursive: true });
      const staging = join(dirname(target), `.poi-snapshot-${randomUUID()}.tmp`);
      await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      staged.push([staging, target]);
    }
    for (const [staging, target] of staged.slice(0, -1)) await rename(staging, target);
    if (staged.length) await rename(staged[staged.length - 1][0], staged[staged.length - 1][1]);
  } finally {
    for (const [staging] of staged) await rm(staging, { force: true });
  }
  return snapshot;
}
