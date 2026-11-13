/**
 * Builder's command line (task M4-07): the parser table (prefix ambiguity, numbers, unknown
 * words) and the key-by-key reducer, over the real block registry.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blocks } from "../../../../src/content/blocks";
import {
  DIRECTIONS,
  EMPTY_LINE,
  MAX_STEPS,
  buildVocabulary,
  completionOf,
  parseLine,
  settled,
  shortCode,
  typeKey,
  waitsForSpace,
} from "../../../../src/modes/builder/commands";
import type {
  Command,
  Feedback,
  LineState,
  Vocabulary,
} from "../../../../src/modes/builder/commands";

const placeable = blocks.filter((b) => b.tags.includes("placeable"));
const miner = buildVocabulary({ blocks: placeable, blueprints: ["house", "tower"], band: "miner" });
const sprout = buildVocabulary({ blocks: placeable, band: "sprout" });

interface Typed {
  state: LineState;
  runs: Command[];
  ran: (string | null)[];
  hints: Feedback[];
  rejected: string[];
}

/** Types keys one by one. `>` is Enter and `<` is Backspace. */
function type(keys: string, vocab: Vocabulary = miner, from: LineState = EMPTY_LINE): Typed {
  const out: Typed = { state: from, runs: [], ran: [], hints: [], rejected: [] };
  for (const ch of keys) {
    const key = ch === ">" ? "Enter" : ch === "<" ? "Backspace" : ch;
    const r = typeKey(out.state, key, vocab);
    out.state = r.state;
    if (r.run !== null) {
      out.runs.push(r.run);
      out.ran.push(r.ran);
    }
    if (r.feedback !== null) out.hints.push(r.feedback);
    if (!r.accepted) out.rejected.push(ch);
  }
  return out;
}

describe("vocabulary", () => {
  it("has every command, direction, placeable block and blueprint, with no clashes", () => {
    const words = miner.words.map((w) => w.word);
    expect(words).toEqual(expect.arrayContaining(["put", "dig", "undo", ...DIRECTIONS]));
    expect(words).toEqual(expect.arrayContaining(placeable.map((b) => b.typedName)));
    expect(words).toEqual(expect.arrayContaining(["house", "tower"]));
    expect(miner.conflicts).toEqual([]);
    expect(new Set(words).size).toBe(words.length);
  });

  it("leaves out water, which can't be placed", () => {
    expect(miner.words.some((w) => w.word === "water")).toBe(false);
  });

  it("reports a name an earlier word already has, and keeps the earlier word", () => {
    const v = buildVocabulary({
      blocks: placeable,
      blueprints: ["dig", "log", "Shed"],
      band: "miner",
    });
    expect(v.conflicts).toEqual(["dig", "log", "Shed"]);
    expect(parseLine("dig", v)).toMatchObject({ command: { kind: "dig" } });
    expect(parseLine("log", v)).toMatchObject({ command: { kind: "arm", block: "oak-log" } });
  });
});

const arm = (block: string): Command => ({ kind: "arm", block });

