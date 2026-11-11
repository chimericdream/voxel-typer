/**
 * Profile ids (docs/impl/contracts.md §15, secure-context note).
 *
 * The app may be served over plain HTTP on a LAN by mistake, and `crypto.randomUUID` only exists in
 * secure contexts. So ids come from here, never from `crypto.randomUUID()` directly.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** Formats 16 random bytes as a v4 UUID (RFC 9562 §5.4): version nibble 4, variant bits 10. */
export function uuidFromBytes(bytes: Uint8Array): string {
  const b = Array.from(bytes.subarray(0, 16));
  if (b.length !== 16) throw new Error("uuidFromBytes needs 16 bytes");
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.map((x) => HEX[x] ?? "00");
  return [
    h.slice(0, 4).join(""),
    h.slice(4, 6).join(""),
    h.slice(6, 8).join(""),
    h.slice(8, 10).join(""),
    h.slice(10, 16).join(""),
  ].join("-");
}

/**
 * A new v4 UUID. Uses `crypto.randomUUID` when present; otherwise builds one from
 * `crypto.getRandomValues`, which is available everywhere.
 */
export function newId(): string {
  // `randomUUID` is missing outside secure contexts, whatever the DOM typings say.
  const randomUUID: unknown = Reflect.get(crypto, "randomUUID");
  if (typeof randomUUID === "function") return crypto.randomUUID();
  return uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)));
}
