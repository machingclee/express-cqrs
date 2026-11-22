/**
 * Serves the event-storming diagram at `/event-storming`.
 *
 * The diagram is the `event-storming/` project at the root of this repository:
 * its `vite build` writes straight into `src/event-storming/public` (see the
 * `build.outDir` in that project's `vite.config.ts`), so the assets ship with the
 * package source instead of being copied by hand.
 *
 * It is mounted before the token check, for the same reason as the Swagger UI: a
 * browser cannot attach `X-Backend-Token` to a page's own asset requests. The
 * graph the page draws is still fetched from the protected `GET /docs/commands`.
 *
 * When the folder is absent the mount answers with build instructions instead of
 * a bare 404, because "the backend is running but the diagram was never built"
 * is the common case in a fresh checkout.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { RequestHandler } from "express";

export const EVENT_STORMING_MOUNT = "/event-storming";

const RELATIVE_DIR = join("src", "event-storming", "public");

/**
 * Where to serve the bundle from, in order of preference:
 *
 * 1. `EVENT_STORMING_DIR` — a packaged binary can point at its own copy,
 * 2. `<repo>/src/event-storming/public`, next to this source file,
 * 3. `./src/event-storming/public` under the working directory.
 *
 * A directory only counts when it holds an `index.html`.
 */
export function resolveEventStormingDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.EVENT_STORMING_DIR?.trim(),
    join(dirname(fileURLToPath(import.meta.url)), "public"),
    join(process.cwd(), RELATIVE_DIR),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}

/** 404 page that says how to produce the bundle. */
function notBuiltPage(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Event-storming diagram not built</title></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 46rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6; color: #0f172a;">
    <h1 style="font-size: 1.35rem;">The event-storming diagram is not built yet</h1>
    <p>This backend serves the diagram from <code>src/event-storming/public</code>, but that folder is missing or empty.</p>
    <pre style="background: #f1f5f9; padding: 1rem; border-radius: 10px; overflow-x: auto;"><code>cd backend-event-storming
npm install
npm run build:event-storming   # writes src/event-storming/public</code></pre>
    <p>Then reload this page. The diagram reads <code>GET /docs/commands</code> from this same backend, so it always shows the running domain model.</p>
  </body>
</html>`;
}

/**
 * Express handler for the mount point: the static bundle, or the instructions
 * page while it does not exist.
 */
export function eventStormingAssets(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const dir = resolveEventStormingDir(env);
  if (!dir) {
    return (_req, res) => {
      res.status(404).type("html").send(notBuiltPage());
    };
  }
  return express.static(dir, { index: "index.html", etag: true });
}