describe("parseLine: the table", () => {
  const table: [text: string, expected: object][] = [
    ["", { kind: "empty" }],
    // Whole words that nothing longer starts with run by themselves.
    ["put", { kind: "command", command: { kind: "put" }, auto: true }],
    ["dig", { kind: "command", command: { kind: "dig" }, auto: true }],
    ["undo", { kind: "command", command: { kind: "undo" }, auto: true }],
    ["planks", { kind: "command", command: arm("oak-planks"), auto: true }],
    ["log", { kind: "command", command: arm("oak-log"), auto: true }],
    ["bluebell", { kind: "command", command: arm("bluebells"), auto: true }],
    ["house", { kind: "command", command: { kind: "blueprint", name: "house" }, auto: true }],
    // Prefix ambiguity: a longer word starts with this one, so it waits for Space or Enter.
    ["blue", { kind: "command", command: arm("blue-wool"), auto: false, longer: ["bluebell"] }],
    // The start of words.
    ["p", { kind: "partial", completions: ["put", "puff", "planks"] }],
    ["pu", { kind: "partial", completions: ["put", "puff"] }],
    ["plan", { kind: "partial", completions: ["planks"] }],
    ["di", { kind: "partial", completions: ["dig", "dirt"] }],
    ["u", { kind: "partial", completions: ["undo", "up"] }],
    // Directions always wait: a number may follow.
    ["east", { kind: "direction", dir: "east", spaced: false }],
    ["east ", { kind: "direction", dir: "east", spaced: true }],
    ["up", { kind: "direction", dir: "up", spaced: false }],
    // Numbers: one digit, 1 to 9, and it runs on the digit.
    ["east 3", { kind: "command", command: { kind: "move", dir: "east", steps: 3 }, auto: true }],
    ["up 1", { kind: "command", command: { kind: "move", dir: "up", steps: 1 }, auto: true }],
    ["west 9", { kind: "command", command: { kind: "move", dir: "west", steps: 9 }, auto: true }],
    ["east 0", { kind: "unknown", suggestions: ["east"] }],
    ["east 12", { kind: "unknown", suggestions: ["east"] }],
    ["east x", { kind: "unknown", suggestions: ["east"] }],
    ["east  3", { kind: "unknown", suggestions: ["east"] }],
    // A number only follows a direction.
    ["put 3", { kind: "unknown" }],
    ["planks 2", { kind: "unknown" }],
    // Unknown words: nearest words first, never an error.
    ["oak", { kind: "unknown", suggestions: [] }],
    ["plant", { kind: "unknown", suggestions: ["planks", "put", "puff"] }],
    ["digs", { kind: "unknown", suggestions: ["dig", "dirt", "down"] }],
    ["zzz", { kind: "unknown", suggestions: [] }],
    ["3", { kind: "unknown", suggestions: [] }],
  ];
  it.each(table)("%j", (text, expected) => {
    expect(parseLine(text, miner)).toMatchObject(expected);
  });

  it(`takes steps 1 to ${MAX_STEPS} for every direction`, () => {
    for (const dir of DIRECTIONS) {
      for (let steps = 1; steps <= MAX_STEPS; steps++) {
        expect(parseLine(`${dir} ${steps}`, miner)).toMatchObject({
          command: { kind: "move", dir, steps },
          auto: true,
        });
      }
    }
  });

  it("never throws, whatever the text (seed 4707)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), (text) => {
        expect(["empty", "command", "direction", "partial", "unknown"]).toContain(
          parseLine(text, miner).kind,
        );
      }),
      { seed: 4707, numRuns: 500 },
    );
  });

  it("auto-run is exactly: a whole word that no longer word starts with", () => {
    for (const w of miner.words) {
      const p = parseLine(w.word, miner);
      const longer = miner.words.filter((o) => o.word !== w.word && o.word.startsWith(w.word));
      if (w.command.kind === "direction") expect(p.kind).toBe("direction");
      else expect(p).toMatchObject({ kind: "command", auto: longer.length === 0 });
    }
  });
});

