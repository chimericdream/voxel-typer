/**
 * The typing session (docs/impl/contracts.md §3.4). Pure.
 *
 * Stubs only; M1-03 implements them. The types live in `./types`.
 */
import type { SessionConfig, SessionSnapshot, Target, TypingSession } from "./types";

/** Starts a session. The rules are on `SessionConfig`, `WrongKeyPolicy` and `TargetingMode`. */
export function createSession(config: SessionConfig, initialTargets: Target[]): TypingSession {
  void [config, initialTargets];
  throw new Error("not implemented: createSession");
}

/**
 * Rebuilds a session by replaying the snapshot's log. The result must equal the original: the same
 * `view()` and the same events for the same future inputs.
 */
export function restoreSession(snap: SessionSnapshot): TypingSession {
  void snap;
  throw new Error("not implemented: restoreSession");
}
