#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDN = "https://designsync-omega.vercel.app";

// ── Peer dependencies required by DesignSync UI components ───────────
const PEER_DEPS = [
  // Radix UI primitives
  "@radix-ui/react-accordion",
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-aspect-ratio",
  "@radix-ui/react-avatar",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-collapsible",
  "@radix-ui/react-context-menu",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-hover-card",
  "@radix-ui/react-label",
  "@radix-ui/react-menubar",
  "@radix-ui/react-navigation-menu",
  "@radix-ui/react-popover",
  "@radix-ui/react-progress",
  "@radix-ui/react-radio-group",
  "@radix-ui/react-scroll-area",
  "@radix-ui/react-select",
  "@radix-ui/react-separator",
  "@radix-ui/react-slider",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-tabs",
  "@radix-ui/react-toast",
  "@radix-ui/react-toggle",
  "@radix-ui/react-toggle-group",
  "@radix-ui/react-tooltip",
  // Utility libraries
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  // Icon library (default)
  "lucide-react",
  // Component dependencies
  "sonner",
  "cmdk",
  "date-fns",
  "vaul",
  "react-hook-form",
  "@hookform/resolvers",
  "input-otp",
  "react-resizable-panels",
  "embla-carousel-react",
  "react-day-picker",
  "recharts",
  "tw-animate-css",
];

// ── Helpers ──────────────────────────────────────────────────────────

