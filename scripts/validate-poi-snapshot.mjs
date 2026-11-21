#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkPoiSnapshot, importPoiSnapshot } from "./poi-import-core.mjs";

function arg(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
}
const project = resolve(new URL("..", import.meta.url).pathname);
const path = (name, fallback) => resolve(project, arg(process.argv, name, fallback));
const paths = {
  csv: path("csv", "data/raw/city-of-melbourne-poi-2026-09-14.csv"),
  metadata: path("metadata", "data/raw/city-of-melbourne-poi-metadata-2026-09-14.json"),
  manifest: path("manifest", "data/curation/poi-import-v1.manifest.json"),
  normalized: path("normalized", "data/normalized/poi-import-v1.json"),
  verified: path("verified", "data/verified/poi-import-v1.json"),
  report: path("report", "data/reports/poi-import-v1.json"),
  planner: path("snapshot", "site/data/melbourne-pois-v0.1.json"),
};
try {
  const [csvText, metadata, manifest, normalized, verified, report, planner] = await Promise.all(
    Object.values(paths).map((p, i) =>
      readFile(p, "utf8").then((x) => (i < 3 ? (i === 0 ? x : JSON.parse(x)) : JSON.parse(x))),
    ),
  );
  const expected = importPoiSnapshot({ csvText, metadata, manifest });
  const checks = [
    checkPoiSnapshot({ csvText, metadata, snapshot: planner }),
    ["normalized", normalized, expected.normalized],
    ["verified", verified, expected.verified],
    ["report", report, expected.qualityReport],
    ["planner", planner, expected.plannerSnapshot],
  ].map((item) =>
    Array.isArray(item)
      ? { name: item[0], ok: JSON.stringify(item[1]) === JSON.stringify(item[2]) }
      : { name: "planner", ...item },
  );
  const failures = checks
    .filter((c) => !c.ok)
    .map((c) => `${c.name} does not match regenerated output`);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `POI snapshot valid: ${expected.qualityReport.selectedCount} rows matched raw CSV; version ${expected.dataVersion}`,
    );
} catch (error) {
  console.error(`POI snapshot validation failed: ${error.message}`);
  process.exitCode = 1;
}
