/**
 * A mutation run, started the way a heavy job is.
 *
 * Stryker run bare takes one worker per logical processor less one at normal priority, beside
 * whatever else is going. Its verdicts are timed: a mutant is given a multiple of what its tests
 * took in the dry run, and one that runs out of it is scored as killed. So a run beside a gate, or
 * beside another mutation run, scores survivors as detected and nothing in the report says so.
 * Both configurations set the multiple to eight and add ten seconds, so a mutant that is only slow
 * reaches its verdict. That does not cover a test that fails on its own time limit beside other
 * work, which scores its mutant as killed whatever the clock, so the run still goes alone.
 *
 * This takes the lock every heavy job takes (`heavy-job-lock.ts`), lowers itself below normal so
 * Stryker and its workers inherit that, and hands Stryker the processor budget the gate runs on
 * (`gate-resources.ts`) as its concurrency unless the command line names one.
 *
 * Usage: node tools/run-mutation.ts [<stryker configuration>] [stryker options]
 */
import { spawn } from 'node:child_process';
import { constants, getPriority, setPriority } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processorBudget } from './gate-resources.ts';
import { holdHeavyJobLock } from './heavy-job-lock.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const passed = process.argv.slice(2);
const configuration =
  passed.find((argument) => !argument.startsWith('-')) ?? 'stryker.config.mjs';

const lock = await holdHeavyJobLock(`a mutation run (${configuration})`);

const PRIORITY = constants.priority.PRIORITY_BELOW_NORMAL;
setPriority(PRIORITY);
if (getPriority() !== PRIORITY) {
  throw new Error(
    `The mutation run asked for priority ${PRIORITY} and has ${getPriority()}, so its workers would not run below normal.`,
  );
}

const names = (option: string): boolean =>
  passed.some(
    (argument) => argument === option || argument.startsWith(`${option}=`),
  );
const concurrency =
  names('--concurrency') || names('-c')
    ? []
    : ['--concurrency', String(processorBudget())];
const args = ['exec', 'stryker', 'run', ...passed, ...concurrency];
const child = spawn(
  process.platform === 'win32' ? (process.env['ComSpec'] ?? 'cmd.exe') : 'pnpm',
  process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm', ...args] : args,
  {
    cwd: workspaceRoot,
    stdio: 'inherit',
    env: { ...process.env, ...lock.environment },
  },
);
child.once('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.once('close', (code) => {
  process.exitCode = code ?? 1;
});