function findProjectRoot(dir) {
  if (fs.existsSync(path.join(dir, "package.json")) && !dir.includes("node_modules")) {
    return dir;
  }
  const parent = path.dirname(dir);
  if (parent === dir) return null;
  return findProjectRoot(parent);
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function buildInstallCommand(pkgManager, packages) {
  switch (pkgManager) {
    case "pnpm": return `pnpm add ${packages.join(" ")}`;
    case "yarn": return `yarn add ${packages.join(" ")}`;
    default:     return `npm install ${packages.join(" ")} --save`;
  }
}

function getMissingPackages(root, packages) {
  const nodeModules = path.join(root, "node_modules");
  return packages.filter((pkg) => {
    // Scoped packages like @radix-ui/react-slot live at node_modules/@radix-ui/react-slot
    const pkgDir = path.join(nodeModules, ...pkg.split("/"));
    return !fs.existsSync(pkgDir);
  });
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
  const entries = [
    "src/main.tsx", "src/main.ts", "src/main.jsx",
    "src/index.tsx", "src/index.ts",
    "pages/_app.tsx", "pages/_app.js",
  ];
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

// ── Main ─────────────────────────────────────────────────────────────

const projectRoot = findProjectRoot(path.resolve(__dirname, "../../.."));
if (!projectRoot) {
  console.log("  [designsync-ui] Could not find project root. Skipping.");
  process.exit(0);
}

const origCwd = process.cwd();
process.chdir(projectRoot);

const pkgManager = detectPackageManager(projectRoot);

console.log("");
console.log("  [designsync-ui] Setting up DesignSync...");
console.log(`  Package manager detected: ${pkgManager}`);

// ── 0. Install missing peer dependencies ─────────────────────────────
try {
  const missing = getMissingPackages(projectRoot, PEER_DEPS);
  if (missing.length > 0) {
    console.log(`  [0/6] Installing ${missing.length} missing peer dependencies...`);
    const cmd = buildInstallCommand(pkgManager, missing);
    execSync(cmd, { cwd: projectRoot, stdio: "inherit" });
    console.log(`  [0/6] Peer dependencies installed`);
  } else {
    console.log("  [0/6] All peer dependencies already present");
  }
} catch (e) {
  // Non-fatal: components may still work if most deps are present
  console.log(`  [0/6] Peer dependency install warning: ${e.message}`);
}

// ── 1. Copy components ───────────────────────────────────────────────
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
  const destPath = path.join(compDest, file);
  let content = fs.readFileSync(path.join(srcComponents, file), "utf-8");
  // Fix registry-internal imports → standard @/components/ui/ path
  content = content.replace(/@\/registry\/new-york\/ui\//g, "@/components/ui/");
  fs.writeFileSync(destPath, content);
  copied++;
}

const utilsSrc = path.join(srcLib, "utils.ts");
const utilsDest = path.join(libDest, "utils.ts");
if (fs.existsSync(utilsSrc) && !fs.existsSync(utilsDest)) {
  fs.copyFileSync(utilsSrc, utilsDest);
}

console.log(`  [1/6] Copied ${copied} components`);

// ── 2. Detect slug from .designsync.json or env ──────────────────────
let dsSlug = process.env.DESIGNSYNC_SLUG || "";

const dsConfigPath = path.join(projectRoot, ".designsync.json");
let dsConfig = {};
if (fs.existsSync(dsConfigPath)) {
  try {
    dsConfig = JSON.parse(fs.readFileSync(dsConfigPath, "utf-8"));
    if (!dsSlug) dsSlug = dsConfig.slug || "";
  } catch {}
}

// ── 2b. Fetch icon library from API if slug exists ───────────────────
const ICON_MAP = {
  ArrowLeft:          { tabler: "IconArrowLeft",        phosphor: "ArrowLeft",        remix: "RiArrowLeftLine",       hugeicons: "ArrowLeft01Icon" },
  ArrowRight:         { tabler: "IconArrowRight",       phosphor: "ArrowRight",       remix: "RiArrowRightLine",      hugeicons: "ArrowRight01Icon" },
  ArrowUpDown:        { tabler: "IconArrowsUpDown",     phosphor: "ArrowsDownUp",     remix: "RiArrowUpDownLine",     hugeicons: "ArrowUpDown01Icon" },
  CalendarIcon:       { tabler: "IconCalendar",         phosphor: "Calendar",         remix: "RiCalendarLine",        hugeicons: "Calendar01Icon" },
  CheckIcon:          { tabler: "IconCheck",            phosphor: "Check",            remix: "RiCheckLine",           hugeicons: "Tick01Icon" },
  ChevronDownIcon:    { tabler: "IconChevronDown",      phosphor: "CaretDown",        remix: "RiArrowDownSLine",      hugeicons: "ArrowDown01Icon" },
  ChevronLeft:        { tabler: "IconChevronLeft",      phosphor: "CaretLeft",        remix: "RiArrowLeftSLine",      hugeicons: "ArrowLeft01Icon" },
  ChevronRight:       { tabler: "IconChevronRight",     phosphor: "CaretRight",       remix: "RiArrowRightSLine",     hugeicons: "ArrowRight01Icon" },
  ChevronRightIcon:   { tabler: "IconChevronRight",     phosphor: "CaretRight",       remix: "RiArrowRightSLine",     hugeicons: "ArrowRight01Icon" },
  ChevronUpIcon:      { tabler: "IconChevronUp",        phosphor: "CaretUp",          remix: "RiArrowUpSLine",        hugeicons: "ArrowUp01Icon" },
  ChevronsUpDown:     { tabler: "IconSelector",         phosphor: "CaretUpDown",      remix: "RiExpandUpDownLine",    hugeicons: "UnfoldMore01Icon" },
  CircleIcon:         { tabler: "IconCircle",           phosphor: "Circle",           remix: "RiCircleLine",          hugeicons: "Circle01Icon" },
  GripVerticalIcon:   { tabler: "IconGripVertical",     phosphor: "DotsSixVertical",  remix: "RiDraggable",           hugeicons: "DragDropVerticalIcon" },
  MenuIcon:           { tabler: "IconMenu2",            phosphor: "List",             remix: "RiMenuLine",            hugeicons: "Menu01Icon" },
  MinusIcon:          { tabler: "IconMinus",            phosphor: "Minus",            remix: "RiSubtractLine",        hugeicons: "MinusSignIcon" },
  MoreHorizontalIcon: { tabler: "IconDotsHorizontal",   phosphor: "DotsThree",        remix: "RiMore2Line",           hugeicons: "MoreHorizontalIcon" },
  PanelLeftIcon:      { tabler: "IconLayoutSidebar",    phosphor: "SidebarSimple",    remix: "RiLayoutLeftLine",      hugeicons: "LeftToRightBlockQuoteIcon" },
  SearchIcon:         { tabler: "IconSearch",           phosphor: "MagnifyingGlass",  remix: "RiSearchLine",          hugeicons: "Search01Icon" },
  XIcon:              { tabler: "IconX",                phosphor: "X",                remix: "RiCloseLine",           hugeicons: "Cancel01Icon" },
};

const LIBRARY_PKG = {
  lucide:     "lucide-react",
  tabler:     "@tabler/icons-react",
  phosphor:   "@phosphor-icons/react",
  remix:      "@remixicon/react",
  hugeicons:  "@hugeicons/react",
};

let iconLibrary = dsConfig.iconLibrary || "lucide";

// Fetch icon library from API if we have a slug
if (dsSlug) {
  try {
    const infoUrl = `${CDN}/api/ds-info?slug=${dsSlug}`;
    const infoText = await fetchText(infoUrl);
    if (infoText) {
      const info = JSON.parse(infoText);
      if (info.icon_library) iconLibrary = info.icon_library;
    }
  } catch {}
}

// Rewrite icon imports in copied component files
if (iconLibrary !== "lucide") {
  const targetPkg = LIBRARY_PKG[iconLibrary];
  if (targetPkg) {
    let rewritten = 0;
    for (const file of fs.readdirSync(compDest)) {
      const filePath = path.join(compDest, file);
      let content = fs.readFileSync(filePath, "utf-8");
      if (content.includes("lucide-react")) {
        content = content.replace(
          /import\s*\{([^}]+)\}\s*from\s*"lucide-react"/g,
          (_match, importList) => {
            const icons = importList.split(",").map((s) => s.trim()).filter(Boolean);
            const mapped = icons.map((icon) => {
              const entry = ICON_MAP[icon];
              if (!entry || !entry[iconLibrary]) return icon;
              const newName = entry[iconLibrary];
              return newName === icon ? icon : `${newName} as ${icon}`;
            });
            return `import { ${mapped.join(", ")} } from "${targetPkg}"`;
          }
        );
        fs.writeFileSync(filePath, content);
        rewritten++;
      }
    }

    // Install the non-lucide icon package using the detected package manager
    try {
      const iconInstallCmd = buildInstallCommand(pkgManager, [targetPkg]);
      execSync(iconInstallCmd, { cwd: projectRoot, stdio: "ignore" });
    } catch {}

    console.log(`  [2/6] Icon library: ${iconLibrary} (${rewritten} files rewritten)`);
  }
} else {
  console.log(`  [2/6] Icon library: lucide (default)`);
}

// ── 3. Inject @theme inline + @import url(...) into CSS ──────────────
const themeInlineBlock = `
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground, #fff);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --shadow-sm: var(--ds-shadow-sm);
  --shadow-md: var(--ds-shadow-md);
  --shadow-lg: var(--ds-shadow-lg);
  --text-xs: var(--font-size-xs, 0.75rem);
  --text-sm: var(--font-size-sm, 0.875rem);
  --text-base: var(--font-size-base, 1rem);
  --text-lg: var(--font-size-lg, 1.125rem);
  --text-xl: var(--font-size-xl, 1.25rem);
  --text-2xl: var(--font-size-2xl, 1.5rem);
  --text-3xl: var(--font-size-3xl, 1.875rem);
  --text-4xl: var(--font-size-4xl, 2.25rem);
  --text-5xl: var(--font-size-5xl, 3rem);
  --leading-tight: var(--line-height-tight, 1.25);
  --leading-normal: var(--line-height-normal, 1.5);
  --leading-relaxed: var(--line-height-relaxed, 1.625);
  --leading-loose: var(--line-height-loose, 1.75);
}
`;

const cssFile = findCssFile(projectRoot);
if (cssFile && dsSlug) {
  const liveUrl = `${CDN}/r/${dsSlug}/designsync-tokens.css`;
  let cssContent = fs.readFileSync(cssFile, "utf-8");

  // Remove old @import url(...designsync-tokens.css) if present
  cssContent = cssContent.replace(/^@import\s+url\(["'][^"']*designsync-tokens\.css["']\);?\s*\n?/m, "");
  // Remove old theme block if present
  cssContent = cssContent.replace(/\/\* designsync-theme-start \*\/[\s\S]*?\/\* designsync-theme-end \*\/\s*\n?/m, "");

  const themeBlock = `/* designsync-theme-start */\n${themeInlineBlock}\n/* designsync-theme-end */`;

  // Insert @theme inline AFTER @import "tailwindcss"
  const tailwindImportRegex = /(@import\s+["']tailwindcss["'];?\s*\n?)/;
  if (tailwindImportRegex.test(cssContent)) {
    cssContent = cssContent.replace(tailwindImportRegex, `$1\n${themeBlock}\n`);
  } else {
    cssContent = themeBlock + "\n" + cssContent;
  }
  fs.writeFileSync(cssFile, cssContent);

  // Inject <link> tag into index.html for live token sync
  const htmlCandidates = ["index.html", "public/index.html", "src/index.html"];
  const linkTag = `<link rel="stylesheet" href="${liveUrl}" />`;
  for (const htmlPath of htmlCandidates) {
    const fullPath = path.join(projectRoot, htmlPath);
    if (fs.existsSync(fullPath)) {
      let html = fs.readFileSync(fullPath, "utf-8");
      if (!html.includes("designsync-tokens.css")) {
        html = html.replace("</head>", `    ${linkTag}\n  </head>`);
      }
      // Add live reload script (refreshes tokens every 5s without page reload)
      if (!html.includes("designsync-live-reload")) {
        const liveScript = `<script data-designsync-live-reload>
    (function(){var l=document.querySelector('link[href*="designsync-tokens"]');if(l)setInterval(function(){l.href=l.href.split("?")[0]+"?t="+Date.now()},5000)})();
    </script>`;
        html = html.replace("</body>", `    ${liveScript}\n  </body>`);
      }
      fs.writeFileSync(fullPath, html);
      break;
    }
  }

  console.log("  [3/6] Live token sync + theme enabled");
} else if (cssFile) {
  console.log("  [3/6] Skipped live sync (set DESIGNSYNC_SLUG env or create .designsync.json)");
} else {
  console.log("  [3/6] Skipped live sync (CSS file not found)");
}

// ── 4. Fetch and write AI rules (.cursorrules, CLAUDE.md) ────────────
try {
  const rulesUrl = dsSlug ? `${CDN}/api/rules?ds=${dsSlug}` : `${CDN}/api/rules`;
  const rulesText = await fetchText(rulesUrl);

  if (rulesText && rulesText.length > 100) {
    fs.writeFileSync(path.join(projectRoot, ".cursorrules"), rulesText);
    fs.writeFileSync(path.join(projectRoot, "CLAUDE.md"), rulesText);
    console.log("  [4/6] Created .cursorrules + CLAUDE.md");
  } else {
    console.log("  [4/6] Skipped rules (could not fetch)");
  }
} catch {
  console.log("  [4/6] Skipped rules (network error)");
}

// ── 5. Copy ESLint plugin + inject into eslint.config.js ─────────────
const pluginSrc = path.join(__dirname, "eslint-plugin-designsync.mjs");

if (fs.existsSync(pluginSrc)) {
  const eslintConfigPath = path.join(projectRoot, "eslint.config.js");
  if (fs.existsSync(eslintConfigPath)) {
    let eslintConfig = fs.readFileSync(eslintConfigPath, "utf-8");
    if (!eslintConfig.includes("designsync")) {
      // Plugin file uses module.exports (CJS), so always save as .cjs
      const pluginFileDest = path.join(projectRoot, "designsync-eslint.cjs");
      fs.copyFileSync(pluginSrc, pluginFileDest);

      // Check if project uses "type": "module" (ESM)
      const projPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
      const isESM = projPkg.type === "module";

      // ESM: createRequire needed for .cjs, CJS: direct require works
      const importLine = isESM
        ? `import { createRequire } from "module";\nconst __require = createRequire(import.meta.url);\nconst designsync = __require("./designsync-eslint.cjs");\n`
        : `const designsync = require("./designsync-eslint.cjs");\n`;
      const configBlock = `  designsync,\n`;

      // Insert import after last import
      const lastImportIdx = eslintConfig.lastIndexOf("import ");
      const lineEnd = eslintConfig.indexOf("\n", lastImportIdx);
      eslintConfig = eslintConfig.slice(0, lineEnd + 1) + importLine + eslintConfig.slice(lineEnd + 1);

      // Insert config block before last ]
      const closingBracket = eslintConfig.lastIndexOf("]");
      eslintConfig = eslintConfig.slice(0, closingBracket) + configBlock + eslintConfig.slice(closingBracket);

      fs.writeFileSync(eslintConfigPath, eslintConfig);
      console.log("  [5/6] ESLint DesignSync rules injected");
    } else {
      console.log("  [5/6] ESLint rules already configured");
    }
  } else {
    console.log("  [5/6] Skipped ESLint injection (no eslint.config.js)");
  }
} else {
  console.log("  [5/6] Skipped ESLint plugin (file not found)");
}

// ── 6. Migrate existing code to DesignSync tokens ────────────────────
const CLASS_MAP = {
  'bg-white':           'bg-background',
  'bg-gray-50':         'bg-background',
  'bg-slate-50':        'bg-background',
  'bg-[#fafafa]':       'bg-background',
  'bg-[#fff]':          'bg-background',
  'bg-gray-100':        'bg-muted',
  'bg-slate-100':       'bg-muted',
  'bg-gray-200':        'bg-muted',
  'bg-blue-600':        'bg-primary',
  'bg-indigo-600':      'bg-primary',
  'bg-red-600':         'bg-destructive',
  'bg-red-500':         'bg-destructive',
  'bg-blue-50':         'bg-accent',
  'bg-indigo-50':       'bg-accent',
  'text-gray-900':      'text-foreground',
  'text-gray-800':      'text-foreground',
  'text-black':         'text-foreground',
  'text-gray-600':      'text-muted-foreground',
  'text-gray-500':      'text-muted-foreground',
  'text-gray-400':      'text-muted-foreground',
  'text-white':         'text-primary-foreground',
  'text-blue-600':      'text-primary',
  'text-red-600':       'text-destructive',
  'border-gray-200':    'border-border',
  'border-gray-100':    'border-border',
  'border-[#e5e5e5]':   'border-border',
  'border-gray-300':    'border-input',
  'border-[#ddd]':      'border-input',
  'hover:bg-gray-50':   'hover:bg-accent',
  'hover:bg-gray-100':  'hover:bg-accent',
};

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");
  let changed = false;
  for (const [from, to] of Object.entries(CLASS_MAP)) {
    const escaped = from.replace(/[[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const re = new RegExp(`(?<=['" ])${escaped}(?=['" ])`, "g");
    const next = content.replace(re, to);
    if (next !== content) { content = next; changed = true; }
  }
  if (changed) fs.writeFileSync(filePath, content);
  return changed;
}

try {
  const srcDir = fs.existsSync(path.join(projectRoot, "src"))
    ? path.join(projectRoot, "src")
    : projectRoot;
  const exts = [".tsx", ".ts", ".jsx", ".js"];
  let migratedCount = 0;

  function walkAndMigrate(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walkAndMigrate(full); }
      else if (exts.includes(path.extname(entry.name))) {
        if (migrateFile(full)) migratedCount++;
      }
    }
  }

  walkAndMigrate(srcDir);
  console.log(`  [6/6] Migrated ${migratedCount} files to DesignSync tokens`);
} catch (e) {
  console.log(`  [6/6] Migration skipped: ${e.message}`);
}

// ── Write .designsync.json if slug provided ──────────────────────────
if (dsSlug && !fs.existsSync(dsConfigPath)) {
  fs.writeFileSync(dsConfigPath, JSON.stringify({
    slug: dsSlug,
    registryUrl: CDN,
    updatedAt: new Date().toISOString(),
  }, null, 2) + "\n");
}

// ── Version check ─────────────────────────────────────────────────────
const installedPkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
const installedVersion = installedPkg.version;

try {
  const latestJson = await fetchText("https://raw.githubusercontent.com/IlYeoLee/designsync-ui/main/package.json");
  const latestVersion = JSON.parse(latestJson).version;
  if (latestVersion && latestVersion !== installedVersion) {
    console.log("");
    console.log(`  Update available: ${installedVersion} -> ${latestVersion}`);
    console.log(`  ${pkgManager === "pnpm" ? "pnpm add" : pkgManager === "yarn" ? "yarn add" : "npm install"} github:IlYeoLee/designsync-ui`);
    console.log("");
  }
} catch {}

console.log("  [6/6] Done!");
console.log("");

if (!dsSlug) {
  console.log("  Tip: To enable live token sync, run:");
  console.log(`  DESIGNSYNC_SLUG=your-slug ${pkgManager} install github:IlYeoLee/designsync-ui`);
  console.log("  Get your slug from https://designsync-omega.vercel.app");
  console.log("");
}

process.chdir(origCwd);
