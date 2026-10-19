import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

const PAGES_DIR = new URL("../pages/", import.meta.url).pathname;

export type TestServer = {
  /** origin, e.g. http://127.0.0.1:41234 */
  origin: string;
  /** absolute URL for a path */
  url(path: string): string;
  /** serve this HTML at `path`, overriding any static file (mutable between runs) */
  set(path: string, html: string): void;
  /** every request path received, in order */
  requests: string[];
  clearRequests(): void;
  close(): Promise<void>;
};

/**
 * Tiny static server for synthetic pages (127.0.0.1, random port).
 *  - /<file>.html      -> tests/acceptance/pages/<file>.html, unless overridden with set()
 *  - /status/<code>    -> responds with that HTTP status and a tiny body
 *  - /slow             -> never answers (simulates a timeout); sockets are destroyed on close()
 *  - anything else     -> 404
 */
export async function startServer(): Promise<TestServer> {
  const overrides = new Map<string, string>();
  const requests: string[] = [];
  const sockets = new Set<Socket>();

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/favicon.ico") requests.push(path);
    const html = (body: string, status = 200) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    if (path === "/slow") return; // hang on purpose
    const status = /^\/status\/(\d{3})$/.exec(path);
    if (status) return html(`<html><body><h1>HTTP ${status[1]}</h1></body></html>`, Number(status[1]));
    const override = overrides.get(path);
    if (override !== undefined) return html(override);
    if (/^\/[\w-]+\.html$/.test(path)) {
      try {
        return html(await readFile(join(PAGES_DIR, normalize(path)), "utf8"));
      } catch {
        // fall through to 404
      }
    }
    html("<html><body>not found</body></html>", 404);
  };

  const server: Server = createServer((req, res) => void handler(req, res));
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    url: (path) => origin + path,
    set: (path, html) => void overrides.set(path, html),
    requests,
    clearRequests: () => void requests.splice(0, requests.length),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
