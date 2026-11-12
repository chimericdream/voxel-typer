/**
 * Builder's command line (task M4-07, PLAN.md §3.2.4). Pure: text in, commands and hints out.
 *
 * **Words.** A command is one real word: a block's `typedName` (arms that block), `put`, `dig`,
 * `undo`, a blueprint's name, or a direction (`up down north south east west`). A direction may
 * take a number of steps, 1 to {@link MAX_STEPS}: `east 3`.
 *
 * **When a command runs** (the card's rule, with decision 81: no trailing space):
 * - A word runs on its last letter when no longer command starts with it. `put` runs on the `t`.
 * - A word that a longer command starts with waits for Space or Enter. `blue` waits, because
 *   `bluebell` starts with it.
 * - A direction always waits, because `east 3` starts with `east`. Enter runs it for one step.
 *   Space makes room for the number; the number runs on its digit (it is one digit, so no longer
 *   number can follow). Space or Enter again, with no number, runs one step.
 * - Space on an empty line is `put`.
 *
 * **Keys that don't fit.** A key that can't continue any command doesn't go into the line (the
 * same "stay" rule Mine teaches), and the line answers with a gentle hint that lists the words
 * that do fit. Nothing is ever an error. {@link parseLine} still classifies any text, so the HUD
 * and tests can ask about a line the reducer would never let through.
 *
 * **Sprout codes.** For the Sprout band every block answers to a short code: the first letters of
 * its name, three or more, as few as tell it apart from every other word (`dirt` → `dir`, `grass`
 * → `gras` because of `gravel`). The picture palette shows those letters as key caps. The rest of
 * the name may still be typed: it is taken quietly ({@link LineState.tail}), so a child who types
 * the whole word `dirt` sees nothing odd.
 */
import type { MessageKey } from "@/i18n";
import type { AgeBand, BlockId } from "@/types/core";

