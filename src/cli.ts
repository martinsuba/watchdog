import { parseArgs } from "node:util";
import { browserOptionsFromEnv } from "./browser.ts";
import { run } from "./run.ts";

const USAGE = "usage: watchdog run [--dry-run] [--watch <id>] [--data-dir <dir>] [--watches-dir <dir>]";

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "run") {
    console.error(USAGE);
    return 1;
  }
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        "dry-run": { type: "boolean", default: false },
        watch: { type: "string" },
        "data-dir": { type: "string", default: "data" },
        "watches-dir": { type: "string", default: "watches" },
      },
      allowPositionals: false,
    }));
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 1;
  }
  const dryRun = values["dry-run"];
  const notifyCmd = process.env.WATCHDOG_NOTIFY_CMD;
  if (!dryRun && !notifyCmd) {
    console.error("watchdog run: WATCHDOG_NOTIFY_CMD is not set (command that receives the message on stdin)");
    return 2;
  }
  return run({
    watchesDir: values["watches-dir"],
    dataDir: values["data-dir"],
    notifyCmd,
    dryRun,
    watchId: values.watch,
    browser: browserOptionsFromEnv(process.env),
  });
}

process.exitCode = await main(process.argv.slice(2));
