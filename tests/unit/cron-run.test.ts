import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../../scripts/cron-run.sh", import.meta.url).pathname;

function sh(cwd: string, cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
const git = (cwd: string, ...args: string[]) =>
  sh(cwd, "git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);

/** Bare origin + production clone. The clone's src/cli.ts is a stub that records its argument and watches/. */
function setup(cliExit = 0) {
  const base = mkdtempSync(join(tmpdir(), "cron-run-"));
  const work = join(base, "work");
  const origin = join(base, "origin.git");
  const prod = join(base, "prod");
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  mkdirSync(join(work, "watches"));
  mkdirSync(join(work, "scripts"));
  mkdirSync(join(work, "src"));
  writeFileSync(join(work, "watches", "a.yaml"), "id: a\n");
  writeFileSync(join(work, "watches", "gone.yaml"), "id: gone\n");
  writeFileSync(
    join(work, "src", "cli.ts"),
    `import { readdirSync } from "node:fs";
console.log("args:", process.argv.slice(2).join(" "), "notify:", process.env.WATCHDOG_NOTIFY_CMD);
console.log("watches:", readdirSync("watches").sort().join(","));
process.exit(${cliExit});
`,
  );
  copyFileSync(SCRIPT, join(work, "scripts", "cron-run.sh"));
  chmodSync(join(work, "scripts", "cron-run.sh"), 0o755);
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "init");
  git(base, "clone", "-q", "--bare", work, origin);
  git(base, "clone", "-q", origin, prod);
  return { base, work, origin, prod, script: join(prod, "scripts", "cron-run.sh") };
}

const run = (s: { prod: string; script: string }, env: Record<string, string> = {}) =>
  spawnSync(s.script, [], {
    cwd: "/",
    encoding: "utf8",
    env: { ...process.env, WATCHDOG_NOTIFY_CMD: "echo-notify", ...env },
  });
const logOf = (prod: string) => {
  const dir = join(prod, "data", "logs");
  return readdirSync(dir)
    .filter((f) => f.startsWith("run-"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("");
};

test("cron-run: replaces watches/ with origin/main's copy (deleted files disappear), logs, exit 0", () => {
  const s = setup();
  // change origin/main: drop gone.yaml, add b.yaml
  git(s.work, "rm", "-q", "watches/gone.yaml");
  writeFileSync(join(s.work, "watches", "b.yaml"), "id: b\n");
  git(s.work, "add", "-A");
  git(s.work, "commit", "-q", "-m", "watches");
  git(s.work, "push", "-q", s.origin, "main");
  const r = run(s);
  assert.equal(r.status, 0, r.stderr);
  const log = logOf(s.prod);
  assert.match(log, /watches: a\.yaml,b\.yaml\n/);
  assert.match(log, /notify: echo-notify/);
  assert.match(log, /args: run notify/);
  assert.match(log, /exit code 0/);
  assert.match(log, /^\d{4}-\d\d-\d\dT/m, "lines are timestamped");
});

test("cron-run: code outside watches/ is not updated (D-005)", () => {
  const s = setup();
  writeFileSync(join(s.work, "src", "cli.ts"), `console.log("NEW CODE");\n`);
  git(s.work, "add", "-A");
  git(s.work, "commit", "-q", "-m", "code");
  git(s.work, "push", "-q", s.origin, "main");
  const r = run(s);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(logOf(s.prod), /NEW CODE/);
  assert.match(logOf(s.prod), /args: run/);
});

test("cron-run: propagates the exit code of the run", () => {
  const s = setup(3);
  const r = run(s);
  assert.equal(r.status, 3);
  assert.match(logOf(s.prod), /exit code 3/);
});

test("cron-run: offline keeps the local watches and still runs", () => {
  const s = setup();
  git(s.prod, "remote", "set-url", "origin", join(s.base, "does-not-exist.git"));
  const r = run(s);
  assert.equal(r.status, 0, r.stderr);
  const log = logOf(s.prod);
  assert.match(log, /fetch failed/i);
  assert.match(log, /watches: a\.yaml,gone\.yaml\n/);
});

test("cron-run: a second run while one is active is skipped without running", () => {
  const s = setup();
  mkdirSync(join(s.prod, "data"), { recursive: true });
  const holder = spawnSync(
    "bash",
    ["-c", `exec 9>"${s.prod}/data/cron.lock"; flock -n 9; "${s.script}"; echo "rc=$?"`],
    {
      encoding: "utf8",
      env: { ...process.env, WATCHDOG_NOTIFY_CMD: "x" },
    },
  );
  // the child inherits fd 9 (still locked), so it must refuse to run
  assert.match(holder.stdout, /rc=[1-9]/);
  assert.doesNotMatch(logOf(s.prod), /args: run/);
  assert.match(logOf(s.prod), /already running/i);
});

test("cron-run: old logs are pruned, recent ones kept", () => {
  const s = setup();
  const dir = join(s.prod, "data", "logs");
  mkdirSync(dir, { recursive: true });
  const old = join(dir, "run-2020-01-01.log");
  const recent = join(dir, "run-2999-01-01.log");
  writeFileSync(old, "x");
  writeFileSync(recent, "x");
  const longAgo = new Date(Date.now() - 40 * 86400_000);
  utimesSync(old, longAgo, longAgo);
  assert.equal(run(s).status, 0);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(recent), true);
});
