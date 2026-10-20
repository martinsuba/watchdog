import { spawn } from "node:child_process";

/** Runs `sh -c <cmd>` with the message on stdin. Rejects when the command cannot start or exits non-zero. */
export function notify(cmd: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", cmd], { stdio: ["pipe", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`notify command failed (${signal ?? `exit ${code}`})`));
    });
    child.stdin.on("error", () => {
      // EPIPE when the command exits early: the exit code decides
    });
    child.stdin.end(message);
  });
}
