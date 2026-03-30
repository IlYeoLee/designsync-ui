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

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBinary(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

// Download all @font-face src URLs to public/fonts/, rewrite CSS to use local paths
async function localizefonts(css, projectRoot) {
  const publicFontsDir = path.join(projectRoot, "public", "fonts");
  fs.mkdirSync(publicFontsDir, { recursive: true });

  // Match url("...") inside @font-face blocks
  const fontFaceRegex = /@font-face\s*\{[^}]*\}/g;
  const urlRegex = /url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g;

  let fontsDownloaded = 0;
  const processedCss = css.replace(fontFaceRegex, (fontFaceBlock) => {
    return fontFaceBlock.replace(urlRegex, (match, url) => {
      // Skip Google Fonts CDN — they need @import, not direct file download
      if (url.includes("fonts.gstatic.com") || url.includes("fonts.googleapis.com")) return match;
      const filename = path.basename(url.split("?")[0]);
      const localPath = path.join(publicFontsDir, filename);
      if (!fs.existsSync(localPath)) {
        try {
          const buf = fetchBinary(url);
          // Schedule async download (fire-and-forget — we write sync placeholder)
          buf.then((b) => { fs.writeFileSync(localPath, b); fontsDownloaded++; }).catch(() => {});
        } catch {}
      }
      return `url('/fonts/${filename}')`;
    });
  });

  // Actually await all downloads properly
  const downloadQueue = [];
  css.replace(fontFaceRegex, (fontFaceBlock) => {
    fontFaceBlock.replace(urlRegex, (_, url) => {
      if (url.includes("fonts.gstatic.com") || url.includes("fonts.googleapis.com")) return;
      const filename = path.basename(url.split("?")[0]);
      const localPath = path.join(publicFontsDir, filename);
      if (!fs.existsSync(localPath)) {
        downloadQueue.push(
          fetchBinary(url).then((buf) => { fs.writeFileSync(localPath, buf); fontsDownloaded++; }).catch(() => {})
        );
      }
    });
  });
  await Promise.all(downloadQueue);

  return { css: processedCss, fontsDownloaded };
}

