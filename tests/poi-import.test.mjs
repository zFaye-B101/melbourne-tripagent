import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  importPoiSnapshot,
  importPoiFiles,
  LEGACY_PIN_IDS,
  parseCsv,
  PoiImportError,
} from "../scripts/poi-import-core.mjs";

const csv = await readFile(
  new URL("../data/raw/city-of-melbourne-poi-2026-09-14.csv", import.meta.url),
  "utf8",
);
const metadata = JSON.parse(
  await readFile(
    new URL("../data/raw/city-of-melbourne-poi-metadata-2026-09-14.json", import.meta.url),
    "utf8",
  ),
);
metadata.dataset_id = "test";
const rows = parseCsv(csv)
  .slice(1)
  .map((v, i) => ({
    theme: v[0],
    sub_theme: v[1],
    feature_name: v[2],
    co_ordinates: v[3],
    sourceRowNumber: i + 2,
  }));
const key = (row) => `${row.feature_name}|${row.co_ordinates.replaceAll(" ", "")}`;
const legacyNames = new Map([
  ["mel-cbd-federation-square", "Federation Square"],
  ["mel-cbd-acmi", "Australian Centre For The Moving Image (ACMI)"],
  ["mel-arts-ngv-international", "NGV International"],
  ["mel-cbd-state-library", "State Library Victoria"],
  ["mel-cbd-qvm", "Queen Victoria Market"],
  ["mel-cbd-immigration-museum", "Immigration Museum"],
  ["mel-carlton-melbourne-museum", "Melbourne Museum"],
  ["mel-carlton-royal-exhibition", "Royal Exhibition Building"],
  ["mel-east-fitzroy-gardens", "Fitzroy Gardens"],
  ["mel-south-royal-botanic-gardens", "Royal Botanic Gardens"],
  ["mel-south-shrine", "Shrine of Remembrance"],
  ["mel-cbd-old-melbourne-gaol", "Old Melbourne Gaol Crime & Justice Experience"],
]);
const manifest = {
  manifestVersion: "poi-import-v1",
  dataVersion: "test-v1",
  generatedAt: "2026-09-14",
  source: {
    datasetId: "test",
    datasetUrl: "https://example.test/dataset",
    license: "CC BY 4.0",
    attribution: "Test source",
    retrievedAt: "2026-09-14T00:00:00.000Z",
  },
  pins: [],
};
for (const id of LEGACY_PIN_IDS) {
  const row = rows.find((r) => r.feature_name === legacyNames.get(id));
  manifest.pins.push({ id, sourceRowKey: key(row) });
}
for (const row of rows)
  if (manifest.pins.length < 40 && !manifest.pins.some((p) => p.sourceRowKey === key(row)))
    manifest.pins.push({ id: `mel-test-${manifest.pins.length + 1}`, sourceRowKey: key(row) });
for (const [i, pin] of manifest.pins.entries()) {
  pin.category = ["art_culture", "history", "nature", "city_landmark", "market_food", "family"][
    i % 6
  ];
  pin.cluster = `cluster-${Math.floor(i / 5) + 1}`;
  pin.referenceUrl = `https://example.test/poi/${i}`;
  pin.referenceKind = "dataset";
  pin.referenceStatus = i < 12 ? "verified" : "unverified";
  pin.referenceVerifiedAt = i < 12 ? "2026-09-14T00:00:00.000Z" : null;
}

test("imports deterministic normalized and verified outputs", () => {
  const a = importPoiSnapshot({ csvText: csv, metadata, manifest });
  const b = importPoiSnapshot({ csvText: csv, metadata, manifest });
  assert.deepEqual(a, b);
  assert.equal(a.normalized.pois.length, 40);
  assert.equal(a.verified.pois.length, 40);
  assert.deepEqual(Object.keys(a.normalized.pois[0]).sort(), [
    "category",
    "fact_assertions",
    "facts",
    "inferences",
    "location",
    "media",
    "name",
    "poi_id",
    "provenance",
    "verification",
  ]);
  assert.equal(a.normalized.pois[0].provenance[0].payload_hash.length, 64);
  assert.equal(
    a.plannerSnapshot.pois.every((p) =>
      ["art_culture", "history", "nature", "city_landmark", "market_food", "family"].includes(
        p.category,
      ),
    ),
    true,
  );
  assert.equal(
    a.plannerSnapshot.pois.every((p) => p.priceStatus === "not_verified"),
    true,
  );
  assert.equal(a.qualityReport.dynamicFacts, "unknown");
  assert.equal(a.plannerSnapshot.pois.filter((p) => p.referenceStatus === "verified").length, 12);
  assert.equal(a.plannerSnapshot.pois.filter((p) => p.referenceStatus === "unverified").length, 28);
  assert.deepEqual(
    LEGACY_PIN_IDS,
    LEGACY_PIN_IDS.filter((id) => a.plannerSnapshot.pois.some((p) => p.id === id)),
  );
});

