/**
 * DesignSync ESLint Plugin v2.0 — Flat Config
 *
 * Blocks hardcoded values that should use DesignSync tokens.
 * Scans className attributes AND cn()/clsx()/cva() call arguments.
 *
 * Add to your eslint.config.mjs:
 *
 *   import designsync from "./designsync-eslint.js";
 *   export default [...otherConfigs, designsync];
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the raw string value from a className attribute.
 * Handles: className="..." and className={'...'} / className={`...`}
 * Returns null for dynamic expressions it can't statically analyze.
 */
function getClassNameValue(node) {
  if (!node.value) return null;

  // className="literal"
  if (node.value.type === "Literal" && typeof node.value.value === "string") {
    return { value: node.value.value, reportNode: node.value };
  }

  // className={"literal"} or className={`literal`}
  if (node.value.type === "JSXExpressionContainer") {
    const expr = node.value.expression;
    if (expr.type === "Literal" && typeof expr.value === "string") {
      return { value: expr.value, reportNode: expr };
    }
    if (expr.type === "TemplateLiteral" && expr.expressions.length === 0) {
      return { value: expr.quasis[0].value.raw, reportNode: expr };
    }
  }

  return null;
}

/**
 * Recursively extract string literals from cn()/clsx()/cva() arguments.
 * Handles: "str", `str`, cond && "str", cond ? "a" : "b", ["a", "b"]
 */
const CN_FUNCTIONS = new Set(["cn", "clsx", "cva", "twMerge", "twJoin"]);

function extractStringsFromExpr(node) {
  if (!node) return [];
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") {
        return [{ value: node.value, reportNode: node }];
      }
      return [];
    case "TemplateLiteral":
      if (node.expressions.length === 0) {
        return [{ value: node.quasis[0].value.raw, reportNode: node }];
      }
      return [];
    case "LogicalExpression":
      // cond && "class" — check the right side
      return extractStringsFromExpr(node.right);
    case "ConditionalExpression":
      // cond ? "a" : "b" — check both branches
      return [
        ...extractStringsFromExpr(node.consequent),
        ...extractStringsFromExpr(node.alternate),
      ];
    case "ArrayExpression":
      return node.elements.flatMap((el) => (el ? extractStringsFromExpr(el) : []));
    default:
      return [];
  }
}

/**
 * Split a className string into individual classes.
 */
function splitClasses(str) {
  return str.split(/\s+/).filter(Boolean);
}

/**
 * Create a class-scanning rule that checks both className attrs and cn() calls.
 * `checker(classes, reportNode, context)` is called for each string found.
 */
function createClassRule(meta, checker) {
  return {
    meta,
    create(context) {
      return {
        // className="..." / className={"..."} / className={`...`}
        JSXAttribute(node) {
          if (node.name.name !== "className") return;
          const info = getClassNameValue(node);
          if (!info) return;
          checker(splitClasses(info.value), info.reportNode, context);
        },
        // cn("...", cond && "...", ...) / clsx(...) / cva(...)
        CallExpression(node) {
          const callee = node.callee;
          if (callee.type !== "Identifier" || !CN_FUNCTIONS.has(callee.name)) return;
          for (const arg of node.arguments) {
            for (const s of extractStringsFromExpr(arg)) {
              checker(splitClasses(s.value), s.reportNode, context);
            }
          }
        },
      };
    },
  };
}

// ─── Patterns ───────────────────────────────────────────────────────────────

// 1. Hardcoded color classes
const HARDCODED_COLOR_RE = new RegExp(
  "^(?:bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|shadow)-(?:" +
    "gray|blue|red|green|slate|zinc|neutral|stone|orange|amber|yellow|" +
    "lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose" +
  ")-\\d+(?:\\/\\d+)?$"
);

