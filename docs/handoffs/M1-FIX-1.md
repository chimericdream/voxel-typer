# M1-FIX-1 Blocklist precision follow-up

Status: done

This closes the gaps the M1-10 re-review (PR #112, review 5865245228) left before sentence content (M3-02, M5-05) relies on the validator. No offensive words appear below. Terms are cited by `blocklist.txt` line or by category.

## What changed

- `tools/validate-wordlists.ts`:
  - **Look-alike pass.** `normalizedWords` now rewrites only tokens that mix letters with digits or symbols. A token with no letter and no `@ $ |` (a number, time or score: `455`, `4:55`, `10!`) is dropped from that pass. A common contraction is split at the apostrophe instead of joined. The new exported `isContraction` decides this from fixed stems: pronouns and "there", "that", "let" and similar with `'ll 'd 're 've 'm 's`, and auxiliaries with `n't`. An apostrophe inside any other word is still removed, so a term with an apostrophe put inside it is still caught.
  - **Allow scope.** `collectHits` now runs the strict substring check before it looks at the allow set. An allowed word cancels only its own derived (inflection) hit, plain or in look-alike spelling. It never cancels an exact hit or a strict hit. `parseBlocklist` rejects an allow entry that contains a strict term, or that isn't an inflection of any term. An entry equal to a term was already rejected. So the section can't become a general bypass list.
  - **Inflections.** Terms ending in `e` also generate `-ey`, with the `e` kept (the form of line 190 the re-review found).
- `src/content/wordlists/blocklist.txt`: a new block at lines 661–716, before the allow section, with 41 terms:
  - sexual (666–681): the clipped, adjective and slang forms the review listed
  - profanity (684–691): chat acronyms and two compounds
  - extremism (693–700): run-together spellings of lines 552–553, the salute word, the racial-purity adjective, and the group name with its member noun
  - violence (703–709): irregular past tenses of lines 576 and 260, and compounds of lines 226 and 581
  - drugs (711–716): compounds of lines 651, 416 and 426, plus one slang noun

  New terms are whole-word when they could hide inside a harmless word ("analysis", "canal", "vague", "Maryann", "woodpecker"), and strict otherwise. The allow section gains the plural the review asked for (re-review §2). The header and the allow comment now describe the real allow scope.

- `src/content/wordlists/README.md`: documents the `-ey` form, which forms still need their own line, the number and contraction rules of the look-alike pass, and the allow section's limits.
- `src/content/wordlists/SOURCES.md`: an M1-FIX-1 section (what was added, what was left out) and a list of the everyday words blocked for now, for the M6-08 read-through.
- `tests/unit/content/wordlists.test.ts`: four new tests and an allow-scope `describe`, listed under Acceptance.
- `tests/fixtures/wordlists/bad/disguised.txt`: adds one contraction-shaped disguise (line 10, must fail) and three sentences with contractions, times and room numbers (lines 11–13, must pass).

## Acceptance

- [x] **Contractions and plain numbers pass in sentence pools, and disguised terms still fail.**
  - Fixture `bad/disguised.txt`: lines 11–13 are sentence-pool items with "He'll", "we'll", "it's", "can't", `4:55`, `455` and `10:15`, and they produce no problem. Lines 3–6 and the new line 10 are still reported. The test is "reports each seeded problem with file:line".
  - The test "leaves contractions and plain numbers alone in the look-alike pass" covers more number tokens and contractions. It also checks that a non-pronoun stem in contraction shape is still joined and caught, that a dotted form of line 125 is still caught, and that `a55`, `@$$` and a digit-disguised line 107 are still caught.
  - Mutation checks: removing the number-token filter fails 3 tests, and treating no token as a contraction fails 3 tests.
- [x] **The allow section can't let a blocklisted word through except as documented.**
  - `describe("allow section scope")` uses harmless stand-in terms. The parser rejects an allow entry that is a term, one that contains a strict term, and one that isn't an inflection. An allowed inflection passes, plain and in look-alike spelling. The term itself, its other inflections, and strict hits still hit, even with an allow set built by hand that the parser never checked.
  - The same tests check the real blocklist: every allow word is an inflection of a term, contains no strict term, and passes. `blocklist.problems` is empty ("is well formed").
  - Mutation checks: moving the allow skip back before the strict loop fails 1 test, and accepting any allow entry fails 1 test.
- [x] **The review's missing terms are rejected, with tests that cite them by blocklist line.**
  - The test "rejects the terms the M1-10 re-review found missing (cited by blocklist line)" walks lines 666–716 by line number and category. Each term is a hit alone and inside a sentence.
  - It builds 17 derived forms from older lines without spelling them out, and checks that each hits the expected new line:
    - the `-ey` form of 190
    - the adverb of 189
    - the diminutive plural of 132
    - the clipped forms of 186 and 512
    - the past of 576
    - the compounds of 120, 126, 226 (×3), 416, 426, 581 and 651
    - the run-together forms of 552 and 553
- [x] `npm run verify` exits 0: typecheck, lint, 42 test files with 2077 tests, build, and size budgets.

## Decisions

- **Contractions use a fixed stem list, not a suffix pattern.** A pattern such as "anything + `'t`" would let an apostrophe placed inside a strict profanity term through (that case is tested). The fixed list covers the contractions children's sentences use. Any other apostrophe word is joined as before.
- **`'s` possessives are still joined** ("Gus's" → "guss"), unless the stem is a pronoun. A joined possessive only adds `s` to a word that the plain pass already checks, and joining keeps an apostrophe disguise caught.
- **Pure-symbol tokens are still read** (`@$$`). Only tokens with no letter and no `@ $ |` are dropped. Sentence lists can't contain `@ $ |` anyway, so this affects comments only.
- **Strict substring over-blocks are kept.** The card says to keep the strict default. The re-review's §2 over-blocks, including "thorny" and "booboo", are listed in SOURCES.md for M6-08, not loosened here.
- **The "expl…" family (explosions) is left out.** The re-review called it a content call: cartoon explosions may be wanted in a mining game. It is recorded in SOURCES.md.
- **The three-letter hate-group acronym** the re-review asked for was already at line 346 (sensitive, strict), so nothing was added for it.

## New dependencies

- none

## Notes for downstream tasks

- M3-02 and M5-05 (sentence content): times, room numbers, scores and common contractions are safe to use. Words split by spaces are still not caught (documented). Reviewers watch for that.
- Blocklist line numbers are cited in tests. Add new terms after line 716 (before the allow section), or update the cited lines in `wordlists.test.ts`. If a cited line moves, the `at()` helper fails with `blocklist line N`.
- An allow entry must now be an inflection of a term. A word that the strict rule blocks can't be allowed. Move that term to a whole-word section with explicit forms instead, as SOURCES.md suggests for the lines behind "thorny" and "booboo".
- M6-08: the everyday words blocked for now are listed in SOURCES.md under "Everyday words blocked for now". New in this task: the two-word bell sound, two irregular past tenses, one cartoon-dwarf adjective from the `-ey` rule, and one bird-related word ("woodpecker" itself passes).

## Contract change request / Questions

- (none)

Closes #119
