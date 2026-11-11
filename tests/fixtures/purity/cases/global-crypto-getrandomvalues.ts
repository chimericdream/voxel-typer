// Fixture: crypto randomness.
export const fill = (b: Uint8Array) => crypto.getRandomValues(b);
