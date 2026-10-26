#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { COMMANDS, runCommand } from './commands';
import { CannotMeasure, EXIT } from './exit-codes';

const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

function usage(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  return [
    'usage: instant-nav <command> [options]',
    '',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    '',
    'exit codes: 0 pass · 1 violations · 2 usage · 3 cannot measure',
  ].join('\n');
}

async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv;
  if (!name || name === '--help' || name === '-h') {
    process.stdout.write(`${usage()}\n`);
    return name ? EXIT.PASS : EXIT.USAGE;
  }
  if (name === '--version' || name === '-v') {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    process.stdout.write(`${pkg.version}\n`);
    return EXIT.PASS;
  }
  return runCommand(name, args, err);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // An input that could not be read is exit 3, naming it; anything else is a bug in this tool, also never a pass.
    err(
      e instanceof CannotMeasure
        ? `CANNOT MEASURE: ${e.message}`
        : `CANNOT MEASURE: instant-nav crashed: ${String(e)}`
    );
    process.exitCode = EXIT.CANNOT_MEASURE;
  }
);
