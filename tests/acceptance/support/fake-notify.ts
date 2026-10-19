// Fake notify command: appends stdin + a separator to the file named by WATCHDOG_TEST_NOTIFY_FILE.
// WATCHDOG_TEST_NOTIFY_FAIL=1 -> records nothing and exits 1 (simulates a failing tg_send.sh).
import { appendFileSync } from "node:fs";
import { SEPARATOR } from "./constants.ts";

const file = process.env.WATCHDOG_TEST_NOTIFY_FILE;
if (!file) {
  console.error("fake-notify: WATCHDOG_TEST_NOTIFY_FILE not set");
  process.exit(3);
}
if (process.env.WATCHDOG_TEST_NOTIFY_FAIL === "1") {
  console.error("fake-notify: simulated failure");
  process.exit(1);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  appendFileSync(file, input + SEPARATOR);
});
