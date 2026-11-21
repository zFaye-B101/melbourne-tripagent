import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://commons.wikimedia.org/w/api.php";
const VERIFIED_AT = "2026-09-15";
const PUBLIC_DOMAIN_URL = "https://creativecommons.org/publicdomain/mark/1.0/";
const ROOT = path.resolve(import.meta.dirname, "..");
const CURATION_PATH = path.join(ROOT, "data/curation/poi-media-v0.4.4.json");
const FEATURED_PATH = path.join(ROOT, "site/data/featured-pois-v0.4.json");
const OUTPUT_PATH = path.join(ROOT, "site/data/poi-media-v0.4.4.json");
const RAW_MEDIA_DIR = path.join(ROOT, "data/raw/media/poi");
const PUBLIC_MEDIA_DIR = path.join(ROOT, "site/public/poi");

if (process.argv.includes("--mark-reviewed")) {
  const current = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  const reviewed = {
    ...current,
    visualReview: {
      status: "passed",
      reviewedAt: VERIFIED_AT,
      method: "4 × 10 contact sheet using centered 4:3 thumbnails",
      notes:
        "All 40 thumbnails show the intended Melbourne venue, landmark, park feature, or venue interior; no same-name city mismatch found.",
    },
    items: current.items.map((item) => ({
      ...item,
      licenseUrl: item.licenseUrl.replace(
        /^http:\/\/creativecommons\.org\//,
        "https://creativecommons.org/",
      ),
      visualReviewStatus: "passed_contact_sheet_review",
    })),
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(reviewed, null, 2)}\n`);
  process.stdout.write(`Marked ${reviewed.items.length} images as visually reviewed.\n`);
  process.exit(0);
}

function textFromHtml(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title) {
  return title.replaceAll("_", " ").normalize("NFC").toLocaleLowerCase();
}

function withoutTracking(url) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("utm_")) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function isAllowedLicense(license) {
  return (
    license === "CC0 1.0" ||
    license.toLocaleLowerCase() === "public domain" ||
    /^CC BY(?:-SA)? (?:2\.0|2\.5|2\.5 AU|3\.0|4\.0)$/.test(license)
  );
}

async function fetchWithRetry(url, init = {}) {
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": "MelbourneTripAgentMediaSync/0.4.4",
        ...init.headers,
      },
    });
    if (response.status !== 429 && response.status < 500) return response;
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  return response;
}

async function writeAtomic(targetPath, bytes) {
  const temporaryPath = `${targetPath}.v0.4.4-download`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, targetPath);
}

const curation = JSON.parse(await readFile(CURATION_PATH, "utf8"));
const featured = JSON.parse(await readFile(FEATURED_PATH, "utf8"));
const curatedIds = curation.items.map((item) => item.poiId);
if (curatedIds.length !== 30 || new Set(curatedIds).size !== 30) {
  throw new Error("POI media curation must contain exactly 30 unique POI IDs.");
}
const replacements = curation.replacements ?? [];
const replacementIds = new Set(replacements.map((item) => item.poiId));
if (
  replacements.length !== replacementIds.size ||
  replacements.some(
    (item) => !featured.items.some((featuredItem) => featuredItem.poiId === item.poiId),
  )
) {
  throw new Error("Every replacement must target one unique featured POI.");
}
const mediaToSync = [...curation.items, ...replacements];

const query = new URLSearchParams({
  action: "query",
  format: "json",
  formatversion: "2",
  redirects: "1",
  titles: mediaToSync.map((item) => item.commonsTitle).join("|"),
  prop: "imageinfo",
  iiprop: "url|mime|size|sha1|extmetadata",
  iiurlwidth: "1280",
  iiextmetadatafilter:
    "LicenseShortName|LicenseUrl|Artist|ImageDescription|Credit|UsageTerms|DateTimeOriginal|Categories",
  origin: "*",
});
const metadataResponse = await fetchWithRetry(`${API_URL}?${query}`);
if (!metadataResponse.ok) {
  throw new Error(`Wikimedia metadata request failed: ${metadataResponse.status}`);
}
const metadata = await metadataResponse.json();
const metadataByTitle = new Map(
  (metadata.query?.pages ?? []).map((page) => [normalizeTitle(page.title), page]),
);

await mkdir(RAW_MEDIA_DIR, { recursive: true });
await mkdir(PUBLIC_MEDIA_DIR, { recursive: true });

const imported = [];
const replacementById = new Map();
for (const [index, curated] of mediaToSync.entries()) {
  const page = metadataByTitle.get(normalizeTitle(curated.commonsTitle));
  const info = page?.imageinfo?.[0];
  if (!page || page.missing || !info?.url) {
    throw new Error(`${curated.poiId}: Commons file is missing.`);
  }
  const meta = info.extmetadata ?? {};
  const author = curated.authorOverride ?? textFromHtml(meta.Artist?.value);
  const rawLicense = textFromHtml(meta.LicenseShortName?.value);
  const license = rawLicense === "CC0" ? "CC0 1.0" : rawLicense;
  const rawLicenseUrl =
    meta.LicenseUrl?.value ||
    (license.toLocaleLowerCase() === "public domain" ? PUBLIC_DOMAIN_URL : null);
  const licenseUrl = rawLicenseUrl?.replace(
    /^http:\/\/creativecommons\.org\//,
    "https://creativecommons.org/",
  );
  if (!author || !isAllowedLicense(license) || !licenseUrl) {
    throw new Error(
      `${curated.poiId}: incomplete or disallowed license metadata (${license || "missing"}).`,
    );
  }
  if (info.mime !== "image/jpeg") {
    throw new Error(`${curated.poiId}: expected image/jpeg, got ${info.mime}.`);
  }

  const downloadUrl = withoutTracking(info.thumburl ?? info.url);
  const imageResponse = await fetchWithRetry(downloadUrl);
  if (!imageResponse.ok) {
    throw new Error(`${curated.poiId}: image download failed ${imageResponse.status}.`);
  }
  const contentType = imageResponse.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!contentType.startsWith("image/jpeg") || bytes.length <= 10_000) {
    throw new Error(
      `${curated.poiId}: invalid image response (${contentType}, ${bytes.length} bytes).`,
    );
  }

  await writeAtomic(path.join(PUBLIC_MEDIA_DIR, curated.localFileName), bytes);
  await writeAtomic(path.join(RAW_MEDIA_DIR, curated.localFileName), bytes);
  const displaySha256 = createHash("sha256").update(bytes).digest("hex");
  const featuredItem = featured.items.find((item) => item.poiId === curated.poiId);
  const mediaItem = {
    poiId: curated.poiId,
    imageSrc: `/poi/${curated.localFileName}`,
    alt: curated.alt,
    sourcePageUrl: info.descriptionurl,
    sourceFileUrl: withoutTracking(info.url),
    articleUrl: curated.articleUrl,
    commonsTitle: page.title,
    author,
    license,
    licenseUrl,
    attribution: `${author} / Wikimedia Commons / ${license}`,
    modification: "采用 Wikimedia 1280px 缩略图；网页按图片容器比例居中裁切显示",
    verifiedAt: VERIFIED_AT,
    editorialOrder:
      featuredItem?.editorialOrder ?? featured.items.length + curation.items.indexOf(curated) + 1,
    sourceMime: info.mime,
    sourceWidth: info.width,
    sourceHeight: info.height,
    sourceSha1: info.sha1,
    displayWidth: info.thumbwidth ?? info.width,
    displayHeight: info.thumbheight ?? info.height,
    displaySha256,
    matchEvidence: curated.matchEvidence,
    visualReviewStatus: "pending_contact_sheet_review",
  };
  if (featuredItem) replacementById.set(curated.poiId, mediaItem);
  else imported.push(mediaItem);
  process.stdout.write(`[${index + 1}/${mediaToSync.length}] ${curated.localFileName}\n`);
}

const updatedFeatured = featured.items.map((item) => replacementById.get(item.poiId) ?? item);
const allItems = [...updatedFeatured, ...imported];
if (allItems.length !== 40 || new Set(allItems.map((item) => item.poiId)).size !== 40) {
  throw new Error("Final POI media manifest must contain 40 unique items.");
}
await writeFile(
  OUTPUT_PATH,
  `${JSON.stringify(
    {
      dataVersion: "poi-media-v0.4.4",
      verifiedAt: VERIFIED_AT,
      featuredDataVersion: featured.dataVersion,
      items: allItems,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`Wrote 40-item manifest to ${OUTPUT_PATH}\n`);
