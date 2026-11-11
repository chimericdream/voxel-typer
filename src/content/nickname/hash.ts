/**
 * The hash behind the nickname filter (task M2-11). Pure.
 *
 * cyrb53: a small, fast, non-cryptographic 53-bit string hash (public domain). 53 bits keep a
 * false alarm on a harmless nickname vanishingly rare. It is not meant to hide the words from a
 * determined adult; it keeps the blocklist from being readable text in the game's files.
 */
export function cyrb53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The hash as short base-36 text, the form stored in `./filter-data.ts`. */
export const hashText = (text: string): string => cyrb53(text).toString(36);
