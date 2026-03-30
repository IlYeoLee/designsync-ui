#!/usr/bin/env node
/**
 * DesignSync AI Migration Script — v2 High Accuracy + Stability
 *
 * 사용법:
 *   node designsync-migrate.mjs [src]              기본 마이그레이션
 *   node designsync-migrate.mjs [src] --visual     스크린샷 + Vision AI
 *   node designsync-migrate.mjs [src] --dry-run    파일 수정 없이 미리보기
 *   node designsync-migrate.mjs [src] --resume     중단된 마이그레이션 이어서
 *
 * API 키 없이 DesignSync 서버 사용 (무료):
 *   DESIGNSYNC_SLUG=xxxx node designsync-migrate.mjs src
 *
 * 직접 API 사용:
 *   ANTHROPIC_API_KEY=sk-ant-... node designsync-migrate.mjs src
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join, extname, basename, dirname, resolve, relative } from "path";
import { execSync } from "child_process";

const DESIGNSYNC_SERVER = "https://designsync-omega.vercel.app/r/migrate";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const VISUAL_MODE   = process.argv.includes("--visual");
const DRY_RUN       = process.argv.includes("--dry-run");
const RESUME        = process.argv.includes("--resume");
const INTERACTIVE   = process.argv.includes("--interactive");
const srcDir        = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || "src";
const projectRoot   = resolve(srcDir, "..");

// Paths
const BACKUP_DIR    = join(projectRoot, ".designsync-backup");
const PROGRESS_FILE = join(projectRoot, ".designsync-progress.json");
const REPORT_FILE   = join(projectRoot, "designsync-report.md");
const IGNORE_FILE   = join(projectRoot, ".designsync-ignore");

// ── System prompt (compact version for local script) ─────────────────
const SYSTEM_PROMPT = `You are a DesignSync migration assistant.
Rewrite the given React/Next.js JSX/TSX file to use DesignSync design tokens and components.

CRITICAL RULES:
- Fix ONLY UI/styling. Do NOT change any logic, state, props, event handlers, or data.
- Return ONLY the complete migrated file content. No explanation. No markdown fences.
- ALWAYS specify Button variant — NEVER leave it unset (default=primary pill, usually wrong):

BUTTON VARIANT — DETERMINE BY VISUAL ROLE (not by tag):
  - <button> wrapping display text/heading/title → variant="ghost" className="h-auto px-0 hover:bg-transparent"
  - <button> that IS a form submit / primary CTA → variant="default"
  - <button> with border, no fill → variant="outline"
  - <button> in nav/sidebar/toolbar/icon → variant="ghost" (or size="icon")
  - <button variant="destructive"> only for delete/dangerous actions
  - WHEN IN DOUBT → variant="ghost"

TABS VARIANT — ONLY THESE TWO VALUES ARE VALID:
  - Border-bottom underline tabs → variant="underline"  (NOT "line", NOT "border")
  - Pill/segment tabs → variant="pill"
  - NEVER use variant="line", variant="default", or any other string

COMPONENT PROP SAFETY:
  - Before using any prop/variant value, confirm it exists in the component definition
  - If unsure of accepted values → use the most basic/default option or skip the prop entirely
  - NEVER invent prop values that aren't in the DS component API

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

TIER 2 EXAMPLES — DS wrapper + custom inner (copy this pattern):
custom page header (title + actions) →
  <Header>
    <HeaderBrand>{/* editable title, logo, breadcrumb — whatever was here */}</HeaderBrand>
    <HeaderActions>{/* save status, buttons — keep as-is inside */}</HeaderActions>
  </Header>
custom sidebar (list of nav items) →
  <Sidebar>
    <SidebarHeader>{/* logo/title area */}</SidebarHeader>
    <SidebarContent>
      <SidebarMenu>
        {items.map(i => <SidebarMenuItem><SidebarMenuButton asChild><Link href={i.href}>{i.label}</Link></SidebarMenuButton></SidebarMenuItem>)}
      </SidebarMenu>
    </SidebarContent>
  </Sidebar>
custom card (non-standard layout) →
  <Card>
    <CardHeader>{/* keep your custom header markup */}</CardHeader>
    <CardContent>{/* keep your custom content */}</CardContent>
  </Card>
RULE: DS component provides shell/tokens, inner markup stays as needed.
      NEVER restructure inner logic to fit DS — wrap it, don't rewrite it.

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
  return withRetry(async () => {
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
  });
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

let PROJECT_CONTEXT = ""; // set after pre-analysis

async function migrate(content, filename, screenshotB64) {
  const componentNote = COMPONENT_LIST_ADDENDUM || "";
  const contextualContent = PROJECT_CONTEXT
    ? `━━━ PROJECT CONTEXT ━━━\n${PROJECT_CONTEXT}${componentNote}${buildFewShotContext()}\n━━━ END CONTEXT ━━━\n\n${content}`
    : content + componentNote + buildFewShotContext();

  const raw = ANTHROPIC_KEY
    ? await migrateViaAnthropic(contextualContent, filename, screenshotB64)
    : OPENAI_KEY
    ? await migrateViaOpenAI(contextualContent, filename, screenshotB64)
    : await migrateViaServer(contextualContent, filename, screenshotB64);
  return raw.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, "");
}