export const DIRECTIONS = ["up", "down", "north", "south", "east", "west"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Most steps one direction command takes. One digit, so a number runs as soon as it is typed. */
export const MAX_STEPS = 9;

/** Shortest Sprout code. */
export const MIN_CODE = 3;

export type Command =
  | { kind: "arm"; block: BlockId }
  | { kind: "put" }
  | { kind: "dig" }
  | { kind: "undo" }
  | { kind: "move"; dir: Direction; steps: number }
  | { kind: "blueprint"; name: string };

/** A word the command line knows, and what it does. */
export interface VocabWord {
  /** What is typed: lowercase a–z. For a Sprout block this is its code. */
  word: string;
  command: Command | { kind: "direction"; dir: Direction };
  /** A Sprout code's left-over letters (`dir` → `t`), else "". */
  tail: string;
}

export interface Vocabulary {
  /** Every word, in listing order: commands, directions, blocks (registry order), blueprints. */
  readonly words: readonly VocabWord[];
  /** The word a block is armed with (its code for Sprout). */
  wordOf(block: BlockId): string | undefined;
  /** Names left out because an earlier word already had them. Empty in a healthy registry. */
  readonly conflicts: readonly string[];
}

export interface VocabularyInput {
  /** Blocks a child may arm, in registry order. */
  blocks: readonly { id: BlockId; typedName: string }[];
  /** Blueprint names (M4-08). */
  blueprints?: readonly string[];
  /** Sprout gets short block codes. */
  band: AgeBand;
}

const isDirection = (w: string): w is Direction => (DIRECTIONS as readonly string[]).includes(w);

/**
 * A block's Sprout code: the shortest start of `name`, at least {@link MIN_CODE} letters, that no
 * word in `others` starts with. The whole name when nothing shorter is free.
 */
export function shortCode(name: string, others: readonly string[]): string {
  for (let n = Math.min(MIN_CODE, name.length); n < name.length; n++) {
    const code = name.slice(0, n);
    if (!others.some((o) => o.startsWith(code))) return code;
  }
  return name;
}

export function buildVocabulary(input: VocabularyInput): Vocabulary {
  const full: { name: string; make(word: string): VocabWord }[] = [];
  const conflicts: string[] = [];
  const taken = new Set<string>();
  const add = (name: string, make: (word: string) => VocabWord): void => {
    if (!/^[a-z]+$/.test(name) || taken.has(name)) {
      conflicts.push(name);
      return;
    }
    taken.add(name);
    full.push({ name, make });
  };
  const plain =
    (command: VocabWord["command"]) =>
    (word: string): VocabWord => ({ word, command, tail: "" });

  add("put", plain({ kind: "put" }));
  add("dig", plain({ kind: "dig" }));
  add("undo", plain({ kind: "undo" }));
  for (const dir of DIRECTIONS) add(dir, plain({ kind: "direction", dir }));
  const short = input.band === "sprout";
  const blockWords = new Map<BlockId, string>();
  for (const b of input.blocks) {
    add(b.typedName, (word) => {
      blockWords.set(b.id, word);
      return {
        word,
        command: { kind: "arm", block: b.id },
        tail: b.typedName.slice(word.length),
      };
    });
  }
  for (const name of input.blueprints ?? []) add(name, plain({ kind: "blueprint", name }));

  const names = full.map((f) => f.name);
  const words = full.map((f, i) => {
    const isBlock = f.make(f.name).command.kind === "arm";
    const others = names.filter((_, j) => j !== i);
    return f.make(short && isBlock ? shortCode(f.name, others) : f.name);
  });
  return { words, wordOf: (block) => blockWords.get(block), conflicts };
}

// ---------------------------------------------------------------------------------------------
// Reading a line
// ---------------------------------------------------------------------------------------------

/** What a line of text is, to the command line. */
export type Parse =
  /** Nothing typed. */
  | { kind: "empty" }
  /**
   * A whole command. `auto` is true when it runs by itself, on its last key; otherwise it waits
   * for Space or Enter because a longer command starts with it (`longer` lists those).
   */
  | { kind: "command"; command: Command; auto: boolean; longer: readonly string[] }
  /** A direction, with or without the space after it, waiting for a number or for Enter. */
  | { kind: "direction"; dir: Direction; spaced: boolean }
  /** The start of one or more words. */
  | { kind: "partial"; completions: readonly string[] }
  /** Not the start of anything. `suggestions` are the nearest words, best first; may be empty. */
  | { kind: "unknown"; suggestions: readonly string[] };

const startsOf = (vocab: Vocabulary, text: string): string[] =>
  vocab.words.filter((w) => w.word.startsWith(text)).map((w) => w.word);

/** How many leading letters two words share. */
const shared = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** Up to three words that begin like `text`, the longest match first. */
function suggest(vocab: Vocabulary, text: string): string[] {
  const head = text.split(" ")[0] ?? "";
  return vocab.words
    .map((w, i) => ({ word: w.word, score: shared(w.word, head), i }))
    .filter((s) => s.score > 0)
    .toSorted((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3)
    .map((s) => s.word);
}

/** Classifies `text` (lowercase). Never throws: text that fits nothing is `unknown`. */
export function parseLine(text: string, vocab: Vocabulary): Parse {
  if (text === "") return { kind: "empty" };
  const space = text.indexOf(" ");
  if (space !== -1) {
    const head = text.slice(0, space);
    const rest = text.slice(space + 1);
    if (!isDirection(head) || !vocab.words.some((w) => w.word === head)) {
      return { kind: "unknown", suggestions: suggest(vocab, text) };
    }
    if (rest === "") return { kind: "direction", dir: head, spaced: true };
    if (/^[1-9]$/.test(rest)) {
      const steps = Number(rest);
      if (steps <= MAX_STEPS) {
        return {
          kind: "command",
          command: { kind: "move", dir: head, steps },
          auto: true,
          longer: [],
        };
      }
    }
    return { kind: "unknown", suggestions: [head] };
  }
  const starts = startsOf(vocab, text);
  const exact = vocab.words.find((w) => w.word === text);
  if (exact === undefined) {
    if (starts.length > 0) return { kind: "partial", completions: starts };
    return { kind: "unknown", suggestions: suggest(vocab, text) };
  }
  if (exact.command.kind === "direction") {
    return { kind: "direction", dir: exact.command.dir, spaced: false };
  }
  const longer = starts.filter((w) => w !== text);
  return { kind: "command", command: exact.command, auto: longer.length === 0, longer };
}

// ---------------------------------------------------------------------------------------------
// Typing into the line
// ---------------------------------------------------------------------------------------------

export interface LineState {
  /** What the line shows. Lowercase. */
  text: string;
  /** Letters still taken quietly after a Sprout code ran (the rest of the block's name). */
  tail: string;
}

export const EMPTY_LINE: LineState = { text: "", tail: "" };

/** A gentle word from the command line. Always a hint, never an error. */
export interface Feedback {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface KeyOutcome {
  state: LineState;
  /** A command to run now. */
  run: Command | null;
  /**
   * The text that was typed for `run` (`"east 3"`, `"dir"`), for the practice session. Null when
   * `run` came from Space on an empty line, which types no word.
   */
  ran: string | null;
  /** True when the key went into the line (or ran it, or was taken as a code's tail). */
  accepted: boolean;
  feedback: Feedback | null;
}

const wordList = (words: readonly string[]): string => words.slice(0, 4).join(", ");

/** The hint for a key that doesn't fit after `text`, or for Enter on an unfinished word. */
function fitHint(text: string, vocab: Vocabulary): Feedback {
  const p = parseLine(text, vocab);
  if (p.kind === "direction") return { key: "builder.hint.number", params: { max: MAX_STEPS } };
  if (p.kind === "partial") {
    return p.completions.length === 1
      ? { key: "builder.hint.keepGoing", params: { word: p.completions[0] ?? "" } }
      : { key: "builder.hint.oneOf", params: { words: wordList(p.completions) } };
  }
  if (p.kind === "command" && !p.auto) {
    return { key: "builder.hint.pressSpace", params: { word: text } };
  }
  if (p.kind === "empty") return { key: "builder.hint.tryWord" };
  return p.suggestions.length === 0
    ? { key: "builder.hint.tryWord" }
    : { key: "builder.hint.oneOf", params: { words: wordList(p.suggestions) } };
}

const stay = (state: LineState, feedback: Feedback | null, accepted = false): KeyOutcome => ({
  state,
  run: null,
  ran: null,
  accepted,
  feedback,
});

const ran = (command: Command, text: string | null, tail = ""): KeyOutcome => ({
  state: { text: "", tail },
  run: command,
  ran: text,
  accepted: true,
  feedback: null,
});

/**
 * One key into the line. `key` is a normalized key (contracts §9): one char, `"Enter"` or
 * `"Backspace"`; letters are folded to lowercase. Backspace on an empty line is not handled here
 * (the mode undoes), and neither are the camera keys.
 */
export function typeKey(state: LineState, key: string, vocab: Vocabulary): KeyOutcome {
  const { text } = state;
  if (key === "Backspace") {
    return stay({ text: Array.from(text).slice(0, -1).join(""), tail: "" }, null, text !== "");
  }

  const here = parseLine(text, vocab);
  if (key === "Enter" || key === " ") {
    const fresh: LineState = { text, tail: "" };
    if (here.kind === "empty") {
      return key === " " ? ran({ kind: "put" }, null) : stay(fresh, null);
    }
    if (here.kind === "command") return ran(here.command, text);
    if (here.kind === "direction") {
      // Space after the word makes room for a number; anything else runs one step.
      if (key === " " && !here.spaced) return stay({ text: `${text} `, tail: "" }, null, true);
      const dir = here.dir;
      return ran({ kind: "move", dir, steps: 1 }, dir);
    }
    return stay(fresh, fitHint(text, vocab));
  }

  const ch = key.toLowerCase();
  if (Array.from(ch).length !== 1) return stay(state, null);

  // The rest of a block's name after its Sprout code: taken quietly.
  if (text === "" && state.tail !== "") {
    if (state.tail.startsWith(ch)) return stay({ text: "", tail: state.tail.slice(1) }, null, true);
  }

  const next = text + ch;
  const p = parseLine(next, vocab);
  if (p.kind === "unknown" || p.kind === "empty") {
    return stay({ text, tail: "" }, fitHint(text, vocab));
  }
  if (p.kind === "command" && p.auto) {
    const word = vocab.words.find((w) => w.word === next);
    return ran(p.command, next, word?.tail ?? "");
  }
  return stay({ text: next, tail: "" }, null, true);
}

/**
 * What the HUD shows after the typed text, dimmed: the rest of the word when only one fits, a
 * marker for "press Space" when the word is whole but a longer one exists, else nothing.
 */
export function completionOf(text: string, vocab: Vocabulary): string {
  const p = parseLine(text, vocab);
  if (p.kind === "partial" && p.completions.length === 1) {
    return (p.completions[0] ?? "").slice(text.length);
  }
  return "";
}

/** True when the line is a whole command (or direction) that is waiting for Space or Enter. */
export function waitsForSpace(text: string, vocab: Vocabulary): boolean {
  const p = parseLine(text, vocab);
  return (p.kind === "command" && !p.auto) || p.kind === "direction";
}
