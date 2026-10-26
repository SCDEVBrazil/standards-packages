import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS, EXIT, runCommand } from '../src/index';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('runCommand', () => {
  it('reports CANNOT MEASURE (3) for every command that is not built yet, naming its chunk', async () => {
    for (const c of COMMANDS.filter((x) => !x.run)) {
      const lines: string[] = [];
      expect(await runCommand(c.name, [], (l) => lines.push(l))).toBe(EXIT.CANNOT_MEASURE);
      expect(lines.join('\n')).toMatch(
        new RegExp(`not built yet \\(build-plan chunk ${c.chunk}\\)`)
      );
    }
  });

  it('returns USAGE (2) for an unknown command and lists the real ones', async () => {
    const lines: string[] = [];
    expect(await runCommand('nope', [], (l) => lines.push(l))).toBe(EXIT.USAGE);
    expect(lines.join('\n')).toMatch(/check, baseline, measure/);
  });
});

describe.runIf(existsSync(CLI))('built CLI (dist/cli.js)', () => {
  it('exits 3 when an input is missing (check outside a project), never 0', () => {
    const r = run('check', '--root', fileURLToPath(new URL('.', import.meta.url)));
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/CANNOT MEASURE: no standards\.json/);
  });

  it('every command is built (none left reporting "not built yet")', () => {
    expect(COMMANDS.filter((c) => !c.run).map((c) => c.name)).toEqual([]);
  });

  it('prints its version and exits 0', () => {
    const r = run('--version');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('with no command prints usage and exits 2', () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/exit codes: 0 pass/);
  });
});