// Arbitrary hex colors: bg-[#...], text-[#...], border-[#...]
const ARBITRARY_COLOR_RE = /^(?:bg|text|border|ring|outline|fill|stroke)-\[#[0-9a-fA-F]+\]$/;

// hover:/focus:/etc. variants with hardcoded colors
const VARIANT_HARDCODED_COLOR_RE = new RegExp(
  "^(?:hover|focus|active|group-hover|peer-hover|focus-within|focus-visible|disabled|aria-\\w+):" +
  "(?:bg|text|border|ring|outline|fill|stroke)-(?:" +
    "gray|blue|red|green|slate|zinc|neutral|stone|orange|amber|yellow|" +
    "lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose" +
  ")-\\d+(?:\\/\\d+)?$"
);

// Allowed semantic bg/text/border classes (not flagged)
const SEMANTIC_COLOR_RE = /^(?:hover:|focus:|active:|focus-visible:|disabled:|group-hover:|peer-hover:)?(?:bg|text|border|ring|outline|fill|stroke)-(?:background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|sidebar|inherit|current|transparent|black|white)(?:-foreground)?(?:\/\d+)?$/;

// 2. Hardcoded radius
const HARDCODED_RADIUS_RE = /^rounded-(?:sm|md|lg|xl|2xl|3xl)$/;
const ALLOWED_RADIUS_RE = /^rounded-(?:full|none|\[var\(--ds-)/;

// 3. Hardcoded heights for buttons/inputs
const HARDCODED_HEIGHT_RE = /^h-(?:8|9|10|11|12)$/;
const ALLOWED_HEIGHT_RE = /^h-(?:full|screen|auto|min|max|fit|px|0|0\.5|1|1\.5|2|2\.5|3|3\.5|4|5|6|7|\[var\(--ds-)/;

// 4. Hardcoded structural padding/gap
const HARDCODED_PADDING_RE = /^(?:p|px|py|pl|pr|pt|pb)-(?:3|4|5|6|7|8)$/;
const HARDCODED_GAP_RE = /^(?:gap|gap-x|gap-y|space-x|space-y)-(?:3|4|5|6)$/;
const HARDCODED_MARGIN_RE = /^(?:m|mx|my|ml|mr|mt|mb)-(?:3|4|5|6|7|8)$/;

// 5. Raw HTML elements → component replacements
const RAW_ELEMENT_MAP = {
  button:     { component: "Button",               importPath: "@/components/ui/button" },
  input:      { component: "Input",                importPath: "@/components/ui/input" },
  textarea:   { component: "Textarea",             importPath: "@/components/ui/textarea" },
  select:     { component: "NativeSelect",         importPath: "@/components/ui/native-select" },
  label:      { component: "Label",                importPath: "@/components/ui/label" },
  aside:      { component: "Sidebar",              importPath: "@/components/ui/sidebar" },
  header:     { component: "Header",               importPath: "@/components/ui/header" },
  table:      { component: "Table",                importPath: "@/components/ui/table" },
  thead:      { component: "TableHeader",          importPath: "@/components/ui/table" },
  tbody:      { component: "TableBody",            importPath: "@/components/ui/table" },
  tfoot:      { component: "TableFooter",          importPath: "@/components/ui/table" },
  tr:         { component: "TableRow",             importPath: "@/components/ui/table" },
  th:         { component: "TableHead",            importPath: "@/components/ui/table" },
  td:         { component: "TableCell",            importPath: "@/components/ui/table" },
  hr:         { component: "Separator",            importPath: "@/components/ui/separator" },
  h1:         { component: "TypographyH1",         importPath: "@/components/ui/typography" },
  h2:         { component: "TypographyH2",         importPath: "@/components/ui/typography" },
  h3:         { component: "TypographyH3",         importPath: "@/components/ui/typography" },
  h4:         { component: "TypographyH4",         importPath: "@/components/ui/typography" },
  h5:         { component: "TypographyH4",         importPath: "@/components/ui/typography" },
  h6:         { component: "TypographyH4",         importPath: "@/components/ui/typography" },
  p:          { component: "TypographyP",          importPath: "@/components/ui/typography" },
  blockquote: { component: "TypographyBlockquote", importPath: "@/components/ui/typography" },
  code:       { component: "TypographyCode",       importPath: "@/components/ui/typography" },
  ul:         { component: "TypographyList",       importPath: "@/components/ui/typography" },
  ol:         { component: "TypographyList",       importPath: "@/components/ui/typography" },
  small:      { component: "TypographySmall",      importPath: "@/components/ui/typography" },
  kbd:        { component: "Kbd",                  importPath: "@/components/ui/kbd" },
};

// 6. SVG chart children
const SVG_CHART_CHILDREN = new Set(["path", "line", "circle", "rect", "g", "polyline", "polygon"]);

// 7. Arbitrary font-size: text-[14px], text-[0.875rem], text-[1.5em]
const ARBITRARY_FONT_SIZE_RE = /^text-\[\d+(?:\.\d+)?(?:px|rem|em|vw|vh|%)\]$/;

// 8. Arbitrary shadow: shadow-[...] (but not shadow-[var(--...)])
const ARBITRARY_SHADOW_RE = /^shadow-\[(?!var\(--)/;

// 9. Inline style properties that should use tokens
const BLOCKED_STYLE_PROPS = new Set([
  "color", "backgroundColor", "background", "borderColor",
  "fontSize", "fontWeight", "lineHeight", "fontFamily",
  "borderRadius", "boxShadow",
]);

// ─── Rule: no-hardcoded-colors ──────────────────────────────────────────────

const noHardcodedColors = createClassRule(
  {
    type: "problem",
    docs: {
      description: "Disallow hardcoded Tailwind color classes; use DesignSync semantic tokens instead.",
    },
    messages: {
      hardcodedColor:
        "Hardcoded color '{{cls}}' — use a semantic token (bg-primary, text-foreground, border-border, etc.) or a CSS variable: bg-[var(--brand-500)].",
      arbitraryHexColor:
        "Arbitrary hex color '{{cls}}' — use a semantic token or CSS variable: bg-[var(--brand-500)].",
    },
    schema: [],
  },
  function checkColors(classes, reportNode, context) {
    for (const cls of classes) {
      if (SEMANTIC_COLOR_RE.test(cls)) continue;
      if (cls.includes("var(--")) continue;

      if (HARDCODED_COLOR_RE.test(cls) || VARIANT_HARDCODED_COLOR_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "hardcodedColor",
          data: { cls },
        });
      } else if (ARBITRARY_COLOR_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "arbitraryHexColor",
          data: { cls },
        });
      }
    }
  }
);

// ─── Rule: no-hardcoded-radius ──────────────────────────────────────────────

const noHardcodedRadius = createClassRule(
  {
    type: "problem",
    docs: {
      description: "Disallow hardcoded border-radius classes; use var(--ds-*-radius) tokens.",
    },
    messages: {
      hardcodedRadius:
        "Hardcoded radius '{{cls}}' — use a DesignSync radius token: rounded-[var(--ds-button-radius)], rounded-[var(--ds-card-radius)], etc.",
    },
    schema: [],
  },
  function checkRadius(classes, reportNode, context) {
    for (const cls of classes) {
      if (HARDCODED_RADIUS_RE.test(cls) && !ALLOWED_RADIUS_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "hardcodedRadius",
          data: { cls },
        });
      }
    }
  }
);

// ─── Rule: no-hardcoded-height ──────────────────────────────────────────────

const noHardcodedHeight = createClassRule(
  {
    type: "problem",
    docs: {
      description: "Disallow hardcoded height classes for buttons/inputs; use var(--ds-*-h) tokens.",
    },
    messages: {
      hardcodedHeight:
        "Hardcoded height '{{cls}}' — use a DesignSync height token: h-[var(--ds-button-h-default)], h-[var(--ds-input-h)], etc.",
    },
    schema: [],
  },
  function checkHeight(classes, reportNode, context) {
    for (const cls of classes) {
      if (HARDCODED_HEIGHT_RE.test(cls) && !ALLOWED_HEIGHT_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "hardcodedHeight",
          data: { cls },
        });
      }
    }
  }
);

