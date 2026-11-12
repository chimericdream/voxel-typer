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

## `meadow-phrases.txt`

- **Source:** authored for Voxel Typer (M2-12). Two or three words from `home-row.txt` in a row,
  typeable with only `a s d f j k l` and space, for Meadow lesson 6. Chosen by hand so each pair
  reads as a tiny, friendly picture ("dad adds salsa").
- **Left out on purpose:**
  - `g` and `h`: Meadow teaches them after lesson 6, so no phrase uses them.
  - `sad` and `falls`: lesson 6 should feel happy, and falling is a hurt.
  - Pairs that don't make sense to a child ("ads ask", "fad salsa"), and words most 6-year-olds don't know (`fad`).

## M3-02 lists: Birch, Shore, Frosty, Meadow g/h pairs and themes

Every list below was **authored for Voxel Typer (M3-02)**: ordinary English dictionary words and
short phrases, chosen and written by hand. Nothing was copied from a published or commercial list.
The `.txt` files are sorted alphabetically (word lists) or written in order (phrase lists).

- **`birch-sprout.txt`, `birch-miner.txt`, `birch-builder.txt`:** words typeable with the Meadow and
  Birch keys only (`a s d f g h j k l ; e i r u t y o w q p`), so no `c n v m b x z`. Flavor:
  trees, birds, forest walks, picnic food. Extra words that use only the first new keys (`e`, `i`,
  `r`, `u`) so the early Birch lessons have enough to pick from.
- **`shore-sprout.txt`, `shore-miner.txt`, `shore-builder.txt`:** almost every word has at least one
  Shore key (`c n v m b x z`); a few theme words (`shell`, `tide`, `sail`) don't. Flavor: sand,
  waves, crabs, boats, beach food, and keyboard words for Builders (`comma`, `spacebar`).
- **`frosty-sprout.txt`, `frosty-miner.txt`, `frosty-builder.txt`:** any letter a-z. Flavor: snow,
  ice, foxes, cold, mountains, the night sky.
- **`*-phrases-miner.txt`, `*-phrases-builder.txt`:** 2-4 words each, written for these lists.
  No apostrophes, because the `'` key comes in Crystal Caverns. Birch phrases use Birch keys only.
- **`meadow-gh-phrases.txt`:** pairs of `home-row.txt` words that use `g` or `h`, for the Meadow
  lessons after `g h` are taught. It is a separate file because `meadow-phrases.txt` (M2-12) is
  tagged `keys=asdfjkl;` and its lesson 06 tests cite it, so it can't take `g` or `h`.
- **`theme-*.txt`** (blocks, animals, colors, food, tools, nature): `band=all` words of 1-5 letters,
  with no `biome` tag, so they only appear when a lesson asks for them.

How the bands relate: a Miner pool repeats its biome's Sprout words and adds more; a Builder pool
keeps the Miner words of 4+ letters and adds longer ones. The validator rejects the same word in
two pools of the same band, so the three biomes' pools of one band don't share any word.

**Left out on purpose** (beyond the blocklist):

- Slang or adult senses: buns, tart, chick, fruity, frigid, snuggle, snuggly; and `pot`, `rat`,
  `fat` were never added.
- Product or IP names: jeep, tweet, superhero, explorer, potter, asteroids (the plural is a game
  title; `asteroid` stays).
- Hurt, fear or danger: spirit, pirate, avalanche, foxglove (a poisonous plant), wolf, shark,
  spider, wasp, storm in Sprout lists, fire words (fireside, campfire, firefly).
- Explosion words (the owner decides at M6-08): none were written, and `explore` / `explorer` were
  dropped too, to keep the `expl...` family out entirely.
- Hard for a 6-year-old to read, removed from Sprout lists only: reed, sap, quail, yew, lark,
  pita, scuba, cove, wren, mink, lynx, brisk, vast.
- Sight words already in `sight-dolch.txt` (a Sprout pool) don't repeat in the Sprout lists.

**Meadow shortfall:** the Meadow keys (`a s d f g h j k l ;`) spell only about 45 safe, readable
English words, all already in `home-row.txt` (43 words, `band=all`). Only 8 Dolch words are
typeable with them. The targets (Sprout 60, Miner 120, Builder 200) can't be met with real words
and aren't. Meadow gets more items from phrases instead: `meadow-phrases.txt` (29) and
`meadow-gh-phrases.txt` (35). Longer home-row words (`salads`, `flasks`, `alfalfa`) are too few
to be worth a Builder list.

