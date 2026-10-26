import { runBaseline, runCheck } from './check';
import { EXIT, type ExitCode } from './exit-codes';
import { runMeasure } from './measure/measure';
import { runScaffoldLoading, runStampVerify } from './scaffold';

/** A CLI subcommand. `chunk` names the build-plan chunk that implements it (plans/2026-09-27-standards-perf-instant-nav.md). */
export interface Command {
  name: string;
  summary: string;
  chunk: string;
  run?: (args: string[]) => Promise<ExitCode>;
}

/**
 * Every subcommand the standard defines (SPEC §7, §8). One that is not built yet reports CANNOT MEASURE (exit 3),
 * never a pass: a pre-commit hook wired to an unbuilt check must not certify anything.
 */
export const COMMANDS: readonly Command[] = [
  {
    name: 'check',
    summary: 'static check of src/app against the standard (P2, P4.3-4.4, P5, P6)',
    chunk: '3-4',
    run: runCheck,
  },
  {
    name: 'baseline',
    summary: 'write or prune the debt list standards/baseline/perf-instant-nav.json (P6.2)',
    chunk: '3',
    run: runBaseline,
  },
  {
    name: 'measure',
    summary: 'shell and content times on production, signed in, never writing (P1)',
    chunk: '6',
    run: runMeasure,
  },
  {
    name: 'scaffold-loading',
    summary: 'generate a reviewed loading.tsx for a route (P2.2)',
    chunk: '9',
    run: runScaffoldLoading,
  },
  {
    name: 'stamp-verify',
    summary: 'compare vendored reference blocks with their provenance stamps',
    chunk: '9',
    run: runStampVerify,
  },
];

/** Runs one subcommand and returns its exit code; unbuilt ones explain themselves on stderr. */
export async function runCommand(
  name: string,
  args: string[],
  err: (line: string) => void
): Promise<ExitCode> {
  const cmd = COMMANDS.find((c) => c.name === name);
  if (!cmd) {
    err(
      `instant-nav: unknown command "${name}". Commands: ${COMMANDS.map((c) => c.name).join(', ')}`
    );
    return EXIT.USAGE;
  }
  if (!cmd.run) {
    err(
      `CANNOT MEASURE: instant-nav ${name} is not built yet (build-plan chunk ${cmd.chunk}); nothing was checked.`
    );
    return EXIT.CANNOT_MEASURE;
  }
  return cmd.run(args);
}
