/**
 * The "sounds like" check (task M3-FIX-6). Pure.
 *
 * Read-aloud (Sprout band) says each target as a word, so a random letter group such as `fak` can
 * sound like a swear word even though no blocklist spelling matches it. This check rejects a
 * group when its likely pronunciation is close to a swear word, slur, or body or toilet word.
 *
 * How it works:
 *
 * 1. {@link spokenForm} normalises a word: lower case, letters only, then `tch`→`ch`, `ph`→`f`,
 *    `ck`→`k`, a soft `c` (before `e i y`) → `s` (`face` is not `fake`), every other `c` (except
 *    in `ch`) → `k`, `q`→`k`, `y`→`i` (except at the start), `oo`→`u` (`fook` sounds like `fuk`,
 *    and `cook` must not read as `kok`), then doubled letters collapsed (`fukk` → `fuk`), except
 *    `ee`, which stays a long vowel (`sheet` is not `shit`, `seeks` is not `seks`). `x` stays as
 *    it is (`fox` is not `fok…`).
 * 2. {@link soundsUnsafe} is true when any {@link SPOKEN_STEMS} entry appears anywhere inside that
 *    form. A silent trailing `e` (`fuke`, `dike`, `shite`) is caught because the stem still
 *    matches inside the word.
 * 3. Real words whose dictionary pronunciation is safe but whose spelling holds a stem (`cake`,
 *    `fact`, `coconut`) are listed in {@link SPOKEN_SAFE_WORDS}. Each one is at least 4 letters
 *    long, longer than any random syllable (2–3 letters), so the list can never let a random group
 *    through.
 *
 * Plain spellings of short runs (`ass`, `poo`, `tit`, `nig`) stay in the generator's own
 * `BLOCKED_RUNS` (`src/engine/generator.ts`). Their spoken forms collapse to common words (`as`,
 * `po`), so they can't be stems here. The word-list validator (`tools/validate-wordlists.ts`)
 * still checks every list against `./blocklist.txt` by spelling.
 *
 * FOR M6-08's CONTENT REVIEW. This list is a safety filter, not content: it never goes through
 * `t()` and never appears in kid-facing UI. It is plain text on purpose, so a reviewer can read
 * it. When unsure, add a stem: a false alarm costs one redraw in the generator.
 */

/**
 * Normalised stems (see {@link spokenForm}). A word fails when one of these appears anywhere in
 * its spoken form. Some lines below are offensive. They are here only so the filter can catch
 * them.
 */
export const SPOKEN_STEMS: readonly string[] = [
  // The f-word: vowel swaps, and the short form. (`fik` is left out: it is in `fix`, `fiction`.)
  "fak",
  "fek",
  "fok",
  "fuk",
  "fk",
  // The s-word, and the short form (`shyt` normalises to `shit`).
  "shit",
  "sht",
  // Body words and slurs that sound alike: `dick`, `dik`, `dyke`, `dike`, and the short form.
  "dik",
  "dk",
  "kok",
  "kunt",
  "bich",
  "pis",
  "krap",
  "kum",
  "seks",
  "sex",
  "wank",
  "jiz",
  "fart",
  "turd",
  "slut",
  "fag",
  "twat",
  "porn",
  "penis",
  // `x` reads as `ks`, so these sound like the plural of a stem (M3-FIX-6 review).
  "fux",
  "dix",
  "kox",
  // A slur and body slang the first draft missed (M3-FIX-6 review).
  "wog",
  "vag",
  "vaj",
];

/**
 * Real words whose spelling holds a stem but which a voice says safely (`cake` is not `kak…`,
 * `fact` is not the f-word). Whole words only, 4 letters or more. Add a word here only after
 * saying it aloud.
 */
export const SPOKEN_SAFE_WORDS: ReadonlySet<string> = new Set<string>([
  "cocoa", // kok
  "coconut", // kok
  "coconuts",
  "cucumber", // kum
  "cucumbers",
  "cumulus", // kum
  "factory", // fak
  "factorys",
  "focus", // fok
  "focused",
  "headquarters", // dk
  "indicator", // dik
  "indicators",
  "perfect", // fek
  "redcap", // dk
  "saltwater", // twat
  "sandcastle", // dk
  "sandcastles",
  "saturday", // turd
  "skyscraper", // krap
  "sphagnum", // fag
  "typist", // pis
  "typists",
  "woodcarver", // dk
  "woodcarvers",
]);

/** The likely spoken form of one word (see the file comment). Letters only, lower case. */
export function spokenForm(word: string): string {
  let s = word.toLowerCase().replace(/[^a-z]/g, "");
  s = s
    .replace(/tch/g, "ch")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c(?!h)/g, "k")
    .replace(/q/g, "k");
  s = s.slice(0, 1) + s.slice(1).replace(/y/g, "i");
  return s.replace(/o{2,}/g, "u").replace(/([a-df-z])\1+/g, "$1");
}

/**
 * True when `text` might sound like an unsafe word when read aloud. `text` is split into words on
 * whitespace; any other non-letter (`;`, `'`) is dropped, so `f;k` reads as `fk`.
 */
export function soundsUnsafe(text: string): boolean {
  for (const raw of text.split(/\s+/)) {
    const plain = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (plain === "" || SPOKEN_SAFE_WORDS.has(plain)) continue;
    const form = spokenForm(plain);
    if (SPOKEN_STEMS.some((stem) => form.includes(stem))) return true;
  }
  return false;
}