// ── Pre-analysis pass ────────────────────────────────────────────────

async function analyzeProject(allFiles) {
  // Sample up to 40 files (spread across dirs) for analysis
  const sample = allFiles.length <= 40 ? allFiles : [
    ...allFiles.filter(f => f.includes("layout") || f.includes("sidebar") || f.includes("nav") || f.includes("header")),
    ...allFiles.filter(f => !f.includes("layout") && !f.includes("sidebar") && !f.includes("nav") && !f.includes("header")).slice(0, 30),
  ].slice(0, 40);

  const combined = sample.map(f => {
    try { return `=== ${basename(f)} ===\n${readFileSync(f, "utf-8").slice(0, 1500)}`; }
    catch { return ""; }
  }).filter(Boolean).join("\n\n");

  const prompt = `Analyze this React/Next.js codebase and produce a concise PROJECT CONTEXT document.

For each UI pattern found, note:
1. What custom pattern is used (e.g. "custom modal: fixed inset-0 + bg-black/50")
2. Which files use it
3. Which DesignSync component it should map to
4. Any special considerations (shared state, multi-file, complex nesting)

Also note:
- The icon library used (lucide-react, phosphor, etc.)
- Whether it uses react-hook-form, zod
- Common className patterns repeated everywhere
- Files that are tightly coupled (import each other)

Output format: concise bullet points, max 60 lines. This will be injected into every migration prompt.

Codebase sample:
${combined}`;

  try {
    let analysisRaw = "";
    if (ANTHROPIC_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      analysisRaw = data.content?.[0]?.text || "";
    } else if (OPENAI_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      analysisRaw = data.choices?.[0]?.message?.content || "";
    } else {
      // Use DesignSync server for analysis too
      const res = await fetch(DESIGNSYNC_SERVER, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: combined, filename: "__analysis__" }),
      });
      const data = await res.json().catch(() => ({}));
      analysisRaw = data.migrated || "";
    }
    return analysisRaw.trim();
  } catch { return ""; }
}

// Few-shot context: collect successfully migrated examples
const migratedExamples = []; // { filename, before, after }

function addExample(filename, before, after) {
  if (migratedExamples.length >= 3) return; // keep top 3 only
  migratedExamples.push({ filename, before: before.slice(0, 800), after: after.slice(0, 800) });
}

function buildFewShotContext() {
  if (migratedExamples.length === 0) return "";
  return `\n\n━━━ EXAMPLES FROM THIS PROJECT (already migrated) ━━━\n` +
    migratedExamples.map(e =>
      `--- ${e.filename} BEFORE ---\n${e.before}\n--- ${e.filename} AFTER ---\n${e.after}`
    ).join("\n\n");
}

