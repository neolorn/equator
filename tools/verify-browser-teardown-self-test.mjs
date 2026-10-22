// Drives the browser rows' call bound and their page teardown with objects of its own in place of a
// browser, and the occurrence record the verification suite reads back. A page whose close never
// settles is closed with its context and recorded. A context whose close does not settle either is
// a browser that is not answering: it is closed, or its process ended where its own close does not
// settle, the occurrence is recorded, and the rest of the row runs in a fresh one.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  UnansweringBrowser,
  UnsettledCall,
  closePageWithItsContext,
  createCallBound,
  replaceUnansweringBrowser,
  replacementSignature,
  stepClosingItsOwnPages,
} from './browser-call-bound.mjs';
import {
  OCCURRENCES_FILE_VARIABLE,
  collectOccurrences,
  ledgerOccurrences,
  recordOccurrence,
  verdictOccurrences,
} from './gate-occurrences.mjs';

const boundCalls = createCallBound({
  timeoutMs: 50,
  describe: () => ({ stage: 'self-test' }),
});
const never = () => new Promise(() => {});

class Page {
  constructor(closes) {
    this.closes = closes;
  }
  close() {
    return this.closes ? Promise.resolve() : never();
  }
  evaluate() {
    return Promise.resolve(1);
  }
}
class Context {
  closed = false;
  constructor(closes) {
    this.closes = closes;
  }
  close() {
    if (!this.closes) return never();
    this.closed = true;
    return Promise.resolve();
  }
}
// A browser whose pages and contexts close or not as it is told, and whose own close does the same.
class Browser {
  closed = false;
  constructor({ answers, closes = true }) {
    this.answers = answers;
    this.closes = closes;
  }
  newContext() {
    return new Context(this.answers);
  }
  newPage() {
    return new Page(this.answers);
  }
  close() {
    if (!this.closes) return never();
    this.closed = true;
    return Promise.resolve();
  }
}

// The bound reports a call that never settles as unsettled, and leaves one that does alone.
{
  const page = boundCalls(new Page(false), 'page');
  await assert.rejects(page.close(), (error) => {
    assert.ok(
      error instanceof UnsettledCall,
      'the bound did not report its own kind of error',
    );
    assert.match(error.message, /^page\.close did not settle within 50ms/u);
    return true;
  });
  assert.equal(await page.evaluate(), 1);
}