// ─── Rule: no-hardcoded-padding ─────────────────────────────────────────────

const noHardcodedPadding = createClassRule(
  {
    type: "problem",
    docs: {
      description: "Disallow hardcoded structural padding/gap; use var(--ds-card-padding), var(--ds-section-gap).",
    },
    messages: {
      hardcodedPadding:
        "Hardcoded structural padding '{{cls}}' — use p-[var(--ds-card-padding)] or similar DesignSync token.",
      hardcodedGap:
        "Hardcoded structural gap '{{cls}}' — use gap-[var(--ds-section-gap)] or gap-[var(--ds-internal-gap)].",
      hardcodedMargin:
        "Hardcoded structural margin '{{cls}}' — use m*-[var(--ds-internal-gap)] or m*-[var(--ds-section-gap)].",
    },
    schema: [],
  },
  function checkPadding(classes, reportNode, context) {
    for (const cls of classes) {
      if (cls.includes("var(--")) continue;

      if (HARDCODED_PADDING_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "hardcodedPadding",
          data: { cls },
        });
      } else if (HARDCODED_GAP_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "hardcodedGap",
          data: { cls },
        });
      } else if (HARDCODED_MARGIN_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "hardcodedMargin",
          data: { cls },
        });
      }
    }
  }
);

// ─── Rule: no-raw-html-elements ─────────────────────────────────────────────

