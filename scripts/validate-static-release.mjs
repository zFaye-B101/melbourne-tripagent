import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(projectRoot, "site");
const hostingConfig = JSON.parse(
  await readFile(path.join(siteRoot, ".openai", "hosting.json"), "utf8"),
);

assert.equal(
  hostingConfig.static?.directory,
  "dist/client",
  "Static hosting directory must remain dist/client.",
);

const outputRoot = path.resolve(siteRoot, hostingConfig.static.directory);
const indexPath = path.join(outputRoot, "index.html");
const html = await readFile(indexPath, "utf8");

assert.doesNotMatch(html, /melbourne-skyline\.jpg/);
assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
assert.doesNotMatch(html, /\/_next\/image\?/);

const skylinePath = path.join(outputRoot, "melbourne-skyline.webp");
assert.ok(
  (await stat(skylinePath)).isFile(),
  "Optimized skyline asset must be included in the static release.",
);

const chunkDirectory = path.join(outputRoot, "_next", "static", "chunks");
const chunkFiles = (await readdir(chunkDirectory)).filter((name) => name.endsWith(".js"));
const clientCode = (
  await Promise.all(chunkFiles.map((name) => readFile(path.join(chunkDirectory, name), "utf8")))
).join("\n");

assert.match(clientCode, /melbourne-skyline\.webp/);
assert.doesNotMatch(clientCode, /melbourne-skyline\.jpg/);
assert.doesNotMatch(
  clientCode,
  /(?:DASHSCOPE|ZHIPU|DEEPSEEK|OPENAI)_API_KEY/,
  "Provider secret names must not appear in the public client bundle.",
);
assert.doesNotMatch(
  clientCode,
  /api\.openai\.com\/v1\/responses/,
  "The server-only LLM provider must not appear in the public client bundle.",
);
assert.doesNotMatch(
  clientCode,
  /cn-beijing\.maas\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions/,
  "The server-only DashScope provider must not appear in the public client bundle.",
);

const attributeReferences = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(
  (match) => match[1],
);

const localReferences = [
  ...new Set(
    attributeReferences
      .map((reference) => new URL(reference, "https://static.local/"))
      .filter((reference) => reference.origin === "https://static.local")
      .map((reference) => decodeURIComponent(reference.pathname))
      .filter((pathname) => pathname !== "/"),
  ),
];

for (const pathname of localReferences) {
  const filePath = path.resolve(outputRoot, `.${pathname}`);
  assert.ok(
    filePath.startsWith(`${outputRoot}${path.sep}`),
    `Asset escaped output directory: ${pathname}`,
  );
  assert.ok((await stat(filePath)).isFile(), `Missing static asset: ${pathname}`);
}

async function summarizeDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await summarizeDirectory(entryPath);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await stat(entryPath)).size;
    }
  }
  return { files, bytes };
}

async function assertNoLocalApiKeyInDirectory(directory, secrets) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await assertNoLocalApiKeyInDirectory(entryPath, secrets);
    } else if (entry.isFile()) {
      const contents = await readFile(entryPath);
      for (const secret of secrets)
        assert.ok(
          !contents.includes(secret),
          `A local provider secret was found in the public release file ${entry.name}.`,
        );
      if (/\.(?:js|mjs|html|json|css)$/.test(entry.name)) {
        const text = contents.toString("utf8");
        assert.doesNotMatch(
          text,
          /(?:DASHSCOPE|ZHIPU|DEEPSEEK|OPENAI)_API_KEY|api\.openai\.com\/v1\/responses|cn-beijing\.maas\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions/,
          `Server-only provider configuration appeared in ${entry.name}.`,
        );
      }
    }
  }
}

// A local development key may be available on the publisher's machine. Never
// print it, but reject the release if its bytes appear in any public asset.
const localSecretsPath = path.join(siteRoot, "bff", ".dev.vars");
let localSecrets = [];
try {
  const localVars = await readFile(localSecretsPath, "utf8");
  localSecrets = localVars
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+_API_KEY)=(.*)$/))
    .filter(Boolean)
    .map((match) => match[2].trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter((value) => value.length >= 12)
    .map((value) => Buffer.from(value));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await assertNoLocalApiKeyInDirectory(outputRoot, localSecrets);

const summary = await summarizeDirectory(outputRoot);
console.log(
  `Static release valid: ${summary.files} files, ${localReferences.length} HTML assets resolved, ${(summary.bytes / 1024 / 1024).toFixed(2)} MiB.`,
);
