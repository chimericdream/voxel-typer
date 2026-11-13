/**
 * The parent gate (task M3-08, PLAN.md §4.4 and §6.7): "Grown-ups: type the word **harbor** to
 * continue." It guards the Settings → Grown-ups tab and, through {@link useParentGate}, every
 * profile change on "Who is playing?" (M3-09's `requireGrownUp(action)`).
 *
 * It is a speed bump, not security. A 10-year-old Builder can read the word and type it; the point
 * is that a young child doesn't wander into "delete" by pressing keys. Nothing here is secret.
 *
 * - The word is a random 6–8 letter word from the shipped Builder word lists (already checked by
 *   the word-list validator for safety), picked through a seeded {@link Rng}. Tests inject one.
 * - Case and spaces at the ends don't matter.
 * - {@link GATE_TRIES} wrong tries start a {@link GATE_COOLDOWN_MS} cool-down. The tries and the
 *   cool-down are shared app-wide ({@link appGateTracker}), so closing the gate and opening it
 *   again doesn't reset them. A reload does; that is fine for a speed bump.
 *
 * The gate renders inline: inside a Settings tab panel, or inside a caller's dialog (a second modal
 * `<dialog>` would break the first one's focus trap). Its text field carries `data-autofocus`, and
 * the gate also focuses it on mount.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { realClock } from "@/app/clock";
import birchBuilder from "@/content/wordlists/birch-builder.txt?raw";
import shoreBuilder from "@/content/wordlists/shore-builder.txt?raw";
import { createRng } from "@/engine/rng";
import type { Rng } from "@/engine/rng";
import { t } from "@/i18n";
import type { Ms } from "@/types/core";
import { Button } from "@/ui/kit/Button";
import styles from "./ParentGate.module.css";

/** Wrong tries before the cool-down. */
export const GATE_TRIES = 3;
/** How long the gate rests after {@link GATE_TRIES} wrong tries. */
export const GATE_COOLDOWN_MS: Ms = 30_000;

/** What a grown-up is asked to allow. M3-09's three, the Settings tab, and the Parent Dashboard. */
export type GrownUpAction =
  | "renameProfile"
  | "changeBand"
  | "deleteProfile"
  | "grownUps"
  | "parentDashboard";

let handedPass = false;

/**
 * Carries one passed gate to the next screen (M3-11): Settings → Grown-ups was already unlocked,
 * so its "See progress" button hands the pass to the Parent Dashboard instead of asking again.
 * The pass is used once; a direct visit to the dashboard still asks.
 */
export function handGrownUpPass(): void {
  handedPass = true;
}

/** True once, after {@link handGrownUpPass}. */
export function takeGrownUpPass(): boolean {
  const had = handedPass;
  handedPass = false;
  return had;
}

/** Gate words: plain lowercase words of 6–8 letters from list files' text (comments skipped). */
export function gateWords(...texts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^[a-z]{6,8}$/.test(line)) out.add(line);
    }
  }
  return [...out];
}

/** The shipped gate words (Builder band). */
export const GATE_WORDS: readonly string[] = gateWords(birchBuilder, shoreBuilder);

/** A random gate word, different from `avoid` when there is a choice. */
export function pickGateWord(rng: Rng, words: readonly string[], avoid?: string): string {
  const pool = words.length > 1 && avoid !== undefined ? words.filter((w) => w !== avoid) : words;
  return rng.pick(pool);
}

/** True when `typed` is the gate word. Case and spaces at the ends don't matter. */
export function wordMatches(typed: string, word: string): boolean {
  return typed.trim().toLocaleLowerCase("en") === word.toLocaleLowerCase("en");
}

export type GateOutcome = "pass" | "retry" | "rest";

/** Tries and cool-down. Times come in as parameters, so it is easy to test. */
export interface GateTracker {
  /** Ms left in the cool-down at `now` (0 when the gate is open for tries). */
  restLeft(now: Ms): number;
  /** Wrong tries left before the cool-down. */
  triesLeft(now: Ms): number;
  /** Records a try. A pass resets the count. While resting, every try is "rest". */
  attempt(ok: boolean, now: Ms): GateOutcome;
}

export function createGateTracker(
  tries: number = GATE_TRIES,
  cooldownMs: Ms = GATE_COOLDOWN_MS,
): GateTracker {
  let wrong = 0;
  let until = -Infinity;
  const settle = (now: Ms): void => {
    if (until !== -Infinity && now >= until) {
      until = -Infinity;
      wrong = 0;
    }
  };
  return {
    restLeft(now) {
      settle(now);
      return until === -Infinity ? 0 : Math.max(0, until - now);
    },
    triesLeft(now) {
      settle(now);
      return Math.max(0, tries - wrong);
    },
    attempt(ok, now) {
      settle(now);
      if (until !== -Infinity) return "rest";
      if (ok) {
        wrong = 0;
        return "pass";
      }
      wrong += 1;
      if (wrong < tries) return "retry";
      until = now + cooldownMs;
      return "rest";
    },
  };
}

let shared: GateTracker | null = null;
/** The app's one tracker, so the count survives closing and reopening the gate. */
export function appGateTracker(): GateTracker {
  shared ??= createGateTracker();
  return shared;
}

/** A fresh seed for the gate's word stream (UI code; never in a pure zone). */
function freshSeed(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] ?? 1;
}

let sharedRng: Rng | null = null;
const appGateRng = (): Rng => {
  sharedRng ??= createRng(freshSeed()).fork("parent-gate");
  return sharedRng;
};