const noRawHtmlElements = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description: "Disallow raw HTML elements; use DesignSync UI components instead.",
    },
    messages: {
      rawElement:
        "Raw <{{element}}> element — use <{{component}}> instead.",
      addImport:
        "Add missing import: {{importStatement}}",
    },
    schema: [],
  },
  create(context) {
    // Track which components need imports: importPath → Set<component>
    const neededImports = new Map();

    function trackImport(importPath, component) {
      if (!neededImports.has(importPath)) neededImports.set(importPath, new Set());
      neededImports.get(importPath).add(component);
    }

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const tag = node.name.name;
        const entry = RAW_ELEMENT_MAP[tag];
        if (!entry) return;

        const { component, importPath } = entry;
        trackImport(importPath, component);

        context.report({
          node,
          messageId: "rawElement",
          data: { element: tag, component },
          fix(fixer) {
            const fixes = [fixer.replaceText(node.name, component)];
            // Fix closing tag too (non-self-closing elements)
            const closingEl = node.parent && node.parent.closingElement;
            if (closingEl) {
              fixes.push(fixer.replaceText(closingEl.name, component));
            }
            return fixes;
          },
        });
      },

      "Program:exit"(programNode) {
        if (neededImports.size === 0) return;

        const body = programNode.body;
        const importDecls = body.filter((n) => n.type === "ImportDeclaration");

        for (const [importPath, components] of neededImports) {
          const existing = importDecls.find((d) => d.source.value === importPath);

          if (existing) {
            // Find which components are already imported
            const existingNames = new Set(
              existing.specifiers
                .filter((s) => s.type === "ImportSpecifier")
                .map((s) => s.imported.name)
            );
            const missing = [...components].filter((c) => !existingNames.has(c));
            if (missing.length === 0) continue;

            // Append missing specifiers to existing import
            const lastSpecifier = existing.specifiers[existing.specifiers.length - 1];
            const addStr = `, ${missing.join(", ")}`;
            context.report({
              node: existing,
              messageId: "addImport",
              data: { importStatement: addStr },
              fix(fixer) {
                return fixer.insertTextAfter(lastSpecifier, addStr);
              },
            });
          } else {
            // Insert new import after last existing import (or at top, after directives)
            const importStr = `import { ${[...components].join(", ")} } from "${importPath}";\n`;
            const insertAfter = importDecls.length > 0
              ? importDecls[importDecls.length - 1]
              : null;

            context.report({
              node: programNode,
              messageId: "addImport",
              data: { importStatement: importStr.trim() },
              fix(fixer) {
                if (insertAfter) {
                  return fixer.insertTextAfter(insertAfter, `\n${importStr}`);
                }
                // No existing imports — insert before first non-directive statement
                const firstStmt = body.find(
                  (n) => !(n.type === "ExpressionStatement" && n.directive)
                );
                return firstStmt
                  ? fixer.insertTextBefore(firstStmt, importStr)
                  : fixer.insertTextBefore(body[0], importStr);
              },
            });
          }
        }
      },
    };
  },
};

// ─── Rule: no-raw-svg-chart ─────────────────────────────────────────────────

const noRawSvgChart = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw SVG elements that look like charts; use <ChartContainer> + recharts.",
    },
    messages: {
      rawSvgChart:
        "Raw <svg> with chart-like children ({{children}}) — use <ChartContainer> + recharts instead of raw SVG.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        const opening = node.openingElement;
        if (opening.name.type !== "JSXIdentifier" || opening.name.name !== "svg") {
          return;
        }

        const chartChildren = [];
        for (const child of node.children) {
          if (
            child.type === "JSXElement" &&
            child.openingElement.name.type === "JSXIdentifier" &&
            SVG_CHART_CHILDREN.has(child.openingElement.name.name)
          ) {
            chartChildren.push(child.openingElement.name.name);
          }
        }

        if (chartChildren.length >= 2) {
          context.report({
            node: opening,
            messageId: "rawSvgChart",
            data: { children: [...new Set(chartChildren)].join(", ") },
          });
        }
      },
    };
  },
};

