#!/usr/bin/env node
/**
 * DesignSync AI Migration Script — High Accuracy Mode
 *
 * 사용법:
 *   node designsync-migrate.mjs [src 디렉토리]
 *   node designsync-migrate.mjs [src 디렉토리] --visual   ← 스크린샷 + Vision AI
 *
 * API 키 없이 DesignSync 서버 사용 (무료):
 *   DESIGNSYNC_SLUG=xxxx node designsync-migrate.mjs src
 *
 * 직접 API 사용:
 *   ANTHROPIC_API_KEY=sk-ant-... node designsync-migrate.mjs src
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, extname, basename, dirname, resolve } from "path";
import { execSync } from "child_process";

const DESIGNSYNC_SERVER = "https://designsync-omega.vercel.app/r/migrate";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const VISUAL_MODE   = process.argv.includes("--visual");
const srcDir        = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || "src";

// ── System prompt (compact version for local script) ─────────────────
const SYSTEM_PROMPT = `You are a DesignSync migration assistant.
Rewrite the given React/Next.js JSX/TSX file to use DesignSync design tokens and components.

CRITICAL RULES:
- Fix ONLY UI/styling. Do NOT change any logic, state, props, event handlers, or data.
- Return ONLY the complete migrated file content. No explanation. No markdown fences.
- ALWAYS specify Button variant — NEVER leave it unset (default=primary pill, usually wrong):

3-TIER MIGRATION STRATEGY:
TIER 1 (full replacement): pattern exactly matches DS component → replace entirely
TIER 2 (partial): similar but custom details → use DS component as wrapper + className overrides
TIER 3 (token-only): no DS component matches → keep original HTML, ONLY replace hardcoded values with tokens
  bg-blue-600→bg-primary, text-gray-500→text-muted-foreground, rounded-lg→rounded-[var(--ds-card-radius)], etc.
RULE: NEVER force a wrong DS component. Token-only (Tier 3) is always better than wrong component.
  - Main CTA / form submit → variant="default"
  - Secondary / bordered   → variant="outline"
  - Nav / sidebar / icon   → variant="ghost" (or size="icon")
  - Destructive            → variant="destructive"
  - Unsure                 → variant="ghost"

COLOR TOKENS:
bg-blue-600/indigo-600/violet-600 → bg-primary
bg-white/gray-50                  → bg-background
bg-gray-100/slate-100             → bg-muted
bg-gray-900/slate-900             → bg-card
bg-red-600/red-500                → bg-destructive
text-gray-900/black               → text-foreground
text-gray-500/gray-400            → text-muted-foreground
text-blue-600/indigo-600          → text-primary
text-red-600                      → text-destructive
border-gray-200/gray-100          → border-border
border-gray-300                   → border-input

SPACING/RADIUS/HEIGHT:
rounded-xl/lg (card)   → rounded-[var(--ds-card-radius)]
rounded-md (button)    → rounded-[var(--ds-button-radius)]
rounded-md (input)     → rounded-[var(--ds-input-radius)]
h-9/h-10 (button)      → h-[var(--ds-button-h-default)]
h-8 (small button)     → h-[var(--ds-button-h-sm)]
h-9 (input)            → h-[var(--ds-input-h)]
p-6/p-5 (card)         → p-[var(--ds-card-padding)]
gap-4/gap-6 (section)  → gap-[var(--ds-section-gap)]
gap-2/gap-3 (internal) → gap-[var(--ds-internal-gap)]

HTML → COMPONENT (always import):
<button>     → <Button variant="ghost">          @/components/ui/button
<input>      → <Input>                           @/components/ui/input
<textarea>   → <Textarea>                        @/components/ui/textarea
<select>     → <NativeSelect>                    @/components/ui/native-select
<label>      → <Label>                           @/components/ui/label
<h1>~<h4>   → <TypographyH1>~<TypographyH4>     @/components/ui/typography
<p>          → <TypographyP>                     @/components/ui/typography
<ul>/<ol>   → <TypographyList>                   @/components/ui/typography
<blockquote> → <TypographyBlockquote>            @/components/ui/typography
<code>       → <TypographyCode>                  @/components/ui/typography
<small>      → <TypographySmall>                 @/components/ui/typography
<kbd>        → <Kbd>                             @/components/ui/kbd
<hr>         → <Separator>                       @/components/ui/separator
<table>~<td> → Table/TableHeader/.../TableCell   @/components/ui/table
<input type="checkbox"> → <Checkbox onCheckedChange={...}> @/components/ui/checkbox
<input type="radio">    → <RadioGroup><RadioGroupItem>     @/components/ui/radio-group
<input type="range">    → <Slider>               @/components/ui/slider
<input type="date">     → <DatePicker>           @/components/ui/date-picker
<progress>   → <Progress>                        @/components/ui/progress
<nav>        → <NavigationMenu>                  @/components/ui/navigation-menu

PATTERN → COMPONENT:
div border+rounded+shadow   → <Card><CardHeader><CardTitle/></CardHeader><CardContent/></Card>  @/components/ui/card
fixed inset-0 overlay+modal → <Dialog>...<DialogContent>...</DialogContent></Dialog>  @/components/ui/dialog
fixed right/left panel      → <Sheet>...<SheetContent>...</SheetContent></Sheet>       @/components/ui/sheet
confirm/cancel modal        → <AlertDialog>...<AlertDialogAction/><AlertDialogCancel/></AlertDialog>  @/components/ui/alert-dialog
absolute dropdown on click  → <DropdownMenu>...<DropdownMenuContent>...</DropdownMenuContent></DropdownMenu>  @/components/ui/dropdown-menu
right-click menu            → <ContextMenu>...<ContextMenuContent>...</ContextMenuContent></ContextMenu>  @/components/ui/context-menu
hover tooltip               → <Tooltip><TooltipTrigger asChild>...<TooltipContent>...</TooltipContent></Tooltip>  @/components/ui/tooltip
popover panel               → <Popover><PopoverTrigger asChild>...<PopoverContent>...</PopoverContent></Popover>  @/components/ui/popover
border-b tabs               → <Tabs><TabsList variant="underline"><TabsTrigger>...</TabsTrigger></TabsList><TabsContent/></Tabs>  @/components/ui/tabs
pill tabs                   → <Tabs><TabsList variant="pill"><TabsTrigger>...</TabsTrigger></TabsList><TabsContent/></Tabs>  @/components/ui/tabs
accordion expand/collapse   → <Accordion><AccordionItem><AccordionTrigger/><AccordionContent/></AccordionItem></Accordion>  @/components/ui/accordion
animate-pulse div           → <Skeleton>  @/components/ui/skeleton
role="alert" div            → <Alert><AlertTitle/><AlertDescription/></Alert>  @/components/ui/alert
animate-spin div            → <Spinner>   @/components/ui/spinner
span text-xs+rounded+bg     → <Badge>     @/components/ui/badge
div rounded-full+img        → <Avatar><AvatarImage/><AvatarFallback>XX</AvatarFallback></Avatar>  @/components/ui/avatar
custom toggle switch        → <Switch checked={...} onCheckedChange={...}>  @/components/ui/switch
searchable select           → <Combobox options={[{value,label}]} value={...} onValueChange={...}/>  @/components/ui/combobox
empty state                 → <Empty><EmptyIcon/><EmptyTitle/><EmptyDescription/><EmptyActions/></Empty>  @/components/ui/empty
scrollable area             → <ScrollArea>  @/components/ui/scroll-area
breadcrumb a>a>current      → <Breadcrumb><BreadcrumbList>...<BreadcrumbSeparator/>...</BreadcrumbList></Breadcrumb>  @/components/ui/breadcrumb
pagination prev/next        → <Pagination><PaginationContent><PaginationPrevious/><PaginationNext/></PaginationContent></Pagination>  @/components/ui/pagination
toast/notification          → import { toast } from "sonner"; toast("msg")  sonner
SVG/canvas chart            → <ChartContainer config={chartConfig}> + recharts  @/components/ui/chart

COMPLEX (reconstruct):
table+.map() rows    → const columns=[{accessorKey,header}]; <DataTable columns={columns} data={data}/>  @/components/ui/data-table
overflow-hidden+prev/next slider → <Carousel><CarouselContent>{items.map(i=><CarouselItem/>)}</CarouselContent><CarouselPrevious/><CarouselNext/></Carousel>  @/components/ui/carousel
search+filtered list → <Command><CommandInput/><CommandList><CommandEmpty/><CommandGroup><CommandItem onSelect={...}/></CommandGroup></CommandList></Command>  @/components/ui/command
N single-char inputs → <InputOTP maxLength={N}><InputOTPGroup><InputOTPSlot index={0}/>...</InputOTPGroup></InputOTP>  @/components/ui/input-otp
useForm() form       → <Form {...form}><FormField control={form.control} name="x" render={({field})=><FormItem><FormLabel/><FormControl><Input {...field}/></FormControl><FormMessage/></FormItem>}/></Form>  @/components/ui/form
top menubar dropdowns → <Menubar><MenubarMenu><MenubarTrigger/><MenubarContent><MenubarItem/></MenubarContent></MenubarMenu></Menubar>  @/components/ui/menubar
<aside> side nav     → <Sidebar><SidebarHeader/><SidebarContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild/></SidebarMenuItem></SidebarMenu></SidebarContent></Sidebar>  @/components/ui/sidebar
<header> top nav     → <Header><HeaderBrand/><HeaderNav><HeaderNavItem/></HeaderNav><HeaderActions/></Header>  @/components/ui/header`;

// ── Screenshot capture (Playwright) ──────────────────────────────────
async function captureScreenshot(url) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    await browser.close();
    return screenshot.toString("base64");
  } catch {
    return null;
  }
}

// Find the dev server URL from package.json scripts or common ports
async function findDevUrl(projectRoot) {
  const ports = [3000, 3001, 5173, 8080, 4000];
  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status < 500) return `http://localhost:${port}`;
    } catch {}
  }
  return null;
}

// Guess the URL path for a given file
function guessPageUrl(filePath, baseUrl) {
  // Next.js app router: app/dashboard/page.tsx → /dashboard
  const appMatch = filePath.match(/app[/\\](.+)[/\\]page\.[tj]sx?$/);
  if (appMatch) return baseUrl + "/" + appMatch[1].replace(/[/\\]/g, "/");
  // Next.js pages router: pages/dashboard.tsx → /dashboard
  const pagesMatch = filePath.match(/pages[/\\](.+)\.[tj]sx?$/);
  if (pagesMatch) return baseUrl + "/" + pagesMatch[1].replace(/[/\\]/g, "/").replace(/\/index$/, "");
  return null;
}

// ── AI migration functions ────────────────────────────────────────────
async function migrateViaServer(content, filename, screenshotB64) {
  const res = await fetch(DESIGNSYNC_SERVER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, filename, screenshot: screenshotB64 || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server ${res.status}`);
  }
  const { migrated } = await res.json();
  return migrated;
}

async function migrateViaAnthropic(content, filename, screenshotB64) {
  const userContent = [];

  if (screenshotB64) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: screenshotB64 },
    });
    userContent.push({
      type: "text",
      text: `This is a screenshot of the rendered UI. Use it to understand the visual patterns (modals, dropdowns, tabs, cards, etc.) and choose the correct DesignSync components.\n\nNow migrate this file (${filename}):\n\n${content}`,
    });
  } else {
    userContent.push({
      type: "text",
      text: `Migrate this file (${filename}):\n\n${content}`,
    });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

async function migrateViaOpenAI(content, filename, screenshotB64) {
  const userContent = [];
  if (screenshotB64) {
    userContent.push({ type: "image_url", image_url: { url: `data:image/png;base64,${screenshotB64}` } });
  }
  userContent.push({ type: "text", text: `Migrate this file (${filename}):\n\n${content}` });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 16000,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userContent }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function migrate(content, filename, screenshotB64) {
  const raw = ANTHROPIC_KEY
    ? await migrateViaAnthropic(content, filename, screenshotB64)
    : OPENAI_KEY
    ? await migrateViaOpenAI(content, filename, screenshotB64)
    : await migrateViaServer(content, filename, screenshotB64);
  return raw.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, "");
}

// ── Group migration (multi-file) ─────────────────────────────────────

// Parse relative imports from a file
function parseRelativeImports(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const importRe = /from\s+["'](\.[^"']+)["']/g;
    const deps = [];
    let m;
    while ((m = importRe.exec(content)) !== null) {
      const rel = m[1];
      const base = dirname(filePath);
      const exts = [".tsx", ".ts", ".jsx", ".js", ""];
      for (const ext of exts) {
        const candidate = resolve(base, rel + ext);
        if (existsSync(candidate)) { deps.push(candidate); break; }
        // Try index file
        const idx = resolve(base, rel, "index" + (ext || ".tsx"));
        if (existsSync(idx)) { deps.push(idx); break; }
      }
    }
    return deps;
  } catch { return []; }
}

// Build connected component groups from import graph
function buildFileGroups(allFiles) {
  const fileSet = new Set(allFiles.map(f => resolve(f)));
  const adj = new Map();

  for (const f of allFiles) {
    const abs = resolve(f);
    if (!adj.has(abs)) adj.set(abs, new Set());
    for (const dep of parseRelativeImports(f)) {
      const depAbs = resolve(dep);
      if (!fileSet.has(depAbs)) continue; // only group within our file set
      adj.get(abs).add(depAbs);
      if (!adj.has(depAbs)) adj.set(depAbs, new Set());
      adj.get(depAbs).add(abs); // bidirectional
    }
  }

  // BFS to find connected components
  const visited = new Set();
  const groups = [];

  for (const f of allFiles) {
    const abs = resolve(f);
    if (visited.has(abs)) continue;
    const group = [];
    const queue = [abs];
    visited.add(abs);
    while (queue.length) {
      const curr = queue.shift();
      group.push(curr);
      for (const neighbor of (adj.get(curr) || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    groups.push(group);
  }

  return groups;
}

// Migrate a group of related files together
async function migrateGroup(filePaths, screenshotB64) {
  const files = filePaths.map(fp => ({
    path: fp,
    name: basename(fp),
    content: readFileSync(fp, "utf-8"),
  }));

  const multiFilePrompt = files.map(f =>
    `=== FILE: ${f.name} ===\n${f.content}`
  ).join("\n\n");

  const instruction = `Migrate ALL files below together as a group. They are related components that share state and imports.

Return EACH migrated file in this exact format:
=== FILE: filename.tsx ===
[complete migrated file content]

Files to migrate:
${files.map(f => `- ${f.name}`).join("\n")}

${multiFilePrompt}`;

  const raw = ANTHROPIC_KEY
    ? await migrateViaAnthropic(instruction, `group(${files.map(f=>f.name).join(", ")})`, screenshotB64)
    : OPENAI_KEY
    ? await migrateViaOpenAI(instruction, `group`, screenshotB64)
    : await migrateViaServer(instruction, `group(${files.map(f=>f.name).join(", ")})`, screenshotB64);

  // Parse response back into per-file content
  const results = new Map();
  const sections = raw.split(/=== FILE: ([^=]+) ===/);
  for (let i = 1; i < sections.length; i += 2) {
    const name = sections[i].trim();
    const content = sections[i + 1]?.trim()
      .replace(/^```(?:tsx?|jsx?)?\n?/, "")
      .replace(/\n?```\s*$/, "") || "";
    // Match back to original path by filename
    const match = files.find(f => f.name === name || f.path.endsWith(name));
    if (match && content) results.set(match.path, content);
  }

  // Fallback: if parsing failed, treat whole response as single file
  if (results.size === 0 && files.length === 1) {
    const cleaned = raw.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, "");
    results.set(files[0].path, cleaned);
  }

  return results;
}

// ── ESLint helpers ────────────────────────────────────────────────────
function getViolations(filePath) {
  try {
    const out = execSync(`npx eslint "${filePath}" --format json`, { stdio: ["pipe", "pipe", "pipe"] });
    const results = JSON.parse(out.toString());
    return results[0]?.messages || [];
  } catch (e) {
    try {
      const out = e.stdout?.toString() || "";
      const results = JSON.parse(out);
      return results[0]?.messages || [];
    } catch { return [{ message: "ESLint error" }]; }
  }
}

function hasViolations(filePath) {
  return getViolations(filePath).length > 0;
}

// ── File discovery ────────────────────────────────────────────────────
function findFiles(dir, result = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return result; }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findFiles(full, result);
    else if ([".jsx", ".tsx"].includes(extname(entry))) result.push(full);
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────
const allFiles = findFiles(srcDir);
const mode = ANTHROPIC_KEY ? "Claude 직접" : OPENAI_KEY ? "GPT-4o 직접" : "DesignSync 서버";
const visualTag = VISUAL_MODE ? " + Vision" : "";

console.log(`\n🚀  DesignSync AI Migration (${mode}${visualTag})`);
console.log(`📁  ${srcDir}/ — ${allFiles.length}개 파일\n`);

// Find dev server for visual mode
let devBaseUrl = null;
if (VISUAL_MODE) {
  devBaseUrl = await findDevUrl(resolve(srcDir, ".."));
  if (devBaseUrl) {
    console.log(`📸  Visual mode: dev server at ${devBaseUrl}\n`);
  } else {
    console.log(`📸  Visual mode: dev server not found — text-only fallback\n`);
  }
}

// Check which files need migration
const toMigrate = allFiles.filter((f) => {
  process.stdout.write(`   checking ${f}...`);
  const v = hasViolations(f);
  process.stdout.write(v ? " ⚠️\n" : " ✅\n");
  return v;
});

if (toMigrate.length === 0) {
  console.log("\n✅  모두 완료 — DesignSync 규칙 준수 중!");
  process.exit(0);
}

// Build import-based groups from files that need migration
const toMigrateSet = new Set(toMigrate.map(f => resolve(f)));
const allGroups = buildFileGroups(toMigrate);

// Filter groups: only include files that need migration
const groups = allGroups.map(g => g.filter(f => toMigrateSet.has(resolve(f)))).filter(g => g.length > 0);

const groupCount = groups.filter(g => g.length > 1).length;
console.log(`\n⚡  ${toMigrate.length}개 파일 마이그레이션 (${groupCount}개 그룹 묶음)...\n`);
let done = 0, failed = 0;

async function processSingleFile(filePath, screenshotB64) {
  let content = readFileSync(filePath, "utf-8");
  let migrated = await migrate(content, basename(filePath), screenshotB64);
  writeFileSync(filePath, migrated);

  let attempts = 1;
  while (attempts < 3) {
    const violations = getViolations(filePath);
    if (violations.length === 0) break;
    try { execSync(`npx eslint "${filePath}" --fix --quiet`, { stdio: "pipe" }); } catch {}
    const remaining = getViolations(filePath);
    if (remaining.length === 0) break;
    const violationSummary = remaining.slice(0, 10).map(v => `Line ${v.line}: ${v.message}`).join("\n");
    const retryContent = readFileSync(filePath, "utf-8");
    const raw = await migrate(retryContent, `${basename(filePath)} [retry ${attempts}, fix:\n${violationSummary}]`, screenshotB64);
    writeFileSync(filePath, raw.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, ""));
    attempts++;
  }
  try { execSync(`npx eslint "${filePath}" --fix --quiet`, { stdio: "pipe" }); } catch {}
}

for (const group of groups) {
  const isGroup = group.length > 1;
  const label = isGroup ? `[그룹 ${group.map(f => basename(f)).join(" + ")}]` : group[0];

  process.stdout.write(`   ${label} ...`);
  try {
    // Visual: screenshot for the first page file in group
    let screenshotB64 = null;
    if (VISUAL_MODE && devBaseUrl) {
      for (const fp of group) {
        const pageUrl = guessPageUrl(fp, devBaseUrl);
        if (pageUrl) {
          screenshotB64 = await captureScreenshot(pageUrl);
          if (screenshotB64) { process.stdout.write(" 📸"); break; }
        }
      }
    }

    if (isGroup) {
      // Group migration: send all files together
      const results = await migrateGroup(group, screenshotB64);
      for (const [fp, content] of results) {
        if (content) writeFileSync(fp, content);
      }
      // ESLint fix pass on all files in group
      for (const fp of group) {
        try { execSync(`npx eslint "${fp}" --fix --quiet`, { stdio: "pipe" }); } catch {}
      }
      const violations = group.flatMap(fp => getViolations(fp));
      if (violations.length === 0) {
        process.stdout.write(" ✅\n");
      } else {
        // Retry individually for remaining violations
        for (const fp of group) {
          if (getViolations(fp).length > 0) await processSingleFile(fp, screenshotB64);
        }
        const finalV = group.flatMap(fp => getViolations(fp));
        process.stdout.write(finalV.length === 0 ? " ✅\n" : ` ⚠️  (${finalV.length}개 잔존)\n`);
      }
      done += group.length;
    } else {
      await processSingleFile(group[0], screenshotB64);
      const finalViolations = getViolations(group[0]);
      process.stdout.write(finalViolations.length === 0 ? " ✅\n" : ` ⚠️  (${finalViolations.length}개 잔존)\n`);
      done++;
    }
  } catch (err) {
    process.stdout.write(` ❌ (${err.message})\n`);
    failed += group.length;
  }
  if (done % 10 === 0 && done > 0) await new Promise((r) => setTimeout(r, 1000));
}

console.log(`\n${"━".repeat(50)}`);
console.log(`✅  ${done}개 완료${failed ? `  ❌  ${failed}개 실패` : ""}`);
console.log(`${"━".repeat(50)}\n`);
