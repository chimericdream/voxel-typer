/**
 * Copy lint: kid-facing text in `src/ui/**` must go through `t()` (docs/impl/contracts.md §11,
 * docs/impl/README.md §4.2). Oxlint's JS plugins are still alpha in 1.93, so this is a small
 * oxc-parser script, like tools/check-boundaries.ts.
 *
 * It reports, in `src/ui/**` `.tsx`/`.jsx` files:
 *   1. JSX text with a letter in it: `<p>Hello</p>`.
 *   2. String literals used as JSX children: `<p>{"Hello"}</p>`, `<p>{`Hi ${name}`}</p>`,
 *      `<p>{ok ? "Yes" : "No"}</p>`.
 *   3. String literals in text props: `title`, `alt`, `placeholder`, `aria-label` and the other
 *      ARIA props that hold text (TEXT_PROPS below), written as `alt="x"` or `alt={"x"}`.
 *
 * Text with no letters is allowed: whitespace, numbers, punctuation and symbols (`{count} / 10`,
 * `—`, `×`, `★`). "Letter" means the Unicode letter class (\p{L}), so other scripts count too.
 *
 *   npm run tool -- check-ui-literals            # scans the repo
 *   npm run tool -- check-ui-literals --root DIR # scans another tree laid out like the repo (tests)
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import {
  parseSync,
  Visitor,
  type Expression,
  type JSXAttribute,
  type JSXElement,
  type JSXFragment,
  type Span,
} from "oxc-parser";

export interface Violation {
  file: string; // posix path relative to root
  line: number;
  column: number;
  rule: "jsx-text" | "jsx-string-child" | "text-prop" | "parse-error";
  message: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Files the check covers, relative to the root. */
export const UI_GLOB = "src/ui/**/*.{tsx,jsx}";

/** Props whose value is read or shown to the player. */
export const TEXT_PROPS: ReadonlySet<string> = new Set([
  "title",
  "alt",
  "placeholder",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
]);

const LETTER = /\p{L}/u;

/**
 * JSX text keeps HTML entities raw (`&nbsp;`). These named ones decode to non-letters. Numeric
 * entities are decoded. Any other named entity is left as is, so its letters still count (safe side).
 */
const SYMBOL_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  gt: ">",
  hellip: "…",
  laquo: "«",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  times: "×",
};

export function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return SYMBOL_ENTITIES[body] ?? whole;
  });
}

/** True when kid-facing text must come from `t()`: it has a letter once entities are decoded. */
export const needsTranslation = (text: string): boolean => LETTER.test(decodeEntities(text));

const toPosix = (p: string): string => p.replaceAll("\\", "/");

function lineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

/** String literals an expression evaluates to directly (through `?:`, `&&`, `||`, `??`, parens). */
function literalTexts(expr: Expression): Array<{ node: Span; text: string }> {
  switch (expr.type) {
    case "Literal":
      return typeof expr.value === "string" ? [{ node: expr, text: expr.value }] : [];
    case "TemplateLiteral":
      return [{ node: expr, text: expr.quasis.map((q) => q.value.cooked ?? q.value.raw).join("") }];
    case "ConditionalExpression":
      return [...literalTexts(expr.consequent), ...literalTexts(expr.alternate)];
    case "LogicalExpression":
      return [...literalTexts(expr.left), ...literalTexts(expr.right)];
    case "ParenthesizedExpression":
      return literalTexts(expr.expression);
    default:
      return [];
  }
}

function propName(attr: JSXAttribute): string {
  const n = attr.name;
  return n.type === "JSXIdentifier" ? n.name : `${n.namespace.name}:${n.name.name}`;
}

const preview = (text: string): string => {
  const flat = text.trim().replaceAll(/\s+/g, " ");
  return flat.length > 40 ? `${flat.slice(0, 37)}...` : flat;
};

export function checkSource(relPath: string, source: string): Violation[] {
  const file = toPosix(relPath);
  const out: Violation[] = [];
  const report = (node: Span, rule: Violation["rule"], message: string): void => {
    out.push({ file, ...lineCol(source, node.start), rule, message });
  };

  const parsed = parseSync(file, source);
  for (const err of parsed.errors) {
    out.push({ file, line: 1, column: 1, rule: "parse-error", message: err.message });
  }

  const checkChildren = (n: JSXElement | JSXFragment): void => {
    for (const child of n.children) {
      if (child.type === "JSXText") {
        if (needsTranslation(child.value)) {
          report(
            child,
            "jsx-text",
            `Text "${preview(child.value)}" in JSX: put it in src/i18n and use t().`,
          );
        }
      } else if (
        child.type === "JSXExpressionContainer" &&
        child.expression.type !== "JSXEmptyExpression"
      ) {
        for (const { node, text } of literalTexts(child.expression)) {
          if (needsTranslation(text)) {
            report(
              node,
              "jsx-string-child",
              `String "${preview(text)}" in JSX: put it in src/i18n and use t().`,
            );
          }
        }
      }
    }
  };

  const visitor = new Visitor({
    JSXElement: checkChildren,
    JSXFragment: checkChildren,
    JSXAttribute(attr) {
      const name = propName(attr);
      if (!TEXT_PROPS.has(name) || attr.value === null) return;
      const v = attr.value;
      const texts =
        v.type === "Literal"
          ? typeof v.value === "string"
            ? [{ node: v, text: v.value }]
            : []
          : v.type === "JSXExpressionContainer" && v.expression.type !== "JSXEmptyExpression"
            ? literalTexts(v.expression)
            : [];
      for (const { node, text } of texts) {
        if (needsTranslation(text)) {
          report(
            node,
            "text-prop",
            `String "${preview(text)}" in the ${name} prop: put it in src/i18n and use t().`,
          );
        }
      }
    },
  });
  visitor.visit(parsed.program);
  return out;
}

/** Scans every UI file under `root`. */
export function checkUiLiterals(root: string = REPO_ROOT): Violation[] {
  const files = globSync(UI_GLOB, { cwd: root }).map(toPosix).toSorted();
  return files.flatMap((f) => checkSource(f, readFileSync(join(root, f), "utf8")));
}

function main(): void {
  const i = argv.indexOf("--root");
  const rootArg = i >= 0 ? argv[i + 1] : undefined;
  const root = rootArg ? resolve(rootArg) : REPO_ROOT;
  if (!existsSync(root)) {
    console.error(`No such directory: ${root}`);
    exit(2);
  }
  const violations = checkUiLiterals(root);
  for (const v of violations) {
    console.error(`${v.file}:${v.line}:${v.column}: error ui-literals(${v.rule}): ${v.message}`);
  }
  if (violations.length > 0) {
    console.error(`\ncheck-ui-literals: ${violations.length} literal(s) in src/ui need t().`);
    exit(1);
  }
  console.log(`check-ui-literals: src/ui clean (${relative(process.cwd(), root) || "."}).`);
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
