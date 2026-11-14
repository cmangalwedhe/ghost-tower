// The three-step strip in the status panel: Spot, Track, Warn.

export type StepState = "idle" | "now" | "done";

/** Which step is happening now, from the focused track's status. `warned` is the phones warned so far. */
export function stepStates(status: string | undefined, warned: number): StepState[] {
  if (status === "active") return ["done", "done", "now"];
  if (status === "candidate") return ["done", "now", "idle"];
  if (status) return ["done", "done", warned > 0 ? "done" : "idle"]; // went quiet
  return ["now", "idle", "idle"]; // nothing found: still watching
}
