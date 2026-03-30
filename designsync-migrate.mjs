#!/usr/bin/env node
/**
 * DesignSync AI Migration Script
 * ESLint이 잡은 위반 사항을 Claude/GPT가 자동으로 전부 수정.
 *
 * 사용법:
 *   ANTHROPIC_API_KEY=sk-ant-... node designsync-migrate.mjs [src 디렉토리]
 *   OPENAI_API_KEY=sk-...       node designsync-migrate.mjs [src 디렉토리]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";

// ─── API 설정 ────────────────────────────────────────────────────────────────

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY    = process.env.OPENAI_API_KEY;

if (!ANTHROPIC_KEY && !OPENAI_KEY) {
  console.error("❌  ANTHROPIC_API_KEY 또는 OPENAI_API_KEY를 설정하세요.");
  process.exit(1);
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a DesignSync migration assistant.
Rewrite the given React/Next.js JSX/TSX file to use DesignSync design tokens and components.

CRITICAL RULES:
- Fix ONLY UI/styling. Do NOT change any logic, state, props, event handlers, or data.
- Return ONLY the complete migrated file content. No explanation. No markdown fences.

━━━ COLOR TOKEN MAPPINGS ━━━
bg-blue-600, bg-indigo-600, bg-violet-600  → bg-primary
bg-white, bg-gray-50, bg-[#fafafa]         → bg-background
bg-gray-100, bg-slate-100, bg-zinc-100     → bg-muted
bg-gray-900, bg-slate-900, bg-[#111]       → bg-card
bg-red-600, bg-red-500                     → bg-destructive
bg-blue-50, bg-indigo-50                   → bg-accent
text-gray-900, text-slate-900, text-black  → text-foreground
text-gray-500, text-gray-400, text-slate-500 → text-muted-foreground
text-white (on primary/dark bg)            → text-primary-foreground
text-blue-600, text-indigo-600             → text-primary
text-red-600, text-red-500                 → text-destructive
border-gray-200, border-gray-100           → border-border
border-gray-300, border-[#ddd]             → border-input

━━━ TOKEN MAPPINGS (RADIUS / HEIGHT / SPACING) ━━━
rounded-xl, rounded-lg  (card/panel)       → rounded-[var(--ds-card-radius)]
rounded-md              (button)           → rounded-[var(--ds-button-radius)]
rounded-md              (input/select)     → rounded-[var(--ds-input-radius)]
rounded-md              (menu/dropdown)    → rounded-[var(--ds-element-radius)]
h-9, h-10               (button)           → h-[var(--ds-button-h-default)]
h-8                     (small button)     → h-[var(--ds-button-h-sm)]
h-12                    (large button)     → h-[var(--ds-button-h-lg)]
h-9                     (input)            → h-[var(--ds-input-h)]
p-6, p-5                (card)             → p-[var(--ds-card-padding)]
gap-4, gap-6            (section layout)   → gap-[var(--ds-section-gap)]
gap-2, gap-3            (internal items)   → gap-[var(--ds-internal-gap)]
focus-visible:ring-[3px]                   → focus-visible:ring-[var(--ds-focus-ring-width)]

━━━ COMPONENT MIGRATIONS ━━━
Raw HTML → DesignSync component (always add the import):
  <button>         → <Button>                    from @/components/ui/button
  <input>          → <Input>                     from @/components/ui/input
  <textarea>       → <Textarea>                  from @/components/ui/textarea
  <select>         → <NativeSelect>              from @/components/ui/native-select
  <label>          → <Label>                     from @/components/ui/label
  <h1>~<h4>        → <TypographyH1>~<H4>         from @/components/ui/typography
  <p>              → <TypographyP>               from @/components/ui/typography
  <ul>/<ol>        → <TypographyList>            from @/components/ui/typography
  <blockquote>     → <TypographyBlockquote>      from @/components/ui/typography
  <code>           → <TypographyCode>            from @/components/ui/typography
  <small>          → <TypographySmall>           from @/components/ui/typography
  <kbd>            → <Kbd>                       from @/components/ui/kbd
  <hr>             → <Separator>                 from @/components/ui/separator
  <table>/<thead>/<tbody>/<tfoot>/<tr>/<th>/<td>
                   → Table/TableHeader/TableBody/TableFooter/TableRow/TableHead/TableCell
                                                 from @/components/ui/table

Pattern → DesignSync component:
  div with className containing border+rounded+shadow (card-like)
    → <Card><CardContent>...</CardContent></Card>   from @/components/ui/card
  div with className containing animate-pulse
    → <Skeleton>                                    from @/components/ui/skeleton
  div/p with role="alert"
    → <Alert><AlertDescription>...</AlertDescription></Alert>
                                                    from @/components/ui/alert
  span with small text + rounded + bg color (badge-like)
    → <Badge>                                       from @/components/ui/badge
  div with rounded-full + img or text initials (avatar-like)
    → <Avatar><AvatarImage src={...} /><AvatarFallback>XX</AvatarFallback></Avatar>
                                                    from @/components/ui/avatar
  <progress value={n}>
    → <Progress value={n} />                        from @/components/ui/progress
  div with className containing animate-spin
    → <Spinner>                                     from @/components/ui/spinner

Always add necessary imports. Remove unused imports.`;

// ─── API 호출 ─────────────────────────────────────────────────────────────────

async function callAnthropic(content) {
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
      messages: [{ role: "user", content: `Migrate this file:\n\n${content}` }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

async function callOpenAI(content) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 8000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Migrate this file:\n\n${content}` },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function migrate(content) {
  const raw = ANTHROPIC_KEY
    ? await callAnthropic(content)
    : await callOpenAI(content);
  // 마크다운 펜스 제거
  return raw.replace(/^```(?:tsx?|jsx?)?\n?/, "").replace(/\n?```\s*$/, "");
}

// ─── ESLint 위반 확인 ─────────────────────────────────────────────────────────

function hasViolations(filePath) {
  try {
    execSync(`npx eslint "${filePath}" --quiet`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return false; // 에러 없음
  } catch {
    return true; // 에러 있음 = 위반 있음
  }
}

// ─── 파일 탐색 ────────────────────────────────────────────────────────────────

function findFiles(dir, result = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return result; }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findFiles(full, result);
    } else if ([".jsx", ".tsx"].includes(extname(entry))) {
      result.push(full);
    }
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const srcDir = process.argv[2] || "src";
const allFiles = findFiles(srcDir);

console.log(`\n🚀  DesignSync AI Migration`);
console.log(`🤖  Using: ${ANTHROPIC_KEY ? "Claude (Anthropic)" : "GPT-4o (OpenAI)"}`);
console.log(`📁  Scanning: ${srcDir}/ — ${allFiles.length} files\n`);

// ESLint 위반이 있는 파일만 추림
const toMigrate = allFiles.filter((f) => {
  process.stdout.write(`   checking ${f}...`);
  const v = hasViolations(f);
  process.stdout.write(v ? " ⚠️\n" : " ✅\n");
  return v;
});

if (toMigrate.length === 0) {
  console.log("\n✅  모든 파일이 이미 DesignSync 규칙을 준수합니다!");
  process.exit(0);
}

console.log(`\n⚡  ${toMigrate.length}개 파일 AI 마이그레이션 시작...\n`);

let done = 0;
let failed = 0;

for (const filePath of toMigrate) {
  process.stdout.write(`   ${filePath} ...`);
  try {
    const original = readFileSync(filePath, "utf-8");
    const migrated = await migrate(original);
    writeFileSync(filePath, migrated);
    process.stdout.write(" ✅\n");
    done++;
  } catch (err) {
    process.stdout.write(` ❌ (${err.message})\n`);
    failed++;
  }

  // Rate limit 방지 — Anthropic: 50 req/min, 잠깐 대기
  if (done % 10 === 0) await new Promise((r) => setTimeout(r, 1000));
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅  완료: ${done}개 파일 마이그레이션`);
if (failed > 0) console.log(`❌  실패: ${failed}개 파일`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
