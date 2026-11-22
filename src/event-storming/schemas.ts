import { z } from "zod";

/**
 * `GET /docs/commands`: the graph built from the decorators. It is generated,
 * so the schema is here mainly to keep the endpoint documented and to catch a
 * malformed flow at the response boundary.
 */
/**
 * `GET /docs/command-flow` — the pointer to the drawn diagram.
 *
 * The diagram itself is a static build served at `/event-storming` (it is not
 * JSON, so it cannot be described by a response schema). This endpoint exists so
 * the page is reachable *and documented* from the Swagger UI: tools get these
 * paths, a browser is redirected to the page.
 */
export const CommandFlowPageSchema = z.object({
  page: z.string().describe("Path of the diagram page, the static build of backend-event-storming"),
  pageUrl: z.string().describe("The same path as an absolute URL on the host that answered"),
  flow: z.string().describe("Path of the JSON graph the page draws"),
  built: z.boolean().describe("False when the diagram has not been built into src/cqrs/event-storming/public yet"),
  hint: z.string().optional().describe("How to produce the build when it is missing"),
}).describe("Where the event-storming diagram page and the graph it draws live");

/** `field: type` rows of a command, query or event payload. */
const PayloadSchema = z.record(z.string(), z.string());

export const CqrsFlowSchema = z.object({
  commands: z.array(
    z.object({
      name: z.string(),
      handler: z.string(),
      context: z.string(),
      actors: z.array(z.string()),
      transaction: z.enum(["required", "none"]),
      emits: z.array(z.string()),
      postCommitEmits: z
        .array(z.string())
        .describe("The subset of emits dispatched with addTransactional (after commit)"),
      payload: PayloadSchema.describe("What the client supplies, from @Payload(...)"),
    }),
  ),
  queries: z.array(
    z.object({
      name: z.string(),
      handler: z.string(),
      context: z.string(),
      actors: z.array(z.string()),
      payload: PayloadSchema,
    }),
  ),
  policies: z.array(
    z.object({
      name: z.string(),
      listensTo: z.array(z.string()),
      sends: z.array(z.string()),
      listeners: z
        .array(
          z.object({
            event: z.string(),
            sends: z.array(z.string()),
            rules: z.array(z.string()),
          }),
        )
        .optional()
        .describe(
          "One entry per @EventListener method: the event → commands pairing the unions above lose",
        ),
    }),
  ),
  events: z.array(
    z.object({
      name: z.string(),
      context: z.string(),
      payload: PayloadSchema,
    }),
  ),
  invariants: z.array(
    z.object({
      component: z.string(),
      method: z.string(),
      rules: z.array(z.string()),
    }),
  ),
  dtos: z
    .record(z.string(), PayloadSchema)
    .describe("Nested shapes that payload types refer to"),
});