export interface ParentGateProps {
  /** What the grown-up is allowing; picks the line under the word. */
  action: GrownUpAction;
  onPass: () => void;
  onCancel: () => void;
  /** Tests inject these. Defaults: a crypto-seeded stream, the real clock, the app tracker. */
  rng?: Rng;
  now?: () => Ms;
  tracker?: GateTracker;
  words?: readonly string[];
}

export function ParentGate({
  action,
  onPass,
  onCancel,
  rng,
  now = () => realClock.now(),
  tracker,
  words = GATE_WORDS,
}: ParentGateProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [gate] = useState(() => tracker ?? appGateTracker());
  const [stream] = useState(() => rng ?? appGateRng());
  const [word, setWord] = useState(() => pickGateWord(stream, words));
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<"miss" | null>(null);
  const [rest, setRest] = useState(() => gate.restLeft(now()));
  // The first clock is kept, so the countdown timer needs no dependency on it.
  const [clock] = useState(() => now);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // While resting, count down once a second; at the end, a new word and a fresh start.
  const resting = rest > 0;
  useEffect(() => {
    if (!resting) return undefined;
    const timer = setInterval(() => {
      const left = gate.restLeft(clock());
      setRest(left);
      if (left === 0) {
        setWord((w) => pickGateWord(stream, words, w));
        setNote(null);
        setTyped("");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [resting, gate, stream, words, clock]);

  useEffect(() => {
    if (!resting) input.current?.focus();
  }, [resting]);

  const submit = (e: Event): void => {
    e.preventDefault();
    if (resting) return;
    const outcome = gate.attempt(wordMatches(typed, word), now());
    if (outcome === "pass") {
      onPass();
      return;
    }
    setTyped("");
    if (outcome === "rest") {
      setRest(gate.restLeft(now()));
      setNote(null);
    } else {
      setNote("miss");
      input.current?.focus();
    }
  };

  const seconds = Math.ceil(rest / 1000);
  const left = gate.triesLeft(now());

  return (
    <form class={styles.gate} data-gate={action} onSubmit={submit} noValidate>
      <p class={styles.title}>{t("settings.gate.title")}</p>
      <p class={styles.ask} id={`${id}-ask`}>
        {t("settings.gate.ask")}{" "}
        <strong class={styles.word} data-gate-word="">
          {word}
        </strong>
      </p>
      <p class={styles.why}>{t(`settings.gate.why.${action}`)}</p>
      <label class={styles.label} for={`${id}-field`}>
        {t("settings.gate.label")}
      </label>
      <input
        ref={input}
        id={`${id}-field`}
        class={styles.field}
        type="text"
        value={typed}
        disabled={resting}
        autoComplete="off"
        autoCapitalize="off"
        spellcheck={false}
        maxLength={32}
        data-autofocus=""
        aria-describedby={`${id}-ask ${id}-note`}
        aria-invalid={note === "miss"}
        onInput={(e) => setTyped(e.currentTarget.value)}
        onKeyDown={(e) => {
          // A held Enter must not try again and again.
          if (e.repeat && e.key === "Enter") e.preventDefault();
        }}
      />
      <output class={styles.note} id={`${id}-note`} data-gate-note="">
        {resting
          ? t("settings.gate.rest", { seconds })
          : note === "miss"
            ? t("settings.gate.miss", { count: left })
            : null}
      </output>
      <div class={styles.actions}>
        <Button variant="primary" type="submit" disabled={resting}>
          {t("settings.gate.go")}
        </Button>
        <Button onClick={onCancel}>{t("settings.gate.cancel")}</Button>
      </div>
    </form>
  );
}

/** M3-09's hook shape: ask, show the question in place of your content, answer. */
export interface GrownUpGate {
  /** Asks for a grown-up. Resolves true on a pass, false on "Not now" or if the asker goes away. */
  requireGrownUp(action: GrownUpAction): Promise<boolean>;
  /** The gate while one is open, else null. Render it in place of your content. */
  view: ComponentChildren;
  /** True while a gate is open. */
  asking: boolean;
  /** Closes an open gate as a "no". */
  cancel(): void;
}

/** Holds the open question's resolver; methods, so no hook value is reassigned in render. */
function createPending() {
  let resolve: ((ok: boolean) => void) | null = null;
  return {
    answer(ok: boolean): void {
      const r = resolve;
      resolve = null;
      r?.(ok);
    },
    open(): Promise<boolean> {
      this.answer(false);
      return new Promise<boolean>((r) => {
        resolve = r;
      });
    },
  };
}

/**
 * The parent gate as a hook (drop-in for M3-09's `useGrownUpGate`). `view` is the gate while one
 * is open; render it inline, inside your dialog if you have one.
 */
export function useParentGate(): GrownUpGate {
  const [action, setAction] = useState<GrownUpAction | null>(null);
  const [pending] = useState(createPending);
  // A new key per question, so each one starts with a fresh word and an empty field.
  const [ask, setAsk] = useState(0);

  const settle = (ok: boolean): void => {
    setAction(null);
    pending.answer(ok);
  };

  useEffect(() => () => pending.answer(false), [pending]);

  const requireGrownUp = (a: GrownUpAction): Promise<boolean> => {
    const asked = pending.open();
    setAsk((n) => n + 1);
    setAction(a);
    return asked;
  };

  const view =
    action === null ? null : (
      <ParentGate
        key={ask}
        action={action}
        onPass={() => settle(true)}
        onCancel={() => settle(false)}
      />
    );

  return { requireGrownUp, view, asking: action !== null, cancel: () => settle(false) };
}
