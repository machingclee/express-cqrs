/**
 * Clock glyph for an emission that is dispatched after the command transaction
 * commits. Used on the command -> event edge, and on the event card when every
 * emitter agrees, so the reader sees the same symbol in both places.
 */
export function AfterCommitIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}
