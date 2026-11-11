# Word lists

The words, phrases and sentences that players type come from the `.txt` files in this folder.
Each file is one **pool**. Lessons pick pools by id or by tag, and the generator picks items that the
player's keys can type.

The players are children aged 6 to 13. Every item must be safe, kind and readable for the band it
is in. **When unsure, leave the item out.**

## Add a list in four steps

1. Create `<pool-id>.txt` in this folder. The id is kebab-case: `animals-sprout`, `meadow-phrases`.
2. Write the tag line, then one item per line (format below).
3. Append one line with the id to `POOL_IDS` in `pools.ts`. Add it at the end. Don't reorder or edit
   other lines.
4. Add a section for the list to `SOURCES.md` that says where the items came from, then run:

   ```sh
   npm run tool -- validate-wordlists
   ```

   Fix every problem it prints (`file:line: message`) until it says "no problems". `npm test` and CI
   run the same check, so a list that fails it can't merge.

## File format

```text
# Animals for Sprouts. Authored for Voxel Typer; see SOURCES.md.
# tags: band=sprout reading=cvc theme=animals
cat
dog
hen
```

- **One item per line**, exactly as the player types it. No spaces at the start or end of a line,
  and never two spaces in a row.
- Lines starting with `#` are comments. Blank lines are skipped. **Comments ship to players with
  the list**, so the validator checks them against the blocklist too. Never name a left-out word in
  a comment; list it in `SOURCES.md` instead.
- `# tags:` lines hold `name=value` pairs separated by spaces. They go before the first item.
- Items are **lowercase** unless the list has `case=mixed`.
- Plain ASCII only: no accents (`café`), curly quotes (`’`), dashes (`—`) or emoji. Type `'` and `"`
  straight.
- Save the file as UTF-8 with LF line endings (the repo's `.editorconfig` does this for you).

## Tags

| Tag       | Required | Values                                                                                     | Meaning                                                                             |
| --------- | -------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `band`    | yes      | `sprout` (6–8), `miner` (9–10), `builder` (11–13), `all`                                   | Who sees the list. `all` lists must also suit Sprouts.                              |
| `reading` | yes      | `dolch`, `cvc`, `grade2`, `grade4`, `grade6+`                                              | Reading level. `sprout` and `all` lists may only use `dolch`, `cvc` or `grade2`.    |
| `kind`    | no       | `words` (default), `phrases`, `sentences`                                                  | What the items are.                                                                 |
| `case`    | no       | `lower` (default), `mixed`                                                                 | `mixed` allows capital letters. Sentence lists usually need it.                     |
| `keys`    | no       | the keys, no spaces, e.g. `asdfghjkl;`                                                     | Every char of every item must be one of these keys (spaces between words are fine). |
| `biome`   | no       | `meadow`, `birch`, `shore`, `frosty`, `mines`, `marsh`, `caverns`, `sparkstone`, `citadel` | The biome whose lessons use this list by default.                                   |
| `theme`   | no       | kebab-case, e.g. `animals`, `food`, `blocks`                                               | Flavor, for picking themed lists.                                                   |

Any other tag name is an error, which catches typos like `bnad=sprout`.

## What the validator checks

| Check      | Rule                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Characters | `words`: letters only. `phrases`: letters, space, `'`. `sentences`: letters, digits, space and `. , ! ? ' " : ; -`. Never non-ASCII.     |
| Length     | Words: `sprout` and `all` 1–5 letters, `miner` 1–8, `builder` 1–14. Phrases: at most 30 chars. Sentences: at most 90 chars.              |
| Duplicates | No item twice in one list, or in two lists with the same `band` (compared ignoring case).                                                |
| Blocklist  | No item or comment may contain a word from `blocklist.txt`, in any common form (see below). Trademark and IP terms are reported as such. |
| Tags       | `band` and `reading` present, every tag known and valid. The character and blocklist checks run even when the tags are broken.           |
| Registry   | Every `.txt` here (except `blocklist.txt`) is in `POOL_IDS`, and every id in `POOL_IDS` has a file.                                      |

## The blocklist

`blocklist.txt` is a **safety filter**. It never ships to players: `pools.ts` leaves it out, and
only the validator reads it. It lists profanity, slurs, sexual words, violence and weapons beyond
cartoon level, scary or sensitive topics, drugs and alcohol, unkind words, slang, brand names, and
IP terms, and the most serious categories for children: abuse and predation, self-harm, and
extremism. We use no names from other games (`docs/impl/README.md` §4.5).

- Under `# section: <category>`, a term blocks the **whole word and its common forms**: `-s`,
  `-es`, `-ed`, `-ing`, `-er`, `-ers`, `-y`, `-man`/`-men`, a doubled last consonant (`stab` →
  "stabbing"), a dropped `e` (`bake` → "baking") and `y` → `ies`/`ied` (`army` → "armies"). List
  only the base word. `ass` blocks "ass" and "asses" but not "glass".
- Under `# section: <category> strict`, a term also blocks any word **containing** it. `shit` blocks
  "shitty". Use strict only for terms that never hide inside a harmless word. `stab` is not strict,
  because of "stable".
- A term with spaces blocks those words in a row, and the last word's forms ("self harming").
- Disguises don't get through. Before matching, the validator also reads each word with look-alike
  chars mapped back to letters (`1` as `i` or `l`, `3` `e`, `4` `a`, `0` `o`, `5` `s`, `7` `t`,
  `@` `a`, `$` `s`, `!` `i`, `|` `l`) and punctuation inside the word removed. So "k1ll", "k.i.l.l"
  and "sh-it" are caught. Splitting a word with a space ("sh it") is not caught; reviewers watch for
  that.
- Under `# section: allow` (the last section) are ordinary words that a form of a term happens to
  spell, such as "butter" from `butt` + `er` and "brass" from `bras` + `s`. An allowed word cancels
  only those derived hits. Add one only for a harmless word a child would read in a book.

If the validator blocks a word you think is fine, pick another word. Don't edit the blocklist to let
it through. To add a term, put it in the right section. When unsure, add it.

The list is strict on purpose. Some everyday words are blocked for now (`kiss`, `hit`, `beat`,
`ghost`, `monster`, `sword`, `god`, `vote`, `hospital`, …). The owner decides at the M6-08 content
read-through whether to loosen any of them. Until then, don't move them out.

## Using the pools in code

- App code (Vite): `import { wordPools } from "@/content/wordlists/pools"`. Each pool is a
  `WordPool` (`docs/impl/contracts.md` §5). Its `tags` are `name=value` strings with the defaults
  filled in: always `kind=…` and `case=…`, then `reading=…`, then the other tags. A lesson's default
  pools are the ones tagged `biome=<lesson biome>`.
- Tools and Node scripts can't use `import.meta.glob`. They read the files with `node:fs` and call
  `poolFromText(id, text)` or `poolsFromTexts(texts, ids)` from `./loader`.
