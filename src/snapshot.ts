import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** File name stem for a snapshot: UTC timestamp, filesystem safe, sorts chronologically. */
export function snapshotStem(d: Date): string {
  return d.toISOString().replace(/[:]/g, "-");
}

/** Keeps the newest `keep` snapshots (all files sharing a stem, e.g. .html + .png) in `dir`, deletes older ones. */
export function pruneSnapshots(dir: string, keep: number): void {
  if (!existsSync(dir)) return;
  const stemOf = (f: string) => f.replace(/\.[^.]+$/, "");
  const stems = [...new Set(readdirSync(dir).map(stemOf))].sort();
  const drop = new Set(stems.slice(0, Math.max(0, stems.length - keep)));
  for (const f of readdirSync(dir)) if (drop.has(stemOf(f))) rmSync(join(dir, f), { force: true });
}