## M5-05 lists: Deep Mines, Mushroom Marsh, Crystal Caverns, Sparkstone, Sky Citadel, sentences

Every list below was **authored for Voxel Typer (M5-05)**: ordinary English dictionary words, given
names, and phrases and sentences written by hand for this game. Nothing was copied from a
published or commercial list. Word lists are sorted; phrase and sentence lists keep the order they
were written in.

- **`mines-*.txt`** (`case=mixed`): every item starts with a capital, for Shift practice. Given names
  from many cultures, days and months, and original place names for the voxel world
  (`Glowhollow`, `Pebbleton`, `Copperbend`, `Lanternwell`). The phrase lists are Title Case names
  of places and signs (`Lantern Lane`, `Glowhollow Junction`).
- **`marsh-*.txt`**: marsh words (mushrooms, frogs, ponds) and number words. The phrase lists put
  numbers in context ("5 red mushrooms", "Room 12"). `marsh-drills.txt` (`band=all`) is digit groups
  for number-row drills. Phrases may now hold digits (validator change in M5-05).
- **`caverns-*.txt`**: cave and crystal words, and phrases with an apostrophe (contractions and
  possessives), which Crystal Caverns teaches.
- **`sparkstone-*.txt`**: factory words. **`sparkstone-code-*.txt`**: short "code-ish" strings that
  read as plain English (`light_on()`, `#blocks: 12`, `mine-cart-3`, `bake(bread)`). They avoid
  real programming idioms, anything that looks like a real command, file path, web address or
  email address, and the words "variable", "program" and "hashtag".
- **`citadel-*.txt`**: sky and castle words and calm "mastery" phrases ("accuracy before speed").
- **`src/content/sentences/<biome>-sentences-<band>.txt`**: 600 sentences, written in batches of
  about 50 and each batch re-read for safety, reading level and variety. A light story runs
  through them: the Big Lantern on Home Island has grown dim, and friends gather a crystal from
  each biome to light it again, helped by friendly original creatures (the Frost Pup, a Moss Golem,
  a Slimeling, cave bats, crystal crabs, a sky owl named Zephyr, Sparkstone's robots). Each list
  uses only its biome's keys: Frosty has no capitals or punctuation, Deep Mines adds capitals,
  the marsh digits, Crystal Caverns and Sky Citadel punctuation, Sparkstone its symbols.

| Biome      | Sprout | Miner | Builder |
| ---------- | ------ | ----- | ------- |
| Frosty     | -      | 30    | 40      |
| Deep Mines | 25     | 35    | 40      |
| Marsh      | 25     | 35    | 40      |
| Caverns    | 30     | 45    | 55      |
| Sparkstone | 10     | 20    | 40      |
| Citadel    | 25     | 45    | 60      |

**Left out on purpose** (beyond the blocklist):

- Slang or adult senses: `plump` (a body word), `shady`, `shroom`, `croak` (slang for dying),
  `stool`, `nuts`, `screw`, and `hung`/`hangs` in sentences.
- Product, IP and franchise names: `minecart` as one word (a game's item name; we write "mine cart"),
  `glowstone` (a game's block name), `piston`, `switch` (a console name), `sprite` (a drink), and
  the owl was not named `Nimbus` (a famous fictional broom). Given names that belong to famous
  characters or assistants are left out: Alexa, Siri, Cortana, Bing, Elsa, Luca, Milo, Finn, Zane.
  Boss names stay out of content, because they live only in i18n and may be renamed.
- Violence, fear and sadness: `tank`, `zap`, `shadow`, `shout`, `sharp`, `battlement`, and any
  fire or explosion word. The `expl...` family is left out entirely (the M6-08 owner decision), so
  sentences say "travel" or "look" instead of "explore".
- Drinking: no word or pair of words that reads as alcohol (no flasks, glasses of anything, or
  toasts).
- Pressure words: no "seconds left", "hurry" or "wrong". Sentences talk about care, rhythm, rest
  and trying again.
- `knob`, `slash` and `hash` are blocklisted, so the Sparkstone sentences call them "the / sign" and
  "the # sign".
