import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FETCH_BAD_PORTS,
  listenForBrowsers,
} from './browser-reachable-port.ts';

/**
 * Prove the browser assurance gate can fail.
 *
 * `verify-package-consumer-hydration.ts` imports the consumer's built server bundle, which calls
 * Angular's `attachNodeGlobalErrorHandlers`; registering any `uncaughtException` or
 * `unhandledRejection` listener suppresses Node's default of printing the error and exiting
 * non-zero, and Angular's listeners only print. Without listeners of its own, every error escaping
 * a `try` in that file, and every server and page callback, which no `try` can cover, is reported
 * in full to a pipeline that reads exit code 0 and moves on.
 *
 * That file registers its own listeners after the import and exits non-zero from them. This runs it
 * twice with a deliberate escape of each class and watches it die, because a gate nobody has seen
 * fail is indistinguishable from a gate that cannot, and the difference between those two states is
 * not visible in any passing run.
 *
 * A third case covers the other way that file can report nothing: by not ending. Without a bound on
 * each stage and narration as it goes, a hung run and a working run are the same observation from
 * outside. A one-millisecond stage budget makes the first stage overrun, and this watches the run
 * name that stage and die, and checks it was narrating its stages on the way, because the bound and
 * the narration are only useful together. A bound with nothing to read tells you a run stopped;
 * narration with no bound tells you where a run is forever.
 *
 * A fifth covers a run that fails before it checks anything: a server on a port the Fetch standard
 * has browsers refuse, which the system hands out where its dynamic range starts low. A listed port
 * is put in the way of the first attempt, and then of every attempt, and this watches the servers
 * pass over it and then stop with a message rather than ask forever.
 *
 * It is a prerequisite of `verify:browser-assurance` rather than a peer, so that a broken control
 * makes the gate report skipped, which is true, instead of passing on evidence nothing has
 * checked. It costs about a second: both escapes fire immediately after the import, before the
 * static file server opens or any browser launches.
 */

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verifier = resolve(
  workspaceRoot,
  'tools/verify-package-consumer-hydration.ts',
);
const consumerName = process.argv[2] ?? 'package-consumer';

const escapes = Object.freeze([
  {
    mode: 'assertion',
    description:
      'an assertion failing at the top level, where 111 of them sit today',
  },
  {
    mode: 'rejection',
    description: 'a promise rejecting with nobody awaiting it',
  },
]);

interface VerifierRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runVerifier(
  overrides: Readonly<Record<string, string>>,
): Promise<VerifierRun> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [verifier, consumerName], {
      cwd: workspaceRoot,
      env: { ...process.env, ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('close', (code, signal) =>
      settle({ code, signal, stdout, stderr }),
    );
  });
}

for (const escape of escapes) {
  const result = await runVerifier({
    EQUATOR_ASSURANCE_SELF_TEST: escape.mode,
  });

  // The whole point, stated as plainly as it can be: this must not be zero.
  assert.notEqual(
    result.code,
    0,
    `The browser assurance gate survived ${escape.description} and exited 0. Its own \`uncaughtException\` and \`unhandledRejection\` listeners are gone, shadowed, or no longer exit, so every assertion in that file is decorative until this passes again.`,
  );

  // And it must fail by reporting, not by dying somewhere unrelated on the way. A missing consumer
  // build would also produce a non-zero exit, and would prove nothing about the listeners.
  assert.ok(
    result.stderr.includes('Equator browser assurance failed.'),
    `The gate exited ${result.code} for ${escape.description} without reporting a failure. That is a different fault from the one under test:\n${result.stderr}`,
  );
  assert.ok(
    result.stderr.includes('Self-test escape'),
    `The gate failed for ${escape.description}, but not on the injected escape:\n${result.stderr}`,
  );

  // Nothing after the escape ran. Without this, a build that failed at the import would satisfy
  // everything above while the listeners themselves were never reached.
  assert.ok(
    !result.stdout.includes('verified.'),
    `The gate reported its verification complete after ${escape.description}:\n${result.stdout}`,
  );
}

// The third silence: a run that does not end. One millisecond of stage budget makes the first
// stage overrun, so this exercises the bound itself rather than any assertion behind it.
const bounded = await runVerifier({ EQUATOR_ASSURANCE_STAGE_TIMEOUT_MS: '1' });

assert.notEqual(
  bounded.code,
  0,
  `The browser assurance gate ran to completion with a one-millisecond stage budget, so no stage is bounded and a stage that never finishes never ends the run:\n${bounded.stderr}`,
);
assert.ok(
  bounded.stderr.includes('did not finish within 1ms'),
  `The gate exited ${bounded.code} under a one-millisecond stage budget without reporting a stage overrun, which is a different fault from the one under test:\n${bounded.stderr}`,
);
// And that it was saying where it was on the way there. A bound with nothing to read says only that
// a run stopped; this is the half that says what it stopped in.
assert.ok(
  /\[assurance\] \S/u.test(bounded.stderr),
  `The gate never announced a stage, so a run in progress still cannot be located:\n${bounded.stderr}`,
);
assert.ok(
  !bounded.stdout.includes('verified.'),
  `The gate reported its verification complete after a stage overrun:\n${bounded.stdout}`,
);
// And that what it says the row was waiting on is the stage that overran. The per-call bound prints
// the same description, and a description that still reads as it did at startup says nothing
// about where a run stopped.
const overran = /Stage ("[^"\n]+") did not finish within 1ms/u.exec(
  bounded.stderr,
)?.[1];
assert.ok(
  overran !== undefined && bounded.stderr.includes(`"awaiting": ${overran}`),
  `The overrun report does not say the row was waiting on the stage that overran, so a bound that trips reports where the run started rather than where it stopped:\n${bounded.stderr}`,
);