describe("typeKey", () => {
  it("runs a word on its last letter, with no space (decision 81)", () => {
    const r = type("put");
    expect(r.runs).toEqual([{ kind: "put" }]);
    expect(r.ran).toEqual(["put"]);
    expect(r.state).toEqual({ ...EMPTY_LINE, habit: true });
  });

  it("arms a block by its name", () => {
    expect(type("planks").runs).toEqual([{ kind: "arm", block: "oak-planks" }]);
  });

  it("Space on an empty line is put, and types no word", () => {
    const r = type(" ");
    expect(r.runs).toEqual([{ kind: "put" }]);
    expect(r.ran).toEqual([null]);
  });

  it("Enter on an empty line does nothing", () => {
    const r = type(">");
    expect(r.runs).toEqual([]);
    expect(r.hints).toEqual([]);
  });

  it("`blue` waits; Space or Enter runs it; more letters make bluebell", () => {
    expect(type("blue").runs).toEqual([]);
    expect(type("blue").state.text).toBe("blue");
    expect(type("blue ").runs).toEqual([{ kind: "arm", block: "blue-wool" }]);
    expect(type("blue>").runs).toEqual([{ kind: "arm", block: "blue-wool" }]);
    expect(type("bluebell").runs).toEqual([{ kind: "arm", block: "bluebells" }]);
  });

  it("a direction waits; Enter moves one step", () => {
    expect(type("east").runs).toEqual([]);
    const r = type("east>");
    expect(r.runs).toEqual([{ kind: "move", dir: "east", steps: 1 }]);
    expect(r.ran).toEqual(["east"]);
  });

  it("a direction, Space, a digit: runs on the digit", () => {
    const r = type("east 2");
    expect(r.runs).toEqual([{ kind: "move", dir: "east", steps: 2 }]);
    expect(r.ran).toEqual(["east 2"]);
    expect(r.state).toEqual({ ...EMPTY_LINE, habit: true });
  });

  it("a direction, Space, then Space or Enter with no number: one step", () => {
    expect(type("up  ").runs).toEqual([{ kind: "move", dir: "up", steps: 1 }]);
    expect(type("up >").runs).toEqual([{ kind: "move", dir: "up", steps: 1 }]);
  });

  it("0 after a direction doesn't go in, and the hint asks for 1 to 9", () => {
    const r = type("east 0");
    expect(r.state.text).toBe("east ");
    expect(r.rejected).toEqual(["0"]);
    expect(r.hints).toEqual([{ key: "builder.hint.number", params: { max: MAX_STEPS } }]);
  });

  it("a key that fits no word stays out of the line and gets a gentle hint", () => {
    const r = type("plx");
    expect(r.state.text).toBe("pl");
    expect(r.rejected).toEqual(["x"]);
    expect(r.hints).toEqual([{ key: "builder.hint.keepGoing", params: { word: "planks" } }]);
    // The child carries on from where they were.
    expect(type("plxanks").runs).toEqual([{ kind: "arm", block: "oak-planks" }]);
  });

  it("with several words that fit, the hint lists them", () => {
    expect(type("dx").hints).toEqual([
      { key: "builder.hint.oneOf", params: { words: "dig, down, dirt" } },
    ]);
  });

  it("a first key that starts no word: a hint, never an error", () => {
    const r = type("o");
    expect(r.state).toEqual(EMPTY_LINE);
    expect(r.hints).toEqual([{ key: "builder.hint.tryWord" }]);
  });

  it("Space or Enter on a half word says how to go on", () => {
    expect(type("plan ").hints).toEqual([
      { key: "builder.hint.keepGoing", params: { word: "planks" } },
    ]);
    expect(type("pu>").hints).toEqual([
      { key: "builder.hint.oneOf", params: { words: "put, puff" } },
    ]);
    expect(type("plan ").state.text).toBe("plan");
  });

  it("Backspace takes one letter back, and is quiet on an empty line", () => {
    expect(type("pla<").state.text).toBe("pl");
    expect(type("east <").state.text).toBe("east");
    const r = type("<");
    expect(r.state).toEqual(EMPTY_LINE);
    expect(r.rejected).toEqual(["<"]);
  });

  it("capital letters count as their small letters (Caps Lock, Shift)", () => {
    expect(type("PUT").runs).toEqual([{ kind: "put" }]);
  });

  it("every feedback is a hint key in the builder namespace (seed 4707)", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 10, unit: fc.constantFrom(...Array.from("abdeglnoprstuw 0123x")) }),
        (s) => {
          for (const h of type(s).hints) expect(h.key.startsWith("builder.hint.")).toBe(true);
        },
      ),
      { seed: 4707, numRuns: 400 },
    );
  });

  it("the line is always the start of something the parser knows (seed 4707)", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 14, unit: fc.constantFrom(...Array.from("abdeiklnoprstuw 12x")) }),
        (s) => {
          expect(parseLine(type(s).state.text, miner).kind).not.toBe("unknown");
        },
      ),
      { seed: 4707, numRuns: 600 },
    );
  });
});

/** What ran, in order: `put`, `arm`, `east 2`… */
const kinds = (keys: string, vocab: Vocabulary = miner): string[] =>
  type(keys, vocab).runs.map((c) => (c.kind === "move" ? `${c.dir} ${c.steps}` : c.kind));