const runs = mkdtempSync(join(tmpdir(), 'equator-teardown-'));
try {
  const file = join(runs, 'row.occurrences.jsonl');
  const environment = { [OCCURRENCES_FILE_VARIABLE]: file };
  const record = (error) =>
    recordOccurrence(
      {
        kind: 'page-close-unsettled',
        signature:
          'firefox-localized-not-found: its context was closed in its place',
        detail: error.message.split('\n')[0],
      },
      environment,
    );

  // A page that closes: its context is closed after it, and nothing is recorded.
  {
    const context = boundCalls(new Context(true), 'context');
    const page = boundCalls(new Page(true), 'page');
    assert.equal(
      await closePageWithItsContext(page, context, record),
      undefined,
    );
    assert.equal(
      context.closed,
      true,
      'the page closed and its context was left open',
    );
    assert.deepEqual(
      collectOccurrences(['row'], () => file),
      [],
    );
  }

  // A page whose close never settles: the context is closed in its place, the row goes on, and
  // the occurrence reaches the file the suite reads.
  {
    const context = boundCalls(new Context(true), 'context');
    const page = boundCalls(new Page(false), 'page');
    const occurrence = await closePageWithItsContext(page, context, record);
    assert.equal(
      context.closed,
      true,
      'the unsettled page was not ended by closing its context',
    );
    assert.equal(occurrence?.kind, 'page-close-unsettled');
    const read = collectOccurrences(['row'], () => file);
    assert.equal(
      read.length,
      1,
      'the occurrence did not reach the file the suite reads',
    );
    assert.deepEqual(ledgerOccurrences(read), [
      {
        stage: 'row',
        kind: 'page-close-unsettled',
        signature:
          'firefox-localized-not-found: its context was closed in its place',
      },
    ]);
    assert.match(read[0].detail, /^page\.close did not settle within 50ms/u);
    assert.equal(verdictOccurrences(read), ', 1 occurrence(s) worked around');
  }

  // A context whose close does not settle either: the teardown reports a browser that is not
  // answering, naming both calls, and records nothing, because what is done about the browser is
  // the occurrence.
  {
    const context = boundCalls(new Context(false), 'context');
    const page = boundCalls(new Page(false), 'page');
    const before = collectOccurrences(['row'], () => file).length;
    await assert.rejects(
      closePageWithItsContext(page, context, record),
      (error) => {
        assert.ok(
          error instanceof UnansweringBrowser,
          'two unsettled closes were not reported as a browser that is not answering',
        );
        assert.match(error.message, /page\.close did not settle within 50ms/u);
        assert.match(
          error.message,
          /context was closed in its place, and that did not settle either/u,
        );
        assert.match(
          error.message,
          /context\.close did not settle within 50ms/u,
        );
        return true;
      },
    );
    assert.equal(
      collectOccurrences(['row'], () => file).length,
      before,
      'the unsettled page was recorded as worked around although its context never closed',
    );
  }

  // A context that fails to close in any other way is the row's failure, not a browser to replace.
  {
    const failing = {
      close: () => Promise.reject(new Error('Protocol error: context')),
    };
    const page = boundCalls(new Page(false), 'page');
    await assert.rejects(
      closePageWithItsContext(page, failing, record),
      (error) => {
        assert.equal(error instanceof UnansweringBrowser, false);
        assert.match(error.message, /Protocol error: context/u);
        return true;
      },
    );
  }

  // A row of three steps, each ending by closing a page and a context of its own, driven the way
  // the browser rows drive theirs. The browser stops answering at the end of the first step.
  const runRow = async ({ stalledCloses, rowFile }) => {
    const rowEnvironment = { [OCCURRENCES_FILE_VARIABLE]: rowFile };
    const launched = [];
    const processesEnded = [];
    const stepsRunIn = [];
    let browser;
    const launch = (options) => {
      browser = boundCalls(new Browser(options), 'browser');
      launched.push(browser);
      return Promise.resolve(browser);
    };
    await launch({ answers: false, closes: stalledCloses });
    const replace = (unanswering) => {
      const stalled = browser;
      return replaceUnansweringBrowser({
        browser: stalled,
        endProcess: () => {
          processesEnded.push(stalled);
          return Promise.resolve();
        },
        record: ({ processEnded }) =>
          recordOccurrence(
            {
              kind: 'browser-replaced',
              signature: replacementSignature({
                stage: 'firefox-localized-not-found',
                timeoutMs: 50,
                processEnded,
              }),
              detail: unanswering.message.split('\n')[0],
            },
            rowEnvironment,
          ),
        launch: () => launch({ answers: true }),
      });
    };
    for (const name of ['first', 'second', 'third']) {
      await stepClosingItsOwnPages(async () => {
        const context = boundCalls(browser.newContext(), 'context');
        const page = boundCalls(browser.newPage(), 'page');
        stepsRunIn.push([name, launched.indexOf(browser)]);
        await closePageWithItsContext(page, context, (error) =>
          recordOccurrence(
            {
              kind: 'page-close-unsettled',
              signature: 'self-test',
              detail: error.message,
            },
            rowEnvironment,
          ),
        );
      }, replace);
    }
    return {
      launched,
      processesEnded,
      stepsRunIn,
      occurrences: collectOccurrences(['row'], () => rowFile),
    };
  };

  // Its own close settles: it is closed, nothing is ended by force, one occurrence is recorded, and
  // the steps after the stall run in the browser launched in its place.
  {
    const row = await runRow({
      stalledCloses: true,
      rowFile: join(runs, 'closed.occurrences.jsonl'),
    });
    assert.equal(row.launched.length, 2, 'no fresh browser was launched');
    assert.equal(
      row.launched[0].closed,
      true,
      'the browser that stopped answering was left open',
    );
    assert.deepEqual(
      row.processesEnded,
      [],
      'a browser that closed had its process ended as well',
    );
    assert.deepEqual(
      row.stepsRunIn,
      [
        ['first', 0],
        ['second', 1],
        ['third', 1],
      ],
      'the rest of the row did not run in the fresh browser',
    );
    assert.deepEqual(ledgerOccurrences(row.occurrences), [
      {
        stage: 'row',
        kind: 'browser-replaced',
        signature:
          'firefox-localized-not-found: page.close and then context.close did not settle within 50ms, so the browser was closed and a fresh one launched in its place',
      },
    ]);
    assert.match(
      row.occurrences[0].detail,
      /^page\.close did not settle within 50ms/u,
    );
    assert.equal(
      verdictOccurrences(row.occurrences),
      ', 1 occurrence(s) worked around',
    );
  }

  // Its own close does not settle either: its process is ended, the signature says so, and the row
  // goes on in the fresh browser all the same.
  {
    const row = await runRow({
      stalledCloses: false,
      rowFile: join(runs, 'ended.occurrences.jsonl'),
    });
    assert.equal(row.launched.length, 2, 'no fresh browser was launched');
    assert.deepEqual(
      row.processesEnded,
      [row.launched[0]],
      'the process of a browser whose close did not settle was not ended',
    );
    assert.deepEqual(
      row.stepsRunIn.map(([, browserIndex]) => browserIndex),
      [0, 1, 1],
      'the rest of the row did not run in the fresh browser',
    );
    assert.deepEqual(
      row.occurrences.map(({ kind, signature }) => [kind, signature]),
      [
        [
          'browser-replaced',
          'firefox-localized-not-found: page.close and then context.close did not settle within 50ms, so the browser was closed, which did not settle either, so its process was ended, and a fresh one launched in its place',
        ],
      ],
    );
  }

  // A browser whose close fails outright is the row's failure, and nothing is launched over it.
  {
    let launches = 0;
    await assert.rejects(
      replaceUnansweringBrowser({
        browser: {
          close: () => Promise.reject(new Error('Protocol error: browser')),
        },
        endProcess: () => assert.fail('a failed close ended a process'),
        record: () =>
          assert.fail('a failed close was recorded as worked around'),
        launch: () => {
          launches += 1;
        },
      }),
      /Protocol error: browser/u,
    );
    assert.equal(launches, 0);
  }

  // A step that fails for any other reason fails the row, and the browser is left as it is.
  {
    await assert.rejects(
      stepClosingItsOwnPages(
        () => Promise.reject(new Error('an assertion of the step')),
        () => assert.fail('a failed step replaced the browser'),
      ),
      /an assertion of the step/u,
    );
  }

  // Any other failure of the close is the row's, and the context is left alone.
  {
    const context = boundCalls(new Context(true), 'context');
    const failing = {
      close: () =>
        Promise.reject(
          new Error('Target page, context or browser has been closed'),
        ),
    };
    await assert.rejects(
      closePageWithItsContext(failing, context, record),
      /has been closed/u,
    );
    assert.equal(
      context.closed,
      false,
      'a close that failed outright was treated as unsettled',
    );
  }

  assert.equal(verdictOccurrences([]), '');
} finally {
  rmSync(runs, { force: true, recursive: true });
}
console.log('browser teardown self-test: every path behaved as required');