test("rejects missing header, missing selection, duplicate id/row key, and count boundaries", () => {
  assert.throws(
    () =>
      importPoiSnapshot({
        csvText: csv.replace("theme,sub_theme,feature_name,co_ordinates", "theme,feature_name"),
        metadata,
        manifest,
      }),
    /header/,
  );
  assert.throws(
    () =>
      importPoiSnapshot({
        csvText: csv,
        metadata,
        manifest: {
          ...manifest,
          pins: manifest.pins.map((p, i) => (i === 0 ? { ...p, sourceRowKey: "missing|-1,1" } : p)),
        },
      }),
    /not found/,
  );
  assert.throws(
    () =>
      importPoiSnapshot({
        csvText: csv,
        metadata,
        manifest: {
          ...manifest,
          pins: manifest.pins.map((p, i) => (i === 1 ? { ...p, id: manifest.pins[0].id } : p)),
        },
      }),
    /duplicate manifest id/,
  );
  assert.throws(
    () =>
      importPoiSnapshot({
        csvText: csv,
        metadata,
        manifest: {
          ...manifest,
          pins: manifest.pins.map((p, i) =>
            i === 1 ? { ...p, sourceRowKey: manifest.pins[0].sourceRowKey } : p,
          ),
        },
      }),
    /duplicate manifest sourceRowKey/,
  );
  assert.throws(
    () =>
      importPoiSnapshot({
        csvText: csv,
        metadata,
        manifest: { ...manifest, pins: manifest.pins.slice(0, 39) },
      }),
    /exactly 40/,
  );
  assert.throws(
    () =>
      importPoiSnapshot({
        csvText: csv,
        metadata,
        manifest: {
          ...manifest,
          pins: [...manifest.pins, { id: "extra", sourceRowKey: key(rows[41]) }],
        },
      }),
    /exactly 40/,
  );
});

test("failed import leaves target bytes unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poi-import-test-"));
  const target = join(dir, "snapshot.json");
  await writeFile(target, "sentinel\n");
  const manifestPath = join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ ...manifest, pins: manifest.pins.slice(0, 39) }));
  await assert.rejects(
    importPoiFiles({
      csvPath: new URL("../data/raw/city-of-melbourne-poi-2026-09-14.csv", import.meta.url),
      metadataPath: new URL(
        "../data/raw/city-of-melbourne-poi-metadata-2026-09-14.json",
        import.meta.url,
      ),
      manifestPath,
      outputPath: target,
    }),
    PoiImportError,
  );
  assert.equal(await readFile(target, "utf8"), "sentinel\n");
});

test("writes four deterministic artifacts with active planner last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poi-import-artifacts-"));
  const outputPath = join(dir, "site/data/planner.json");
  const metadataPath = join(dir, "metadata.json");
  await writeFile(metadataPath, JSON.stringify(metadata));
  const snapshot = await importPoiFiles({
    csvPath: new URL("../data/raw/city-of-melbourne-poi-2026-09-14.csv", import.meta.url),
    metadataPath,
    manifestPath: await (async () => {
      const p = join(dir, "manifest.json");
      await writeFile(p, JSON.stringify(manifest));
      return p;
    })(),
    normalizedPath: join(dir, "data/normalized.json"),
    verifiedPath: join(dir, "data/verified.json"),
    reportPath: join(dir, "data/report.json"),
    outputPath,
  });
  assert.equal(JSON.parse(await readFile(outputPath, "utf8")).pois.length, 40);
  assert.deepEqual(
    JSON.parse(await readFile(join(dir, "data/normalized.json"), "utf8")),
    snapshot.normalized,
  );
});

test("imports the checked-in real manifest with canonical and planner contract", async () => {
  const realCsv = await readFile(
    new URL("../data/raw/city-of-melbourne-poi-2026-09-14.csv", import.meta.url),
    "utf8",
  );
  const realMetadata = JSON.parse(
    await readFile(
      new URL("../data/raw/city-of-melbourne-poi-metadata-2026-09-14.json", import.meta.url),
      "utf8",
    ),
  );
  const realManifest = JSON.parse(
    await readFile(
      new URL("../data/curation/poi-import-v1.manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const snapshot = importPoiSnapshot({
    csvText: realCsv,
    metadata: realMetadata,
    manifest: realManifest,
  });
  assert.equal(snapshot.plannerSnapshot.pois.length, 40);
  assert.deepEqual(snapshot.qualityReport.referenceCounts, { verified: 28, unverified: 12 });
  for (const name of [
    "St Paul’s Cathedral Melbourne",
    "Forum Melbourne",
    "Museum of Chinese Australian History",
    "Melbourne Skydeck",
    "SEA LIFE Melbourne Aquarium",
  ])
    assert.ok(snapshot.plannerSnapshot.pois.some((poi) => poi.nameEn === name));
  assert.equal(
    LEGACY_PIN_IDS.every((id) => snapshot.plannerSnapshot.pois.some((poi) => poi.id === id)),
    true,
  );
  assert.equal(new Set(snapshot.plannerSnapshot.pois.map((poi) => poi.category)).size, 6);
  assert.equal(
    Object.values(snapshot.qualityReport.clusterCounts).filter((count) => count >= 5).length >= 4,
    true,
  );
  for (const poi of snapshot.normalized.pois)
    for (const field of [
      "poi_id",
      "name",
      "category",
      "location",
      "facts",
      "fact_assertions",
      "inferences",
      "media",
      "provenance",
      "verification",
    ])
      assert.ok(field in poi);
  assert.equal(snapshot.normalized.pois[0].provenance[0].payload_hash.length, 64);
});