// TypeScript error feedback
function getTsErrors(filePath) {
  try {
    execSync(`npx tsc --noEmit --skipLibCheck 2>&1 | grep "${basename(filePath)}"`, { stdio: ["pipe", "pipe", "pipe"] });
    return [];
  } catch (e) {
    const out = e.stdout?.toString() || e.stderr?.toString() || "";
    return out.split("\n").filter(l => l.includes(basename(filePath))).slice(0, 5);
  }
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

// ── 2. Component-level chunking ───────────────────────────────────────
// Split a file into top-level exported components/functions
function splitIntoComponents(content) {
  const chunks = [];
  // Match export function/const/default at top level
  const exportRe = /^(export\s+(?:default\s+)?(?:function|const|class|async function)\s+\w[^]*?)(?=\nexport\s+(?:default\s+)?(?:function|const|class|async function)\s+\w|\n*$)/gm;
  let match;
  while ((match = exportRe.exec(content)) !== null) {
    if (match[1].length > 100) chunks.push(match[1].trim());
  }
  // If chunking found meaningful splits (2+), return them; otherwise return whole file
  return chunks.length >= 2 ? chunks : [content];
}

// ── 3. Migration plan pass ────────────────────────────────────────────
async function generateMigrationPlan(groups, allFiles) {
  const fileList = allFiles.slice(0, 30).map(f => {
    try {
      const content = readFileSync(f, "utf-8").slice(0, 600);
      return `${basename(f)}:\n${content}`;
    } catch { return ""; }
  }).filter(Boolean).join("\n\n---\n\n");

  const prompt = `You are a DesignSync migration planner.
Analyze these React files and create a migration plan.

For each file, output ONE line:
filename.tsx | Tier1: Dialog+Card | Tier2: custom-header→Card | Tier3: token-only

Tier1 = full DS component replacement
Tier2 = DS component wrapper + custom inner
Tier3 = keep structure, apply tokens only

Files:
${fileList}`;

  try {
    let planRaw = "";
    if (ANTHROPIC_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      planRaw = data.content?.[0]?.text || "";
    } else if (OPENAI_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      planRaw = data.choices?.[0]?.message?.content || "";
    }
    return planRaw.trim();
  } catch { return ""; }
}

// ── 4. Parallel 2x + vote ─────────────────────────────────────────────
async function migrateWithVote(content, filename, screenshotB64) {
  // Run two migrations in parallel, pick the one with fewer ESLint + TypeScript errors
  const [r1, r2] = await Promise.allSettled([
    migrate(content, filename, screenshotB64),
    migrate(content, filename, screenshotB64),
  ]);
  const candidates = [r1, r2]
    .filter(r => r.status === "fulfilled")
    .map(r => r.value);
  if (candidates.length === 0) throw new Error("Both migrations failed");
  if (candidates.length === 1) return candidates[0];

  // Write to temp files, check violations, pick winner
  const ts = Date.now();
  const tmp1 = `/tmp/ds_vote_a_${ts}.tsx`;
  const tmp2 = `/tmp/ds_vote_b_${ts}.tsx`;
  writeFileSync(tmp1, candidates[0]);
  writeFileSync(tmp2, candidates[1]);
  // Score = ESLint violations + TypeScript errors (lower is better)
  const v1 = getViolations(tmp1).length + getTsErrors(tmp1).length;
  const v2 = getViolations(tmp2).length + getTsErrors(tmp2).length;
  try { execSync(`rm -f "${tmp1}" "${tmp2}"`); } catch {}
  return v1 <= v2 ? candidates[0] : candidates[1];
}

// ── 5. Build error feedback loop ──────────────────────────────────────
async function buildFeedbackLoop(projectRoot, allMigratedFiles) {
  console.log(`\n🔨  빌드 에러 검사 중...`);
  let buildErrors = "";
  try {
    execSync("npm run build 2>&1", { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"], timeout: 120000 });
    console.log(`   빌드 성공 ✅`);
    return;
  } catch (e) {
    buildErrors = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
  }

  // Parse which files have build errors
  const fileErrorMap = new Map();
  const lines = buildErrors.split("\n");
  for (const line of lines) {
    for (const fp of allMigratedFiles) {
      const name = basename(fp);
      if (line.includes(name) && (line.includes("error") || line.includes("Error"))) {
        if (!fileErrorMap.has(fp)) fileErrorMap.set(fp, []);
        fileErrorMap.get(fp).push(line.trim());
      }
    }
  }

  if (fileErrorMap.size === 0) {
    console.log(`   파일 특정 불가 — 빌드 로그:\n${buildErrors.slice(0, 500)}`);
    return;
  }

  console.log(`   ${fileErrorMap.size}개 파일 빌드 에러 → AI 재수정\n`);
  for (const [fp, errors] of fileErrorMap) {
    process.stdout.write(`   fixing ${basename(fp)} ...`);
    try {
      const content = readFileSync(fp, "utf-8");
      const errorSummary = errors.slice(0, 8).join("\n");
      const fixed = await migrate(content, `${basename(fp)} [build errors:\n${errorSummary}]`, null);
      writeFileSync(fp, fixed.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, ""));
      process.stdout.write(" ✅\n");
    } catch {
      process.stdout.write(" ❌\n");
    }
  }

  // Second build check
  try {
    execSync("npm run build 2>&1", { cwd: projectRoot, stdio: "pipe", timeout: 120000 });
    console.log(`   재빌드 성공 ✅`);
  } catch {
    console.log(`   재빌드 실패 — 수동 확인 필요`);
  }
}

// ── Migrate a group of related files together ─────────────────────────
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

// ── Deterministic post-processing ────────────────────────────────────
// Fixes common AI mistakes without another AI call — runs after every migration
function deterministicFix(content) {
  let r = content;

  // 1. Button size="icon" without variant → ghost
  r = r.replace(/<Button\s+size="icon"([^>]*?)>/g, (match, rest) => {
    if (/variant\s*=/.test(rest)) return match;
    return `<Button size="icon" variant="ghost"${rest}>`;
  });
  // 1b. Button wrapping heading/title content (h-auto, px-0 className hints) → ghost
  r = r.replace(/<Button(\s[^>]*)?>/g, (match, attrs = "") => {
    if (/variant\s*=/.test(attrs)) return match;
    if (/h-auto|px-0/.test(attrs)) return `<Button variant="ghost"${attrs}>`;
    return match; // leave other buttons for AI to decide — don't blindly set ghost
  });

  // 2. TabsList invalid variant → fix to closest valid value
  r = r.replace(/variant\s*=\s*["'](line|border|default|tab)["']/g, 'variant="underline"');

  // 3. Button wrapping TypographyH* → must be ghost with no padding
  r = r.replace(
    /(<Button\s[^>]*variant="ghost"[^>]*>)\s*(<TypographyH[1-4])/g,
    (match, btn, typo) => {
      if (btn.includes("h-auto")) return match;
      return btn.replace('variant="ghost"', 'variant="ghost" className="h-auto px-0 hover:bg-transparent"') + "\n      " + typo;
    }
  );

  // 4. Remove markdown code fences if AI accidentally included them
  r = r.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, "");

  // 5. size="icon" without variant → add ghost
  r = r.replace(/<Button\s+size="icon"([^>]*?)>/g, (match, rest) => {
    if (/variant\s*=/.test(rest)) return match;
    return `<Button size="icon" variant="ghost"${rest}>`;
  });

  return r;
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

// ── Ignore list ───────────────────────────────────────────────────────
function loadIgnorePatterns() {
  if (!existsSync(IGNORE_FILE)) return [];
  return readFileSync(IGNORE_FILE, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));
}

function isIgnored(filePath, patterns) {
  const rel = relative(projectRoot, filePath).replace(/\\/g, "/");
  return patterns.some(p => {
    // Support glob-like: *.test.tsx, src/legacy/**, exact paths
    const regex = new RegExp("^" + p.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
    return regex.test(rel);
  });
}

// ── Backup system ─────────────────────────────────────────────────────
function backupFile(filePath) {
  if (DRY_RUN) return;
  const rel = relative(projectRoot, filePath);
  const dest = join(BACKUP_DIR, rel);
  // Create subdirectory structure inside backup dir
  mkdirSync(dirname(dest), { recursive: true });
  // Only backup once (don't overwrite original with already-migrated content)
  if (!existsSync(dest)) copyFileSync(filePath, dest);
}

function restoreFile(filePath) {
  const rel = relative(projectRoot, filePath).replace(/\\/g, "_");
  const src = join(BACKUP_DIR, rel);
  if (existsSync(src)) {
    copyFileSync(src, filePath);
    return true;
  }
  return false;
}

// ── Progress persistence ───────────────────────────────────────────────
function loadProgress() {
  if (!RESUME || !existsSync(PROGRESS_FILE)) return new Set();
  try {
    const data = JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
    return new Set(data.completed || []);
  } catch { return new Set(); }
}

function saveProgress(completedSet) {
  if (DRY_RUN) return;
  writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: [...completedSet], ts: new Date().toISOString() }));
}

// ── Report tracking ────────────────────────────────────────────────────
const reportRows = []; // { file, tier, status, violations }

function recordReport(file, status, violations = 0, notes = "") {
  reportRows.push({ file: relative(projectRoot, file), status, violations, notes });
}

function writeReport() {
  if (DRY_RUN) return;
  const ok = reportRows.filter(r => r.status === "✅");
  const warn = reportRows.filter(r => r.status === "⚠️");
  const fail = reportRows.filter(r => r.status === "❌");
  const skipped = reportRows.filter(r => r.status === "skipped");
  const rolled = reportRows.filter(r => r.status === "rolled-back");

  const lines = [
    `# DesignSync Migration Report`,
    `> Generated: ${new Date().toLocaleString("ko-KR")}`,
    ``,
    `## Summary`,
    `| | Count |`,
    `|---|---|`,
    `| ✅ Success | ${ok.length} |`,
    `| ⚠️ Partial (violations remain) | ${warn.length} |`,
    `| ❌ Failed | ${fail.length} |`,
    `| ↩️ Rolled back (regression) | ${rolled.length} |`,
    `| ⏭️ Skipped (already done) | ${skipped.length} |`,
    ``,
    `## Files Needing Manual Review`,
    ...(warn.length + fail.length + rolled.length === 0
      ? ["All files migrated successfully! 🎉"]
      : [...warn, ...fail, ...rolled].map(r =>
          `- \`${r.file}\` ${r.status}${r.violations ? ` (${r.violations} violations)` : ""}${r.notes ? ` — ${r.notes}` : ""}`
        )
    ),
    ``,
    `## All Files`,
    `| File | Status | Notes |`,
    `|---|---|---|`,
    ...reportRows.map(r => `| \`${r.file}\` | ${r.status} | ${r.notes || ""} |`),
  ];
  writeFileSync(REPORT_FILE, lines.join("\n"));
  console.log(`\n📄  리포트 저장: ${REPORT_FILE}`);
}

// ── API retry (exponential backoff) ───────────────────────────────────
async function withRetry(fn, maxAttempts = 3, baseMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isRateLimit = e.message?.includes("429") || e.message?.includes("rate");
      if (attempt === maxAttempts || !isRateLimit) throw e;
      const delay = baseMs * Math.pow(2, attempt - 1);
      process.stdout.write(` [rate limit, ${delay / 1000}s 대기]`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── Installed component scanner ────────────────────────────────────────
function scanInstalledComponents(root) {
  const uiDir = join(root, "components", "ui");
  if (!existsSync(uiDir)) {
    // Try src/components/ui
    const alt = join(root, "src", "components", "ui");
    if (!existsSync(alt)) return null;
    return readdirSync(alt).filter(f => f.endsWith(".tsx")).map(f => f.replace(".tsx", ""));
  }
  return readdirSync(uiDir).filter(f => f.endsWith(".tsx")).map(f => f.replace(".tsx", ""));
}

// ── CSS/SCSS token migration ────────────────────────────────────────────
const CSS_TOKEN_MAP = [
  // Colors
  [/#3b82f6|#6366f1|#4f46e5|#2563eb/gi, "var(--color-primary)"],
  [/#f9fafb|#f8fafc/gi, "var(--color-background)"],
  [/#f3f4f6|#f1f5f9/gi, "var(--color-muted)"],
  [/#111827|#0f172a/gi, "var(--color-foreground)"],
  [/#6b7280|#94a3b8/gi, "var(--color-muted-foreground)"],
  [/#e5e7eb|#e2e8f0/gi, "var(--color-border)"],
  [/#ef4444|#dc2626/gi, "var(--color-destructive)"],
  // Radius
  [/border-radius:\s*0\.5rem/gi, "border-radius: var(--ds-button-radius)"],
  [/border-radius:\s*0\.75rem/gi, "border-radius: var(--ds-card-radius)"],
  [/border-radius:\s*1rem/gi, "border-radius: var(--ds-card-radius)"],
  // Spacing
  [/padding:\s*1\.5rem/gi, "padding: var(--ds-card-padding)"],
  [/gap:\s*1rem/gi, "gap: var(--ds-section-gap)"],
  [/gap:\s*0\.5rem/gi, "gap: var(--ds-internal-gap)"],
];

function migrateCssContent(content) {
  let result = content;
  for (const [pattern, replacement] of CSS_TOKEN_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function findCssFiles(dir, result = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return result; }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findCssFiles(full, result);
    else if ([".css", ".scss"].includes(extname(entry)) && !entry.includes("designsync")) result.push(full);
  }
  return result;
}

// ── Git safety branch ─────────────────────────────────────────────────
async function createSafetyBranch(projectRoot) {
  try {
    // Check if this is a git repo
    execSync("git rev-parse --is-inside-work-tree", { cwd: projectRoot, stdio: "pipe" });
  } catch {
    console.log(`⚠️  Git 저장소 없음 — 브랜치 생성 스킵 (수동 백업 권장)\n`);
    return null;
  }
  try {
    // Check for uncommitted changes
    const status = execSync("git status --porcelain", { cwd: projectRoot, stdio: "pipe" }).toString().trim();
    if (status) {
      // Auto-stash or warn
      console.log(`⚠️  커밋되지 않은 변경사항 감지 — 현재 브랜치에서 새 브랜치 생성\n`);
    }
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const time = new Date().toTimeString().slice(0, 5).replace(":", "");
    const branch = `designsync-migration-${date}-${time}`;
    execSync(`git checkout -b "${branch}"`, { cwd: projectRoot, stdio: "pipe" });
    console.log(`🔀  안전 브랜치 생성: ${branch}`);
    console.log(`   복구: git checkout main && git branch -D ${branch}\n`);
    return branch;
  } catch (e) {
    const msg = e.stderr?.toString() || e.message || "";
    console.log(`⚠️  Git 브랜치 생성 실패 (${msg.trim().slice(0, 60)}) — 계속 진행\n`);
    return null;
  }
}

// ── Interactive mode helpers ──────────────────────────────────────────
import { createInterface } from "readline";

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

function getCodeContext(filePath, line, contextLines = 3) {
  try {
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const start = Math.max(0, line - 1 - contextLines);
    const end = Math.min(lines.length, line + contextLines);
    return lines.slice(start, end).map((l, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === line ? "→ " : "  ";
      return `${marker}${String(lineNum).padStart(4)} │ ${l}`;
    }).join("\n");
  } catch { return ""; }
}

// Describe violation in human-readable form
function describeViolation(v) {
  const r = v.ruleId || "";
  if (r.includes("no-raw-button")) return `raw <button> → <Button variant="...">`;
  if (r.includes("no-raw-input"))  return `raw <input> → <Input>`;
  if (r.includes("no-raw-header")) return `raw <header> → <Header>`;
  if (r.includes("no-raw-aside"))  return `raw <aside> → <Sidebar>`;
  if (r.includes("no-raw-h"))      return `raw <h1>~<h6> → <TypographyH1>~`;
  if (r.includes("no-hardcoded-color"))  return `하드코딩 색상 → DS 토큰`;
  if (r.includes("no-hardcoded-radius")) return `하드코딩 radius → var(--ds-*-radius)`;
  if (r.includes("no-hardcoded-height")) return `하드코딩 height → var(--ds-button-h-*)`;
  if (r.includes("no-raw-table"))  return `raw <table> → <Table>`;
  if (r.includes("no-svg-chart"))  return `SVG 차트 → <ChartContainer>`;
  return v.message?.slice(0, 80) || r;
}

async function runInteractiveMode(toMigrate) {
  console.log(`\n🎯  Interactive 마이그레이션 모드`);
  console.log(`   파일별로 위반 항목을 하나씩 보여줍니다.`);
  console.log(`   y = 교체  /  n = 건너뜀  /  s = 이 파일 전체 스킵  /  q = 종료\n`);
  console.log(`${"─".repeat(60)}\n`);

  let totalApproved = 0, totalSkipped = 0, totalFixed = 0, totalFailed = 0;

  for (const filePath of toMigrate) {
    const relPath = relative(projectRoot, filePath);
    const violations = getViolations(filePath);
    if (violations.length === 0) continue;

    console.log(`\n📄  ${relPath}  (${violations.length}개 위반)\n`);

    const approvedViolations = [];
    let skipFile = false;

    for (const v of violations) {
      if (skipFile) break;
      const desc = describeViolation(v);
      const context = getCodeContext(filePath, v.line);
      console.log(`  Line ${v.line}: ${desc}`);
      if (context) console.log(`\n${context}\n`);

      const answer = await ask(`  교체할까요? (y/n/s/q) › `);
      if (answer === "q") {
        console.log(`\n👋  종료\n`);
        writeReport();
        process.exit(0);
      }
      if (answer === "s") { skipFile = true; totalSkipped += violations.length; break; }
      if (answer === "y") { approvedViolations.push(v); totalApproved++; }
      else { totalSkipped++; }
      console.log("");
    }

    if (skipFile || approvedViolations.length === 0) continue;

    // Migrate the file targeting only approved violations
    process.stdout.write(`  🔄  ${approvedViolations.length}개 항목 교체 중...`);
    backupFile(filePath);

    try {
      const content = readFileSync(filePath, "utf-8");
      const violationDesc = approvedViolations.map(v =>
        `Line ${v.line}: ${describeViolation(v)} — "${v.message}"`
      ).join("\n");

      const targetedPrompt = `Migrate this file (${basename(filePath)}).
FIX ONLY these specific violations (do NOT change anything else):
${violationDesc}

Leave all other code exactly as-is.`;

      const raw = ANTHROPIC_KEY
        ? await migrateViaAnthropic(content, targetedPrompt, null)
        : OPENAI_KEY
        ? await migrateViaOpenAI(content, targetedPrompt, null)
        : await migrateViaServer(content, targetedPrompt, null);

      const fixed = deterministicFix(raw.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, ""));
      writeFileSync(filePath, fixed);
      try { execSync(`npx eslint "${filePath}" --fix --quiet`, { stdio: "pipe" }); } catch {}

      // Check only the violations user approved
      const remaining = getViolations(filePath).filter(v =>
        approvedViolations.some(a => a.line === v.line && a.ruleId === v.ruleId)
      );

      if (remaining.length === 0) {
        process.stdout.write(` ✅\n`);
        recordReport(filePath, "✅", 0, `interactive: ${approvedViolations.length}개 교체`);
        totalFixed++;
      } else {
        // Partial success — restore and report
        restoreFile(filePath);
        process.stdout.write(` ↩️  롤백 (${remaining.length}개 미해결)\n`);
        recordReport(filePath, "rolled-back", remaining.length, "interactive 교체 실패");
        totalFailed++;
      }
    } catch (err) {
      restoreFile(filePath);
      process.stdout.write(` ❌ (${err.message?.slice(0, 60)})\n`);
      recordReport(filePath, "❌", 0, err.message?.slice(0, 80));
      totalFailed++;
    }
  }

  console.log(`\n${"━".repeat(60)}`);
  console.log(`✅  ${totalFixed}개 파일 교체  |  ↩️  ${totalFailed}개 실패  |  ⏭️  ${totalSkipped}개 스킵`);
  console.log(`${"━".repeat(60)}\n`);
  writeReport();
}

// ── Main ──────────────────────────────────────────────────────────────
const mode = ANTHROPIC_KEY ? "Claude 직접" : OPENAI_KEY ? "GPT-4o 직접" : "DesignSync 서버";
const flags = [VISUAL_MODE && "Vision", DRY_RUN && "dry-run", RESUME && "resume", INTERACTIVE && "interactive"].filter(Boolean);
const flagTag = flags.length ? ` + ${flags.join(", ")}` : "";

console.log(`\n🚀  DesignSync AI Migration v2 (${mode}${flagTag})`);
if (DRY_RUN) console.log(`⚠️   DRY-RUN 모드 — 파일이 실제로 수정되지 않습니다\n`);

// ── Ignore patterns ───────────────────────────────────────────────────
const ignorePatterns = loadIgnorePatterns();
if (ignorePatterns.length) console.log(`🚫  무시 패턴 ${ignorePatterns.length}개 로드\n`);

// ── Installed component scan ──────────────────────────────────────────
const installedComponents = scanInstalledComponents(projectRoot);
let COMPONENT_LIST_ADDENDUM = "";
if (installedComponents) {
  COMPONENT_LIST_ADDENDUM = `\n\nINSTALLED DS COMPONENTS (use ONLY these — do NOT import others):\n${installedComponents.join(", ")}`;
  console.log(`🧩  설치된 컴포넌트 ${installedComponents.length}개 감지\n`);
}

// ── Load progress (resume mode) ───────────────────────────────────────
const completedFiles = loadProgress();
if (RESUME && completedFiles.size > 0) console.log(`⏭️   ${completedFiles.size}개 파일 이미 완료 — 재개\n`);

// ── File discovery ────────────────────────────────────────────────────
const allFiles = findFiles(srcDir).filter(f => !isIgnored(f, ignorePatterns));
console.log(`📁  ${srcDir}/ — ${allFiles.length}개 파일\n`);

// ── Git safety branch (create before any file changes) ───────────────
const safetyBranch = await createSafetyBranch(projectRoot);

// ── Pre-analysis pass ────────────────────────────────────────────────
process.stdout.write(`\n🔍  프로젝트 패턴 분석 중...`);
PROJECT_CONTEXT = await analyzeProject(allFiles);
if (PROJECT_CONTEXT) {
  process.stdout.write(` 완료 (${PROJECT_CONTEXT.split("\n").length}줄 컨텍스트)\n`);
} else {
  process.stdout.write(` 스킵\n`);
}

// ── Migration plan pass ───────────────────────────────────────────────
process.stdout.write(`📋  마이그레이션 계획 수립 중...`);
const migrationPlan = await generateMigrationPlan([], allFiles);
if (migrationPlan) {
  PROJECT_CONTEXT = PROJECT_CONTEXT
    ? `${PROJECT_CONTEXT}\n\n━━━ MIGRATION PLAN ━━━\n${migrationPlan}`
    : `━━━ MIGRATION PLAN ━━━\n${migrationPlan}`;
  process.stdout.write(` 완료\n`);
} else {
  process.stdout.write(` 스킵\n`);
}

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

// Check which files need migration (skip already-completed in resume mode)
const toMigrate = allFiles.filter((f) => {
  const absF = resolve(f);
  if (RESUME && completedFiles.has(absF)) {
    recordReport(f, "skipped", 0, "resume: 이전 실행에서 완료");
    return false;
  }
  process.stdout.write(`   checking ${f}...`);
  const v = hasViolations(f);
  process.stdout.write(v ? " ⚠️\n" : " ✅\n");
  if (!v) recordReport(f, "✅", 0, "이미 준수");
  return v;
});

// ── Interactive mode: run and exit ────────────────────────────────────
if (INTERACTIVE) {
  if (toMigrate.length === 0) {
    console.log("\n✅  모두 완료 — DesignSync 규칙 준수 중!");
    process.exit(0);
  }
  await runInteractiveMode(toMigrate);
  process.exit(0);
}

if (toMigrate.length === 0) {
  console.log("\n✅  모두 완료 — DesignSync 규칙 준수 중!");
  process.exit(0);
}

// Build import-based groups from files that need migration
const toMigrateSet = new Set(toMigrate.map(f => resolve(f)));
const allGroups = buildFileGroups(toMigrate);

// Filter groups: only include files that need migration
const rawGroups = allGroups.map(g => g.filter(f => toMigrateSet.has(resolve(f)))).filter(g => g.length > 0);

// Split large groups into chunks of MAX_GROUP_SIZE to avoid token overflow
const MAX_GROUP_SIZE = 5;
const groups = rawGroups.flatMap(g =>
  g.length <= MAX_GROUP_SIZE
    ? [g]
    : Array.from({ length: Math.ceil(g.length / MAX_GROUP_SIZE) }, (_, i) =>
        g.slice(i * MAX_GROUP_SIZE, (i + 1) * MAX_GROUP_SIZE)
      )
);

const groupCount = groups.filter(g => g.length > 1).length;
console.log(`\n⚡  ${toMigrate.length}개 파일 마이그레이션 (${groupCount}개 그룹 묶음)...\n`);
let done = 0, failed = 0;

async function processSingleFile(filePath, screenshotB64, useVote = false) {
  const originalContent = readFileSync(filePath, "utf-8");

  // Snapshot pre-existing violations by identity (line:col:ruleId)
  // so we never retry or count errors that existed BEFORE migration
  const preExistingKeys = new Set(
    getViolations(filePath).map(v => `${v.line}:${v.column}:${v.ruleId}`)
  );
  const originalViolations = preExistingKeys.size;

  function getNewViolations(fp) {
    return getViolations(fp).filter(v => !preExistingKeys.has(`${v.line}:${v.column}:${v.ruleId}`));
  }

  // Backup original before any modification
  backupFile(filePath);

  if (DRY_RUN) {
    console.log(`   [dry-run] would migrate: ${basename(filePath)}`);
    return { status: "dry-run", violations: 0 };
  }

  // Choose strategy by complexity
  const lineCount = originalContent.split("\n").length;
  let migrated;
  if (useVote && lineCount > 100 && ANTHROPIC_KEY) {
    migrated = await migrateWithVote(originalContent, basename(filePath), screenshotB64);
  } else {
    migrated = await migrate(originalContent, basename(filePath), screenshotB64);
  }
  // Deterministic fix before any ESLint/TS check — catches common AI mistakes
  writeFileSync(filePath, deterministicFix(migrated));

  let attempts = 1;
  while (attempts < 3) {
    // Only check NEW violations introduced by migration (ignore pre-existing)
    const newViolations = getNewViolations(filePath);
    const tsErrors = getTsErrors(filePath);
    if (newViolations.length === 0 && tsErrors.length === 0) break;

    try { execSync(`npx eslint "${filePath}" --fix --quiet`, { stdio: "pipe" }); } catch {}
    const remainingNew = getNewViolations(filePath);
    const remainingTs = getTsErrors(filePath);
    if (remainingNew.length === 0 && remainingTs.length === 0) break;

    const violationSummary = [
      ...remainingNew.slice(0, 8).map(v => `ESLint Line ${v.line}: ${v.message}`),
      ...remainingTs.slice(0, 6).map(e => `TypeScript: ${e}`),
    ].join("\n");

    const retryContent = readFileSync(filePath, "utf-8");
    const raw = await migrate(retryContent, `${basename(filePath)} [retry ${attempts}, fix these errors:\n${violationSummary}]`, screenshotB64);
    writeFileSync(filePath, deterministicFix(raw));
    attempts++;
  }
  try { execSync(`npx eslint "${filePath}" --fix --quiet`, { stdio: "pipe" }); } catch {}

  const finalNewViolations = getNewViolations(filePath).length;

  // Regression check: if NEW violations introduced, restore original
  if (finalNewViolations > 0) {
    restoreFile(filePath);
    recordReport(filePath, "rolled-back", finalNewViolations, `마이그레이션으로 새 violations 도입 (${finalNewViolations}개)`);
    return { status: "rolled-back", violations: originalViolations };
  }

  if (finalNewViolations === 0) {
    addExample(basename(filePath), originalContent, readFileSync(filePath, "utf-8"));
    recordReport(filePath, "✅");
    return { status: "ok", violations: 0 };
  }

  recordReport(filePath, "⚠️", finalNewViolations);
  return { status: "warn", violations: finalNewViolations };
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
      if (!DRY_RUN) {
        // Backup all group files before touching them
        for (const fp of group) backupFile(fp);
        const results = await migrateGroup(group, screenshotB64);
        for (const [fp, content] of results) {
          if (content) writeFileSync(fp, content);
        }
        for (const fp of group) {
          try { execSync(`npx eslint "${fp}" --fix --quiet`, { stdio: "pipe" }); } catch {}
        }
      }
      const violations = group.flatMap(fp => getViolations(fp));
      if (violations.length === 0) {
        process.stdout.write(" ✅\n");
        const groupNames = group.map(f => basename(f)).join(", ");
        PROJECT_CONTEXT += `\nSuccessfully migrated group: ${groupNames}`;
        for (const fp of group) {
          recordReport(fp, "✅");
          completedFiles.add(resolve(fp));
        }
      } else {
        for (const fp of group) {
          if (getViolations(fp).length > 0) await processSingleFile(fp, screenshotB64, true);
          completedFiles.add(resolve(fp));
        }
        const finalV = group.flatMap(fp => getViolations(fp));
        process.stdout.write(finalV.length === 0 ? " ✅\n" : ` ⚠️  (${finalV.length}개 잔존)\n`);
      }
      done += group.length;
    } else {
      const result = await processSingleFile(group[0], screenshotB64, true);
      completedFiles.add(resolve(group[0]));
      const icon = result?.status === "rolled-back" ? " ↩️\n" : result?.status === "ok" ? " ✅\n" : ` ⚠️  (${result?.violations}개 잔존)\n`;
      process.stdout.write(icon);
      done++;
    }
    saveProgress(completedFiles);
  } catch (err) {
    process.stdout.write(` ❌ (${err.message})\n`);
    for (const fp of group) recordReport(fp, "❌", 0, err.message.slice(0, 80));
    failed += group.length;
  }
  if (done % 10 === 0 && done > 0) await new Promise((r) => setTimeout(r, 1000));
}

console.log(`\n${"━".repeat(50)}`);
console.log(`✅  ${done}개 완료${failed ? `  ❌  ${failed}개 실패` : ""}`);
console.log(`${"━".repeat(50)}\n`);

// ── CSS/SCSS token migration ───────────────────────────────────────────
if (!DRY_RUN) {
  const cssFiles = findCssFiles(resolve(srcDir, ".."));
  const migratedCss = [];
  for (const cf of cssFiles) {
    const original = readFileSync(cf, "utf-8");
    const updated = migrateCssContent(original);
    if (updated !== original) {
      backupFile(cf);
      writeFileSync(cf, updated);
      migratedCss.push(basename(cf));
    }
  }
  if (migratedCss.length) {
    console.log(`🎨  CSS/SCSS 토큰 치환: ${migratedCss.join(", ")}\n`);
  }
}

// ── Build feedback loop ───────────────────────────────────────────────
if (!DRY_RUN) {
  const allMigratedFiles = toMigrate;
  await buildFeedbackLoop(projectRoot, allMigratedFiles);
}

// ── Cleanup progress file on full success ─────────────────────────────
if (!DRY_RUN && failed === 0 && existsSync(PROGRESS_FILE)) {
  try { execSync(`rm -f "${PROGRESS_FILE}"`); } catch {}
}

// ── Write migration report ─────────────────────────────────────────────
writeReport();

if (DRY_RUN) {
  console.log(`\n✅  dry-run 완료 — 실제 마이그레이션하려면 --dry-run 플래그 없이 실행\n`);
} else if (safetyBranch) {
  // Auto-merge back to original branch if migration succeeded
  const rolledBack = reportRows.filter(r => r.status === "rolled-back").length;
  const hardFailed = failed;

  if (hardFailed === 0 && rolledBack === 0) {
    try {
      const baseBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/remotes/origin/main", { cwd: projectRoot, stdio: "pipe" }).toString().trim().replace("refs/remotes/origin/", "");
      execSync(`git checkout "${baseBranch}"`, { cwd: projectRoot, stdio: "pipe" });
      execSync(`git merge --no-ff "${safetyBranch}" -m "chore: DesignSync migration"`, { cwd: projectRoot, stdio: "pipe" });
      execSync(`git branch -d "${safetyBranch}"`, { cwd: projectRoot, stdio: "pipe" });
      console.log(`\n✅  main 머지 완료 — 브랜치 ${safetyBranch} 삭제됨\n`);
    } catch (e) {
      // Merge failed — leave on branch, user decides
      console.log(`\n⚠️  자동 머지 실패 — 브랜치 ${safetyBranch} 유지`);
      console.log(`   수동 머지: git checkout main && git merge ${safetyBranch}\n`);
    }
  } else {
    console.log(`\n⚠️  실패/롤백 있음 — 브랜치 ${safetyBranch} 유지 (수동 검토 후 머지)`);
    console.log(`   머지: git checkout main && git merge ${safetyBranch}`);
    console.log(`   폐기: git checkout main && git branch -D ${safetyBranch}\n`);
  }
}
