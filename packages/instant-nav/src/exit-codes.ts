/**
 * The three outcomes every instant-nav command reports (workspace Rule 28): a result the command could not
 * measure is never folded into a pass or a failure.
 */
export const EXIT = {
  /** Measured, and it holds. */
  PASS: 0,
  /** Measured, and it does not hold (violations found). */
  FAIL: 1,
  /** Bad usage (unknown command or flag). */
  USAGE: 2,
  /** The command's own inputs are missing, unreadable or ambiguous, or the command is not built yet. */
  CANNOT_MEASURE: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * Thrown when an input the command needs cannot be read. The CLI turns it into exit 3 and prints the reason,
 * which must name the input that failed (Rule 28.2).
 */
export class CannotMeasure extends Error {
  override readonly name = 'CannotMeasure';
}