// ─── Rule: no-arbitrary-font-size ───────────────────────────────────────────

const noArbitraryFontSize = createClassRule(
  {
    type: "problem",
    docs: {
      description: "Disallow arbitrary font-size classes; use text-xs through text-5xl tokens.",
    },
    messages: {
      arbitraryFontSize:
        "Arbitrary font-size '{{cls}}' — use a token: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, text-3xl, text-4xl, text-5xl.",
    },
    schema: [],
  },
  function checkFontSize(classes, reportNode, context) {
    for (const cls of classes) {
      if (cls.includes("var(--")) continue;
      if (ARBITRARY_FONT_SIZE_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "arbitraryFontSize",
          data: { cls },
        });
      }
    }
  }
);

// ─── Rule: no-arbitrary-shadow ──────────────────────────────────────────────

const noArbitraryShadow = createClassRule(
  {
    type: "problem",
    docs: {
      description: "Disallow arbitrary shadow values; use shadow-sm, shadow-md, shadow-lg tokens.",
    },
    messages: {
      arbitraryShadow:
        "Arbitrary shadow '{{cls}}' — use a token: shadow-sm, shadow-md, shadow-lg.",
    },
    schema: [],
  },
  function checkShadow(classes, reportNode, context) {
    for (const cls of classes) {
      if (ARBITRARY_SHADOW_RE.test(cls)) {
        context.report({
          node: reportNode,
          messageId: "arbitraryShadow",
          data: { cls },
        });
      }
    }
  }
);

// ─── Rule: no-inline-style-tokens ───────────────────────────────────────────

const noInlineStyleTokens = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow inline style properties that should use DesignSync tokens (color, fontSize, borderRadius, etc.).",
    },
    messages: {
      inlineStyleToken:
        "Inline style '{{prop}}' should use a DesignSync token or Tailwind utility class instead of a hardcoded value.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name !== "style") return;
        if (!node.value || node.value.type !== "JSXExpressionContainer") return;

        const expr = node.value.expression;
        if (expr.type !== "ObjectExpression") return;

        for (const prop of expr.properties) {
          if (prop.type !== "Property") continue;

          // Get property name
          let propName;
          if (prop.key.type === "Identifier") {
            propName = prop.key.name;
          } else if (prop.key.type === "Literal") {
            propName = String(prop.key.value);
          } else {
            continue;
          }

          if (!BLOCKED_STYLE_PROPS.has(propName)) continue;

          // Allow dynamic expressions (variables, function calls)
          // Only flag literal values and template literals with no expressions
          const val = prop.value;
          if (
            (val.type === "Literal" && typeof val.value === "string") ||
            (val.type === "TemplateLiteral" && val.expressions.length === 0)
          ) {
            context.report({
              node: prop,
              messageId: "inlineStyleToken",
              data: { prop: propName },
            });
          }
        }
      },
    };
  },
};

// ─── Plugin Definition ──────────────────────────────────────────────────────

const plugin = {
  meta: {
    name: "eslint-plugin-designsync",
    version: "2.0.0",
  },
  rules: {
    "no-hardcoded-colors": noHardcodedColors,
    "no-hardcoded-radius": noHardcodedRadius,
    "no-hardcoded-height": noHardcodedHeight,
    "no-hardcoded-padding": noHardcodedPadding,
    "no-raw-html-elements": noRawHtmlElements,
    "no-raw-svg-chart": noRawSvgChart,
    "no-arbitrary-font-size": noArbitraryFontSize,
    "no-arbitrary-shadow": noArbitraryShadow,
    "no-inline-style-tokens": noInlineStyleTokens,
  },
};

// ─── Flat Config Export ─────────────────────────────────────────────────────

module.exports = {
  files: ["**/*.{jsx,tsx}"],
  plugins: {
    designsync: plugin,
  },
  rules: {
    "designsync/no-hardcoded-colors": "error",
    "designsync/no-hardcoded-radius": "error",
    "designsync/no-hardcoded-height": "error",
    "designsync/no-hardcoded-padding": "error",
    "designsync/no-raw-html-elements": "error",
    "designsync/no-raw-svg-chart": "error",
    "designsync/no-arbitrary-font-size": "error",
    "designsync/no-arbitrary-shadow": "error",
    "designsync/no-inline-style-tokens": "error",
  },
};

