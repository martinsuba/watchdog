// Harness stub: real CLI arrives with T-003. Exits non-zero until then.
const [command] = process.argv.slice(2);

if (command === "run") {
  console.error("watchdog run: not implemented");
  process.exit(2);
}
console.error("usage: watchdog run [--dry-run] [--watch <id>] [--data-dir <dir>] [--watches-dir <dir>]");
process.exit(1);
