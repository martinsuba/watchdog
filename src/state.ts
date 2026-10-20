import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { State } from "./types.ts";

export function loadState(file: string): State {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as State;
}

/** Atomic: write a temp file next to the target, then rename. */
export function saveState(file: string, state: State): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, file);
}
