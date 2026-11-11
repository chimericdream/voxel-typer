/**
 * Replay harness (docs/impl/tasks-m0-m1.md M1-07, PLAN.md §9.2). Pure.
 *
 * `replay(snapshot)` rebuilds a session from its input log and returns every event the log
 * produces plus the session's summary. It is a thin wrapper over `replaySession` (`./session`),
 * which is `restoreSession` with the events kept.
 */
import type { Ms } from "@/types/core";
import { replaySession } from "./session";
import type { SessionSummary } from "./stats";
import type { EngineEvent, SessionSnapshot } from "./types";

/** What {@link replay} returns. */
export interface ReplayResult {
  /** Every event of the replay, in order. Ends with the `sessionEnd` event. */
  events: EngineEvent[];
  summary: SessionSummary;
  /** `true` when the log already held the end; `false` when `replay` ended the session itself. */
  endedInLog: boolean;
}

/**
 * The latest timestamp in a snapshot's log, or 0 for an empty log. `add` entries carry no time.
 * A session never moves backwards in time, so this is where an unfinished log stops.
 */
export function lastLogTime(snap: SessionSnapshot): Ms {
  let t = 0;
  for (const entry of snap.log) {
    if (entry.k === "key") t = Math.max(t, entry.input.t);
    else if (entry.k !== "add") t = Math.max(t, entry.t);
  }
  return t;
}

/**
 * Replays a snapshot and returns its events and summary. A log that never ended (no `end` entry, no
 * `time` deadline or last completion inside it) is ended at `endAt`, which defaults to the log's
 * last timestamp; the `sessionEnd` that this produces is appended to `events`.
 */
export function replay(snap: SessionSnapshot, endAt?: Ms): ReplayResult {
  const { session, events } = replaySession(snap);
  let endedInLog = true;
  let end = events.findLast((event) => event.type === "sessionEnd");
  if (end === undefined) {
    endedInLog = false;
    const extra = session.end(endAt ?? lastLogTime(snap));
    events.push(...extra);
    end = extra.findLast((event) => event.type === "sessionEnd");
  }
  if (end?.type !== "sessionEnd") throw new Error("replay: the session produced no sessionEnd");
  return { events, summary: end.summary, endedInLog };
}
