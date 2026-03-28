#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDN = "https://designsync-omega.vercel.app";

// ── Helpers ─────────────────────────────────────────────────────────

function findProjectRoot(dir) {
  if (fs.existsSync(path.join(dir, "package.json")) && !dir.includes("node_modules")) {
    return dir;
  }
  const parent = path.dirname(dir);
  if (parent === dir) return null;
  return findProjectRoot(parent);
}

function findCssFile(root) {
  // 1) From components.json
  const compJsonPath = path.join(root, "components.json");
  if (fs.existsSync(compJsonPath)) {
    try {
      const compJson = JSON.parse(fs.readFileSync(compJsonPath, "utf-8"));
      const cssPath = compJson.tailwind?.css || compJson.style?.css;
      if (cssPath) {
        const full = path.join(root, cssPath);
        if (fs.existsSync(full)) return full;
      }
    } catch {}
  }

  // 2) From entry files
  const entries = ["src/main.tsx", "src/main.ts", "src/main.jsx", "src/index.tsx", "src/index.ts", "pages/_app.tsx", "pages/_app.js"];
  for (const entry of entries) {
    const entryPath = path.join(root, entry);
    if (fs.existsSync(entryPath)) {
      const content = fs.readFileSync(entryPath, "utf-8");
      const match = content.match(/import\s+['"]([^'"]+\.css)['"]/);
      if (match) {
        const cssPath = path.join(path.dirname(entryPath), match[1]);
        if (fs.existsSync(cssPath)) return cssPath;
      }
    }
  }

  // 3) Common locations
  const candidates = [
    "src/app/globals.css", "app/globals.css", "src/index.css",
    "styles/globals.css", "src/styles/globals.css", "src/global.css", "src/globals.css",
  ];
  for (const c of candidates) {
    const full = path.join(root, c);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

// ── Main ────────────────────────────────────────────────────────────

const projectRoot = findProjectRoot(path.resolve(__dirname, "../../.."));
if (!projectRoot) {
  console.log("  [designsync-ui] Could not find project root. Skipping.");
  process.exit(0);
}

const origCwd = process.cwd();
process.chdir(projectRoot);

console.log("");
console.log("  [designsync-ui] Setting up DesignSync...");

// ── 1. Copy components ──────────────────────────────────────────────
const srcComponents = path.join(__dirname, "components", "ui");
const srcLib = path.join(__dirname, "lib");

const useSrc = fs.existsSync(path.join(projectRoot, "src"));
const compDest = useSrc
  ? path.join(projectRoot, "src", "components", "ui")
  : path.join(projectRoot, "components", "ui");
const libDest = useSrc
  ? path.join(projectRoot, "src", "lib")
  : path.join(projectRoot, "lib");

fs.mkdirSync(compDest, { recursive: true });
fs.mkdirSync(libDest, { recursive: true });

let copied = 0;
for (const file of fs.readdirSync(srcComponents)) {
  fs.copyFileSync(path.join(srcComponents, file), path.join(compDest, file));
  copied++;
}

const utilsSrc = path.join(srcLib, "utils.ts");
const utilsDest = path.join(libDest, "utils.ts");
if (fs.existsSync(utilsSrc) && !fs.existsSync(utilsDest)) {
  fs.copyFileSync(utilsSrc, utilsDest);
}

console.log(`  [1/4] Copied ${copied} components`);

// ── 2. Detect slug from .designsync.json or env ─────────────────────
let dsSlug = process.env.DESIGNSYNC_SLUG || "";

const dsConfigPath = path.join(projectRoot, ".designsync.json");
if (!dsSlug && fs.existsSync(dsConfigPath)) {
  try {
    const dsConfig = JSON.parse(fs.readFileSync(dsConfigPath, "utf-8"));
    dsSlug = dsConfig.slug || "";
  } catch {}
}

// ── 3. Inject @import url(...) into CSS ─────────────────────────────
const cssFile = findCssFile(projectRoot);
if (cssFile && dsSlug) {
  const liveUrl = `${CDN}/r/${dsSlug}/designsync-tokens.css`;
  const importLine = `@import url("${liveUrl}");`;
  let cssContent = fs.readFileSync(cssFile, "utf-8");

  if (!cssContent.includes("designsync-tokens.css")) {
    fs.writeFileSync(cssFile, importLine + "\n" + cssContent);
    console.log("  [2/4] Live token sync enabled");
  } else {
    console.log("  [2/4] Live token sync already configured");
  }
} else if (cssFile) {
  console.log("  [2/4] Skipped live sync (set DESIGNSYNC_SLUG env or create .designsync.json)");
} else {
  console.log("  [2/4] Skipped live sync (CSS file not found)");
}

// ── 4. Fetch and write AI rules (.cursorrules, CLAUDE.md) ───────────
try {
  const rulesUrl = dsSlug ? `${CDN}/api/rules?ds=${dsSlug}` : `${CDN}/api/rules`;
  const rulesText = await fetchText(rulesUrl);

  if (rulesText && rulesText.length > 100) {
    fs.writeFileSync(path.join(projectRoot, ".cursorrules"), rulesText);
    fs.writeFileSync(path.join(projectRoot, "CLAUDE.md"), rulesText);
    console.log("  [3/4] Created .cursorrules + CLAUDE.md");
  } else {
    console.log("  [3/4] Skipped rules (could not fetch)");
  }
} catch {
  console.log("  [3/4] Skipped rules (network error)");
}

// ── 5. Create .designsync.json if slug provided ─────────────────────
if (dsSlug && !fs.existsSync(dsConfigPath)) {
  fs.writeFileSync(dsConfigPath, JSON.stringify({
    slug: dsSlug,
    registryUrl: CDN,
    updatedAt: new Date().toISOString(),
  }, null, 2) + "\n");
}

console.log("  [4/4] Done!");
console.log("");
if (!dsSlug) {
  console.log("  Tip: To enable live token sync, run:");
  console.log(`  DESIGNSYNC_SLUG=your-slug npm install github:IlYeoLee/designsync-ui`);
  console.log("  Get your slug from https://designsync-omega.vercel.app");
  console.log("");
}

process.chdir(origCwd);