describe("the habit space (review B1)", () => {
  const table: [keys: string, runs: string[]][] = [
    // The reviewer's sequence: two puts, not five.
    ["planks put east 2 put", ["arm", "put", "east 2", "put"]],
    ["planks put", ["arm", "put"]],
    ["put put put", ["put", "put", "put"]],
    ["dig undo ", ["dig", "undo"]],
    // One Space is the habit space; the next one is a deliberate put.
    ["put ", ["put"]],
    ["put  ", ["put", "put"]],
    ["put   ", ["put", "put", "put"]],
    ["east 2 ", ["east 2"]],
    ["east 2  ", ["east 2", "put"]],
    // Space with no word before it is put, as the card says.
    [" ", ["put"]],
    ["  ", ["put", "put"]],
    // A word that Space or Enter ran has had its Space already.
    ["blue ", ["arm"]],
    ["blue  ", ["arm", "put"]],
    ["blue> ", ["arm", "put"]],
    ["east> ", ["east 1", "put"]],
    ["up  ", ["up 1"]],
    ["up   ", ["up 1", "put"]],
    // Any other key ends the wait for a habit space.
    ["putx ", ["put", "put"]],
    ["put< ", ["put", "put"]],
    ["put> ", ["put", "put"]],
  ];
  it.each(table)("%j runs %j", (keys, runs) => {
    expect(kinds(keys)).toEqual(runs);
  });

  it("the habit space goes in quietly: no hint, and it is no word", () => {
    const r = type("put ");
    expect(r.hints).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(r.ran).toEqual(["put"]);
    expect(r.state).toEqual(EMPTY_LINE);
  });

  it("after a Sprout types a block's whole name, the habit space still follows", () => {
    expect(kinds("dirt put", sprout)).toEqual(["arm", "put"]);
    expect(kinds("dir put", sprout)).toEqual(["arm", "put"]);
    expect(kinds("dirt  ", sprout)).toEqual(["arm", "put"]);
  });

  it("settled() forgets the habit space and a half-finished name, and keeps the text", () => {
    expect(settled(type("put").state)).toEqual(EMPTY_LINE);
    expect(settled(type("dir", sprout).state)).toEqual(EMPTY_LINE);
    expect(settled(type("pla").state)).toEqual({ ...EMPTY_LINE, text: "pla" });
    expect(type(" ", miner, settled(type("put").state)).runs).toEqual([{ kind: "put" }]);
  });

  it("with a space after every word, each word runs exactly once (seed 4707)", () => {
    const words = miner.words.filter((w) => w.command.kind !== "direction").map((w) => w.word);
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 6 }), (list) => {
        const spaced = list.map((w) => (parseLine(w, miner).kind === "command" ? w : "")).join(" ");
        const r = type(`${spaced} `);
        expect(r.runs).toHaveLength(list.length);
        expect(r.hints).toEqual([]);
      }),
      { seed: 4707, numRuns: 300 },
    );
  });
});

describe("what the HUD shows", () => {
  it("completes a word when only one fits", () => {
    expect(completionOf("plan", miner)).toBe("ks");
    expect(completionOf("pu", miner)).toBe("");
    expect(completionOf("", miner)).toBe("");
  });

  it("shows the Space key for a word that waits", () => {
    expect(waitsForSpace("blue", miner)).toBe(true);
    expect(waitsForSpace("east", miner)).toBe(true);
    expect(waitsForSpace("east ", miner)).toBe(true);
    expect(waitsForSpace("blu", miner)).toBe(false);
  });
});