// Walk all source files, skipping build/vendor dirs
function walkSrcFiles(dir, exts, skipDirs = []) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist" || entry.name === ".git") continue;
    if (skipDirs.includes(path.join(dir, entry.name))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSrcFiles(full, exts, skipDirs));
    } else if (exts.includes(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
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

// ── 1.5. Ensure @/ path alias is configured ──────────────────────────
(function ensurePathAlias() {
  const aliasSrc = useSrc ? "./src/*" : "./*";
  const aliasVal = useSrc ? "./src" : ".";

  // ── tsconfig / jsconfig ───────────────────────────────────────────
  const tsconfigCandidates = ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"];
  let tsconfigPatched = false;

  for (const cfgName of tsconfigCandidates) {
    const cfgPath = path.join(projectRoot, cfgName);
    if (!fs.existsSync(cfgPath)) continue;
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")); } catch { continue; }

    const co = cfg.compilerOptions || (cfg.compilerOptions = {});
    const paths = co.paths || (co.paths = {});
    if (paths["@/*"]) { tsconfigPatched = true; break; } // already present

    if (!co.baseUrl) co.baseUrl = ".";
    paths["@/*"] = [aliasSrc];
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    tsconfigPatched = true;
    break;
  }

  // ── vite.config.ts / vite.config.js ──────────────────────────────
  const viteConfigCandidates = ["vite.config.ts", "vite.config.js"];
  let vitePatched = false;

  for (const vcName of viteConfigCandidates) {
    const vcPath = path.join(projectRoot, vcName);
    if (!fs.existsSync(vcPath)) continue;
    let vc = fs.readFileSync(vcPath, "utf-8");

    if (vc.includes('"@"') || vc.includes("'@'")) { vitePatched = true; break; } // already present

    // Ensure path import exists at top
    if (!vc.includes("import path from") && !vc.includes('import path from "path"')) {
      vc = `import path from "path";\n` + vc;
    }

    if (/\bresolve\s*:/.test(vc)) {
      // Has resolve: block but no @ alias — inject inside alias object if present, else add alias
      if (/\balias\s*:/.test(vc)) {
        vc = vc.replace(/(\balias\s*:\s*\{)/, `$1\n      "@": path.resolve(__dirname, "${aliasVal}"),`);
      } else {
        vc = vc.replace(/(\bresolve\s*:\s*\{)/, `$1\n    alias: { "@": path.resolve(__dirname, "${aliasVal}") },`);
      }
    } else {
      // No resolve: block — inject before closing }) of defineConfig
      vc = vc.replace(/(}\s*\)\s*;?\s*)$/, `  resolve: { alias: { "@": path.resolve(__dirname, "${aliasVal}") } },\n$1`);
    }

    fs.writeFileSync(vcPath, vc);
    vitePatched = true;
    break;
  }

  if (tsconfigPatched || vitePatched) {
    console.log("  [1.5/6] Path alias @/ configured");
  } else {
    console.log("  [1.5/6] Path alias @/ already present");
  }
})();

// ── 2. Icon library detection + full lucide→target rewriting ─────────

const ICON_MAP = {
  // ── Originally present ──────────────────────────────────────────────
  ArrowLeft:            { tabler: "IconArrowLeft",         phosphor: "ArrowLeft",               remix: "RiArrowLeftLine",        hugeicons: "ArrowLeft01Icon" },
  ArrowRight:           { tabler: "IconArrowRight",        phosphor: "ArrowRight",              remix: "RiArrowRightLine",       hugeicons: "ArrowRight01Icon" },
  ArrowUpDown:          { tabler: "IconArrowsUpDown",      phosphor: "ArrowsDownUp",            remix: "RiArrowUpDownLine",      hugeicons: "ArrowUpDown01Icon" },
  CalendarIcon:         { tabler: "IconCalendar",          phosphor: "Calendar",                remix: "RiCalendarLine",         hugeicons: "Calendar01Icon" },
  CheckIcon:            { tabler: "IconCheck",             phosphor: "Check",                   remix: "RiCheckLine",            hugeicons: "Tick01Icon" },
  ChevronDownIcon:      { tabler: "IconChevronDown",       phosphor: "CaretDown",               remix: "RiArrowDownSLine",       hugeicons: "ArrowDown01Icon" },
  ChevronLeft:          { tabler: "IconChevronLeft",       phosphor: "CaretLeft",               remix: "RiArrowLeftSLine",       hugeicons: "ArrowLeft01Icon" },
  ChevronRight:         { tabler: "IconChevronRight",      phosphor: "CaretRight",              remix: "RiArrowRightSLine",      hugeicons: "ArrowRight01Icon" },
  ChevronRightIcon:     { tabler: "IconChevronRight",      phosphor: "CaretRight",              remix: "RiArrowRightSLine",      hugeicons: "ArrowRight01Icon" },
  ChevronUpIcon:        { tabler: "IconChevronUp",         phosphor: "CaretUp",                 remix: "RiArrowUpSLine",         hugeicons: "ArrowUp01Icon" },
  ChevronsUpDown:       { tabler: "IconSelector",          phosphor: "CaretUpDown",             remix: "RiExpandUpDownLine",     hugeicons: "UnfoldMore01Icon" },
  CircleIcon:           { tabler: "IconCircle",            phosphor: "Circle",                  remix: "RiCircleLine",           hugeicons: "Circle01Icon" },
  GripVerticalIcon:     { tabler: "IconGripVertical",      phosphor: "DotsSixVertical",         remix: "RiDraggable",            hugeicons: "DragDropVerticalIcon" },
  MenuIcon:             { tabler: "IconMenu2",             phosphor: "List",                    remix: "RiMenuLine",             hugeicons: "Menu01Icon" },
  MinusIcon:            { tabler: "IconMinus",             phosphor: "Minus",                   remix: "RiSubtractLine",         hugeicons: "MinusSignIcon" },
  MoreHorizontalIcon:   { tabler: "IconDotsHorizontal",    phosphor: "DotsThree",               remix: "RiMore2Line",            hugeicons: "MoreHorizontalIcon" },
  PanelLeftIcon:        { tabler: "IconLayoutSidebar",     phosphor: "SidebarSimple",           remix: "RiLayoutLeftLine",       hugeicons: "LeftToRightBlockQuoteIcon" },
  SearchIcon:           { tabler: "IconSearch",            phosphor: "MagnifyingGlass",         remix: "RiSearchLine",           hugeicons: "Search01Icon" },
  XIcon:                { tabler: "IconX",                 phosphor: "X",                       remix: "RiCloseLine",            hugeicons: "Cancel01Icon" },

  // ── Navigation / Directional ─────────────────────────────────────────
  Home:                 { tabler: "IconHome",              phosphor: "House",                   remix: "RiHomeLine",             hugeicons: "Home01Icon" },
  ArrowUp:              { tabler: "IconArrowUp",           phosphor: "ArrowUp",                 remix: "RiArrowUpLine",          hugeicons: "ArrowUp01Icon" },
  ArrowDown:            { tabler: "IconArrowDown",         phosphor: "ArrowDown",               remix: "RiArrowDownLine",        hugeicons: "ArrowDown01Icon" },
  ChevronDown:          { tabler: "IconChevronDown",       phosphor: "CaretDown",               remix: "RiArrowDownSLine",       hugeicons: "ArrowDown01Icon" },
  ChevronUp:            { tabler: "IconChevronUp",         phosphor: "CaretUp",                 remix: "RiArrowUpSLine",         hugeicons: "ArrowUp01Icon" },
  Navigation:           { tabler: "IconNavigation",        phosphor: "NavigationArrow",         remix: "RiNavigationLine",       hugeicons: "Navigation01Icon" },
  Compass:              { tabler: "IconCompass",           phosphor: "Compass",                 remix: "RiCompassLine",          hugeicons: "Compass01Icon" },
  MapPin:               { tabler: "IconMapPin",            phosphor: "MapPin",                  remix: "RiMapPinLine",           hugeicons: "Location01Icon" },
  Map:                  { tabler: "IconMap",               phosphor: "Map",                     remix: "RiMapLine",              hugeicons: "Map01Icon" },

  // ── Settings / System ────────────────────────────────────────────────
  Settings:             { tabler: "IconSettings",          phosphor: "Gear",                    remix: "RiSettings4Line",        hugeicons: "Settings01Icon" },
  Sliders:              { tabler: "IconAdjustments",       phosphor: "Sliders",                 remix: "RiSlidersLine",          hugeicons: "Slider01Icon" },
  SlidersHorizontal:    { tabler: "IconAdjustmentsHorizontal", phosphor: "Sliders",            remix: "RiEqualizerLine",        hugeicons: "Slider02Icon" },
  Power:                { tabler: "IconPower",             phosphor: "Power",                   remix: "RiPowerLine",            hugeicons: "PowerIcon" },
  Zap:                  { tabler: "IconBolt",              phosphor: "Lightning",               remix: "RiFlashlightLine",       hugeicons: "Zap01Icon" },
  Toggle:               { tabler: "IconToggleRight",       phosphor: "Toggle",                  remix: "RiToggleLine",           hugeicons: "ToggleOffIcon" },
  ToggleLeft:           { tabler: "IconToggleLeft",        phosphor: "ToggleLeft",              remix: "RiToggleLine",           hugeicons: "ToggleOffIcon" },
  ToggleRight:          { tabler: "IconToggleRight",       phosphor: "ToggleRight",             remix: "RiToggleFill",           hugeicons: "ToggleOnIcon" },

  // ── Users / Auth ─────────────────────────────────────────────────────
  User:                 { tabler: "IconUser",              phosphor: "User",                    remix: "RiUserLine",             hugeicons: "User01Icon" },
  Users:                { tabler: "IconUsers",             phosphor: "Users",                   remix: "RiGroupLine",            hugeicons: "UserGroup01Icon" },
  UserPlus:             { tabler: "IconUserPlus",          phosphor: "UserPlus",                remix: "RiUserAddLine",          hugeicons: "UserAdd01Icon" },
  UserMinus:            { tabler: "IconUserMinus",         phosphor: "UserMinus",               remix: "RiUserMinusLine",        hugeicons: "UserRemove01Icon" },
  UserCheck:            { tabler: "IconUserCheck",         phosphor: "UserCheck",               remix: "RiUserFollowLine",       hugeicons: "UserCheck01Icon" },
  LogIn:                { tabler: "IconLogin",             phosphor: "SignIn",                  remix: "RiLoginBoxLine",         hugeicons: "Login01Icon" },
  LogOut:               { tabler: "IconLogout",            phosphor: "SignOut",                 remix: "RiLogoutBoxLine",        hugeicons: "Logout01Icon" },

  // ── Search / Zoom ────────────────────────────────────────────────────
  Search:               { tabler: "IconSearch",            phosphor: "MagnifyingGlass",         remix: "RiSearchLine",           hugeicons: "Search01Icon" },
  ZoomIn:               { tabler: "IconZoomIn",            phosphor: "MagnifyingGlassPlus",     remix: "RiZoomInLine",           hugeicons: "ZoomInAreaIcon" },
  ZoomOut:              { tabler: "IconZoomOut",           phosphor: "MagnifyingGlassMinus",    remix: "RiZoomOutLine",          hugeicons: "ZoomOutAreaIcon" },

  // ── CRUD / Editing ───────────────────────────────────────────────────
  Plus:                 { tabler: "IconPlus",              phosphor: "Plus",                    remix: "RiAddLine",              hugeicons: "Add01Icon" },
  Minus:                { tabler: "IconMinus",             phosphor: "Minus",                   remix: "RiSubtractLine",         hugeicons: "MinusSignIcon" },
  X:                    { tabler: "IconX",                 phosphor: "X",                       remix: "RiCloseLine",            hugeicons: "Cancel01Icon" },
  Check:                { tabler: "IconCheck",             phosphor: "Check",                   remix: "RiCheckLine",            hugeicons: "Tick01Icon" },
  Edit:                 { tabler: "IconEdit",              phosphor: "PencilSimple",            remix: "RiEditLine",             hugeicons: "Edit01Icon" },
  Edit2:                { tabler: "IconEdit",              phosphor: "PencilSimple",            remix: "RiEditLine",             hugeicons: "Edit02Icon" },
  Edit3:                { tabler: "IconEdit",              phosphor: "PencilSimple",            remix: "RiEditLine",             hugeicons: "Edit03Icon" },
  Pencil:               { tabler: "IconPencil",            phosphor: "Pencil",                  remix: "RiPencilLine",           hugeicons: "PencilEdit01Icon" },
  Trash:                { tabler: "IconTrash",             phosphor: "Trash",                   remix: "RiDeleteBinLine",        hugeicons: "Delete01Icon" },
  Trash2:               { tabler: "IconTrash",             phosphor: "Trash",                   remix: "RiDeleteBin2Line",       hugeicons: "Delete02Icon" },
  Delete:               { tabler: "IconTrash",             phosphor: "Trash",                   remix: "RiDeleteBackLine",       hugeicons: "Delete01Icon" },
  Copy:                 { tabler: "IconCopy",              phosphor: "Copy",                    remix: "RiFileCopyLine",         hugeicons: "Copy01Icon" },
  Clipboard:            { tabler: "IconClipboard",         phosphor: "Clipboard",               remix: "RiClipboardLine",        hugeicons: "Clipboard01Icon" },
  Save:                 { tabler: "IconDeviceFloppy",      phosphor: "FloppyDisk",              remix: "RiSave2Line",            hugeicons: "FloppyDiskIcon" },

  // ── Files / Folders ──────────────────────────────────────────────────
  Download:             { tabler: "IconDownload",          phosphor: "DownloadSimple",          remix: "RiDownloadLine",         hugeicons: "Download01Icon" },
  Upload:               { tabler: "IconUpload",            phosphor: "UploadSimple",            remix: "RiUploadLine",           hugeicons: "Upload01Icon" },
  File:                 { tabler: "IconFile",              phosphor: "File",                    remix: "RiFileLine",             hugeicons: "File01Icon" },
  FileText:             { tabler: "IconFileText",          phosphor: "FileText",                remix: "RiFileTextLine",         hugeicons: "FileText01Icon" },
  Folder:               { tabler: "IconFolder",            phosphor: "Folder",                  remix: "RiFolderLine",           hugeicons: "Folder01Icon" },
  FolderOpen:           { tabler: "IconFolderOpen",        phosphor: "FolderOpen",              remix: "RiFolderOpenLine",       hugeicons: "FolderOpen01Icon" },
  Paperclip:            { tabler: "IconPaperclip",         phosphor: "Paperclip",               remix: "RiAttachment2",          hugeicons: "AttachmentIcon" },
  Attach:               { tabler: "IconPaperclip",         phosphor: "Paperclip",               remix: "RiAttachment2",          hugeicons: "AttachmentIcon" },

  // ── Visibility / Access ──────────────────────────────────────────────
  Eye:                  { tabler: "IconEye",               phosphor: "Eye",                     remix: "RiEyeLine",              hugeicons: "Eye01Icon" },
  EyeOff:               { tabler: "IconEyeOff",            phosphor: "EyeSlash",                remix: "RiEyeOffLine",           hugeicons: "EyeOffIcon" },
  Lock:                 { tabler: "IconLock",              phosphor: "Lock",                    remix: "RiLockLine",             hugeicons: "Lock01Icon" },
  Unlock:               { tabler: "IconLockOpen",          phosphor: "LockOpen",                remix: "RiLockUnlockLine",       hugeicons: "Unlock01Icon" },
  Key:                  { tabler: "IconKey",               phosphor: "Key",                     remix: "RiKeyLine",              hugeicons: "Key01Icon" },
  Shield:               { tabler: "IconShield",            phosphor: "Shield",                  remix: "RiShieldLine",           hugeicons: "Shield01Icon" },

  // ── Notifications / Alerts ───────────────────────────────────────────
  Bell:                 { tabler: "IconBell",              phosphor: "Bell",                    remix: "RiNotificationLine",     hugeicons: "Notification01Icon" },
  BellOff:              { tabler: "IconBellOff",           phosphor: "BellSlash",               remix: "RiNotificationOffLine",  hugeicons: "Notification02Icon" },
  AlertCircle:          { tabler: "IconAlertCircle",       phosphor: "WarningCircle",           remix: "RiErrorWarningLine",     hugeicons: "Alert01Icon" },
  AlertTriangle:        { tabler: "IconAlertTriangle",     phosphor: "Warning",                 remix: "RiAlertLine",            hugeicons: "AlertTriangleIcon" },
  Info:                 { tabler: "IconInfoCircle",        phosphor: "Info",                    remix: "RiInformationLine",      hugeicons: "InformationCircleIcon" },
  HelpCircle:           { tabler: "IconHelpCircle",        phosphor: "Question",                remix: "RiQuestionLine",         hugeicons: "HelpCircleIcon" },
  CheckCircle:          { tabler: "IconCircleCheck",       phosphor: "CheckCircle",             remix: "RiCheckboxCircleLine",   hugeicons: "CheckmarkCircle01Icon" },
  XCircle:              { tabler: "IconCircleX",           phosphor: "XCircle",                 remix: "RiCloseCircleLine",      hugeicons: "CancelCircleIcon" },

  // ── Communication ────────────────────────────────────────────────────
  Mail:                 { tabler: "IconMail",              phosphor: "Envelope",                remix: "RiMailLine",             hugeicons: "Mail01Icon" },
  Phone:                { tabler: "IconPhone",             phosphor: "Phone",                   remix: "RiPhoneLine",            hugeicons: "Call01Icon" },
  Globe:                { tabler: "IconWorld",             phosphor: "Globe",                   remix: "RiGlobalLine",           hugeicons: "EarthIcon" },
  MessageCircle:        { tabler: "IconMessageCircle",     phosphor: "ChatCircle",              remix: "RiMessage2Line",         hugeicons: "MessageCircle01Icon" },
  MessageSquare:        { tabler: "IconMessage",           phosphor: "ChatSquare",              remix: "RiMessageLine",          hugeicons: "Message01Icon" },
  Send:                 { tabler: "IconSend",              phosphor: "PaperPlaneRight",         remix: "RiSendPlaneLine",        hugeicons: "Send01Icon" },
  Share:                { tabler: "IconShare",             phosphor: "ShareNetwork",            remix: "RiShareLine",            hugeicons: "Share01Icon" },
  Share2:               { tabler: "IconShare2",            phosphor: "ShareNetwork",            remix: "RiShareForwardLine",     hugeicons: "Share02Icon" },

  // ── Loading / Refresh ────────────────────────────────────────────────
  Loader:               { tabler: "IconLoader",            phosphor: "CircleNotch",             remix: "RiLoader4Line",          hugeicons: "Loading01Icon" },
  Loader2:              { tabler: "IconLoader2",           phosphor: "CircleNotch",             remix: "RiLoader5Line",          hugeicons: "Loading02Icon" },
  RefreshCw:            { tabler: "IconRefresh",           phosphor: "ArrowClockwise",          remix: "RiRefreshLine",          hugeicons: "RefreshIcon" },
  RotateCw:             { tabler: "IconRotateClockwise",   phosphor: "ArrowClockwise",          remix: "RiRestartLine",          hugeicons: "RotateRight01Icon" },
  RotateCcw:            { tabler: "IconRotateCounterClockwise", phosphor: "ArrowCounterClockwise", remix: "RiAnticlockwise2Line", hugeicons: "RotateLeft01Icon" },

  // ── Links / Navigation Assist ────────────────────────────────────────
  ExternalLink:         { tabler: "IconExternalLink",      phosphor: "ArrowSquareOut",          remix: "RiExternalLinkLine",     hugeicons: "LinkSquare01Icon" },
  Link:                 { tabler: "IconLink",              phosphor: "Link",                    remix: "RiLinkM",                hugeicons: "Link01Icon" },
  Link2:                { tabler: "IconLink",              phosphor: "Link",                    remix: "RiLinkM",                hugeicons: "Link02Icon" },

  // ── Resize / Window ──────────────────────────────────────────────────
  Maximize:             { tabler: "IconMaximize",          phosphor: "CornersOut",              remix: "RiFullscreenLine",       hugeicons: "MaximizeScreen01Icon" },
  Minimize:             { tabler: "IconMinimize",          phosphor: "CornersIn",               remix: "RiFullscreenExitLine",   hugeicons: "MinimizeScreen01Icon" },

  // ── Layout / UI Structure ────────────────────────────────────────────
  Menu:                 { tabler: "IconMenu2",             phosphor: "List",                    remix: "RiMenuLine",             hugeicons: "Menu01Icon" },
  MoreHorizontal:       { tabler: "IconDotsHorizontal",    phosphor: "DotsThree",               remix: "RiMore2Line",            hugeicons: "MoreHorizontalIcon" },
  MoreVertical:         { tabler: "IconDotsVertical",      phosphor: "DotsThreeVertical",       remix: "RiMoreLine",             hugeicons: "MoreVerticalIcon" },
  Ellipsis:             { tabler: "IconDotsHorizontal",    phosphor: "DotsThree",               remix: "RiMore2Line",            hugeicons: "MoreHorizontalIcon" },
  Grid:                 { tabler: "IconGridDots",          phosphor: "GridFour",                remix: "RiGridLine",             hugeicons: "Grid01Icon" },
  LayoutGrid:           { tabler: "IconGridDots",          phosphor: "GridFour",                remix: "RiLayoutGridLine",       hugeicons: "GridViewIcon" },
  Layout:               { tabler: "IconLayout",            phosphor: "Layout",                  remix: "RiLayoutLine",           hugeicons: "Layout01Icon" },
  Sidebar:              { tabler: "IconLayoutSidebar",     phosphor: "SidebarSimple",           remix: "RiLayoutLeftLine",       hugeicons: "Sidebar01Icon" },
  PanelLeft:            { tabler: "IconLayoutSidebar",     phosphor: "SidebarSimple",           remix: "RiLayoutLeftLine",       hugeicons: "LeftToRightBlockQuoteIcon" },
  List:                 { tabler: "IconList",              phosphor: "List",                    remix: "RiListUnordered",        hugeicons: "ListViewIcon" },
  Table:                { tabler: "IconTable",             phosphor: "Table",                   remix: "RiTableLine",            hugeicons: "Table01Icon" },
  Filter:               { tabler: "IconFilter",            phosphor: "Funnel",                  remix: "RiFilterLine",           hugeicons: "FilterHorizontalIcon" },
  SortAsc:              { tabler: "IconSortAscending",     phosphor: "SortAscending",           remix: "RiSortAsc",              hugeicons: "SortByUp01Icon" },
  SortDesc:             { tabler: "IconSortDescending",    phosphor: "SortDescending",          remix: "RiSortDesc",             hugeicons: "SortByDown01Icon" },

  // ── Data / Infrastructure ────────────────────────────────────────────
  Database:             { tabler: "IconDatabase",          phosphor: "Database",                remix: "RiDatabaseLine",         hugeicons: "Database01Icon" },
  Server:               { tabler: "IconServer",            phosphor: "HardDrives",              remix: "RiServerLine",           hugeicons: "Server01Icon" },
  Cloud:                { tabler: "IconCloud",             phosphor: "Cloud",                   remix: "RiCloudLine",            hugeicons: "Cloud01Icon" },
  CloudOff:             { tabler: "IconCloudOff",          phosphor: "CloudSlash",              remix: "RiCloudOffLine",         hugeicons: "Cloud02Icon" },
  Wifi:                 { tabler: "IconWifi",              phosphor: "Wifi",                    remix: "RiWifiLine",             hugeicons: "Wifi01Icon" },
  WifiOff:              { tabler: "IconWifiOff",           phosphor: "WifiX",                   remix: "RiWifiOffLine",          hugeicons: "WifiOff01Icon" },
  Bluetooth:            { tabler: "IconBluetooth",         phosphor: "Bluetooth",               remix: "RiBluetoothLine",        hugeicons: "BluetoothIcon" },

  // ── Media / Playback ─────────────────────────────────────────────────
  Play:                 { tabler: "IconPlayerPlay",        phosphor: "Play",                    remix: "RiPlayLine",             hugeicons: "Play01Icon" },
  Pause:                { tabler: "IconPlayerPause",       phosphor: "Pause",                   remix: "RiPauseLine",            hugeicons: "PauseIcon" },
  Stop:                 { tabler: "IconPlayerStop",        phosphor: "Stop",                    remix: "RiStopLine",             hugeicons: "StopIcon" },
  SkipBack:             { tabler: "IconPlayerSkipBack",    phosphor: "SkipBack",                remix: "RiSkipBackLine",         hugeicons: "PreviousIcon" },
  SkipForward:          { tabler: "IconPlayerSkipForward", phosphor: "SkipForward",             remix: "RiSkipForwardLine",      hugeicons: "NextIcon" },
  Volume:               { tabler: "IconVolume",            phosphor: "Speaker",                 remix: "RiVolumeMuteLine",       hugeicons: "Volume01Icon" },
  Volume2:              { tabler: "IconVolume2",           phosphor: "SpeakerHigh",             remix: "RiVolumeUpLine",         hugeicons: "Volume02Icon" },
  VolumeX:              { tabler: "IconVolumeOff",         phosphor: "SpeakerX",                remix: "RiVolumeMuteLine",       hugeicons: "VolumeMuteIcon" },
  Mic:                  { tabler: "IconMicrophone",        phosphor: "Microphone",              remix: "RiMicLine",              hugeicons: "Microphone01Icon" },
  MicOff:               { tabler: "IconMicrophoneOff",     phosphor: "MicrophoneSlash",         remix: "RiMicOffLine",           hugeicons: "MicrophoneMuteIcon" },

  // ── Devices ──────────────────────────────────────────────────────────
  Monitor:              { tabler: "IconDeviceDesktop",     phosphor: "Monitor",                 remix: "RiComputerLine",         hugeicons: "ComputerIcon" },
  Smartphone:           { tabler: "IconDeviceMobile",      phosphor: "DeviceMobile",            remix: "RiSmartphoneLine",       hugeicons: "SmartPhone01Icon" },
  Tablet:               { tabler: "IconDeviceTablet",      phosphor: "DeviceTablet",            remix: "RiTabletLine",           hugeicons: "Tablet01Icon" },
  Laptop:               { tabler: "IconDeviceLaptop",      phosphor: "Laptop",                  remix: "RiMacbookLine",          hugeicons: "Laptop01Icon" },
  Camera:               { tabler: "IconCamera",            phosphor: "Camera",                  remix: "RiCameraLine",           hugeicons: "Camera01Icon" },

  // ── Media Content ────────────────────────────────────────────────────
  Image:                { tabler: "IconPhoto",             phosphor: "Image",                   remix: "RiImageLine",            hugeicons: "Image01Icon" },
  Video:                { tabler: "IconVideo",             phosphor: "Video",                   remix: "RiVideoLine",            hugeicons: "Video01Icon" },

  // ── Date / Time ──────────────────────────────────────────────────────
  Calendar:             { tabler: "IconCalendar",          phosphor: "Calendar",                remix: "RiCalendarLine",         hugeicons: "Calendar01Icon" },
  Clock:                { tabler: "IconClock",             phosphor: "Clock",                   remix: "RiTimeLine",             hugeicons: "Clock01Icon" },
  Timer:                { tabler: "IconTimer",             phosphor: "Timer",                   remix: "RiTimerLine",            hugeicons: "Timer01Icon" },
  AlarmClock:           { tabler: "IconAlarm",             phosphor: "Alarm",                   remix: "RiAlarmLine",            hugeicons: "AlarmClockIcon" },
  History:              { tabler: "IconHistory",           phosphor: "ClockCounterClockwise",   remix: "RiHistoryLine",          hugeicons: "TimeHistoryIcon" },

  // ── Charts / Analytics ───────────────────────────────────────────────
  Chart:                { tabler: "IconChartBar",          phosphor: "ChartBar",                remix: "RiBarChartLine",         hugeicons: "Chart01Icon" },
  BarChart:             { tabler: "IconChartBar",          phosphor: "ChartBar",                remix: "RiBarChartLine",         hugeicons: "BarChart01Icon" },
  BarChart2:            { tabler: "IconChartBar2",         phosphor: "ChartBar",                remix: "RiBarChart2Line",        hugeicons: "BarChart02Icon" },
  LineChart:            { tabler: "IconChartLine",         phosphor: "ChartLine",               remix: "RiLineChartLine",        hugeicons: "ChartLineData01Icon" },
  PieChart:             { tabler: "IconChartPie",          phosphor: "ChartPie",                remix: "RiPieChartLine",         hugeicons: "PieChartIcon" },
  TrendingUp:           { tabler: "IconTrendingUp",        phosphor: "TrendUp",                 remix: "RiLineChartLine",        hugeicons: "TrendingUp01Icon" },
  TrendingDown:         { tabler: "IconTrendingDown",      phosphor: "TrendDown",               remix: "RiLineChartLine",        hugeicons: "TrendingDown01Icon" },

  // ── Commerce ─────────────────────────────────────────────────────────
  DollarSign:           { tabler: "IconCurrencyDollar",    phosphor: "CurrencyDollar",          remix: "RiMoneyDollarCircleLine", hugeicons: "Dollar01Icon" },
  CreditCard:           { tabler: "IconCreditCard",        phosphor: "CreditCard",              remix: "RiBankCardLine",         hugeicons: "CreditCardIcon" },
  ShoppingCart:         { tabler: "IconShoppingCart",      phosphor: "ShoppingCart",            remix: "RiShoppingCartLine",     hugeicons: "ShoppingCart01Icon" },
  ShoppingBag:          { tabler: "IconShoppingBag",       phosphor: "ShoppingBag",             remix: "RiShoppingBagLine",      hugeicons: "ShoppingBag01Icon" },
  Package:              { tabler: "IconPackage",           phosphor: "Package",                 remix: "RiGiftLine",             hugeicons: "Package01Icon" },

  // ── Social / Engagement ──────────────────────────────────────────────
  Star:                 { tabler: "IconStar",              phosphor: "Star",                    remix: "RiStarLine",             hugeicons: "Star01Icon" },
  Heart:                { tabler: "IconHeart",             phosphor: "Heart",                   remix: "RiHeartLine",            hugeicons: "FavouriteIcon" },
  Bookmark:             { tabler: "IconBookmark",          phosphor: "Bookmark",                remix: "RiBookmarkLine",         hugeicons: "Bookmark01Icon" },
  Tag:                  { tabler: "IconTag",               phosphor: "Tag",                     remix: "RiPriceTagLine",         hugeicons: "Tag01Icon" },
  Tags:                 { tabler: "IconTags",              phosphor: "Tag",                     remix: "RiPriceTags2Line",       hugeicons: "Tag02Icon" },
  Flag:                 { tabler: "IconFlag",              phosphor: "Flag",                    remix: "RiFlagLine",             hugeicons: "Flag01Icon" },
  Ban:                  { tabler: "IconBan",               phosphor: "Prohibit",                remix: "RiForbidLine",           hugeicons: "BlockedIcon" },
};

const LIBRARY_PKG = {
  lucide:     "lucide-react",
  tabler:     "@tabler/icons-react",
  phosphor:   "@phosphor-icons/react",
  remix:      "@remixicon/react",
  hugeicons:  "@hugeicons/core-free-icons",  // icons live here, not @hugeicons/react
};

// Detect slug from .designsync.json or env
let dsSlug = process.env.DESIGNSYNC_SLUG || "";

const dsConfigPath = path.join(projectRoot, ".designsync.json");
let dsConfig = {};
if (fs.existsSync(dsConfigPath)) {
  try {
    dsConfig = JSON.parse(fs.readFileSync(dsConfigPath, "utf-8"));
    if (!dsSlug) dsSlug = dsConfig.slug || "";
  } catch {}
}

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

// Rewrite lucide imports in a single file, returns whether file was changed
function rewriteIconImports(filePath, targetPkg, lib) {
  let content = fs.readFileSync(filePath, "utf-8");
  if (!content.includes("lucide-react")) return false;
  const next = content.replace(
    /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g,
    (_match, importList) => {
      const icons = importList.split(",").map((s) => s.trim()).filter(Boolean);
      const mapped = icons.map((icon) => {
        const aliasMatch = icon.match(/^(\S+)\s+as\s+(\S+)$/);
        const baseName = aliasMatch ? aliasMatch[1] : icon;
        const userAlias = aliasMatch ? aliasMatch[2] : null;

        const entry = ICON_MAP[baseName];
        if (!entry || !entry[lib]) return icon;
        const newName = entry[lib];

        if (newName === baseName) return icon; // no change needed
        // If user had an alias, keep their alias: `NewName as userAlias`
        // If no alias, rename with original name as alias: `NewName as baseName`
        const alias = userAlias || baseName;
        return `${newName} as ${alias}`;
      });
      return `import { ${mapped.join(", ")} } from "${targetPkg}"`;
    }
  );
  if (next !== content) {
    fs.writeFileSync(filePath, next);
    return true;
  }
  return false;
}

if (iconLibrary !== "lucide") {
  const targetPkg = LIBRARY_PKG[iconLibrary];
  if (targetPkg) {
    let rewritten = 0;
    const srcDir = useSrc ? path.join(projectRoot, "src") : projectRoot;
    const exts = [".tsx", ".ts", ".jsx", ".js"];
    const allFiles = walkSrcFiles(srcDir, exts);

    for (const filePath of allFiles) {
      try {
        if (rewriteIconImports(filePath, targetPkg, iconLibrary)) rewritten++;
      } catch {}
    }

    // Install the non-lucide icon package
    try {
      const iconInstallCmd = buildInstallCommand(pkgManager, [targetPkg]);
      execSync(iconInstallCmd, { cwd: projectRoot, stdio: "ignore" });
    } catch {}

    console.log(`  [2/6] Icon library: ${iconLibrary} (${rewritten} files rewritten across all src/)`);
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
  const tokenUrl = `${CDN}/r/${dsSlug}/designsync-tokens.css`;
  let cssContent = fs.readFileSync(cssFile, "utf-8");

  // Remove previous designsync injections
  cssContent = cssContent.replace(/^@import\s+url\(["'][^"']*designsync-tokens\.css["']\)[^;\n]*;?[ \t]*\n([ \t]*\n)*/m, "");
  cssContent = cssContent.replace(/\/\* designsync-theme-start \*\/[\s\S]*?\/\* designsync-theme-end \*\/[ \t]*\n([ \t]*\n)*/m, "");

  try {
    // Fetch token CSS at install time — no runtime server dependency
    let tokenCss = await fetchText(tokenUrl);

    // Download fonts locally → rewrite to /fonts/filename
    const { css: localizedCss, fontsDownloaded } = await localizefonts(tokenCss, projectRoot);
    tokenCss = localizedCss;

    // Separate out @import lines (Google Fonts etc.) — must stay at top per CSS spec
    const importLines = [];
    const tokenBody = tokenCss.replace(/^@import\s+url\([^)]+\);?[ \t]*\n?/gm, (m) => {
      importLines.push(m.trim());
      return "";
    }).trim();

    const themeBlock = [
      "/* designsync-theme-start */",
      ...importLines,
      tokenBody,
      `${themeInlineBlock}`,
      "/* designsync-theme-end */",
    ].join("\n");

    const tailwindV4Regex = /(@import\s+["']tailwindcss["'];?[ \t]*\n?)/;
    const tailwindV3Regex = /(@tailwind\s+base;?[ \t]*\n?)/;

    if (tailwindV4Regex.test(cssContent)) {
      cssContent = cssContent.replace(tailwindV4Regex, `$1\n${themeBlock}\n\n`);
    } else if (tailwindV3Regex.test(cssContent)) {
      cssContent = cssContent.replace(tailwindV3Regex, `${themeBlock}\n\n$1`);
    } else {
      cssContent = themeBlock + "\n\n" + cssContent;
    }

    fs.writeFileSync(cssFile, cssContent);
    console.log(`  [3/6] Tokens inlined (${fontsDownloaded} fonts downloaded to public/fonts/)`);
  } catch (e) {
    console.log(`  [3/6] Token fetch failed (${e.message}) — skipping`);
  }
} else if (cssFile) {
  console.log("  [3/6] Skipped (set DESIGNSYNC_SLUG env or create .designsync.json)");
} else {
  console.log("  [3/6] Skipped (CSS file not found)");
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
      const pluginFileDest = path.join(projectRoot, "designsync-eslint.cjs");
      fs.copyFileSync(pluginSrc, pluginFileDest);

      const projPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
      const isESM = projPkg.type === "module";

      const importLine = isESM
        ? `import { createRequire } from "module";\nconst __require = createRequire(import.meta.url);\nconst designsync = __require("./designsync-eslint.cjs");\n`
        : `const designsync = require("./designsync-eslint.cjs");\n`;
      const configBlock = `  designsync,\n`;

      const lastImportIdx = eslintConfig.lastIndexOf("import ");
      const lineEnd = eslintConfig.indexOf("\n", lastImportIdx);
      eslintConfig = eslintConfig.slice(0, lineEnd + 1) + importLine + eslintConfig.slice(lineEnd + 1);

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

// ── 6a. Tailwind class token migration ───────────────────────────────
const CLASS_MAP = {
  // Color – background
  'bg-white':                   'bg-background',
  'bg-gray-50':                 'bg-background',
  'bg-slate-50':                'bg-background',
  'bg-[#fafafa]':               'bg-background',
  'bg-[#fff]':                  'bg-background',
  'bg-gray-100':                'bg-muted',
  'bg-slate-100':               'bg-muted',
  'bg-gray-200':                'bg-muted',
  'bg-blue-600':                'bg-primary',
  'bg-indigo-600':              'bg-primary',
  'bg-red-600':                 'bg-destructive',
  'bg-red-500':                 'bg-destructive',
  'bg-blue-50':                 'bg-accent',
  'bg-indigo-50':               'bg-accent',

  // Color – text
  'text-gray-900':              'text-foreground',
  'text-gray-800':              'text-foreground',
  'text-black':                 'text-foreground',
  'text-gray-600':              'text-muted-foreground',
  'text-gray-500':              'text-muted-foreground',
  'text-gray-400':              'text-muted-foreground',
  'text-white':                 'text-primary-foreground',
  'text-blue-600':              'text-primary',
  'text-red-600':               'text-destructive',

  // Color – border
  'border-gray-200':            'border-border',
  'border-gray-100':            'border-border',
  'border-[#e5e5e5]':           'border-border',
  'border-gray-300':            'border-input',
  'border-[#ddd]':              'border-input',

  // Color – hover
  'hover:bg-gray-50':           'hover:bg-accent',
  'hover:bg-gray-100':          'hover:bg-accent',

  // Height tokens
  'h-8':                        'h-[var(--ds-button-h-sm)]',
  'h-9':                        'h-[var(--ds-button-h-default)]',
  'h-10':                       'h-[var(--ds-button-h-default)]',
  'h-12':                       'h-[var(--ds-button-h-lg)]',

  // Border radius tokens
  'rounded-md':                 'rounded-[var(--ds-element-radius)]',
  'rounded-lg':                 'rounded-[var(--ds-card-radius)]',
  'rounded-xl':                 'rounded-[var(--ds-card-radius)]',
  'rounded-2xl':                'rounded-[var(--ds-dialog-radius)]',

  // Padding tokens
  'p-4':                        'p-[var(--ds-card-padding)]',
  'p-5':                        'p-[var(--ds-card-padding)]',
  'p-6':                        'p-[var(--ds-card-padding)]',
  'px-4':                       'px-[var(--ds-card-padding)]',
  'py-4':                       'py-[var(--ds-card-padding)]',

  // Gap tokens
  'gap-4':                      'gap-[var(--ds-section-gap)]',
  'gap-6':                      'gap-[var(--ds-section-gap)]',
  'gap-8':                      'gap-[var(--ds-section-gap)]',

  // Focus ring tokens
  'focus-visible:ring-2':       'focus-visible:ring-[var(--ds-focus-ring-width)]',
  'ring-2':                     'ring-[var(--ds-focus-ring-width)]',
};

function migrateClassTokens(filePath) {
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

// ── 6b. HTML element → DesignSync component migration ────────────────

// Elements to migrate: { tag, component, importPath }
const ELEMENT_MAP = [
  // Buttons
  { tag: "button",   component: "Button",        importPath: "@/components/ui/button" },
  // Form elements
  { tag: "label",    component: "Label",         importPath: "@/components/ui/label" },
  { tag: "textarea", component: "Textarea",      importPath: "@/components/ui/textarea" },
  { tag: "select",   component: "NativeSelect",  importPath: "@/components/ui/native-select" },
  { tag: "input",    component: "Input",         importPath: "@/components/ui/input" },
  // Table elements
  { tag: "table",    component: "Table",         importPath: "@/components/ui/table" },
  { tag: "thead",    component: "TableHeader",   importPath: "@/components/ui/table" },
  { tag: "tbody",    component: "TableBody",     importPath: "@/components/ui/table" },
  { tag: "tfoot",    component: "TableFooter",   importPath: "@/components/ui/table" },
  { tag: "tr",       component: "TableRow",      importPath: "@/components/ui/table" },
  { tag: "th",       component: "TableHead",     importPath: "@/components/ui/table" },
  { tag: "td",       component: "TableCell",     importPath: "@/components/ui/table" },
  { tag: "hr",       component: "Separator",     importPath: "@/components/ui/separator" },
  // Typography
  { tag: "h1",       component: "TypographyH1",  importPath: "@/components/ui/typography" },
  { tag: "h2",       component: "TypographyH2",  importPath: "@/components/ui/typography" },
  { tag: "h3",       component: "TypographyH3",  importPath: "@/components/ui/typography" },
  { tag: "h4",       component: "TypographyH4",  importPath: "@/components/ui/typography" },
  { tag: "p",          component: "TypographyP",          importPath: "@/components/ui/typography" },
  { tag: "blockquote", component: "TypographyBlockquote", importPath: "@/components/ui/typography" },
  { tag: "code",       component: "TypographyCode",       importPath: "@/components/ui/typography" },
  { tag: "ul",         component: "TypographyList",       importPath: "@/components/ui/typography" },
  { tag: "ol",         component: "TypographyList",       importPath: "@/components/ui/typography" },
  { tag: "small",      component: "TypographySmall",      importPath: "@/components/ui/typography" },
  { tag: "kbd",        component: "Kbd",                  importPath: "@/components/ui/kbd" },
];

// (import grouping for shared-path components is handled automatically via neededImports Map)

/**
 * Insert an import statement into a file's source, after the last existing import.
 * Handles "use client" / "use server" directives at the top.
 * Returns the modified content.
 */
function injectImport(content, importStatement) {
  // Find the index of the last import line
  const lines = content.split("\n");
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i])) lastImportLine = i;
  }

  if (lastImportLine >= 0) {
    lines.splice(lastImportLine + 1, 0, importStatement);
    return lines.join("\n");
  }

  // No imports found — insert after "use client"/"use server" directive if present
  const directiveMatch = content.match(/^["']use (client|server)["'];?\s*\n/);
  if (directiveMatch) {
    const insertAt = directiveMatch[0].length;
    return content.slice(0, insertAt) + importStatement + "\n" + content.slice(insertAt);
  }

  // Prepend at top
  return importStatement + "\n" + content;
}

/**
 * Check whether a given import name is already imported from a given path.
 * e.g. already has `import { Button } from "@/components/ui/button"`
 */
function isAlreadyImported(content, name, importPath) {
  // Match both named imports from that path
  const re = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${importPath.replace(/\//g, "\\/")}["']`);
  return re.test(content);
}


/**
 * Replace raw HTML element tags with DesignSync component names in JSX.
 * Skips replacements inside JS comments (// and block comments).
 * Returns { content, changed }.
 */
function replaceElementTags(content, tag, component) {
  // Opening tag: <button  →  <Button  (only JSX, i.e. followed by space, / or >)
  // Closing tag: </button>  →  </Button>
  // We use a naive but effective approach: replace outside of comment blocks.
  // Strip comments temporarily is error-prone; instead use word-boundary regex
  // and only match when preceded by < or </ and followed by \s, > or />.

  const openRe  = new RegExp(`<${tag}(\\s|>|/)`, "g");
  const closeRe = new RegExp(`<\\/${tag}>`, "g");

  let changed = false;

  const next1 = content.replace(openRe, (m, after) => {
    changed = true;
    return `<${component}${after}`;
  });

  const next2 = next1.replace(closeRe, () => {
    changed = true;
    return `</${component}>`;
  });

  return { content: next2, changed };
}

function migrateElements(filePath) {
  // Skip DesignSync component files themselves (components/ui/)
  if (filePath.includes(path.sep + "components" + path.sep + "ui" + path.sep)) return false;

  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }

  // Only process JSX/TSX files — plain .ts/.js rarely have JSX elements
  const ext = path.extname(filePath);
  if (ext !== ".tsx" && ext !== ".jsx") return false;

  let fileChanged = false;
  const neededImports = new Map(); // importPath → Set<componentName>

  // NOTE: <input type="checkbox"> is intentionally left as <Input type="checkbox">.
  // Checkbox (Radix) uses onCheckedChange instead of onChange — API mismatch too risky to auto-fix.
  // ESLint will flag <Input type="checkbox"> and guide manual migration to <Checkbox>.

  for (const { tag, component, importPath } of ELEMENT_MAP) {
    const { content: next, changed } = replaceElementTags(content, tag, component);
    if (changed) {
      content = next;
      fileChanged = true;
      if (!neededImports.has(importPath)) neededImports.set(importPath, new Set());
      neededImports.get(importPath).add(component);
    }
  }

  if (!fileChanged) return false;

  // Inject missing imports
  for (const [importPath, components] of neededImports.entries()) {
    // For Typography: group all typography components into one import
    const toImport = [...components].filter((c) => !isAlreadyImported(content, c, importPath));
    if (toImport.length === 0) continue;

    // Check whether there's already a partial import from this path we should extend
    // No "g" flag — we use it for both exec() and replace() on the same string
    const existingImportRe = new RegExp(
      `(import\\s*\\{)([^}]*)(\\}\\s*from\\s*["']${importPath.replace(/\//g, "\\/")}["'])`
    );
    const existingMatch = existingImportRe.exec(content);
    if (existingMatch) {
      // Extend existing import
      const alreadyThere = existingMatch[2].split(",").map((s) => s.trim()).filter(Boolean);
      const merged = [...new Set([...alreadyThere, ...toImport])];
      content = content.replace(existingImportRe, `${existingMatch[1]} ${merged.join(", ")} ${existingMatch[3]}`);
    } else {
      const stmt = `import { ${toImport.join(", ")} } from "${importPath}";`;
      content = injectImport(content, stmt);
    }
  }

  try {
    fs.writeFileSync(filePath, content);
  } catch {
    return false;
  }
  return true;
}

// ── Run 6a + 6b across all src files ─────────────────────────────────
try {
  const srcDir = useSrc ? path.join(projectRoot, "src") : projectRoot;
  const exts = [".tsx", ".ts", ".jsx", ".js"];
  let classTokenMigrated = 0;
  let elementMigrated = 0;

  const elementCounters = {};
  for (const { tag } of ELEMENT_MAP) {
    elementCounters[tag] = 0;
  }

  const allFiles = walkSrcFiles(srcDir, exts);

  for (const filePath of allFiles) {
    try {
      if (migrateClassTokens(filePath)) classTokenMigrated++;
    } catch {}

    try {
      // Track per-element counts for logging
      const ext = path.extname(filePath);
      if (ext === ".tsx" || ext === ".jsx") {
        // Skip components/ui/
        if (!filePath.includes(path.sep + "components" + path.sep + "ui" + path.sep)) {
          let content = fs.readFileSync(filePath, "utf-8");
          for (const { tag } of ELEMENT_MAP) {
            const openRe = new RegExp(`<${tag}(\\s|>|/)`, "g");
            if (openRe.test(content)) elementCounters[tag]++;
          }
          if (migrateElements(filePath)) {
            elementMigrated++;
          }
        }
      }
    } catch {}
  }

  const elementSummary = ELEMENT_MAP
    .filter(({ tag }) => elementCounters[tag] > 0)
    .map(({ tag, component }) => `${tag}→${component}`)
    .join(", ");

  console.log(`  [6/6] Class tokens: ${classTokenMigrated} files migrated`);
  if (elementMigrated > 0) {
    console.log(`  [6/6] Elements: ${elementMigrated} files migrated (${elementSummary || "none"})`);
  } else {
    console.log(`  [6/6] Elements: no raw HTML elements found to migrate`);
  }
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

console.log("  [done] DesignSync setup complete!");
console.log("");

if (!dsSlug) {
  console.log("  Tip: To enable live token sync, run:");
  console.log(`  DESIGNSYNC_SLUG=your-slug ${pkgManager} install github:IlYeoLee/designsync-ui`);
  console.log("  Get your slug from https://designsync-omega.vercel.app");
  console.log("");
}

process.chdir(origCwd);
