import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Watch } from "./types.ts";

export const KNOWN_SITES = ["selectors"] as const;

const selectorsSchema = z.object({
  pageMarker: z.string().min(1),
  item: z.string().min(1),
  name: z.string().min(1),
  price: z.string().min(1),
  listPrice: z.string().min(1).optional(),
  sizes: z.string().min(1).optional(),
  link: z.string().min(1).optional(),
});

const matchSchema = z.object({
  nameIncludes: z.array(z.string()).optional(),
  nameExcludes: z.array(z.string()).optional(),
  maxPrice: z.number().positive().optional(),
  minDiscountPct: z.number().min(0).max(100).optional(),
  sizes: z.array(z.coerce.string()).optional(),
});

const watchSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    site: z.enum(KNOWN_SITES),
    urls: z.array(z.url()).min(1),
    currency: z.string().min(1).default("EUR"),
    match: matchSchema.default({}),
    note: z.string().optional(),
    enabled: z.boolean().default(true),
    selectors: selectorsSchema.optional(),
  })
  .superRefine((w, ctx) => {
    if (w.site === "selectors" && w.selectors === undefined) {
      ctx.addIssue({ code: "custom", path: ["selectors"], message: "required for site: selectors" });
    }
  });

/** `error` is a single capped line: "<file>: <field path>: <problem>[; ...]". File content is untrusted. */
export type InvalidWatch = { file: string; error: string; hash: string };

const MAX_ERROR_LENGTH = 400;

function invalidWatch(file: string, problem: string, content: string): InvalidWatch {
  const line = `${file}: ${problem}`.replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(content).digest("hex");
  return { file, hash, error: line.length > MAX_ERROR_LENGTH ? `${line.slice(0, MAX_ERROR_LENGTH - 1)}…` : line };
}

/** Loads watches/*.yaml; invalid files are returned, not thrown, so the others still run (REQ-001). */
export function loadWatches(dir: string): { watches: Watch[]; invalid: InvalidWatch[] } {
  const watches: Watch[] = [];
  const invalid: InvalidWatch[] = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  for (const file of files) {
    let content = "";
    try {
      content = readFileSync(join(dir, file), "utf8");
      const parsed = watchSchema.safeParse(parse(content));
      if (!parsed.success) {
        invalid.push(
          invalidWatch(
            file,
            parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
            content,
          ),
        );
      } else if (parsed.data.id !== file.slice(0, -".yaml".length)) {
        invalid.push(invalidWatch(file, `id: "${parsed.data.id}" must equal the file name`, content));
      } else {
        watches.push(parsed.data as Watch);
      }
    } catch (e) {
      invalid.push(
        invalidWatch(file, e instanceof Error ? (e.message.split("\n")[0] ?? "unreadable") : "unreadable", content),
      );
    }
  }
  return { watches, invalid };
}
