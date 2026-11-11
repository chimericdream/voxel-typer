/**
 * Message formatting for `t()` (docs/impl/contracts.md §11): a minimal ICU MessageFormat subset,
 * written in-house so the game needs no i18n dependency.
 *
 * Supported syntax:
 *   - `{name}`: the param `name`, inserted as is. A missing param leaves `{name}` in the text so the
 *     bug is visible but nothing crashes.
 *   - `{count, plural, one {# block} other {# blocks}}`: picks a branch by the number in `count`.
 *     Branches are `=N` (exact match, checked first), the CLDR categories (`zero`, `one`, `two`,
 *     `few`, `many`) and `other` (required in well-formed messages; the fallback). Inside a branch,
 *     `#` is the number. Branches can hold params and further plurals.
 *   - Apostrophe quoting, as in ICU: `''` is one `'`; a `'` right before `{`, `}` (or `#` inside a
 *     plural branch) starts literal text that runs to the next lone `'`. Any other `'` is just an
 *     apostrophe, so "Let's go" needs no escaping.
 *
 * Param values are never parsed: `{`, `}`, `#` and `'` in a value come out unchanged. Nothing is
 * HTML-escaped; Preact escapes text when it renders it.
 *
 * Text that doesn't parse (an unclosed `{`, a bad plural) is kept as literal text instead of
 * throwing: kid-facing screens must never crash over a typo in a string.
 */

/** One piece of a parsed message. */
type Part =
  | string
  | { kind: "arg"; name: string }
  | { kind: "plural"; name: string; branches: ReadonlyMap<string, readonly Part[]> }
  | { kind: "pound" };

type Params = Readonly<Record<string, string | number>>;

const NAME = /^[A-Za-z_$][\w$]*$/;
const SELECTOR = /^(?:=\d+(?:\.\d+)?|zero|one|two|few|many|other)$/;

class Parser {
  i = 0;
  constructor(readonly src: string) {}

  /** Parses until the end, or until an unmatched `}` when `inBranch`. Leaves `i` on that `}`. */
  message(inBranch: boolean): Part[] {
    const parts: Part[] = [];
    let text = "";
    const flush = (): void => {
      if (text !== "") parts.push(text);
      text = "";
    };
    const { src } = this;
    while (this.i < src.length) {
      const c = src.charAt(this.i);
      if (c === "'") {
        text += this.apostrophe(inBranch);
      } else if (c === "{") {
        const start = this.i;
        const arg = this.argument();
        if (arg === null) {
          this.i = start + 1;
          text += "{";
        } else {
          flush();
          parts.push(arg);
        }
      } else if (c === "}" && inBranch) {
        break;
      } else if (c === "#" && inBranch) {
        flush();
        parts.push({ kind: "pound" });
        this.i++;
      } else {
        text += c;
        this.i++;
      }
    }
    flush();
    return parts;
  }

  /** Reads an apostrophe at `i` and returns the literal text it stands for. */
  private apostrophe(inBranch: boolean): string {
    const { src } = this;
    const next = src.charAt(this.i + 1);
    if (next === "'") {
      this.i += 2;
      return "'";
    }
    const special = next === "{" || next === "}" || (inBranch && next === "#");
    if (!special) {
      this.i++;
      return "'";
    }
    // Quoted literal: runs to the next lone apostrophe ('' inside it is one apostrophe).
    let out = "";
    this.i++;
    while (this.i < src.length) {
      const c = src.charAt(this.i);
      if (c === "'") {
        if (src.charAt(this.i + 1) === "'") {
          out += "'";
          this.i += 2;
          continue;
        }
        this.i++;
        return out;
      }
      out += c;
      this.i++;
    }
    return out; // unterminated quote: the rest is literal, as in ICU
  }

  /** Parses `{…}` at `i`. Returns null (and a garbage `i`) when it isn't a valid argument. */
  private argument(): Part | null {
    const { src } = this;
    const close = (): boolean => {
      this.skipSpace();
      if (src.charAt(this.i) !== "}") return false;
      this.i++;
      return true;
    };
    this.i++; // {
    this.skipSpace();
    const name = this.word();
    if (!NAME.test(name)) return null;
    this.skipSpace();
    const c = src.charAt(this.i);
    if (c === "}") {
      this.i++;
      return { kind: "arg", name };
    }
    if (c !== ",") return null;
    this.i++;
    this.skipSpace();
    if (this.word() !== "plural") return null;
    this.skipSpace();
    if (src.charAt(this.i) !== ",") return null;
    this.i++;
    const branches = new Map<string, Part[]>();
    for (;;) {
      this.skipSpace();
      if (src.charAt(this.i) === "}") break;
      const selector = this.word();
      if (!SELECTOR.test(selector) || branches.has(selector)) return null;
      this.skipSpace();
      if (src.charAt(this.i) !== "{") return null;
      this.i++;
      const body = this.message(true);
      if (src.charAt(this.i) !== "}") return null;
      this.i++;
      branches.set(selector, body);
    }
    if (branches.size === 0 || !close()) return null;
    return { kind: "plural", name, branches };
  }

  private word(): string {
    const start = this.i;
    while (this.i < this.src.length && /[^\s{},]/.test(this.src.charAt(this.i))) this.i++;
    return this.src.slice(start, this.i);
  }

  private skipSpace(): void {
    while (this.i < this.src.length && /\s/.test(this.src.charAt(this.i))) this.i++;
  }
}

const cache = new Map<string, readonly Part[]>();

/** Parses `pattern` once and caches the result. */
export function parseMessage(pattern: string): readonly Part[] {
  let parts = cache.get(pattern);
  if (parts === undefined) {
    parts = new Parser(pattern).message(false);
    cache.set(pattern, parts);
  }
  return parts;
}

const pluralRules = new Intl.PluralRules("en");

function pluralBranch(
  branches: ReadonlyMap<string, readonly Part[]>,
  n: number,
): readonly Part[] | undefined {
  if (Number.isFinite(n)) {
    const exact = branches.get(`=${n}`);
    if (exact) return exact;
    const category = branches.get(pluralRules.select(n));
    if (category) return category;
  }
  return branches.get("other");
}

function render(parts: readonly Part[], params: Params, pound: string): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "string") {
      out += part;
    } else if (part.kind === "pound") {
      out += pound;
    } else if (part.kind === "arg") {
      const v = params[part.name];
      out += v === undefined ? `{${part.name}}` : String(v);
    } else {
      const v = params[part.name];
      if (v === undefined) {
        out += `{${part.name}}`;
        continue;
      }
      const n = typeof v === "number" ? v : Number(v);
      const branch = pluralBranch(part.branches, n);
      if (branch) out += render(branch, params, String(v));
    }
  }
  return out;
}

/**
 * Fills `pattern` with `params`. Plural categories follow English rules (every shipped locale is
 * English; the pseudo-locale only changes letters).
 */
export function formatMessage(pattern: string, params: Params = {}): string {
  return render(parseMessage(pattern), params, "#");
}
