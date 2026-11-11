# Contracts

> **FROZEN 2026-11-11** (M1-01 merged as 9564af6; pre-freeze corrections from its review are folded in, see `docs/decisions.md` #46–53). Change a contract only through `README.md` §4.3.

These are the interfaces between modules. Workers build against them in parallel, so they are **frozen** once task M1-01 merges them into `src/` as real `.ts` files. To change one, follow `README.md` §4.3.

The code blocks here are the source of truth for **shape and meaning**. M1-01 copies them into the listed files verbatim (adding only doc comments and obvious imports). If a block here and the file in `src/` disagree, the file in `src/` wins once merged, and this doc is updated to match.

---

## 0. File ownership and shared files

Most conflicts in multi-agent work come from a few shared files. This project avoids them with **auto-discovery** and **per-area files**:

| Concern | Pattern | Rule |
|---|---|---|
| Game modes | `src/modes/<mode>/index.ts`, discovered by `import.meta.glob` in `src/modes/registry.ts` | Workers add a folder; never edit `registry.ts` |
| Lessons | `src/content/lessons/<biome>.ts`, each exporting `lessons: Lesson[]`, aggregated by glob in `src/content/lessons/index.ts` | One file per biome |
| Word lists | `src/content/wordlists/<pool-id>.txt` + entry in that folder's `pools.ts` (append-only, one line per pool) | Append-only |
| Blocks | `src/content/blocks/<group>.ts` (`terrain.ts`, `ores.ts`, `wood.ts`, `deco.ts`, …), aggregated by glob | One file per group |
| Mobs & bosses | `src/content/mobs/<id>.model.json` + `<id>.ts` | One pair per creature |
| Achievements | `src/content/achievements/<area>.ts` | One file per area |
| i18n strings | `src/i18n/en/<namespace>.ts`, aggregated in `src/i18n/en/index.ts` | Each task owns its namespace file; adding a namespace = one import line in `index.ts` (append-only) |
| Screens | `src/ui/screens/<Screen>.tsx` + a route entry in `src/app/routes.ts` (append-only) | Append-only |
| Settings fields | `src/save/settings.ts` | **Orchestrator-owned**: request new fields in the handoff note |
| Save schema & migrations | `src/save/schema.ts`, `src/save/migrations.ts` | **Orchestrator-owned** after M1-09 |
| Shared types | `src/engine/types.ts`, `src/types/*.ts` | **Orchestrator-owned** after M1-01 |
| Content loaders | `src/content/collect.ts`, `src/content/*/load.ts`, `src/content/layouts/types.ts` | **Orchestrator-owned** after M1-01. Each content folder has a Vite-only `index.ts` aggregator (`import.meta.glob`, used by the app) and a pure `load.ts` that takes already-loaded modules, so `tools/*.ts` (tsx, no `import.meta.glob`) can feed it with direct imports or `node:fs` |
| `package.json` deps | — | Any worker may add; note it in handoff; lockfile per `README.md` §3.4 |
| `docs/decisions.md`, `docs/progress.md` | — | **Orchestrator-owned**; workers write decisions in their handoff note |

"Append-only" means: add new lines at the end, don't reorder or edit others' lines. Git merges these cleanly almost always.

---

## 1. Shared primitive types (`src/types/core.ts`)

```ts
export type Ms = number;                      // milliseconds, from performance.now() or a test clock
export type EpochMs = number;                 // wall-clock ms since epoch (Date.now()), for save timestamps only
export type AgeBand = 'sprout' | 'miner' | 'builder';
export type BiomeId =
  | 'meadow' | 'birch' | 'shore' | 'frosty' | 'mines'
  | 'marsh' | 'caverns' | 'sparkstone' | 'citadel';
export type GameModeId =
  | 'mine' | 'defense' | 'minecart' | 'builder' | 'boss' | 'daily' | 'practice' | 'placement';
export type LessonId = string;                // "<biome>-<2-digit order>", e.g. "meadow-03"; remedial: "remedial-<hash>"
export type BlockId = string;                 // kebab-case slug, e.g. "oak-planks"
export type AchievementId = string;           // kebab-case slug
export type QualityLevel = 'low' | 'medium' | 'high';
export type TimeOfDay = 'day' | 'dusk' | 'night' | 'dawn';
export type Finger = 'L5' | 'L4' | 'L3' | 'L2' | 'R2' | 'R3' | 'R4' | 'R5' | 'T';  // 5=pinky … 2=index, T=thumb
export type Material = 'dirt' | 'stone' | 'wood' | 'glass' | 'wool' | 'sand' | 'snow' | 'crystal' | 'metal' | 'leaf';  // block material (sound + particles); re-exported from src/audio/types.ts
```

Biome order (curriculum order) is exported as `BIOME_ORDER: readonly BiomeId[]` in the same file:
`meadow, birch, shore, frosty, mines, marsh, caverns, sparkstone, citadel`.

`src/types/` is a **pure zone** (it holds only types and `BIOME_ORDER`), so pure code may import its runtime values.

**Provisional types.** The contracts below use four types they never define. M1-01 gave each a minimal shape marked `PROVISIONAL` in its doc comment; the named card owns the final shape and may change it without a contract change request, as long as it updates every user in the same PR:

| Type | Lives in | Final shape owned by |
|---|---|---|
| `Palette`, `PaletteRampId` | `src/render/atlas/recipes.ts` | M1-14 (make `PaletteRampId` a union of ramp names before M2-04 writes block recipes) |
| `LootTable` | `src/content/loot/types.ts` | M2-04 (also add whatever `rollLoot`'s `ctx` needs for "epic only on ore-vein bonus") |
| `LiteCanvas` | `src/render/types.ts` | M6-04 |

---

## 2. Seeded randomness (`src/engine/rng.ts`)

```ts
export interface Rng {
  next(): number;                              // [0, 1)
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;             // throws on empty array
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  shuffle<T>(items: readonly T[]): T[];        // returns a new array (Fisher–Yates)
  fork(label: string): Rng;                    // independent child stream, deterministic per (parent seed, label)
  readonly seed: number;
}
export function createRng(seed: number | string): Rng;   // string seeds hashed with cyrb53 → 32-bit
export function hashString(s: string): number;            // cyrb53, truncated to uint32
export function dailySeed(localDate: { y: number; m: number; d: number }): string;  // "daily-YYYY-MM-DD"
```

Algorithm: **sfc32** seeded via splitmix32 from the 32-bit seed. Fixed so that test fixtures stay valid. A golden test pins the first 10 outputs of `createRng(42)` and `createRng('voxel')`.

---

## 3. Typing engine (`src/engine/types.ts`, `session.ts`, `matcher.ts`)

### 3.1 Input

```ts
export interface KeyInput {
  key: string;            // KeyboardEvent.key after normalization (§9). Single printable char, or 'Backspace'.
  t: Ms;
  shift: boolean;
  code?: string;          // KeyboardEvent.code, for the on-screen keyboard only. The engine ignores it.
}
```

### 3.2 Configuration

```ts
export type WrongKeyPolicy = 'stay' | 'skip' | 'backspace';
// stay:      cursor does not move on a wrong key; the learner must hit the right one. Error counted once per position
//            (repeated wrong keys at the same position count as additional keystrokes but only ONE uncorrected position).
// skip:      cursor advances; the position is marked wrong; counts as an uncorrected error.
// backspace: cursor advances showing the wrong char; learner must Backspace to fix before the target completes.
//            A target cannot complete while it holds wrong chars. Fixed positions count as corrected errors.

export type TargetingMode = 'sequential' | 'lockOn';
// sequential: targets are typed in array order (Mine, Minecart, practice).
// lockOn:     no target is active until the learner types a char that starts some unlocked target; ties go to the
//             target with the lowest `priority` value, then the earliest added. While locked, input goes to that target
//             only. A wrong key while locked follows the policy. Backspace with 0 typed chars unlocks; under `stay`,
//             Backspace while locked unlocks and resets the target (Defense, Boss).

export interface Target {
  id: string;
  text: string;           // exact text to type; no leading/trailing whitespace
  priority?: number;      // lockOn tie-break; lower = preferred (e.g. the mob closest to the base)
  trailingSpace?: boolean;// sequential only: require a space after the text before the next target (default true for words, false for single letters)
}

export interface SessionConfig {
  policy: WrongKeyPolicy;
  targeting: TargetingMode;
  caseSensitive: boolean;            // false only for Sprout early lessons: 'A' accepted for 'a' (never the reverse)
  end: { kind: 'targets' } | { kind: 'time'; ms: Ms } | { kind: 'manual' };
  lessonId?: LessonId;
  mode: GameModeId;
  seed: number;
}
```

### 3.3 Events

```ts
export type EngineEvent =
  | { type: 'correct'; t: Ms; targetId: string; index: number; char: string; latencyMs: Ms | null }
  | { type: 'wrong'; t: Ms; targetId: string | null; index: number | null; expected: string | null; got: string }
  | { type: 'backspace'; t: Ms; targetId: string; index: number }
  | { type: 'targetLocked'; t: Ms; targetId: string }
  | { type: 'targetUnlocked'; t: Ms; targetId: string }
  | { type: 'targetComplete'; t: Ms; targetId: string; accuracy: number; durationMs: Ms; errors: number }
  | { type: 'streak'; t: Ms; length: number }              // emitted on every correct char (length ≥ 1)
  | { type: 'streakBroken'; t: Ms; length: number }        // length before the break; only if length ≥ 1
  | { type: 'paused'; t: Ms }
  | { type: 'resumed'; t: Ms }
  | { type: 'sessionEnd'; t: Ms; summary: SessionSummary };
```

Rules:
- `wrong` with `targetId: null` is a lockOn keystroke that matched no target. It counts toward accuracy (it is a keystroke) but not toward any target's errors, and it breaks the streak.
- `latencyMs` is the time since the previous keystroke **within the same target**; `null` for the first char of a target and the first keystroke after `resumed`.
- Space between sequential targets is a real char: it produces `correct` with `char: ' '` attributed to the target it trails.
- `Backspace` under `stay` or `skip` is ignored (no event) unless `index > 0` under `skip`, where it moves back and un-marks that position. Under `backspace` it always works within the active target.
- `streak` counts consecutive correct keystrokes across targets; any `wrong` resets it.
- In `sequential`, a key fed when no target remains is ignored (no event, not a keystroke).

### 3.4 Session

```ts
export interface TypingSession {
  feed(input: KeyInput): EngineEvent[];
  addTargets(targets: Target[]): void;          // lockOn: may be called mid-session (new mobs). sequential: appends.
  removeTarget(id: string, t: Ms): EngineEvent[]; // e.g. a mob despawned; unlocks if locked; no errors counted
  pause(t: Ms): EngineEvent[];
  resume(t: Ms): EngineEvent[];
  end(t: Ms): EngineEvent[];                    // emits sessionEnd; further feeds throw
  view(): SessionView;                          // cheap read model for rendering
  snapshot(): SessionSnapshot;                  // JSON-serializable, includes the full input log
}
export function createSession(config: SessionConfig, initialTargets: Target[]): TypingSession;
export function restoreSession(snap: SessionSnapshot): TypingSession;   // replays the log; must equal the original

export interface TargetView {
  id: string; text: string;
  typed: number;                  // cursor position
  marks: ('pending' | 'ok' | 'fixed' | 'wrong')[]; // per char; text.length + 1 entries while a trailing space is required (the last is the space)
  locked: boolean; complete: boolean;
}
export interface SessionView {
  active: TargetView | null;      // sequential: current; lockOn: locked target or null
  targets: TargetView[];          // all not-yet-removed targets
  streak: number; elapsedMs: Ms; paused: boolean; ended: boolean;
  liveWpm: number; liveAccuracy: number;   // over the last 10 s of active time; 0 before 2 s of activity
}
export interface SessionSnapshot {
  version: 1; config: SessionConfig; initialTargets: Target[];
  log: ({ k: 'key'; input: KeyInput } | { k: 'add'; targets: Target[] } | { k: 'remove'; id: string; t: Ms }
       | { k: 'pause'; t: Ms } | { k: 'resume'; t: Ms } | { k: 'end'; t: Ms })[];
}
```

Time while paused does not count toward `elapsedMs`, WPM, or `end: time`. A `time` session ends on the first `feed` at or after the deadline **or** when the mode calls `end`. The engine never reads a clock.

### 3.5 Summary and stats math (`src/engine/stats.ts`)

```ts
export interface KeyAgg { attempts: number; errors: number; latencies: Ms[] }   // per expected char; latencies capped at 200 per session
export interface SessionSummary {
  lessonId?: LessonId; mode: GameModeId; seed: number;
  startedAtT: Ms; activeMs: Ms;
  keystrokes: number;              // every non-Backspace key fed while unpaused, including lockOn misses; not keys ignored in `sequential` when no target remains
  correct: number;                 // correct keystrokes (chars incl. spaces)
  errors: number;                  // wrong keystrokes
  uncorrected: number;             // positions still wrong at end (skip policy) — always 0 for stay/backspace
  grossWpm: number; netWpm: number; accuracy: number; consistency: number;
  perKey: Record<string, KeyAgg>;
  bigrams: Record<string, KeyAgg>; // keyed by the 2-char string; attributed to the second char's attempt
  longestStreak: number; targetsCompleted: number;
}
```

**Formulas (pinned; tests use hand-computed fixtures):**
- `minutes = activeMs / 60000`. If `activeMs < 1000`, all rates are 0.
- `grossWpm = (correct / 5) / minutes`
- `netWpm = max(0, grossWpm − uncorrected / minutes)`
- `accuracy = keystrokes === 0 ? 1 : correct / keystrokes` (range 0–1; shown as %)
- `consistency = 1 − min(1, population stddev(latencies) / mean(latencies))` over all non-null latencies in the session; 0 if fewer than 10 samples. Higher is steadier.
- Round only for display, never in stored values.

### 3.6 Persistent per-key stats

```ts
export interface KeyStat {
  attempts: number; errors: number;         // lifetime
  recentErrRate: number;                     // EMA, α = 0.1 per attempt
  latencyMedian: Ms | null;                  // median of `recentLatencies`
  recentLatencies: Ms[];                     // ring of last 30
  lastSeenSession: number;                   // profile's session counter when last practiced
  srs: { intervalSessions: number; dueSession: number };   // spaced repetition in "sessions", not days
}
export function foldSummaryIntoKeyStats(
  prev: Record<string, KeyStat>, summary: SessionSummary, sessionIndex: number,
): Record<string, KeyStat>;   // pure, returns a new object
```

---

## 4. Adaptive engine (`src/engine/adaptive.ts`)

```ts
export interface AdaptiveParams {
  allowed: readonly string[];       // chars the learner knows (plus space)
  focus: readonly string[];         // this lesson's new keys; always weighted up
  stats: Readonly<Record<string, KeyStat>>;
  sessionIndex: number;
  targetLatencyMs: Ms;              // band default: sprout 900, miner 500, builder 300
}
export function keyWeights(p: AdaptiveParams): Record<string, number>;
export function weakKeys(p: AdaptiveParams, n: number): string[];   // top-n by weight, excluding focus
export function dueReviewKeys(p: AdaptiveParams): string[];         // srs.dueSession ≤ sessionIndex
export function scheduleSrs(stat: KeyStat, sessionIndex: number, sessionAccuracyForKey: number): KeyStat['srs'];
```

**Weight formula (starting point; M1-05 may tune constants with the simulator and must record final values):**
```
err   = (errors_recent_smoothed)        = (stat.recentErrRate * n + 0.05 * 5) / (n + 5),  n = min(attempts, 50)
slow  = latencyMedian == null ? 0 : max(0, latencyMedian / targetLatencyMs − 1)
w     = 1 + 6 * err + 1.5 * min(slow, 2)
focus keys:  w = max(w, 3)
unseen keys (attempts < 5) in allowed: w = 2
```
**Comfort cap:** generators must keep at least 50% of generated chars from keys whose weight is within the bottom half. `keyWeights` is the input to the generator, which enforces the cap (§5).

**SRS:** `accuracyForKey ≥ 0.95` doubles `intervalSessions` (start 1, max 32); `< 0.85` resets to 1; otherwise unchanged. `dueSession = sessionIndex + intervalSessions`.

---

## 5. Content generation (`src/engine/generator.ts`) and pools

```ts
export type ContentKind = 'letters' | 'syllables' | 'words' | 'phrases' | 'sentences';
export interface WordPool { id: string; band: AgeBand | 'all'; tags: string[]; items: readonly string[] }
export interface GenerateParams {
  kind: ContentKind;
  allowed: readonly string[];       // the generator NEVER emits a char outside allowed ∪ {' '}
  weights: Record<string, number>;  // from keyWeights
  pools: readonly WordPool[];       // already filtered to the band
  length: { chars: number } | { targets: number } | { seconds: number; estWpm: number };
  minLen?: number; maxLen?: number; // per target
  capitalize?: 'none' | 'first' | 'mixed';
}
export function generateTargets(p: GenerateParams, rng: Rng): Target[];
export function typeable(text: string, allowed: ReadonlySet<string>): boolean;
```

Behavior:
- `letters`: single chars, weighted by `weights`, no char repeated more than 3 times in a row. Targets have `trailingSpace: false`.
- `syllables`: 2–3-char pseudo-syllables from allowed chars, consonant–vowel aware when vowels exist; for early home-row lessons (`a` is the only vowel), use patterns like `aa`, `as`, `sad`, `fa`.
- `words` / `phrases` / `sentences`: pick from pool items where `typeable(item, allowed)` holds, weighted by the sum of their chars' weights; enforce the comfort cap (§4) by rejection sampling with a fallback that relaxes after 200 tries (never relaxes the allowed set).
- If no pool items are typeable, fall back to `syllables` and set nothing else silently: the caller sees fewer word-like targets. The curriculum validator (M3-01) makes sure this never happens for shipped lessons.
- `{ seconds, estWpm }` converts to chars as `seconds/60 * estWpm * 5 * 1.3` (30% headroom so the learner never runs out).

---

## 6. Lessons and curriculum (`src/content/lessons/types.ts`)

```ts
export interface Lesson {
  id: LessonId; biome: BiomeId; order: number;          // order within the biome, 1-based
  titleKey: MessageKey;                                  // i18n key
  newKeys: string[]; reviewKeys: string[];               // review = earlier keys emphasized; allowed = all keys up to this lesson
  kind: ContentKind;
  pools?: string[];                                      // WordPool ids; default: pools tagged with the biome
  length: { chars: number } | { targets: number } | { seconds: number };
  mode: GameModeId;                                      // preferred mode; see fallback rule §7.3
  targets: { accuracy: number; wpmRelative?: number };   // wpmRelative: multiple of the learner's baseline net WPM
  policy?: Partial<Record<AgeBand, WrongKeyPolicy>>;     // default: sprout/miner 'stay', builder 'skip'; sentences 'backspace'
  bandScale?: Partial<Record<AgeBand, number>>;          // length multiplier; default sprout 0.6, miner 1, builder 1.3
  tags?: ('mastery' | 'boss' | 'challenge-hide-keyboard' | 'intro')[];
  caseInsensitiveFor?: AgeBand[];                        // default ['sprout'] for lessons before 'mines'
}
export function allowedKeysFor(
  lessons: readonly Lesson[], lessonId: LessonId,
  opts?: { sparkstoneUnlocked?: boolean },
): string[];  // cumulative newKeys of all earlier lessons in BIOME_ORDER, plus this lesson's (excluding sparkstone unless the lesson is in sparkstone or later and opts.sparkstoneUnlocked). Pure: callers pass the lesson list (app: the glob aggregator; tools: load.ts)
```

**Stars** (`src/engine/stars.ts`, pure):
```
stars = 1  if the lesson completed
      + 1  if accuracy ≥ max(0.90, lesson.targets.accuracy)
      + 1  if accuracy ≥ 0.95 AND (no wpmRelative OR netWpm ≥ baseline × wpmRelative)
baseline = median netWpm of the profile's last 10 summaries in mine/practice/minecart modes; if fewer than 3, wpmRelative is ignored
```

**Unlocks:** completing a lesson (any stars) unlocks the next in its biome. A biome's `mastery` lesson with ≥ 2 stars unlocks the next biome in `BIOME_ORDER` (`caverns` unlocks both `sparkstone` and `citadel`). The placement test can unlock up to the biome it estimates. Nothing ever re-locks.

---

## 7. Game modes (`src/modes/types.ts`)

```ts
export interface ModeModule {
  id: GameModeId;
  load(): Promise<{ create(ctx: ModeContext): ModeInstance }>;   // dynamic import keeps modes out of the initial bundle
}
export interface ModeContext {
  lesson: Lesson | null;              // null for free-play builder/daily/practice with ad-hoc params
  params: Record<string, unknown>;    // mode-specific extras (e.g. daily seed, custom text)
  profile: Readonly<Profile>;
  settings: Readonly<Settings>;
  band: AgeBand;
  rng: Rng;
  clock: Clock;                       // §13
  scene: SceneHandle;                 // §8
  hud: HudBridge;                     // §10
  audio: AudioApi;                    // §12
  bus: Emitter<GameEvents>;           // §7.2
  finish(result: ModeResult): void;   // exactly once; the app then shows Results
}
export interface ModeInstance {
  start(): void;
  input(k: KeyInput): void;           // already normalized; Escape/Tab never arrive here (the app handles them)
  frame(dtMs: Ms, t: Ms): void;       // called by the render loop while running
  pause(t: Ms): void; resume(t: Ms): void;
  dispose(): void;                    // must release all GPU resources and listeners
}
export interface ModeResult {
  summary: SessionSummary;
  loot: Record<BlockId, number>;
  stars: 0 | 1 | 2 | 3;               // 0 only for modes without stars (builder)
  extra?: Record<string, unknown>;
}
```

### 7.2 Game events bus (`src/app/events.ts`)
```ts
export interface Emitter<E extends Record<string, unknown>> {
  on<K extends keyof E>(k: K, fn: (e: E[K]) => void): () => void;
  emit<K extends keyof E>(k: K, e: E[K]): void;
}
export function createEmitter<E extends Record<string, unknown>>(): Emitter<E>;
export interface GameEvents {
  engine: EngineEvent;                                       // modes re-emit every engine event here
  loot: { block: BlockId; count: number; rarity: Rarity };
  achievement: { id: AchievementId };
  quality: { level: QualityLevel };
  [k: string]: unknown;                                      // modes may add namespaced events: 'defense:wave'
}
```
Achievements, audio reactions and the HUD subscribe to `engine` events from the bus, so modes don't call them directly.

### 7.3 Mode fallback rule
`src/modes/registry.ts` exposes `resolveMode(id: GameModeId): ModeModule`. If a mode folder doesn't exist yet, it returns `mine` and logs once in dev. This lets lesson data name its final mode before that mode exists.

---

## 8. Rendering (`src/render/types.ts`)

```ts
export interface SceneHandle {
  three: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer } | null; // null in lite mode
  lite: LiteCanvas | null;                         // 2D fallback (M6); exactly one of three/lite is non-null
  setEnvironment(env: { biome: BiomeId; timeOfDay: TimeOfDay; t01?: number }): void; // sky, fog, lights, palette
  loadDiorama(id: string, grid: VoxelGrid): Promise<void>;   // meshes and shows a static world
  clearDiorama(): void;
  camera: CameraRig;
  fx: FxApi;
  requestRender(): void;                           // render-on-demand when the loop is idle
  setQuality(q: QualityLevel): void;
  onFrame(fn: (dtMs: Ms, t: Ms) => void): () => void;
}
export interface CameraRig {
  preset(name: 'mine' | 'overview' | 'lane' | 'orbit' | 'rail', opts?: { durationMs?: Ms }): void;
  orbit(dYaw: number, dPitch: number, dZoom: number): void;
  shake(intensity01: number, durationMs: Ms): void;   // no-op when reducedMotion
}
export interface FxApi {
  burst(at: Vec3, opts: { blockId: BlockId; count: number; speed?: number }): void;  // cube particles
  hitStop(ms: Ms): void;                              // freezes mode `frame` dt for ms; no-op when reducedMotion
  floatText(at: Vec3, text: string, opts?: { color?: string }): void;
}
export type Vec3 = { x: number; y: number; z: number };
```

### 8.2 Voxels (`src/render/mesher/voxel-grid.ts`, pure)
```ts
export class VoxelGrid {
  constructor(readonly sx: number, readonly sy: number, readonly sz: number, data?: Uint16Array);
  get(x: number, y: number, z: number): number;    // numeric block id; 0 = air; out of bounds = 0
  set(x: number, y: number, z: number, id: number): void;
  readonly data: Uint16Array;                       // index = x + sx * (z + sz * y)  (y-up)
  toJSON(): { sx: number; sy: number; sz: number; rle: number[] };   // run-length encoded for saves
  static fromJSON(j: ReturnType<VoxelGrid['toJSON']>): VoxelGrid;
}
export interface ChunkMesh { positions: Float32Array; normals: Float32Array; uvs: Float32Array; colors: Float32Array; indices: Uint32Array; }
export function meshChunk(grid: VoxelGrid, origin: Vec3, size: number, atlas: AtlasLookup, opts: { ao: boolean }): ChunkMesh;
export interface AtlasLookup { uv(blockNum: number, face: 'top' | 'bottom' | 'side'): [u0: number, v0: number, u1: number, v1: number]; transparent(blockNum: number): boolean; }
```
Chunk size 16. Culled-face meshing with per-vertex AO (the classic 3-neighbor rule) and AO-aware quad flipping. Greedy meshing is optional (M6 perf).

### 8.3 Atlas (`src/render/atlas/`)
```ts
// recipes.ts (pure): describes how to paint a 16×16 tile
export type TextureRecipe =
  | { kind: 'noise'; ramp: PaletteRampId; scale: number; contrast: number }
  | { kind: 'planks'; ramp: PaletteRampId; boards: number }
  | { kind: 'bricks'; ramp: PaletteRampId; mortar: PaletteRampId }
  | { kind: 'ore'; base: TextureRecipe; ore: PaletteRampId; density: number }
  | { kind: 'overlay-top'; base: TextureRecipe; top: PaletteRampId; depth: number }  // grass-side style
  | { kind: 'crack'; stage: number }                                                   // 0–9 crack overlays
  | { kind: 'custom'; paint: string };                                                 // name of a painter in painters.ts
export function paintTile(recipe: TextureRecipe, palette: Palette, rng: Rng): Uint8ClampedArray; // 16*16*4 RGBA, pure
// build.ts (DOM): packs tiles into an OffscreenCanvas/canvas atlas, applies PNG overrides from assets/textures/src/<blockId>_<face>.png
export function buildAtlas(blocks: readonly BlockDef[], palette: Palette, seed: number): Promise<Atlas>;
export interface Atlas extends AtlasLookup { texture: THREE.Texture; canvas: HTMLCanvasElement | OffscreenCanvas; tileOf(blockId: BlockId, face: 'top'|'bottom'|'side'): number; }
```
Textures use `NearestFilter`, no mipmaps, 1-px gutter per tile (duplicated edge pixels) to stop bleeding.

### 8.4 Voxel models (mobs, avatar, pets, bosses) (`src/render/models/`)
```ts
export interface VoxelModel {
  id: string;
  parts: { name: string; parent?: string; size: [number, number, number]; pivot: [number, number, number];
           offset: [number, number, number]; color?: string; tile?: { blockId: BlockId; face: 'top'|'side'|'bottom' } }[];
  anims: Record<'idle' | 'walk' | 'hit' | 'defeat' | string,
    { durationMs: number; loop: boolean; tracks: { part: string; prop: 'rot' | 'pos' | 'scale'; keys: { t: number; v: [number, number, number] }[] }[] }>;
}
```
Stored as `<id>.model.json`, validated by a JSON schema test.

---

## 9. Input (`src/input/`)

```ts
export type ControlInput = { kind: 'control'; action: 'pause' | 'confirm' | 'back' | 'next' | 'prev' | 'up' | 'down' | 'left' | 'right' | 'hearAgain'; t: Ms };
export type TypedInput = { kind: 'typed'; input: KeyInput };
// Every field but `inPlay` is optional and off by default (approved in M1-08).
// band: 'sprout' enables Backquote → hearAgain; undo: Ctrl+Z / Cmd+Z → typed 'Undo'; wantsEnter: Enter in play → typed 'Enter'.
export type InputCtx = { inPlay: boolean; band?: AgeBand; undo?: boolean; wantsEnter?: boolean };
export function normalizeKeyEvent(e: KeyboardEvent, t: Ms, ctx: InputCtx): TypedInput | ControlInput | null;
export function attachKeyboard(target: Window, clock: Clock, handler: (i: TypedInput | ControlInput) => void, getCtx: () => InputCtx): () => void;
export function capsLockOn(e: KeyboardEvent): boolean;
```
Rules (from `PLAN.md` §6.5, made exact):
- Ignore `e.repeat`, `e.isComposing`, `key === 'Dead'`, `key === 'Process'`, and any event with `ctrlKey | metaKey | altKey` **except** `Ctrl+Z`, or `Cmd+Z` (Meta+Z with no Ctrl/Alt/Shift), when `ctx.undo` is on (Builder; delivered as `typed` with key `'Undo'`; the Shift variants are not redo and stay ignored) and `AltGr` combos where `getModifierState('AltGraph')` is true (those are real chars on some layouts).
- `Escape` → `pause` (in play) / `back` (menus). `Enter` → `confirm` in menus; in play, `Enter` is delivered as `typed` (key `'Enter'`) only if the mode declared it wants it via `ctx.wantsEnter` (none in v1, so it's ignored). `Tab` → `next` / `Shift+Tab` → `prev` in menus; ignored in play. Arrows → directions. `F1` or `` ` `` (by `key`, when `ctx.band === 'sprout'`) → `hearAgain`.
- In play, `preventDefault` for every key that becomes `typed`, plus Space, `'`, `/`, Backspace, Tab.
- Single printable chars pass through as-is; `' '` for Space. Typographic apostrophes/quotes from some keyboards (`’ ‘ “ ”`) normalize to `'` and `"`.
- Window `blur` and `visibilitychange → hidden` produce `pause` immediately.

---

## 10. HUD bridge (`src/ui/hud/bridge.ts`)

Modes don't touch Preact. They push state through a typed signal bridge:
```ts
export interface HudState {
  word: { text: string; marks: TargetView['marks']; typed: number } | null;   // big word display (sequential modes)
  combo: number;                       // hotbar combo meter (0–9 slots lit = min(9, floor(streak/3)))
  progress01: number;                  // lesson progress bar
  nextKey: string | null;              // drives on-screen keyboard highlight + hand overlay
  banner: { key: MessageKey; params?: Record<string, string | number>; tone: 'info' | 'cheer' } | null;
  capsLock: boolean;
  timer: { remainingMs: Ms } | null;   // hidden for Sprout and calm mode
  custom: Record<string, unknown>;     // mode-specific widgets read their own slice
}
export interface HudBridge { set(patch: Partial<HudState>): void; get(): Readonly<HudState>; }
```
Implemented with `@preact/signals`. Calls are cheap; modes may call `set` every frame.

---

## 11. i18n (`src/i18n/`)

```ts
// src/i18n/en/<namespace>.ts
export default { title: 'Meadow Home', lessonCount: '{count} lessons' } as const;
// src/i18n/en/index.ts aggregates: { common, menu, mine, results, ... }
export type MessageKey = `${Namespace}.${string}`;   // derived type; exact keys checked by a test, not the type system
export function t(key: MessageKey, params?: Record<string, string | number>): string;
export function setLocale(id: 'en' | 'en-XA'): void;  // en-XA = pseudo-locale (M6)
```
Plurals: `{count, plural, one {# block} other {# blocks}}` minimal ICU subset implemented in-house (no dependency). A unit test fails on missing keys or unused keys.

---

## 12. Audio (`src/audio/types.ts`)

```ts
export type SfxName = 'break' | 'chip' | 'chime' | 'thud' | 'pop' | 'click' | 'whoosh' | 'levelUp' | 'star' | 'shield' | 'cart' | 'place' | 'undo';
export type Bus = 'master' | 'music' | 'sfx' | 'voice';
export interface AudioApi {
  unlock(): Promise<void>;                          // call on first user gesture
  sfx(name: SfxName, opts?: { pitchStep?: number; material?: Material; gain?: number }): void;
  music: { setScene(biome: BiomeId | 'menu', tod: TimeOfDay): void; setIntensity(v01: number): void; stop(): void };
  speak(text: string): void;                        // Web Speech API; no-op if unavailable or disabled
  setVolume(bus: Bus, v01: number): void;
}
export type { Material } from '@/types/core';  // defined in §1's src/types/core.ts so pure content code can use it; re-exported here
```
`chime` with `pitchStep` walks a pentatonic ladder (C D E G A, wrapping up octaves, capped at 2 octaves).

---

## 13. Clock, debug params and test hooks

```ts
// src/app/clock.ts
export interface Clock { now(): Ms; epoch(): EpochMs; }
export const realClock: Clock;
export function fixedStepClock(startMs: Ms, stepMs: Ms): Clock;   // for tests and ?freeze
```

`fixedStepClock` advances by `stepMs` on **every** `now()` call, and `epoch()` returns the current value (so `fixedStepClock(0, 16).epoch()` is 1970-01-01). Rule: under `?freeze`, only the frame loop calls `clock.now()`, once per frame, and passes that frame time down to everything it updates. Any other `now()` caller would shift every later frame and break screenshot baselines.

**URL debug params** (parsed in `src/app/debug.ts`; ignored in production builds except `lite` and `quality`):

| Param | Effect |
|---|---|
| `?seed=<n>` | Overrides all top-level seeds |
| `?freeze=1` | Day/night and ambient animation frozen at `t01=0.3`; fixed-step clock for visuals (input timestamps still real) |
| `?profile=<fixture>` | Loads a fixture profile from `tests/fixtures/profiles/<fixture>.json` into a throwaway in-memory store |
| `?screen=<id>&lesson=<id>` | Deep-link to a screen |
| `?record=1` | Records keystroke logs, offers download at Results |
| `?quality=low\|medium\|high`, `?lite=1` | Force quality / 2D mode |
| `?nosave=1` | In-memory persistence only |

**`window.__vt`** (dev and test builds only, `import.meta.env.MODE !== 'production'`):
```ts
interface VtTestHooks {
  screen(): string;                         // current route id
  session(): SessionView | null;
  lastResult(): ModeResult | null;
  profile(): Profile | null;
  fps(): number;                            // rolling average
  ready(): Promise<void>;                   // resolves when the current screen finished loading assets
}
```
E2E tests wait on `__vt.ready()` instead of sleeping.

---

## 14. Budgets (enforced by `npm run size` and perf tests)

| Budget | Value | Enforced by |
|---|---|---|
| Initial JS (gzip), entry chunk + its static imports | ≤ 450 KB | `tools/check-bundle-size.ts` (fails build) |
| Any single lazy chunk (gzip) | ≤ 250 KB | same |
| Total `dist/` (gzip) | ≤ 3 MB | same |
| Draw calls in Mine mode, Medium quality | ≤ 150 | e2e reads `renderer.info.render.calls` via `__vt` |
| Frame time, Mine mode, Medium, SwiftShader, 1280×720 | p95 ≤ 33 ms (proxy; real-GPU target 16.7 ms is 👤) | perf e2e (M6) |
| Time to interactive, cold cache | < 3 s on Playwright with "Fast 3G"-free desktop profile | perf e2e (M6) |

---

## 15. Save data (`src/save/schema.ts`)

`Profile` from `PLAN.md` §6.6, made concrete:
```ts
export interface Profile {
  id: string;                     // crypto.randomUUID()
  name: string;                   // nickname, 1–16 chars, validated by the word-list blocklist
  ageBand: AgeBand;
  avatar: { skin: string; hat?: string; pickaxe?: string; cape?: string; pet?: string };
  createdAt: EpochMs;
  settings: Settings;
  progress: {
    lessons: Record<LessonId, { bestStars: 0 | 1 | 2 | 3; bestNetWpm: number; bestAccuracy: number; plays: number; lastPlayed: EpochMs }>;
    unlockedBiomes: BiomeId[];
    placement?: { doneAt: EpochMs; startBiome: BiomeId };
  };
  sessionCounter: number;
  keyStats: Record<string, KeyStat>;
  bigramStats: Record<string, KeyStat>;
  inventory: Record<BlockId, number>;
  island: { grid: ReturnType<VoxelGrid['toJSON']>; expansions: number; lastEdited: EpochMs } | null;
  cosmetics: { unlocked: string[] };
  achievements: Record<AchievementId, EpochMs>;   // unlock time
  daily: { lastDone?: string; streakDates: string[] };   // "YYYY-MM-DD", local dates
  history: StoredSummary[];        // newest last; cap 500, then compact oldest into weekly aggregates
  weekly: { weekStart: string; minutes: number; sessions: number; avgNetWpm: number; avgAccuracy: number }[];
  schemaVersion: number;
}
export type StoredSummary = Omit<SessionSummary, 'perKey' | 'bigrams'> & { at: EpochMs };
```
Settings (`src/save/settings.ts`, orchestrator-owned; workers request fields):
```ts
export interface Settings {
  textScale: number;              // 1.0–2.0
  showKeyboard: boolean; showHands: boolean;
  calmMode: boolean;              // no timers anywhere
  reducedMotion: boolean | 'system';
  highContrast: boolean;
  font: 'pixel' | 'clean' | 'dyslexic';   // body text; headings stay pixel unless 'dyslexic'
  tts: boolean;
  volume: Record<Bus, number>;
  quality: QualityLevel | 'auto';
  breakReminderMin: number;       // 0 = off; default 15
  layout: string;                 // keyboard layout id, default 'en-US'
}
export function defaultSettings(band: AgeBand): Settings;
```
Persistence API (`src/save/store.ts`):
```ts
export interface SaveStore {
  listProfiles(): Promise<{ id: string; name: string; ageBand: AgeBand; avatar: Profile['avatar'] }[]>;
  load(id: string): Promise<Profile | null>;          // runs migrations; on corruption returns the last good snapshot
  save(p: Profile): Promise<void>;                     // keeps the previous version as `<id>:prev`
  remove(id: string): Promise<void>;
  exportAll(): Promise<Blob>;                          // JSON { app: 'voxel-typer', version, profiles: Profile[] }
  importAll(file: Blob): Promise<{ imported: number; skipped: number; errors: string[] }>;  // validates; max 5 MB
}
export function createIdbStore(dbName?: string): SaveStore;
export function createMemoryStore(): SaveStore;      // tests, ?nosave
```
**Secure-context note:** the app may be served over plain HTTP on a LAN by mistake (`README.md` §8.13). `crypto.randomUUID` is only available in secure contexts, so ids come from `src/save/id.ts` → `newId()`, which uses `crypto.randomUUID` when present and otherwise builds a v4 UUID from `crypto.getRandomValues` (available everywhere). The same rule applies to the service worker (registered only when `window.isSecureContext`); show a small parent-facing note in Settings → Grown-ups when it's not.

Max 8 profiles. Migrations: `migrations: Record<number, (old: unknown) => unknown>`, one per version bump, each with a fixture test in `tests/fixtures/saves/v<N>.json`.

---

## 16. Keyboard layouts (`src/content/layouts/<id>.json`)

```ts
export interface LayoutDef {
  id: string; name: string;                 // 'en-US', 'US QWERTY'
  rows: { keys: { code: string; base: string; shift?: string; finger: Finger; x: number; w?: number }[] }[];  // x in key units
  homeCodes: string[];                       // KeyF, KeyJ get bumps
}
export function fingerFor(layout: LayoutDef, char: string): Finger | null;
export function codeFor(layout: LayoutDef, char: string): { code: string; shift: boolean } | null;
```

---

## 17. Blocks (`src/content/blocks/types.ts`)

```ts
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export interface BlockDef {
  id: BlockId; num: number;                  // num is stable forever (saved in grids); 0 reserved for air
  nameKey: MessageKey;
  faces: { top: TextureRecipe; side: TextureRecipe; bottom: TextureRecipe };
  material: Material; rarity: Rarity;
  tags: string[];                            // 'terrain', 'ore', 'biome:meadow', 'placeable', 'light', 'transparent'
  light?: { color: string; intensity: number };
  typedName: string;                         // what kids type in Builder to arm it, e.g. 'oak' (lowercase, a–z only)
}
```
`num` values are allocated in ranges per group file to avoid collisions: terrain 1–99, wood 100–149, stone 150–199, ores 200–249, wool/colors 250–299, deco/light 300–399, biome-specials 400–599. A unit test asserts uniqueness and that `typedName` is unique and typeable.

---

## 18. Loot (`src/engine/loot.ts`, pure)

```ts
export function rollLoot(ctx: { biome: BiomeId; wordLen: number; streak: number; targetAccuracy: number; band: AgeBand },
                         table: LootTable, rng: Rng): { block: BlockId; count: number; rarity: Rarity }[];
```
Rarity odds depend on streak and accuracy only, **never on speed** (`PLAN.md` §3.3). Exact table authored in M2-04.
