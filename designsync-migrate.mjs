#!/usr/bin/env node
/**
 * DesignSync AI Migration Script
 * API 키 없이도 DesignSync 서버를 통해 무료로 마이그레이션.
 *
 * 사용법 (API 키 없이 — 서버가 처리):
 *   node designsync-migrate.mjs [src 디렉토리]
 *
 * 사용법 (직접 API 사용):
 *   ANTHROPIC_API_KEY=sk-ant-... node designsync-migrate.mjs [src 디렉토리]
 *   OPENAI_API_KEY=sk-...       node designsync-migrate.mjs [src 디렉토리]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";
import { execSync } from "child_process";

const DESIGNSYNC_SERVER = "https://designsync-omega.vercel.app/r/migrate";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY    = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `You are a DesignSync migration assistant.
Rewrite the given React/Next.js JSX/TSX file to use DesignSync design tokens and components.

CRITICAL RULES:
- Fix ONLY UI/styling. Do NOT change any logic, state, props, event handlers, or data.
- Return ONLY the complete migrated file content. No explanation. No markdown fences.

COLOR TOKEN MAPPINGS:
bg-blue-600, bg-indigo-600  → bg-primary
bg-white, bg-gray-50        → bg-background
bg-gray-100, bg-slate-100   → bg-muted
bg-gray-900, bg-[#111]      → bg-card
bg-red-600, bg-red-500      → bg-destructive
bg-blue-50, bg-indigo-50    → bg-accent
text-gray-900, text-black   → text-foreground
text-gray-500, text-gray-400 → text-muted-foreground
text-blue-600               → text-primary
text-red-600                → text-destructive
border-gray-200             → border-border
border-gray-300             → border-input

RADIUS/HEIGHT/SPACING:
rounded-xl, rounded-lg (card) → rounded-[var(--ds-card-radius)]
rounded-md (button)           → rounded-[var(--ds-button-radius)]
rounded-md (input)            → rounded-[var(--ds-input-radius)]
h-9, h-10 (button)            → h-[var(--ds-button-h-default)]
h-8 (small button)            → h-[var(--ds-button-h-sm)]
h-9 (input)                   → h-[var(--ds-input-h)]
p-6, p-5 (card)               → p-[var(--ds-card-padding)]
gap-4, gap-6 (section)        → gap-[var(--ds-section-gap)]

COMPONENT MIGRATIONS (always add import):
<button>     → <Button>          @/components/ui/button
<input>      → <Input>           @/components/ui/input
<textarea>   → <Textarea>        @/components/ui/textarea
<select>     → <NativeSelect>    @/components/ui/native-select
<label>      → <Label>           @/components/ui/label
<h1>~<h4>    → <TypographyH1~H4> @/components/ui/typography
<p>          → <TypographyP>     @/components/ui/typography
<ul>/<ol>    → <TypographyList>  @/components/ui/typography
<blockquote> → <TypographyBlockquote> @/components/ui/typography
<code>       → <TypographyCode>  @/components/ui/typography
<small>      → <TypographySmall> @/components/ui/typography
<kbd>        → <Kbd>             @/components/ui/kbd
<hr>         → <Separator>       @/components/ui/separator
<table>/<thead>/<tbody>/<tfoot>/<tr>/<th>/<td>
             → Table/TableHeader/TableBody/TableFooter/TableRow/TableHead/TableCell
                                  @/components/ui/table

PATTERN MIGRATIONS:
div with border+rounded+shadow  → <Card><CardContent>...</CardContent></Card>  @/components/ui/card
div with animate-pulse          → <Skeleton>                                   @/components/ui/skeleton
div/p with role="alert"         → <Alert><AlertDescription>...</AlertDescription></Alert> @/components/ui/alert
span with text-xs+rounded+bg    → <Badge>                                      @/components/ui/badge
div with rounded-full+img/text  → <Avatar><AvatarImage/><AvatarFallback>       @/components/ui/avatar
<progress value={n}>            → <Progress value={n} />                       @/components/ui/progress
div with animate-spin           → <Spinner>                                    @/components/ui/spinner`;

async function migrateViaServer(content, filename) {
  const res = await fetch(DESIGNSYNC_SERVER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, filename }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server ${res.status}`);
  }
  const { migrated } = await res.json();
  return migrated;
}

async function migrateViaAnthropic(content, filename) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Migrate this file (${filename}):\n\n${content}` }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

async function migrateViaOpenAI(content, filename) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 8000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Migrate this file (${filename}):\n\n${content}` },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function migrate(content, filename) {
  const raw = ANTHROPIC_KEY
    ? await migrateViaAnthropic(content, filename)
    : OPENAI_KEY
    ? await migrateViaOpenAI(content, filename)
    : await migrateViaServer(content, filename);
  return raw.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, "");
}

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

const srcDir = process.argv[2] || "src";
const allFiles = findFiles(srcDir);
const mode = ANTHROPIC_KEY ? "Claude 직접" : OPENAI_KEY ? "GPT-4o 직접" : "DesignSync 서버";

console.log(`\n🚀  DesignSync AI Migration (${mode})`);
console.log(`📁  ${srcDir}/ — ${allFiles.length}개 파일\n`);

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

console.log(`\n⚡  ${toMigrate.length}개 파일 마이그레이션...\n`);
let done = 0, failed = 0;

for (const filePath of toMigrate) {
  process.stdout.write(`   ${filePath} ...`);
  try {
    let content = readFileSync(filePath, "utf-8");
    let migrated = await migrate(content, basename(filePath));
    writeFileSync(filePath, migrated);

    // 재시도 루프: 위반 남아있으면 AI에게 위반 목록 포함해서 재요청 (최대 3회)
    let attempts = 1;
    while (attempts < 3) {
      const violations = getViolations(filePath);
      if (violations.length === 0) break;

      // ESLint --fix로 자동 수정 가능한 것 먼저 처리
      try { execSync(`npx eslint "${filePath}" --fix --quiet`, { stdio: "pipe" }); } catch {}

      const remaining = getViolations(filePath);
      if (remaining.length === 0) break;

      // 남은 위반을 AI에게 알려주고 재요청
      const violationSummary = remaining.slice(0, 10).map(v => `Line ${v.line}: ${v.message}`).join("\n");
      const retryContent = readFileSync(filePath, "utf-8");
      const retryPrompt = `The following ESLint violations remain after migration. Fix them:\n\n${violationSummary}\n\nFile:\n\n${retryContent}`;

      const raw = ANTHROPIC_KEY
        ? await migrateViaAnthropic(retryContent, basename(filePath) + ` [retry ${attempts}, violations: ${violationSummary}]`)
        : OPENAI_KEY
        ? await migrateViaOpenAI(retryContent, basename(filePath) + ` [retry ${attempts}]`)
        : await migrateViaServer(retryContent, basename(filePath));

      migrated = raw.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, "");
      writeFileSync(filePath, migrated);
      attempts++;
    }

    // 최종 ESLint --fix 한 번 더
    try { execSync(`npx eslint "${filePath}" --fix --quiet`, { stdio: "pipe" }); } catch {}

    const finalViolations = getViolations(filePath);
    if (finalViolations.length === 0) {
      process.stdout.write(" ✅\n");
    } else {
      process.stdout.write(` ⚠️  (${finalViolations.length}개 위반 잔존)\n`);
    }
    done++;
  } catch (err) {
    process.stdout.write(` ❌ (${err.message})\n`);
    failed++;
  }
  if (done % 10 === 0 && done > 0) await new Promise((r) => setTimeout(r, 1000));
}

console.log(`\n${"━".repeat(50)}`);
console.log(`✅  ${done}개 완료${failed ? `  ❌  ${failed}개 실패` : ""}`);
console.log(`${"━".repeat(50)}\n`);
