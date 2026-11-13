# M3-FIX-6 Letter groups that sound safe when read aloud

Status: done

## What changed

- `src/content/wordlists/spoken-blocklist.ts` (new, pure): `spokenForm` (normalises a word to a
  rough spoken form), `soundsUnsafe` (true when a normalised stem appears anywhere in any word of
  the text), `SPOKEN_STEMS` (the stem list, 26 stems, marked for M6-08's content review) and
  `SPOKEN_SAFE_WORDS` (25 real words that hold a stem but are said safely, such as `coconut`).
  None of this goes through `t()` or into the UI.
- `src/engine/generator.ts`: the syllable path rejects a draft that `soundsUnsafe` and draws
  again, inside the existing `syllableTries` budget. Rule 2 of the file comment now says so.
- `tests/unit/engine/generator-spoken.test.ts` (new): the table, property and fixed-content tests.
- `docs/curriculum.md`: regenerated (`npm run tool -- gen-curriculum-doc`). The meadow-03 sample
  used to show `sfk`, which is now rejected.
- No word list, phrase, sentence or lesson needed a fix. Every item that failed a first draft of
  the check was a false positive (`cook`, `face`, `fox`, `spreadsheet`), fixed in the normaliser,
  or a real word that a voice says safely, added to `SPOKEN_SAFE_WORDS`.

- **Review fixes (orchestrator, review 5883504892):** `x` reads as `ks`, so `fux`, `dix` and `kox` (also `cox`) are stems now; so are `wog`, `vag` and `vaj`. The generator's `BLOCKED_RUNS` gains `hor`, `bum`, `wee`, `wii`, `sod` and `lsd`, which can't be stems because they sit inside safe words (`horse`, `sweet`). Table rows were added for all of them, and `docs/curriculum.md` was regenerated.

## Acceptance

- [x] Property test with a fixed seed (`20261112`), 10 runs × 1,000 groups = 10,000 groups for
      each distinct allowed-key set of every lesson (with and without Sparkstone), with random
      key weights: no group fails the check.
      `generator-spoken.test.ts` › "never makes a group that sounds unsafe…".
- [x] Table test: 66 unsafe spellings, all rejected (vowel swaps `fak fek fok fuk`, c/k/ck/q
      `fuc fuq dic diq cok coq`, ph `phuk phuck`, doubles `fukk fuuk ffk`, a silent trailing e
      `fuke dike dyke shite`, short forms `fk fck sht dk`, capitals, and `;` inside a group
      `f;k d;k`). 64 near-misses, all allowed (`fa ka as sad lad has fan kit dish kick fix fox
      face cake cook sheet seeks duck deck dock desk shot shut kf kd df …`).
- [x] Every fixed item in `src/content` passes: every item of every `src/content/wordlists/*.txt`
      and `src/content/sentences/*.txt` list (not `blocklist.txt`), checked word by word.
      `generator-spoken.test.ts` › "fixed content". Lessons, placement rungs, Defense and Builder
      take their words from these pools, and letter rungs are single keys, so this covers all
      the text that read-aloud can speak.
- [x] `npm run verify` passes.

### Rejection rates

How many groups the generator made before this fix that the check now rejects. Seed 42, 10,000
groups for each key set, equal weights. `*` marks the lessons whose `kind` is `syllables`. The
other key sets only reach the syllable path as a fallback.

| Key set (first lesson that uses it) | Keys     | Rejected | Examples                 |
| ----------------------------------- | -------- | -------- | ------------------------ |
| meadow-01                           | `fj`     | 0.00%    |                          |
| meadow-02                           | `fjdk`   | 19.06%   | `fk dkf kdk jfk fdk`     |
| meadow-03 \*                        | `fjdksl` | 8.24%    | `dk fkk jdk dfk fks lfk` |
| meadow-04                           | `+a;`    | 0.68%    | `fak`                    |
| meadow-07, meadow-08 \*             | `+gh`    | 0.30%    | `fak`                    |
| birch-01                            | `+ei`    | 0.18%    | `fek fak`                |
| birch-03 \*                         | `+ru`    | 0.12%    | `fek fak`                |
| birch-06                            | `+ty`    | 0.10%    | `fak fek`                |
| birch-09                            | `+ow`    | 0.22%    | `kok fok fak fek`        |
| birch-11                            | `+qp`    | 0.18%    | `qok feq fok fuq`        |
| shore-01                            | `+mv`    | 0.26%    | `koq diq kum pis`        |
| shore-03                            | `+nb`    | 0.16%    | `fek diq kok`            |
| shore-06                            | `+cx`    | 0.28%    | `dic qoc cex faq`        |
| shore-09                            | `+z`     | 0.22%    | `pis qok fac fuq`        |

After the fix, every set is at 0.00% unsafe. Not one group needed the single-key fallback (all
20 tries failing), so the redraws don't starve the generator. meadow-03 has no vowels, and its
rate comes from the short forms `fk` and `dk` that the card asks for. 8% is about one redraw in
twelve groups.

## Decisions

- **Seeded stream:** a group that passes uses exactly the draws it used before. A group that is
  now rejected costs a redraw, so a seed whose old output held such a group changes from that
  group on. Only the `docs/curriculum.md` sample changed. No replay or golden fixture uses
  syllables from an affected seed, and all existing tests pass unchanged.
- **Normaliser, beyond the card's list** (each one cut false positives in real words):
  - a soft `c` before `e i y` → `s`, so `face` and `surface` don't read as `fak…`;
  - `oo` → `u`, so `fook` is caught but `cook` and `cookie` don't read as `kok`;
  - `ee` stays doubled, so `sheet` and `spreadsheet` don't read as `shit`, and `seeks` doesn't
    read as `seks`;
  - `x` is not changed, so `fox` doesn't read as `foks`;
  - `y` → `i` except at the start (`shyt`, `dyke`);
  - a non-letter inside a word is dropped (`f;k` → `fk`), because the Meadow key set has `;`.
- **A silent trailing e** needs no separate rule. Because a stem matches anywhere in the word,
  `fuke`, `dike` and `shite` are caught.
- **Stems left out on purpose:** `fik` (it is in `fix` and `fiction`) and `kak` (in `cake` and
  `cactus`, and `ka`/`kak` are core home-row groups). Short plain spellings whose spoken form
  collapses to a common word (`ass` → `as`, `poo` → `po`, `butt` → `but`) stay in the generator's
  existing spelling list `BLOCKED_RUNS`, which still runs first. M6-08 may want to look at `fik`
  and `kak` again.
- **Allow-list:** `SPOKEN_SAFE_WORDS` holds whole real words only, each longer than 3 letters,
  so it can never let a random 2–3-letter group through (a test enforces this, and that each
  entry really holds a stem). An entry is needed only for a word in a shipped list.
- **Reuse:** `blocklist.txt` matches spellings of whole words, and the nickname filter ships only
  hashes of those forms. Neither can match a sound inside a 3-letter group, so I didn't reuse
  them. The new list sits beside `blocklist.txt`, ships in plain text as `BLOCKED_RUNS` already
  does, and is about 0.5 kB.

## New dependencies

- none

## Notes for downstream tasks

- M6-08 (content review): the stem list and the allow-list are both in
  `src/content/wordlists/spoken-blocklist.ts`, with a comment for you.
- A new word list needs no step of its own: the fixed-content test reads every `.txt` in the two
  folders. When a real word trips a stem, say it aloud. If it is safe, add it to
  `SPOKEN_SAFE_WORDS`. If not, drop it.
- `soundsUnsafe` is exported. A later generator path that makes random letter groups (for
  example a new `kind`) should call it too.
- The `letters` kind is not checked. Its targets are single keys, so read-aloud says one letter
  at a time.

## Contract change request / Questions

- (none)

Closes #176
