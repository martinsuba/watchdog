import { renderInvalidWatch } from "./message.ts";
import type { InvalidFiles } from "./state.ts";
import type { InvalidWatch } from "./watches.ts";

/**
 * Alerts once per invalid file content (REQ-001, PRD G2/G3). Alerts for new or changed invalid content; the hash is
 * stored only after notify succeeds (so a failure is retried next run); entries of files that are valid again or
 * deleted are dropped (so breaking them again alerts again).
 */
export async function alertInvalid(
  invalid: InvalidWatch[],
  stored: InvalidFiles,
  send: (message: string) => Promise<void>,
): Promise<InvalidFiles> {
  const next: InvalidFiles = {};
  for (const i of invalid) {
    if (stored[i.file] === i.hash) {
      next[i.file] = i.hash;
      continue;
    }
    try {
      await send(renderInvalidWatch(i));
      next[i.file] = i.hash;
    } catch (e) {
      console.error(`notify failed for invalid watch ${i.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return next;
}
