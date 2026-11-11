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
