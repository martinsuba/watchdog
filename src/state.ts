import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { State, WatchState } from "./types.ts";

/** state.json = per-watch state plus a reserved top-level `invalidFiles` map (cannot clash: watch ids are lowercase). */
export type InvalidFiles = Record<string, string>;
const INVALID_KEY = "invalidFiles";

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * A missing file is empty state. A corrupt file (bad JSON or not an object) is moved to state.json.corrupt-<ts>, an
 * error is logged, and the run continues with empty state (alerts may repeat once) instead of crashing.
 */
function readRaw(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  let reason = "";
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!isObject(parsed)) reason = "top level is not an object";
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
  }
  if (reason === "") return parsed as Record<string, unknown>;
  const kept = `${file}.corrupt-${new Date().toISOString().replace(/:/g, "-")}`;
  try {
    renameSync(file, kept);
  } catch {
    // keep going with empty state even if the copy fails
  }
  console.error(`state file ${file} is corrupt (${reason}); kept as ${kept}, continuing with empty state`);
  return {};
}

export function loadState(file: string): State {
  const raw = readRaw(file);
  const state: State = {};
  for (const [id, v] of Object.entries(raw)) {
    if (id === INVALID_KEY || !isObject(v)) continue;
    const b = v.broken;
    const broken =
      isObject(b) && typeof b.reason === "string" && typeof b.since === "string"
        ? { reason: b.reason, since: b.since }
        : null;
    state[id] = { broken, alerted: isObject(v.alerted) ? (v.alerted as WatchState["alerted"]) : {} };
  }
  return state;
}

/** file name -> sha256 of the invalid content that was already alerted. Old state files without the key give {}. */
export function loadInvalidFiles(file: string): InvalidFiles {
  const v = readRaw(file)[INVALID_KEY];
  return v !== null && typeof v === "object" ? (v as InvalidFiles) : {};
}

/** Atomic: write a temp file next to the target, then rename. */
export function saveState(file: string, state: State, invalidFiles: InvalidFiles = {}): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify(Object.keys(invalidFiles).length > 0 ? { ...state, [INVALID_KEY]: invalidFiles } : state, null, 2) +
      "\n",
  );
  renameSync(tmp, file);
}