describe("Sprout codes", () => {
  it("shortCode: three letters, or more until no other word starts with them", () => {
    expect(shortCode("dirt", ["dig", "down"])).toBe("dir");
    expect(shortCode("grass", ["gravel", "green"])).toBe("gras");
    expect(shortCode("log", ["lantern"])).toBe("log");
    // No free start: the whole name.
    expect(shortCode("blue", ["bluebell"])).toBe("blue");
  });

  it("gives every block a code of 3 or more letters that starts its name", () => {
    for (const b of placeable) {
      const code = sprout.wordOf(b.id) ?? "";
      expect(code.length).toBeGreaterThanOrEqual(3);
      expect(b.typedName.startsWith(code)).toBe(true);
    }
    expect(sprout.wordOf("dirt")).toBe("dir");
    expect(sprout.wordOf("oak-planks")).toBe("pla");
    expect(sprout.wordOf("grass")).toBe("gras");
    expect(sprout.wordOf("gravel")).toBe("grav");
    expect(sprout.wordOf("oak-log")).toBe("log");
  });

  it("most codes are exactly 3 letters", () => {
    const codes = placeable.map((b) => sprout.wordOf(b.id) ?? "");
    expect(codes.filter((c) => c.length === 3).length).toBeGreaterThanOrEqual(codes.length - 6);
  });

  it("a code runs on its last letter, except a name another name starts with", () => {
    for (const b of placeable) {
      const code = sprout.wordOf(b.id) ?? "";
      const waits = placeable.some((o) => o.id !== b.id && o.typedName.startsWith(b.typedName));
      const r = type(code, sprout);
      expect(r.runs, code).toEqual(waits ? [] : [{ kind: "arm", block: b.id }]);
    }
  });

  it("the rest of the name may still be typed, quietly", () => {
    const r = type("dirt", sprout);
    expect(r.runs).toEqual([{ kind: "arm", block: "dirt" }]);
    expect(r.ran).toEqual(["dir"]);
    expect(r.hints).toEqual([]);
    expect(r.rejected).toEqual([]);
    // The `t` is kept in case it starts the next word; the line itself is empty.
    expect(r.state).toEqual({ text: "", tail: "", eaten: "t", habit: true });
    // And the next word starts clean.
    expect(type("dirtput", sprout).runs).toEqual([{ kind: "arm", block: "dirt" }, { kind: "put" }]);
    // Leaving the name half done is fine too.
    expect(type("plandig", sprout).runs).toEqual([
      { kind: "arm", block: "oak-planks" },
      { kind: "dig" },
    ]);
  });

  it("a new word that starts like the rest of the name gets its letters back (review N1)", () => {
    // `pla` leaves `nks`; `north` starts with that `n`.
    const r = type("planorth>", sprout);
    expect(r.runs).toEqual([
      { kind: "arm", block: "oak-planks" },
      { kind: "move", dir: "north", steps: 1 },
    ]);
    expect(r.ran).toEqual(["pla", "north"]);
    expect(r.hints).toEqual([]);
    expect(r.rejected).toEqual([]);
    // The line shows the letters as soon as they stop being the name.
    expect(type("plano", sprout).state.text).toBe("no");
    expect(typeKey(type("plan", sprout).state, "o", sprout).replayed).toBe(1);
    // Two letters deep, and into a word that runs by itself.
    expect(type("stonorth>", sprout).runs).toHaveLength(2);
    // The reviewer's other cases: a one-letter rest of the name (`gras` + `s`).
    for (const word of ["south>", "sand", "stone"]) {
      const after = type(`gras${word}`, sprout);
      expect(after.runs, word).toHaveLength(2);
      expect(after.hints, word).toEqual([]);
    }
    // And the whole name, then a word that starts with its last letter.
    expect(kinds("grass sand", sprout)).toEqual(["arm", "arm"]);
    expect(kinds("grasssand", sprout)).toEqual(["arm", "arm"]);
    expect(type("cobbri", sprout).runs).toEqual([
      { kind: "arm", block: "cobble" },
      { kind: "arm", block: "brick" },
    ]);
  });

  it("after any code, any word can be typed with nothing lost", () => {
    let pairs = 0;
    for (const b of placeable) {
      const code = sprout.wordOf(b.id) ?? "";
      const armed = type(code, sprout);
      if (armed.runs.length === 0) continue; // a code that waits for Space (`blue`)
      for (const w of sprout.words) {
        const want = parseLine(w.word, sprout);
        const auto = want.kind === "command" && want.auto;
        const r = type(auto ? w.word : `${w.word}>`, sprout, armed.state);
        expect(r.hints, `${code} ${w.word}`).toEqual([]);
        expect(r.rejected, `${code} ${w.word}`).toEqual([]);
        expect(r.runs, `${code} ${w.word}`).toHaveLength(1);
        if (want.kind === "command") expect(r.runs[0]).toEqual(want.command);
        pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThan(700);
  });

  it("a letter that fits neither the name nor a word after its letters starts from an empty line", () => {
    // `plan` then `dig`: the `n` was part of the name, left unfinished.
    expect(type("plandig", sprout).runs).toEqual([
      { kind: "arm", block: "oak-planks" },
      { kind: "dig" },
    ]);
    const r = type("planx", sprout);
    expect(r.state.text).toBe("");
    expect(r.rejected).toEqual(["x"]);
    expect(r.hints).toEqual([{ key: "builder.hint.tryWord" }]);
  });

  it("held letters that don't all fit a new word stay the name: no letter is dropped (review N-B)", () => {
    // `plank` then `o`: `n` would start `north`, but `nk` starts nothing. The line must not
    // become `no` with the `k` gone.
    const r = type("planko", sprout);
    expect(r.runs).toEqual([{ kind: "arm", block: "oak-planks" }]);
    expect(r.state.text).toBe("");
    expect(r.rejected).toEqual(["o"]);
    expect(typeKey(type("plank", sprout).state, "o", sprout).replayed).toBe(0);
    // The whole name still works, and so does a new word after the part that fit.
    expect(type("planksdig", sprout).runs).toHaveLength(2);
    expect(type("plankdig", sprout).runs).toEqual([
      { kind: "arm", block: "oak-planks" },
      { kind: "dig" },
    ]);
  });

  it("Miner and Builder type the whole name", () => {
    expect(miner.wordOf("dirt")).toBe("dirt");
    expect(type("dir").runs).toEqual([]);
  });

  it("commands and directions are the same words for every band", () => {
    for (const w of ["put", "dig", "undo", ...DIRECTIONS]) {
      expect(sprout.words.some((x) => x.word === w)).toBe(true);
    }
  });
});
