// Fixture: network global through globalThis (check-boundaries; Oxlint also bans globalThis).
export const get = () => globalThis.fetch("/x");
