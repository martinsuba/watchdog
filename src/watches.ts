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

export type InvalidWatch = { file: string; error: string };

/** Loads watches/*.yaml; invalid files are returned, not thrown, so the others still run. T-004 hardens the reporting. */
export function loadWatches(dir: string): { watches: Watch[]; invalid: InvalidWatch[] } {
  const watches: Watch[] = [];
  const invalid: InvalidWatch[] = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  for (const file of files) {
    try {
      const parsed = watchSchema.safeParse(parse(readFileSync(join(dir, file), "utf8")));
      if (!parsed.success) {
        invalid.push({
          file,
          error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
        });
      } else if (parsed.data.id !== file.slice(0, -".yaml".length)) {
        invalid.push({ file, error: `id "${parsed.data.id}" must equal the file name` });
      } else {
        watches.push(parsed.data as Watch);
      }
    } catch (e) {
      invalid.push({ file, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { watches, invalid };
}
