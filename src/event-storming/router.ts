/**
 * `/docs/commands` — the event-storming graph for this application.
 * `/docs/command-flow` — the same graph, drawn.
 *
 * The graph comes from the decorators: each handler declares the events it
 * emits, each policy declares what it listens to (and optionally which
 * commands it sends), and `@Actor`/`@BoundedContext` place the nodes.
 */

import type { Express, Request, RequestHandler } from "express";
import { createDocRouter } from "../internal/docs/routeRegistry.ts";
import { EVENT_STORMING_MOUNT, eventStormingAssets, resolveEventStormingDir } from "./assets.ts";
import { getCqrsModule } from "../runtime.ts";
import { CommandFlowPageSchema, CqrsFlowSchema } from "./schemas.ts";

const DIAGRAM_PAGE = `${EVENT_STORMING_MOUNT}/`;

export const EVENT_STORMING_URL_PATH = "/docs/command-flow";

export interface EventStormingUrl {
  page: string;
  pageUrl: string;
  flow: string;
  built: boolean;
  hint?: string;
}

export interface EventStormingRouteConfig {
  responseSchema?: unknown;
  responses?: Record<string, { description: string; schema?: unknown }>;
  summary?: string;
  description?: string;
  externalDocs?: { url: string; description?: string };
  tags?: string[];
}

/**
 * Register one documented route in the host application's registry.
 *
 * The package uses its bundled DocApp registry by default. A host with its own
 * OpenAPI registry passes this function and receives the same route definitions.
 */
export type EventStormingRouteRegistrar = (
  path: string,
  config: EventStormingRouteConfig,
  handler: RequestHandler,
) => void;

export interface RegisterEventStormingOptions {
  registerRoute?: EventStormingRouteRegistrar;
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

const COMMANDS_CONFIG: EventStormingRouteConfig = {
  responseSchema: CqrsFlowSchema,
  summary: "Commands, queries, policies and events, built from decorator metadata",
  tags: ["domain"],
};

const COMMAND_FLOW_CONFIG: EventStormingRouteConfig = {
  responseSchema: CommandFlowPageSchema,
  responses: {
    "302": { description: "A browser is redirected to the diagram page instead of receiving the body" },
  },
  summary: "Open the event-storming diagram of this backend",
  description:
    "**Open the diagram:** [the event-storming page](/event-storming/)\n\n" +
    "A browser is redirected to the diagram page; any other client gets the paths as JSON. " +
    "The page is a static build that reads `GET /docs/commands` " +
    "from this same backend, so it always draws the running domain model — no snapshot, no proxy, " +
    "and no need to know the port it is served on.",
  externalDocs: { url: DIAGRAM_PAGE, description: "Open the event-storming diagram" },
  tags: ["domain"],
};

const commandHandler: RequestHandler = (_req, res) => {
  res.json(getCqrsModule().flow());
};

const commandFlowHandler: RequestHandler = (req, res) => {
  if (wantsHtml(req)) {
    res.redirect(302, DIAGRAM_PAGE);
    return;
  }
  res.json(eventStormingUrl(req));
};

/**
 * Mount the static event-storming page and its documented routes.
 *
 * With `registerRoute`, the routes are registered in the host's docs registry.
 * Without it, the package mounts its bundled `/docs` router.
 */
export function registerEventStorming(
  app: Express,
  options: RegisterEventStormingOptions = {},
): void {
  app.use(EVENT_STORMING_MOUNT, eventStormingAssets());

  const register: EventStormingRouteRegistrar =
    options.registerRoute ??
    ((path, config, handler) => {
      (eventStormingRouter.get as unknown as (
        path: string,
        config: EventStormingRouteConfig,
        handler: RequestHandler,
      ) => void)(path, config, handler);
    });

  register("/commands", COMMANDS_CONFIG, commandHandler);
  register("/command-flow", COMMAND_FLOW_CONFIG, commandFlowHandler);

  if (!options.registerRoute) {
    app.use("/docs", eventStormingRouter);
  }
}

export const eventStormingRouter = createDocRouter("/docs");

const DIAGRAM_HINT =
  "The diagram is not built yet. Run `yarn build:event-storming` from the repository root " +
  "(or `npm run build` in backend-event-storming/) and reload.";

function wantsHtml(req: Request): boolean {
  if (req.get("sec-fetch-mode") === "navigate") return true;
  return /text\/html/i.test(req.get("accept") ?? "");
}
