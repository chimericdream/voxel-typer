// Fixture: high-res clock through globalThis (check-boundaries).
export const now = () => globalThis.performance.now();
