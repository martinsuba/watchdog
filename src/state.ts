import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { State } from "./types.ts";

/** state.json = per-watch state plus a reserved top-level `invalidFiles` map (cannot clash: watch ids are lowercase). */
export type InvalidFiles = Record<string, string>;
const INVALID_KEY = "invalidFiles";

function readRaw(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

export function loadState(file: string): State {
  const raw = readRaw(file);
  delete raw[INVALID_KEY];
  return raw as State;
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
