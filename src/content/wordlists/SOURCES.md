# Word-list sources

Every list must be public domain, permissively licensed, or written by us (`PLAN.md` §7.1). Never
paste a copyrighted list. Each list in this folder has a section here saying where its items came
from and what was left out.

## `sight-dolch.txt`

- **Source:** the Dolch sight words, published by Edward William Dolch in 1936 and collected in his
  book _Problems in Reading_ (1948): 220 "service words" (pre-primer to third grade) plus 95 nouns.
  The list is in the public domain. It is a list of common English words, transcribed from memory of
  the standard list, not copied from a modern typeset edition.
- **Kept:** every Dolch word of 1–5 letters, lowercase, because Sprout words are 1–5 letters long. The
  comments in the file group the words by Dolch level.
- **Left out on purpose:**
  - `I`: a capital letter in a lowercase list. It can come back in a `case=mixed` list.
  - `don't`: words lists are letters only.
  - `Christmas`, `Santa Claus`: holidays and names.
  - `hurt`: we keep pain out of word drills (it is on the blocklist).
  - Longer than 5 letters, for a later Miner list: always, around, because, before, better,
    birthday, brother, chicken, children, farmer, father, flower, garden, goodbye, ground, letter,
    little, morning, mother, myself, picture, please, pretty, rabbit, school, sister, squirrel,
    street, together, window, yellow.

## `home-row.txt`

- **Source:** authored for Voxel Typer (M1-10). Common English words typeable with only the home-row
  keys `a s d f g h j k l ;`. They're ordinary dictionary words, chosen by hand.
- **Left out on purpose:**
  - Slang, crude or unkind: ass, fag, gal, gals, gag, hag, lass, sass, shag, slag, skag, jag, gall.
  - Violent: lash, gash, slash, flak.
  - Confusing for kids: hash, and words most 6-year-olds can't read or don't know (alas, gala, saga,
    alfalfa, kasha, shad, skald, dhal).
  - Religious or cultural terms (`hajj`, `halal`), which belong in no drill list.
  - Longer than 5 letters (`band=all` lists use the Sprout length limit): alaska, alfalfa, flasks,
    salads.

## `blocklist.txt`

Not a word list: the safety filter the validator checks every list against. Written for Voxel Typer.
The child-safety review of M1-10 added the abuse and predation, self-harm, extremism and gambling
categories, more sexual, violence, drug, slang, brand and IP terms, and the `allow` section.

It errs on excluding. Some everyday words are blocked for now (`kiss`, `hit`, `beat`, `ghost`,
`monster`, `sword`, `god`, `vote`, `hospital`, …), which the orchestrator accepted. The owner can
loosen them at the M6-08 content read-through.

### M1-FIX-1 additions (re-review of M1-10)

- **Added:** clipped forms, adjectives and slang in the sexual category; profane chat acronyms;
  run-together spellings of two extremism phrases and more extremism terms; irregular past
  tenses and compounds of whole-word violence, profanity and drug terms (blocklist lines
  661-716). Terms that end in `e` now also block their `-ey` form. Every new term is whole-word
  unless it can't hide inside a harmless word.
- **Not added, content-owner call:** the "expl…" family for blowing things up (cartoon explosions
  may be wanted for mining). The hate-group acronym the review asked for was already strict at
  line 346.
- **Matcher precision:** number tokens (`455`, `4:55`) and common contractions ("he'll") no longer
  read as blocked words in phrase and sentence lists. The `allow` section now cancels only derived
  hits, and only entries that are inflections of a term are accepted.

### Everyday words blocked for now (for the M6-08 read-through)

The strict default stays. These ordinary words are blocked by a term with an unrelated sense. The
owner decides at M6-08 whether to loosen any of them; until then, pick another word.

- **New in M1-FIX-1:** "dong" (blocks "ding dong"), "bled", "fought", "dopey" (from the `-ey`
  rule), "pecker" ("woodpecker" still passes).
- **From inflections (M1-10 re-review §2):** gravy, flaky, titter, rummy, ginny, knobby, sucker
  (the lollipop), beater and beats (egg beater, music), hangman (the word game), weeds and weeding
  (gardening, likely in a farm biome), strips and stripy (comic strips, a stripy cat), deviled,
  crackers and cracked (the snack, a cracked egg).
- **From strict substrings (older rule):** thorny (roses), booboo and "boo-boo" (a kid's word for a
  scrape), swanky, pakistan (a country), condominium, retardant, ghastly and aghast. The review
  suggests moving the terms behind "thorny" and "booboo" to whole-word sections first.
- **From the plain hyphen split:** "yo-yo".
