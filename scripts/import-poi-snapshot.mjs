#!/usr/bin/env node
import { resolve } from "node:path";
import { importPoiFiles } from "./poi-import-core.mjs";

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--") || !argv[i + 1]) throw new Error(`expected ${key} value`);
    out[key.slice(2)] = argv[++i];
  }
  return out;
}

const project = resolve(new URL("..", import.meta.url).pathname);
try {
  const options = args(process.argv);
  const required = {
    csv: "data/raw/city-of-melbourne-poi-2026-09-14.csv",
    metadata: "data/raw/city-of-melbourne-poi-metadata-2026-09-14.json",
    manifest: "data/curation/poi-import-v1.manifest.json",
    out: "site/data/melbourne-pois-v0.1.json",
    normalized: "data/normalized/poi-import-v1.json",
    verified: "data/verified/poi-import-v1.json",
    report: "data/reports/poi-import-v1.json",
  };
  for (const key of Object.keys(required)) options[key] ??= required[key];
  const snapshot = await importPoiFiles({
    csvPath: resolve(project, options.csv),
    metadataPath: resolve(project, options.metadata),
    manifestPath: resolve(project, options.manifest),
    outputPath: resolve(project, options.out),
    normalizedPath: resolve(project, options.normalized),
    verifiedPath: resolve(project, options.verified),
    reportPath: resolve(project, options.report),
  });
  console.log(`Imported ${snapshot.qualityReport.selectedCount} POIs (${snapshot.dataVersion})`);
} catch (error) {
  console.error(`POI import failed: ${error.message}`);
  process.exitCode = 1;
}
