/**
 * Query semantics shared by the search box and the graph dimming.
 *
 * The reference search reads a space-separated query as "these fragments, in
 * this order, with anything between them": `Create Folder` becomes
 * `/Create.*Folder/i`, so it finds `CreateFolderCommand` as readily as
 * "Create a folder". Each token is escaped first, so a name containing `.` or
 * `(` is still matched literally.
 */

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** The non-empty, whitespace-separated pieces of a query. */
export function queryTokens(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

/**
 * `"Create Folder"` → `/Create.*Folder/i`; an empty query → `null`.
 *
 * The `s` flag lets `.*` cross a line break, because policy rules can be
 * multi-line.
 */
export function buildTokenRegex(query: string): RegExp | null {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return null;
  const pattern = tokens
    .map((token) => token.replace(REGEX_SPECIALS, "\\$&"))
    .join(".*");
  return new RegExp(pattern, "is");
}

/** One haystack, one test: the caller joins the fields it wants searched. */
export function matchesQuery(text: string, regex: RegExp | null): boolean {
  return regex !== null && regex.test(text);
}
