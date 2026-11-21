/**
 * `/docs/commands` — the event-storming graph for this application.
 * `/docs/command-flow` — the same graph, drawn.
 *
 * The Java prototype builds the same shape with bytecode scanners. Here the
 * graph comes from the decorators: each handler declares the events it emits,
 * each policy declares what it listens to (and optionally which commands it
 * sends), and `@Actor`/`@BoundedContext` place the nodes.
 */

import type { Express, Request } from "express";
import { createDocRouter } from "../internal/docs/routeRegistry.ts";
import { EVENT_STORMING_MOUNT, eventStormingAssets, resolveEventStormingDir } from "./assets.ts";
import { getCqrsModule } from "../runtime.ts";
import { CommandFlowPageSchema, CqrsFlowSchema } from "./schemas.ts";

/** The page itself; the build lives at `backend/src/cqrs/event-storming/public`. */
const DIAGRAM_PAGE = `${EVENT_STORMING_MOUNT}/`;

export const EVENT_STORMING_URL_PATH = "/docs/command-flow";

export interface EventStormingUrl {
  page: string;
  pageUrl: string;
  flow: string;
  built: boolean;
  hint?: string;
}

/** The JSON body that describes where the diagram page and its graph live. */
export function eventStormingUrl(req: Request): EventStormingUrl {
  const built = resolveEventStormingDir() !== null;
  return {
    page: DIAGRAM_PAGE,
    pageUrl: `${req.protocol}://${req.get("host") ?? ""}${DIAGRAM_PAGE}`,
    flow: "/docs/commands",
    built,
    ...(built ? {} : { hint: DIAGRAM_HINT }),
  };
}

/**
 * Mount the static event-storming page and its documented routes.
 *
 * Call it after the authentication middleware and make that middleware skip
 * `/event-storming`; the page's own asset requests cannot attach a token.
 * `GET /docs/command-flow` redirects a browser straight to the page.
 */
export function registerEventStorming(app: Express): void {
  app.use(EVENT_STORMING_MOUNT, eventStormingAssets());
  app.use("/docs", eventStormingRouter);
}

export const eventStormingRouter = createDocRouter("/docs");

eventStormingRouter.get(
  "/commands",
  {
    responseSchema: CqrsFlowSchema,
    summary: "Commands, queries, policies and events, built from decorator metadata",
    tags: ["domain"],
  },
  (_req, res) => {
    res.json(getCqrsModule().flow());
  },
);

const DIAGRAM_HINT =
  "The diagram is not built yet. Run `yarn build:event-storming` from the repository root " +
  "(or `npm run build` in backend-event-storming/) and reload.";

/**
 * A browser navigating here sends `Sec-Fetch-Mode: navigate` and prefers
 * `text/html`; Swagger UI's "Try it out" and curl send a wildcard Accept header
 * and want the JSON body. Both behaviours are useful, so the redirect is chosen
 * from those two signals rather than from the path.
 */
function wantsHtml(req: Request): boolean {
  if (req.get("sec-fetch-mode") === "navigate") return true;
  return /text\/html/i.test(req.get("accept") ?? "");
}

/**
 * The page is a static build, so it cannot be described by a response schema —
 * this endpoint is the documented *way in*. It answers with the paths the page
 * and its data live at, and sends a browser straight to the page.
 *
 * Reached from the Swagger UI, from a bookmark, or by an agent that wants to know
 * where the diagram lives. The page itself stays at `/event-storming/`; only this
 * route is part of the documented API surface.
 */
eventStormingRouter.get(
  "/command-flow",
  {
    responseSchema: CommandFlowPageSchema,
    responses: {
      "302": { description: "A browser is redirected to the diagram page instead of receiving the body" },
    },
    summary: "Open the event-storming diagram of this backend",
    description:
      "**Open the diagram:** [the event-storming page](/event-storming/)\n\n" +
      "A browser is redirected to the diagram page; any other client gets the paths as JSON. " +
      "The page is a static build (`backend/src/cqrs/event-storming/public`) that reads `GET /docs/commands` " +
      "from this same backend, so it always draws the running domain model — no snapshot, no proxy, " +
      "and no need to know the port it is served on.",
    externalDocs: { url: DIAGRAM_PAGE, description: "Open the event-storming diagram" },
    tags: ["domain"],
  },
  (req, res) => {
    if (wantsHtml(req)) {
      res.redirect(302, DIAGRAM_PAGE);
      return;
    }

    res.json(eventStormingUrl(req));
  },
);