// The fourth silence: the block that reports a caught failure. Both escapes above die before the
// try that assembles it and the stage bound exits from its own timer, so without this case nothing
// reads the browser rows, the violations or the page state a real failure reports.
const reported = await runVerifier({
  EQUATOR_ASSURANCE_SELF_TEST: 'diagnostics',
});

assert.notEqual(
  reported.code,
  0,
  `The browser assurance gate survived a failure inside its own try block and exited 0:\n${reported.stderr}`,
);
assert.ok(
  reported.stderr.includes('Self-test escape'),
  `The gate exited ${reported.code} without reporting the injected failure, which is a different fault from the one under test:\n${reported.stderr}`,
);

// Every engine in the matrix, with how far it got. A row that enters the evidence on the way out,
// after it has passed, contributes nothing when it fails, and the block then describes the engines
// that succeeded while saying nothing about the one that did not. The three labels are written out
// here rather than read from the verifier, which cannot be imported without running it.
for (const label of ['Chromium', 'Firefox', 'WebKit']) {
  assert.ok(
    reported.stderr.includes(`"label": "${label}"`),
    `The failure block did not name the ${label} row, so a run that failed before that engine reported nothing about it:\n${reported.stderr}`,
  );
}
assert.ok(
  reported.stderr.includes('"outcome": "not started"'),
  `The failure block named the browser rows without saying how far each got:\n${reported.stderr}`,
);
assert.ok(
  !reported.stdout.includes('verified.'),
  `The gate reported its verification complete after a failure inside its own try block:\n${reported.stdout}`,
);

// The fifth: a port no browser reaches. First the premise, so a pass below is not a fetch that
// reaches every port: Node's fetch, like a browser, refuses a server listening on a listed port.
const blockedPort = 10080;
assert.ok(FETCH_BAD_PORTS.includes(blockedPort));
const reachedBy = (port: number) =>
  fetch(`http://127.0.0.1:${port}/`).then(
    (response) => response.text(),
    (error) => `refused: ${error.cause?.message ?? error.message}`,
  );
const answering = () =>
  createServer((_request, response) => response.end('reached'));
const closing = (server: Server) =>
  new Promise<void>((resolveClose) => server.close(() => resolveClose()));

const direct = answering();
await new Promise<void>((resolveListen, rejectListen) => {
  direct.once('error', rejectListen);
  direct.listen(blockedPort, '127.0.0.1', resolveListen);
});
const directly = await reachedBy(blockedPort);
await closing(direct);
assert.equal(
  directly,
  'refused: bad port',
  `A server on port ${blockedPort} answered Node's fetch, so nothing below shows a refused port being passed over.`,
);

// The system hands out the listed port first, and the server has to move off it.
const asked: number[] = [];
const passedOver = answering();
const port = await listenForBrowsers(passedOver, '127.0.0.1', (attempt) => {
  asked.push(attempt);
  return attempt === 0 ? blockedPort : 0;
});
const reached = await reachedBy(port);
await closing(passedOver);
assert.equal(
  reached,
  'reached',
  `A server handed port ${blockedPort} first listened on ${port}, which a browser cannot reach (${reached}).`,
);
assert.equal(
  asked.length,
  2,
  `A server handed port ${blockedPort} first asked for ${asked.length} port(s) rather than passing over it once.`,
);

// The system hands out ports in sequence from inside the list, and the server has to walk past the
// five that 6665 to 6669 put in a row.
const sequential = answering();
const walkedTo = await listenForBrowsers(
  sequential,
  '127.0.0.1',
  (attempt) => 6665 + attempt,
).then(
  (listened) => listened,
  (error) => error,
);
await closing(sequential);
assert.equal(
  walkedTo,
  6670,
  `A server handed 6665, 6666 and on in turn stopped at ${walkedTo} rather than listening on 6670.`,
);

// The system hands out nothing else, and the server has to stop and say why.
let tries = 0;
const cornered = answering();
const stopped = await listenForBrowsers(cornered, '127.0.0.1', () => {
  tries += 1;
  return blockedPort;
}).then(
  (listened) => `listened on ${listened}`,
  (error) => error,
);
assert.ok(
  stopped instanceof Error,
  `A server offered only port ${blockedPort} ${stopped}, so a system that keeps handing out a listed port is not caught.`,
);
assert.match(stopped.message, /Fetch, section 2\.9/u);
assert.equal(tries, 2);
assert.equal(cornered.listening, false);

// And every server a tool starts goes through it. The helper itself is the proof the search finds a
// listen, and this file listens directly above on purpose.
const listens = /\.listen\(/u;
const toolsRoot = resolve(workspaceRoot, 'tools');
assert.match(
  readFileSync(resolve(toolsRoot, 'browser-reachable-port.ts'), 'utf8'),
  listens,
);
for (const name of readdirSync(toolsRoot)) {
  if (
    !/\.c?ts$/u.test(name) ||
    name === 'browser-reachable-port.ts' ||
    name === 'verify-browser-assurance-self-test.ts'
  ) {
    continue;
  }
  assert.doesNotMatch(
    readFileSync(resolve(toolsRoot, name), 'utf8'),
    listens,
    `tools/${name} listens without listenForBrowsers, so the system can give it a port no browser reaches.`,
  );
}

process.stdout.write(
  `Browser assurance fails when it should: ${escapes
    .map((escape) => escape.mode)
    .join(
      ' and ',
    )} escapes each ended the process non-zero after the consumer's server bundle installed Angular's log-only handlers, an overrunning stage ended it by name, a failure inside the run reported every browser row, and a server passed over a port browsers refuse and stopped when offered nothing else.\n`,
);
