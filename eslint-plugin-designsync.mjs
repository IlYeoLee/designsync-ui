/**
 * eslint-plugin-designsync
 *
 * Enforces DesignSync design system rules:
 * 1. No raw HTML elements (use DesignSync components)
 * 2. No hardcoded colors in className
 * 3. No hardcoded radius/height tokens
 */

// ── Rule: no-raw-html ────────────────────────────────────────────────
const RAW_HTML_MAP = {
  button: "Button (from @/components/ui/button)",
  input: "Input (from @/components/ui/input)",
  textarea: "Textarea (from @/components/ui/textarea)",
  select: "Select or NativeSelect (from @/components/ui/select)",
  label: "Label (from @/components/ui/label)",
  table: "Table (from @/components/ui/table)",
  aside: "Sidebar (from @/components/ui/sidebar)",
  header: "Header (from @/components/ui/header)",
  nav: "NavigationMenu, SidebarMenu, or HeaderNav",
  h1: "TypographyH1 (from @/components/ui/typography)",
  h2: "TypographyH2 (from @/components/ui/typography)",
  h3: "TypographyH3 (from @/components/ui/typography)",
  h4: "TypographyH4 (from @/components/ui/typography)",
  h5: "TypographyH4 (from @/components/ui/typography)",
  h6: "TypographyH4 (from @/components/ui/typography)",
};

const noRawHtml = {
  meta: {
    type: "problem",
    docs: { description: "Disallow raw HTML elements — use DesignSync components instead" },
    messages: {
      noRawHtml: "❌ <{{element}}> is not allowed. Use {{replacement}} instead.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name?.name;
        if (typeof name !== "string") return;
        const replacement = RAW_HTML_MAP[name];
        if (replacement) {
          // Allow inside ui/ component library files
          const filename = context.getFilename();
          if (filename.includes("/components/ui/")) return;
          context.report({ node, messageId: "noRawHtml", data: { element: name, replacement } });
        }
      },
    };
  },
};

// ── Rule: no-hardcoded-color ─────────────────────────────────────────
// Catches: bg-blue-600, text-gray-500, bg-[#fff], text-[#1a1a1a], bg-slate-100, etc.
const HARDCODED_COLOR_RE = /(?:^|\s)(?:bg|text|border|ring|outline|fill|stroke|from|via|to)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d+)?(?:\/\d+)?(?:\s|$)|(?:^|\s)(?:bg|text|border|ring)-\[#[0-9a-fA-F]{3,8}\]|(?:^|\s)(?:bg|text|border|ring)-\[(?:rgb|hsl|oklch)\(/;

const noHardcodedColor = {
  meta: {
    type: "problem",
    docs: { description: "Disallow hardcoded Tailwind color classes — use semantic tokens" },
    messages: {
      noHardcodedColor: "❌ Hardcoded color \"{{value}}\" detected. Use semantic tokens (bg-primary, text-foreground, etc.) or CSS variables (bg-[var(--brand-500)]).",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name !== "className") return;
        const filename = context.getFilename();
        if (filename.includes("/components/ui/")) return;

        const value = extractStringValue(node.value);
        if (!value) return;

        const match = value.match(HARDCODED_COLOR_RE);
        if (match) {
          context.report({ node, messageId: "noHardcodedColor", data: { value: match[0].trim() } });
        }
      },
    };
  },
};

// ── Rule: no-hardcoded-token ─────────────────────────────────────────
// Catches: rounded-md, rounded-lg, rounded-xl (not rounded-full, rounded-none, rounded-sm, rounded-[var(...)])
// Catches: h-8, h-9, h-10, h-12 (common button/input heights)
// Catches: p-4, p-5, p-6 (card/section padding) — only structural, not small values
const HARDCODED_TOKEN_PATTERNS = [
  {
    re: /(?:^|\s)rounded-(?:md|lg|xl|2xl)(?:\s|$)/,
    msg: "rounded-md/lg/xl",
    fix: "rounded-[var(--ds-button-radius)], rounded-[var(--ds-card-radius)], etc.",
  },
  {
    re: /(?:^|\s)h-(?:8|9|10|11|12)(?:\s|$)/,
    msg: "h-8 ~ h-12",
    fix: "h-[var(--ds-button-h-default)], h-[var(--ds-input-h)], etc.",
  },
];

const noHardcodedToken = {
  meta: {
    type: "problem",
    docs: { description: "Disallow hardcoded design tokens — use DesignSync CSS variables" },
    messages: {
      noHardcodedToken: "❌ Hardcoded token \"{{value}}\" detected. Use {{fix}} instead.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name !== "className") return;
        const filename = context.getFilename();
        if (filename.includes("/components/ui/")) return;

        const value = extractStringValue(node.value);
        if (!value) return;

        for (const pattern of HARDCODED_TOKEN_PATTERNS) {
          const match = value.match(pattern.re);
          if (match) {
            context.report({
              node,
              messageId: "noHardcodedToken",
              data: { value: pattern.msg, fix: pattern.fix },
            });
            break;
          }
        }
      },
    };
  },
};

// ── Helper ───────────────────────────────────────────────────────────
function extractStringValue(valueNode) {
  if (!valueNode) return null;
  // className="..."
  if (valueNode.type === "Literal") return valueNode.value;
  // className={`...`} or className={"..."}
  if (valueNode.type === "JSXExpressionContainer") {
    const expr = valueNode.expression;
    if (expr.type === "Literal") return expr.value;
    if (expr.type === "TemplateLiteral") {
      return expr.quasis.map((q) => q.value.raw).join("*");
    }
  }
  return null;
}

// ── Plugin export ────────────────────────────────────────────────────
const plugin = {
  meta: { name: "eslint-plugin-designsync", version: "1.0.0" },
  rules: {
    "no-raw-html": noRawHtml,
    "no-hardcoded-color": noHardcodedColor,
    "no-hardcoded-token": noHardcodedToken,
  },
};

export default plugin;
