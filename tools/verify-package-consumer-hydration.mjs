import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { listenForBrowsers } from './browser-reachable-port.mjs';
import {
  closePageWithItsContext,
  createCallBound,
  replaceUnansweringBrowser,
  replacementSignature,
  stepClosingItsOwnPages,
} from './browser-call-bound.mjs';
import { navigateWithScriptGate } from './browser-script-gate.mjs';
import { recordOccurrence } from './gate-occurrences.mjs';
import { descendantsOf, readProcesses } from './process-tree.mjs';
import {
  openCapabilityEvidence,
  recordCapabilityClaim,
} from './capability-evidence.mjs';
import {
  readConsumerAddresses,
  readConsumerBuilds,
} from './consumer-addresses.mjs';
import {
  claimLoggedChange,
  claimLoggedHandOver,
  loggedEvents,
} from './consumer-events.mjs';
import {
  claimExercisedContext,
  claimExercisedControls,
  claimExercisedDirectives,
  claimExercisedExtensions,
  claimExercisedFormats,
  claimExercisedPipes,
  claimInstalledRelativeTime,
  claimSheetParameter,
  exerciseSheetNames,
  exerciseAuthority,
  readCatalogMessage,
  readExerciseSources,
  readExerciseInputs,
  sheetOf,
} from './exercise-sheet.mjs';
import { resolveConsumerProfile } from './package-consumer-profiles.mjs';
import { chromium, firefox, webkit } from 'playwright';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Which materialized consumer to drive, named by the caller so that every row can be driven. A row
// this stage cannot reach has no server-rendering, hydration, accessibility or browser evidence
// behind it, and "works on Angular 22.0.0" would then mean that its unit tests and a build passed
// rather than that it rendered and hydrated.
const consumerName = process.argv[2] ?? 'package-consumer';
const consumerProfile = resolveConsumerProfile(consumerName);
const consumerRoot = resolve(
  workspaceRoot,
  'tmp/package-consumer-verification',
  consumerName,
);
// The sections below claim what they assert, as the consumer row this stage drives.
openCapabilityEvidence('browser-assurance', { consumer: consumerRoot });
// Where each page lives, read from the address table the consumer's own specs read.
const addresses = await readConsumerAddresses(consumerRoot);
// Whether the deployment lets a cache serve a stale success without asking again. The address
// table says so beside the floor, so a declaration that goes missing from `response-caching.ts`
// fails the checks that expect it instead of switching them off.
const declaresNoRevalidation =
  JSON.parse(
    await readFile(resolve(consumerRoot, 'src/app/addresses.json'), 'utf8'),
  ).revalidateSuccess === false;
// The locales this build generated, which are the ones it prerenders.
const consumerConfiguration = JSON.parse(
  await readFile(resolve(consumerRoot, 'equator.config.json'), 'utf8'),
);
const builtLocales = consumerConfiguration.locales;
// The name the build gave each locale, from the one line the toolkit writes for them in the
// generated configuration, so a choice's label is held to the build rather than to the engine's
// own display names.
const generatedLocaleNames = JSON.parse(
  /^ {2}localeNames: Object\.freeze\((\{.*\}) as const\),$/mu.exec(
    await readFile(
      resolve(consumerRoot, 'src/generated/i18n/index.ts'),
      'utf8',
    ),
  )?.[1] ?? 'null',
);
assert.ok(
  typeof generatedLocaleNames?.['ar-EG'] === 'string',
  'The generated configuration gives ar-EG no name, so no choice label can be held to one',
);
// The source locale, whose addresses a pseudo-locale spells where no address names a locale, and
// the formatting the consumer declares for each locale that departs from CLDR.
const { sourceLocale, formatting: configuredFormatting = {} } =
  consumerConfiguration;
// The imports below take this process's failure reporting away, and this is where the harness keeps
// it.
//
// The consumer's server bundle calls Angular's `attachNodeGlobalErrorHandlers`, which registers
// `uncaughtException` and `unhandledRejection` listeners that write to `console.error` and return.
// Node suppresses its own default (print the error, exit non-zero) as soon as any listener is
// registered for those events. So from the first of those imports onwards, without listeners of
// this file's own, every error that escapes is printed in full and the process exits 0: a later
// import that finds no build, an assertion outside the `try` further down, a throw inside the
// static file server's request handler, a promise nobody awaited. The pass that follows is
// indistinguishable from a real one. The listeners are registered before the first import and not
// after the last, because the imports are several and each one after the first can fail.
//
// Note what this cannot be replaced by. Moving the assertions inside a `try` would cover the
// assertions and not the callbacks, and the next `createServer` handler or page listener would be
// outside it again. The property that has to hold is narrower and stronger than any block boundary:
// an error this file did not choose to handle ends the process non-zero. Listeners run in
// registration order, so these run before Angular's and end the process. `fetch` reports every
// network failure as a bare `TypeError: fetch failed` and puts the reason (a refused connection and
// the port it was refused on, a socket hang up, a DNS failure) in `cause`. Printing the top error
// alone turns a specific failure into a sentence that identifies nothing, which is the same shape
// of non-answer the bounds in this file exist to remove.
const describeError = (error) => {
  const parts = [];
  let current = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 8;) {
    parts.push(
      current instanceof Error
        ? (current.stack ?? current.message)
        : String(current),
    );
    current = current instanceof Error ? current.cause : undefined;
    depth += 1;
  }
  return parts.join('\ncaused by: ');
};

const failEscaped = (event) => (error) => {
  process.stderr.write(
    `Equator browser assurance failed.\nEscaped as an ${event}, outside every handler in this file.\n${describeError(error)}\n`,
  );
  // `process.exit` rather than `process.exitCode`, because an escape can leave the static file
  // server or a browser holding the event loop open, and a gate that fails by hanging is no better
  // than one that fails by exiting 0.
  process.exit(1);
};
process.on('uncaughtException', failEscaped('uncaught exception'));
process.on('unhandledRejection', failEscaped('unhandled rejection'));

// What is deployed: one build, or under a policy that puts each locale on an origin of its own, one
// build for each of those origins, which is how the consumer stage built them. A request reaches
// the build its Host names, as it would behind a real deployment's routing.
const builds = await readConsumerBuilds(consumerRoot);
const deployments = await Promise.all(
  (addresses.localeInOrigin
    ? [...new Set(builtLocales.map((locale) => addresses.origin(locale)))]
    : [builds.siteOrigin]
  ).map(async (deploymentOrigin) => {
    const root = resolve(consumerRoot, builds.output(deploymentOrigin));
    return Object.freeze({
      origin: deploymentOrigin,
      host: new URL(deploymentOrigin).host,
      locales: builtLocales.filter(
        (locale) =>
          !addresses.localeInOrigin ||
          addresses.origin(locale) === deploymentOrigin,
      ),
      browserRoot: resolve(root, 'browser'),
      prerenderManifestPath: resolve(root, 'prerendered-routes.json'),
      ...(await (async () => {
        const server = await import(
          pathToFileURL(resolve(root, 'server/server.mjs')).href
        );
        return {
          reqHandler: server.reqHandler,
          localeRequestOptions: server.localeRequestOptions,
        };
      })()),
    });
  }),
);
// The pseudo build the consumer stage made beside the production one, for the origin that serves
// the pseudo-locale. A request that names it by this header is answered by it in place of the
// production build, so its pages sit at the same addresses and pass the same edge.
const PSEUDO_BUILD_HEADER = 'x-equator-build';
const pseudoDeployment = await (async () => {
  const pseudoOrigin = addresses.localeInOrigin
    ? addresses.origin('en-Arab-XB')
    : builds.siteOrigin;
  const root = resolve(
    consumerRoot,
    builds.output(pseudoOrigin, 'dist/feature-lab-pseudo'),
  );
  return Object.freeze({
    origin: pseudoOrigin,
    host: new URL(pseudoOrigin).host,
    browserRoot: resolve(root, 'browser'),
    reqHandler: (
      await import(pathToFileURL(resolve(root, 'server/server.mjs')).href)
    ).reqHandler,
  });
})();
function deploymentFor(host) {
  return addresses.localeInOrigin
    ? deployments.find((deployment) => deployment.host === host)
    : deployments[0];
}
function deploymentOf(locale) {
  return addresses.localeInOrigin
    ? deployments.find((deployment) => deployment.locales.includes(locale))
    : deployments[0];
}
// The route view each page renders, for the pages the address table says the build prerenders.
const prerenderedViews = Object.freeze({
  second: 'second',
  article: 'article',
  'exercise values': 'exercise',
  deferred: 'lazy',
});
// The page the checks of a prerendered file load, because a policy decides which pages can be
// written once for every visitor.
const prerenderedPage = addresses.prerendered[0];
const prerenderedView = `[data-route-view="${prerenderedViews[prerenderedPage]}"]`;
// What that page shows in Arabic.
const prerenderedArabic = Object.freeze({
  second: Object.freeze({ selector: prerenderedView, text: 'الصفحة الثانية' }),
  article: Object.freeze({
    selector: `${prerenderedView} h2`,
    text: 'دليل Equator للترجمة',
  }),
})[prerenderedPage];
// Every locale's copy of every prerendered route a deployment writes, and none that Equator did not
// derive. The article's slug is spelled differently per locale, so its addresses share no path
// segment after `/articles/`, which is exactly the expansion a hand-written list gets wrong
// silently. Keyed as the manifest keys them, decoded.
function prerenderedRouteViews(deployment) {
  return new Map(
    deployment.locales.flatMap((locale) =>
      Object.entries(prerenderedViews)
        .filter(
          ([page]) =>
            addresses.prerendered.includes(page) && addresses.has(page, locale),
        )
        .map(([page, view]) => [
          decodeURIComponent(addresses.path(page, locale)),
          view,
        ]),
    ),
  );
}

// And this is what proves the two listeners registered above the imports work, because nothing else
// can: a gate that has never been seen failing is indistinguishable from one that cannot fail.
// `verify:browser-assurance` does not run unless
// `verify:browser-assurance:self-test` has just watched this process exit non-zero for both classes
// of escape, against the same Angular bundle that installs the handlers being overridden, which
// is why the hook is here, after the import, and not in a unit test that never loads one.
const selfTest = process.env.EQUATOR_ASSURANCE_SELF_TEST;
if (selfTest === 'assertion') {
  assert.fail(
    "Self-test escape: an assertion outside this file's own try block.",
  );
} else if (selfTest === 'rejection') {
  void Promise.reject(
    new Error('Self-test escape: a rejection nobody awaited.'),
  );
} else if (selfTest === 'diagnostics') {
  // Thrown inside the try below rather than here. The two above exercise the process-level
  // handlers and must escape everything; this one exercises the block that reports a failure the
  // run did catch, and that block only runs for a failure inside the try.
} else if (
  selfTest === 'unanswering-browser' ||
  selfTest === 'unanswering-browser-process'
) {
  // Planted where each row first closes a page and context of its own: both closes are left
  // outstanding, and under the second value the browser's own close as well, so the row replaces a
  // real browser, by ending real processes under the second value, and has to finish in the fresh
  // one. A run by hand; it passes, with one occurrence recorded for each engine.
} else if (selfTest !== undefined) {
  assert.fail(`Unknown EQUATOR_ASSURANCE_SELF_TEST value: ${selfTest}`);
}

// Where this run is, and a bound on how long it may stay there.
//
// The success line sits at the close of the `try` and the failure block after the `finally`, so
// without this a hung run and a working run are the same observation from outside. Telling them
// apart would need a reader who already knows how long the step takes, and a step that takes 29
// seconds can be watched for twenty minutes on the reading that it is merely slow.
//
// The budget is per stage rather than per run, because during a hang the useful question is never
// "how long has this taken" but "what is it waiting for", and a stage name answers it. Playwright
// hangs are awaits that never settle rather than busy loops, so a timer still fires; `unref` keeps
// a healthy run from being held open by one. The default is generous against a 29-second run (it
// is here to convert an unbounded wait into a report, not to police timing) and the environment
// variable is for a machine slow enough to need one.
const stageTimeoutMs = Number(
  process.env.EQUATOR_ASSURANCE_STAGE_TIMEOUT_MS ?? 120_000,
);
assert.ok(
  Number.isSafeInteger(stageTimeoutMs) && stageTimeoutMs > 0,
  `EQUATOR_ASSURANCE_STAGE_TIMEOUT_MS must be a positive whole number of milliseconds, not ${JSON.stringify(process.env.EQUATOR_ASSURANCE_STAGE_TIMEOUT_MS)}`,
);
// What the row is doing right now, kept so the stage bound can report it.
//
// A stage can overrun with no console error, no page error and no request failure to report, and a
// bound that then reports only the stage name is a tally rather than an instrument. So the row
// carries a rolling account of what it last did and what it is still waiting for, and the watchdog
// prints it. Playwright bounds a call when its own signature carries a timeout: navigations,
// locator actions, the explicit waits. Everything else is unbounded by construction:
// `page.evaluate`, `elementHandle.evaluate`, `context.newPage`, and `page.close`, whose 1.61.1
// signature takes `reason` and `runBeforeUnload` and nothing else, so `setDefaultTimeout` cannot
// reach it.
//
// Bounding a chosen list of methods leaves every other method unbounded: the list is wrong the
// first time anyone calls a method nobody thought of.
//
// So the rule is over the API rather than over the sites noticed so far: wrap every method, and race
// only what comes back as a thenable. A call that carries its own timeout reaches Playwright's bound
// first and reports Playwright's message; a call that carries none reaches this one, which names the
// method, its first argument, and what the row was doing. Handles that come back from a wrapped call
// are wrapped in turn, because `page.$()` returns the object whose `evaluate` is as unbounded as the
// page's own.
//
// The three bounds nest deliberately. Playwright's own is 15s for an action and 20s for a
// navigation; this one is 30s, above both so it never pre-empts a more specific message; the stage
// bound is 120s and stays as the outer guard for anything this file does not make a call for. What
// the tracker says about the recurring shape here: Firefox page.close hanging under parallel load
// (microsoft/playwright#22090, closed for 1.37), two Firefox contexts waiting endlessly (#34586, a
// 1.50.1 regression closed by PR #35116), and newPage timing out on Firefox (#36551, closed). All
// closed in releases older than the 1.61.1 pinned here, none of them naming a workaround to adopt.
const callTimeoutMs = Number(
  process.env.EQUATOR_ASSURANCE_CALL_TIMEOUT_MS ?? 30_000,
);
assert.ok(
  Number.isSafeInteger(callTimeoutMs) && callTimeoutMs > 0,
  `EQUATOR_ASSURANCE_CALL_TIMEOUT_MS must be a positive whole number of milliseconds, not ${JSON.stringify(process.env.EQUATOR_ASSURANCE_CALL_TIMEOUT_MS)}`,
);

// A wait that fails with no console error, no page error and no failed request says nothing about
// a request the page started and never saw answered, which is what a held or lost script looks
// like. So every page keeps the requests it has outstanding, and a failed call on it lists them.
const outstandingRequests = new WeakMap();

function watchRequests(target) {
  if (typeof target.goto !== 'function' || typeof target.on !== 'function') {
    return;
  }
  const outstanding = new Map();
  outstandingRequests.set(target, outstanding);
  target.on('request', (request) => outstanding.set(request, Date.now()));
  target.on('requestfinished', (request) => outstanding.delete(request));
  target.on('requestfailed', (request) => outstanding.delete(request));
}

function outstandingRequestsNote(page) {
  const outstanding = outstandingRequests.get(page);
  if (outstanding === undefined) return '';
  const now = Date.now();
  const listed = [...outstanding].map(
    ([request, started]) =>
      `${request.method()} ${request.url()} (${request.resourceType()}, ${now - started}ms)`,
  );
  return `\nRequests the page had started and not seen finish: ${
    listed.length === 0 ? 'none' : `\n  ${listed.join('\n  ')}`
  }`;
}

const boundCalls = createCallBound({
  timeoutMs: callTimeoutMs,
  describe: () => describeActivity(),
  adopt: watchRequests,
  annotate: outstandingRequestsNote,
});

// Heavy diagnostics, off unless asked for.
//
// The plainest form of the problem: page-side wrappers around every scroll-capable call, plus a
// Playwright subscription to every request the row makes, moved this row's failure rate from 6 in 40
// to 9 in 20. An instrument that changes what it measures is not one, and the honest response is a
// switch rather than an argument about which half did it. Declared here with the rest of the stage
// state, because the watchdog is armed by the first `enterStage` and reads all of it.
const traceCalls = process.env.EQUATOR_ASSURANCE_TRACE_CALLS === '1';
const traceRequests = process.env.EQUATOR_ASSURANCE_TRACE_REQUESTS === '1';

const rowActivity = {
  lastEvent: 'nothing yet',
  lastEventAt: Date.now(),
  awaiting: 'nothing yet',
  awaitingSince: Date.now(),
  inFlight: new Map(),
};

function noteActivity(what) {
  rowActivity.lastEvent = what;
  rowActivity.lastEventAt = Date.now();
}

// Which await the row is inside, kept apart from `lastEvent` on purpose. `lastEvent` is the most
// recent thing that happened and is overwritten by every navigation; this is the thing that has not
// happened yet, and it has to survive everything that happens while it waits. Recording the await
// through `noteActivity` was tried first and a deliberately shortened bound reported a URL, which is
// the reading this exists to replace.
function noteAwaiting(what) {
  rowActivity.awaiting = what;
  rowActivity.awaitingSince = Date.now();
}

function describeActivity() {
  const now = Date.now();
  const outstanding = [...rowActivity.inFlight.entries()]
    .map(([url, startedAt]) => `${url} (${now - startedAt}ms in flight)`)
    .slice(0, 10);
  return {
    awaiting: rowActivity.awaiting,
    awaitingForMs: now - rowActivity.awaitingSince,
    lastEvent: rowActivity.lastEvent,
    lastEventAgeMs: now - rowActivity.lastEventAt,
    requestsInFlight: traceRequests ? outstanding.length : 'not tracked',
    outstanding: traceRequests
      ? outstanding
      : 'set EQUATOR_ASSURANCE_TRACE_REQUESTS=1',
  };
}

let verificationStage = 'startup';
let stageWatchdog;
let stageEnteredAt = Date.now();
// How long the stage that is ending took, on every run rather than only on the failing ones.
//
// The Firefox row's 120s bound has blown twice with nothing else reporting: no console
// error, no page error, no request failure. A bound sitting just above a row's typical duration
// produces exactly that: a rare, causeless timeout that is a defect in the bound rather than a hang.
// Deciding between the two needs the distribution of the passing runs, and `stageElapsedMs` was
// only ever written into the failure diagnostics, so a hundred green runs carried nothing to
// compare against. Now every stage prints what it cost as it ends.
const leaveStage = () => {
  process.stderr.write(
    `[assurance] ${verificationStage} finished in ${Date.now() - stageEnteredAt}ms\n`,
  );
};
const enterStage = (name) => {
  leaveStage();
  verificationStage = name;
  stageEnteredAt = Date.now();
  // stderr, because `verify.mjs` streams both but reprints stdout as a step's evidence.
  process.stderr.write(`[assurance] ${name}\n`);
  clearTimeout(stageWatchdog);
  stageWatchdog = setTimeout(() => {
    process.stderr.write(
      `Equator browser assurance failed.\nStage ${JSON.stringify(name)} did not finish within ${stageTimeoutMs}ms. The bound is what separates a wait for something that is never coming from work in progress.\n` +
        `What the row was doing when the bound tripped: ${JSON.stringify(describeActivity(), null, 2)}\n` +
        `A last event that is seconds old with nothing in flight is a wait for something that is never coming, rather than work that is slow.\n`,
    );
    process.exit(1);
  }, stageTimeoutMs);
  stageWatchdog.unref();
};
enterStage('startup');

// Keyed by the deployment's origin and the route, because under a policy that puts each locale on
// an origin of its own every deployment writes the same paths.
const prerenderArtifacts = new Map();
for (const deployment of deployments) {
  assert.equal(
    typeof deployment.reqHandler,
    'function',
    `The SSR request handler of the build at ${deployment.origin} is absent`,
  );
  const routeViews = prerenderedRouteViews(deployment);
  const prerenderManifest = JSON.parse(
    await readFile(deployment.prerenderManifestPath, 'utf8'),
  );
  assert.deepEqual(
    Object.keys(prerenderManifest.routes ?? {}).sort(),
    [...routeViews.keys()].sort(),
    `The prerender manifest of the build at ${deployment.origin} does not contain the exact Equator prerender rows`,
  );
  for (const [route, view] of routeViews) {
    const html = await readFile(
      resolve(deployment.browserRoot, route.slice(1), 'index.html'),
      'utf8',
    );
    assert.match(html, /<app-root\b/iu, `${route} prerender root is absent`);
    assert.match(
      html,
      new RegExp(`data-route-view="${view}"`, 'u'),
      `${route} prerender route is absent`,
    );
    prerenderArtifacts.set(
      `${deployment.origin}${route}`,
      Object.freeze({
        digest: createHash('sha256').update(html, 'utf8').digest('hex'),
      }),
    );
  }
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

async function serveBrowserAsset(request, response, browserRoot) {
  let assetPath;

  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const relativePath = decodeURIComponent(pathname)
      .replace(/^\/+/, '')
      .replaceAll('/', sep);
    assetPath = resolve(browserRoot, relativePath);
  } catch {
    response.statusCode = 400;
    response.end('Invalid asset path');
    return;
  }

  if (
    assetPath === browserRoot ||
    !assetPath.startsWith(`${browserRoot}${sep}`)
  ) {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }

  // A directory resolves to the `index.html` inside it, which is the deployment requirement Equator
  // states in `specs/07-routing-rendering-and-seo.spec.md` section 9, met here rather than
  // assumed.
  //
  // **An engine that looks its prerendered assets up without decoding the request path reaches this
  // line for a non-ASCII address.** `/ar-eg/articles/%D8%AF...` then misses the manifest entry the
  // same build wrote under the decoded name and falls through to here, and without this line to
  // `readFile` on a directory, which is `EISDIR` rather than `ENOENT` and answers 500.
  // `@angular/ssr` from 22.1.7 decodes before the lookup
  // (`AngularServerApp.buildServerAssetPathFromRequest`, read at 22.2.1) and answers that address
  // itself, `200` with `ng-server-context="ssg"`, without reaching this function.
  //
  // The line stays, because what it meets is a requirement on the host and not a workaround for a
  // framework defect. A static file server or a CDN serving this build has no engine in front of it
  // and still has to map the directory itself; section 9.1 states that, and this fixture is where it
  // is measured. The engine version decides which of the two paths answers first here, not whether
  // the requirement holds.
  if (extname(assetPath) === '') {
    assetPath = resolve(assetPath, 'index.html');
  }

  try {
    const content = await readFile(assetPath);
    response.statusCode = 200;
    response.setHeader(
      'Content-Type',
      contentTypes.get(extname(assetPath)) ?? 'application/octet-stream',
    );
    response.end(content);
  } catch (error) {
    response.statusCode =
      typeof error === 'object' && error !== null && error.code === 'ENOENT'
        ? 404
        : 500;
    response.end(response.statusCode === 404 ? 'Not found' : String(error));
  }
}

// Declared before either server, because the application server records a request for a host no
// deployment answers at in it as well.
const edgeFailures = [];

const server = createServer((request, response) => {
  const deployment =
    request.headers[PSEUDO_BUILD_HEADER] === 'pseudo'
      ? pseudoDeployment
      : deploymentFor(request.headers.host);
  if (deployment === undefined) {
    edgeFailures.push(
      `${request.method} ${request.url}: no deployment answers at ${request.headers.host}`,
    );
    response.statusCode = 421;
    response.end('No deployment answers at this host.');
    return;
  }
  const next = (error) => {
    if (response.writableEnded) {
      return;
    }

    if (error === undefined) {
      void serveBrowserAsset(request, response, deployment.browserRoot);
      return;
    }

    response.statusCode = 500;
    response.end(String(error));
  };

  try {
    const result = deployment.reqHandler(request, response, next);
    Promise.resolve(result).catch(next);
  } catch (error) {
    next(error);
  }
});

await listenForBrowsers(server, '127.0.0.1');

const address = server.address();
assert.notEqual(address, null, 'SSR server has no address');
assert.equal(typeof address, 'object', 'SSR server address is not TCP');
const origin = `http://127.0.0.1:${address.port}`;

// The server a deployment under a strict policy puts in front of the application, and the policy
// comes from it for the reason a deployment's does: every document passes through it, whether the
// browser asked for that address or was redirected there. A route in the browser misses the second
// kind, because Playwright calls a route handler only for the first address of a navigation that
// redirects (Playwright 1.63.0, the documentation of `Page.route`). The application's own server
// cannot add it, because the policy hashes the document's inline scripts and the headers are sent before the body
// (`writeNodeResponse` in `@neolorn/equator/http` sets every header before it reads a chunk).
//
// The checks of what the application answers read `origin` directly, without the edge, because
// the application's answer is what they are about. Pages load from `browserOrigin`.
const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const withoutHopByHop = (headers) =>
  Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) => value !== undefined && !hopByHopHeaders.has(name),
    ),
  );

/**
 * What a browser asked the edge for at a host outside loopback, where no deployment of this site
 * can be. The full Chromium build the back-forward restore runs in calls a time service and
 * sign-in and push services on its own, and it reaches every host through this edge so that none
 * of those requests leaves the machine. They are refused and listed rather than counted as
 * failures, because no page made them: a page's own request to another origin meets its Content
 * Security Policy first.
 */
const offSiteRequests = [];

function isLoopbackHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

const edge = createServer((request, response) => {
  // Recorded as well as answered, because a page that lands on the answer may assert nothing
  // about it, and `assertBrowserDiagnostics` reads this list.
  const fail = (error) => {
    edgeFailures.push(
      `${request.method} ${request.url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!response.headersSent) {
      response.statusCode = 502;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
    }
    response.end('The browser assurance edge could not serve this response.');
  };
  // Under a policy that puts each locale on an origin of its own the browsers reach this as their
  // proxy, so the target is absolute and names the origin the page is at. That origin is the Host
  // the application is asked with, taken from the target rather than the header, which an engine
  // may drop from an intercepted request it continues.
  const target = new URL(request.url ?? '/', browserOrigin);
  if (!isLoopbackHost(target.hostname)) {
    offSiteRequests.push(`${request.method} ${target.host}`);
    response.statusCode = 502;
    response.end();
    return;
  }
  const upstream = httpRequest(
    `${origin}${target.pathname}${target.search}`,
    {
      method: request.method,
      headers: { ...withoutHopByHop(request.headers), host: target.host },
    },
    (answer) => {
      try {
        const status = answer.statusCode ?? 502;
        response.statusCode = status;
        for (const [name, value] of Object.entries(
          withoutHopByHop(answer.headers),
        )) {
          response.setHeader(name, value);
        }
        // A redirect is not an application document and has no root element to attach a nonce
        // to; the document it leads to comes back through here.
        const isDocument =
          request.method !== 'HEAD' &&
          (status < 300 || status >= 400) &&
          (answer.headers['content-type'] ?? '').includes('text/html');
        if (!isDocument) {
          answer.pipe(response);
          return;
        }
        assert.equal(
          answer.headers['content-encoding'],
          undefined,
          `${request.url} arrived encoded, and the policy is computed from the document's text`,
        );
        const chunks = [];
        answer.on('data', (chunk) => chunks.push(chunk));
        answer.on('error', fail);
        answer.on('end', () => {
          try {
            const original = Buffer.concat(chunks).toString('utf8');
            const protectedDocument = applyStrictBrowserPolicy(
              original,
              target.href,
            );
            response.setHeader(
              'content-security-policy',
              protectedDocument.policy,
            );
            response.setHeader(
              'x-equator-original-document-sha256',
              createHash('sha256').update(original, 'utf8').digest('hex'),
            );
            response.setHeader(
              'content-length',
              Buffer.byteLength(protectedDocument.body),
            );
            response.end(protectedDocument.body);
          } catch (error) {
            fail(error);
          }
        });
      } catch (error) {
        fail(error);
      }
    },
  );
  upstream.on('error', fail);
  request.pipe(upstream);
});

// A tunnel is how a browser reaches an https address through a proxy, and nothing this site serves
// is https.
edge.on('connect', (request, socket) => {
  socket.on('error', () => {});
  const tunnel = `CONNECT ${request.url}`;
  if (isLoopbackHost(new URL(`http://${request.url}`).hostname)) {
    edgeFailures.push(`${tunnel}: this site serves nothing over https`);
  } else {
    offSiteRequests.push(tunnel);
  }
  socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
});

await listenForBrowsers(edge, '127.0.0.1');

/**
 * The embedded application in the seat, served as a deployment of its own. The consumer stage builds
 * it on every row, and nothing it does reads a URL policy, so the development row alone opens it.
 */
async function serveEmbedded() {
  const buildRoot = resolve(consumerRoot, 'embedded/dist/embedded');
  const { reqHandler } = await import(
    pathToFileURL(resolve(buildRoot, 'server/server.mjs')).href
  );
  const browserRoot = resolve(buildRoot, 'browser');
  const embeddedServer = createServer((request, response) => {
    const next = (error) => {
      if (response.writableEnded) return;
      if (error === undefined) {
        void serveBrowserAsset(request, response, browserRoot);
        return;
      }
      response.statusCode = 500;
      response.end(String(error));
    };
    try {
      Promise.resolve(reqHandler(request, response, next)).catch(next);
    } catch (error) {
      next(error);
    }
  });
  await listenForBrowsers(embeddedServer, '127.0.0.1');
  return Object.freeze({
    server: embeddedServer,
    origin: `http://127.0.0.1:${embeddedServer.address().port}`,
    browserRoot,
  });
}
const embedded =
  consumerName === 'package-consumer' ? await serveEmbedded() : undefined;
const edgeAddress = edge.address();
assert.equal(
  typeof edgeAddress,
  'object',
  'The edge server address is not TCP',
);
const browserOrigin = `http://127.0.0.1:${edgeAddress.port}`;

async function closeServer() {
  await Promise.race([
    Promise.all(
      [edge, server, ...(embedded === undefined ? [] : [embedded.server])].map(
        (each) => {
          each.closeIdleConnections?.();
          each.closeAllConnections?.();
          return new Promise((resolveClose, rejectClose) => {
            each.close((error) => {
              if (error === undefined) {
                resolveClose();
              } else {
                rejectClose(error);
              }
            });
          });
        },
      ),
    ),
    new Promise((resolveClose) => setTimeout(resolveClose, 5_000)),
  ]);
}

// Where a browser loads a path the locale is served at: through the edge, which under a policy that
// puts each locale on an origin of its own is the browser's proxy, so the page keeps its own origin.
function siteUrl(path, locale = 'en-US') {
  return addresses.localeInOrigin
    ? new URL(path, addresses.origin(locale)).href
    : `${browserOrigin}${path}`;
}

function isSiteUrl(url) {
  return (
    url.startsWith(`${browserOrigin}/`) ||
    (addresses.localeInOrigin &&
      builtLocales.some((locale) =>
        url.startsWith(`${addresses.origin(locale)}/`),
      ))
  );
}

// Whether the browser is at the page as shown in the locale, origin included where it names one.
function isShown(url, page, locale) {
  return (
    url.pathname === addresses.shownPath(page, locale) &&
    (!addresses.localeInOrigin || url.origin === addresses.origin(locale))
  );
}

/** The option `LocaleChoice` renders for a locale, found by the attribute the application gives it. */
function localeChoice(page, locale) {
  return page.locator(`[data-locale-choice="${locale}"]`);
}

/**
 * Holds every element the server rendered, from inside the page and before any script runs, so a
 * claim made later can count how many of them the client kept. A page that loads another document
 * loses the hold with the rest of its state, and so counts none.
 */
async function holdServerElements(page) {
  await page.evaluate(() => {
    const root = document.querySelector('[ng-server-context]');
    globalThis.__equatorServerElements =
      root === null ? [] : [root, ...root.querySelectorAll('*')];
  });
}

/**
 * Where a section's claims were asserted, read from the page once its client has booted: the
 * engine running it, the policy the page reports, the document it shows, how many of the server's
 * elements it still shows, and how often its router moved without a document request.
 */
async function measuredContext(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );
  const reported = await page.evaluate(() => ({
    policy: document.documentElement.dataset['urlPolicy'],
    clientNavigations: document.documentElement.dataset['clientNavigations'],
    adoptedElements: (globalThis.__equatorServerElements ?? []).filter(
      (element) => element.isConnected,
    ).length,
  }));
  assert.notEqual(
    reported.policy,
    undefined,
    'The page reports no policy, so its claims cannot say which one they ran under',
  );
  return {
    engine: page.context().browser(),
    policy: JSON.parse(reported.policy),
    document: await page.content(),
    adoptedElements: reported.adoptedElements,
    clientNavigations: Number(reported.clientNavigations),
  };
}

/**
 * Where a client render's claims were asserted: what `measuredContext` reads, the platform the
 * page's own injector reports, and the document the server answered for the page in place of the
 * one the browser holds now. `measuredContext` reports no platform, because a hydrated page is on
 * the browser platform too and every claim made there would then name a client render. Only a
 * document the server answered without a server-context mark shows that nothing drew the page
 * before the browser did.
 */
async function clientRenderContext(page, answered) {
  const measured = await measuredContext(page);
  const platform = await page.evaluate(
    () => document.documentElement.dataset['platform'],
  );
  assert.notEqual(
    platform,
    undefined,
    'The page reports no platform, so its claims cannot say which one rendered it',
  );
  return { ...measured, platform, document: answered };
}

/**
 * The lines the application's event log writes to the console of `page`, as they arrive, for
 * `loggedEvents` to read.
 */
function logOf(page) {
  const lines = [];
  page.on('console', (message) => {
    if (message.text().startsWith('equator-event ')) lines.push(message.text());
  });
  return lines;
}

/** The name a section's claims are listed under. */
function sectionCheck(row, section) {
  return `${consumerName} ${row.id}: ${section}`;
}

/**
 * Claims the row of the policy the page reports. A claim for another policy's row is refused as a
 * mislabel, so only the matching one is made.
 */
function claimRunningPolicy(check, { policy, ...context }) {
  if (policy.kind === 'locale-host') {
    recordCapabilityClaim(check, 'policy:locale-host', { ...context, policy });
  } else if (policy.kind === 'locale-neutral') {
    recordCapabilityClaim(check, 'policy:locale-neutral', {
      ...context,
      policy,
    });
  } else if (policy.omitDefaultPrefix) {
    recordCapabilityClaim(check, 'policy:default-locale-prefix', {
      ...context,
      policy,
    });
  } else {
    recordCapabilityClaim(check, 'policy:path-prefix', { ...context, policy });
  }
}

// What the application answers at a path, asked of the deployment that serves the locale.
//
// Under a policy that puts each locale on an origin of its own the origin is the Host a request
// carries, which `fetch` may not set, so there the request goes through `node:http` and a redirect
// to another of the site's origins is followed to the deployment that answers there. The answer is
// a `Response` either way, so every check reads it one way.
async function answer(path, { locale = 'en-US', headers = {}, redirect } = {}) {
  if (!addresses.localeInOrigin) {
    return fetch(`${origin}${path}`, {
      headers,
      redirect,
      signal: AbortSignal.timeout(15_000),
    });
  }
  // The path is sent as written rather than parsed, because some checks send a malformed one on
  // purpose and parsing would read `//second` as a host.
  let host = new URL(addresses.origin(locale)).host;
  let requestPath = path;
  for (let hops = 0; hops < 5; hops += 1) {
    const response = await new Promise((resolveAnswer, rejectAnswer) => {
      const outgoing = httpRequest(
        `${origin}${requestPath}`,
        { headers: { ...headers, host } },
        (incoming) => {
          const chunks = [];
          incoming.on('data', (chunk) => chunks.push(chunk));
          incoming.on('error', rejectAnswer);
          incoming.on('end', () => {
            const answered = new Headers();
            for (
              let index = 0;
              index < incoming.rawHeaders.length;
              index += 2
            ) {
              answered.append(
                incoming.rawHeaders[index],
                incoming.rawHeaders[index + 1],
              );
            }
            const status = incoming.statusCode ?? 502;
            resolveAnswer(
              new Response(
                [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
                { status, headers: answered },
              ),
            );
          });
        },
      );
      outgoing.setTimeout(15_000, () =>
        outgoing.destroy(
          new Error(`${requestPath} at ${host} did not answer within 15s`),
        ),
      );
      outgoing.on('error', rejectAnswer);
      outgoing.end();
    });
    const location = response.headers.get('location');
    if (
      redirect === 'manual' ||
      location === null ||
      response.status < 300 ||
      response.status >= 400
    ) {
      return response;
    }
    const target = new URL(location, `http://${host}/`);
    assert.ok(
      builtLocales.some((each) => addresses.origin(each) === target.origin),
      `${path} redirected to ${target.href}, which no deployment of this site answers at`,
    );
    host = target.host;
    requestPath = `${target.pathname}${target.search}`;
  }
  assert.fail(`${path} redirected more than four times`);
}

/**
 * The server seat given the options this deployment's server builds, its renderer included, which
 * is the seat `docs/how-to/test-localized-output.md` describes. Each address is asked of the seat
 * and of the deployment, and the two must answer alike: the status, the fields a cache and a
 * crawler read, and the head, which is read off the deployment's document here without the seat's
 * own reader, so the seat's reading is held to something it did not produce.
 *
 * The seat is imported from the consumer's installed `@neolorn/equator/testing` after
 * `@angular/compiler`, as a test runner loads a partially compiled library in Node.
 */
async function verifySeatAgainstDeployments() {
  const requireFromConsumer = createRequire(
    resolve(consumerRoot, 'package.json'),
  );
  const load = (specifier) =>
    import(pathToFileURL(requireFromConsumer.resolve(specifier)).href);
  await load('@angular/compiler');
  const { createLocalizedServerSeat } = await load('@neolorn/equator/testing');
  for (const deployment of deployments) {
    const options = deployment.localeRequestOptions;
    assert.ok(
      options !== undefined && typeof options.render === 'function',
      `${consumerName}: the server bundle for ${deployment.origin} exports no localeRequestOptions to build a seat from`,
    );
    // Asked on a host the deployment's server accepts: loopback where one origin serves every
    // locale, and the locale's own origin where each has one.
    const seat = createLocalizedServerSeat({
      ...options,
      origin: addresses.localeInOrigin ? deployment.origin : 'http://localhost',
    });
    const [firstLocale] = deployment.locales;
    const asked = [
      ...deployment.locales.map((locale) => ['second', locale]),
      ['missing', firstLocale],
      ['removed', firstLocale],
      ['legacy', firstLocale],
    ].filter(([name, locale]) => addresses.has(name, locale));
    for (const [name, locale] of asked) {
      const path = addresses.path(name, locale);
      const check = `${consumerName}: the server seat, ${name} in ${locale}`;
      const seated = await seat.request(path);
      const served = await answer(path, { locale, redirect: 'manual' });
      assert.equal(
        seated.status,
        served.status,
        `${check}: the seat answered ${seated.status} where the deployment answered ${served.status}`,
      );
      for (const field of [
        'content-language',
        'cache-control',
        'vary',
        'x-robots-tag',
        'location',
      ]) {
        assert.equal(
          seated.headers.get(field),
          served.headers.get(field),
          `${check}: the seat's ${field} is not the deployment's`,
        );
      }
      const servedBody = await served.text();
      if (served.status >= 300 && served.status < 400) continue;
      const servedDocument = new JSDOM(servedBody).window.document;
      assert.deepEqual(
        {
          lang: seated.head.lang,
          title: seated.head.title,
          canonical: seated.head.canonical,
          robots: seated.head.robots,
        },
        {
          lang: servedDocument.documentElement.lang,
          title: servedDocument.title,
          canonical:
            servedDocument
              .querySelector('link[rel="canonical"]')
              ?.getAttribute('href') ?? undefined,
          robots:
            servedDocument
              .querySelector('meta[name="robots"]')
              ?.getAttribute('content') ?? undefined,
        },
        `${check}: the head answeredHead read off the seat's answer is not the deployment's`,
      );
      recordCapabilityClaim(check, 'testing:createLocalizedServerSeat', {
        policy: options.policy,
        document: seated.body,
      });
      recordCapabilityClaim(check, 'testing:answeredHead', {
        policy: options.policy,
        document: seated.body,
      });
      recordCapabilityClaim(check, 'entry:@neolorn/equator/testing', {
        policy: options.policy,
        document: seated.body,
      });
    }
  }
}

// A reader who chose a locale the page has no address in reaches the one address it has and states
// the choice, which is the only way that locale is served there.
function requestFor(page, locale) {
  return addresses.has(page, locale)
    ? { path: addresses.path(page, locale), headers: {} }
    : {
        path: addresses.shownPath(page, locale),
        headers: { cookie: `equator-locale=${locale}` },
      };
}

// The same for a browser, where the choice is the cookie it sends. Where no address names a locale
// a choice an earlier stage made would answer instead of the address, so the cookie says exactly
// what this visit states. It stays that way after the visit: the page reads the stores again once
// it has hydrated (specs/03-locale-identity-and-resolution.spec.md section 8), so a cookie put back
// under it is a choice made elsewhere, and the page follows it. Every visit sets its own.
async function visitFor(browserContext, page, locale, visit) {
  const { path, headers } = requestFor(page, locale);
  if (addresses.localeInAddress) return visit(siteUrl(path, locale));
  await browserContext.clearCookies({ name: 'equator-locale' });
  if (headers.cookie !== undefined) {
    await browserContext.addCookies([
      { name: 'equator-locale', value: locale, url: browserOrigin },
    ]);
  }
  return visit(siteUrl(path, locale));
}

async function render(label, locale = 'en-US', page = 'home') {
  const { path, headers } = requestFor(page, locale);
  const response = await answer(`${path}?label=${encodeURIComponent(label)}`, {
    headers,
    locale,
  });
  assert.equal(response.status, 200, `SSR failed for ${label}`);
  assert.equal(response.headers.get('content-language'), locale);
  return response.text();
}

function readSnapshot(html) {
  const document = new JSDOM(html).window.document;
  const probe = document.querySelector('[data-ssr-probe]');
  assert.notEqual(probe, null, 'SSR probe element is absent');
  const transferScript = document.querySelector('script#ng-state');
  assert.notEqual(transferScript, null, 'Angular TransferState is absent');
  const transferState = JSON.parse(transferScript.textContent ?? '{}');
  const localizationState =
    transferState['@neolorn/equator:localization-state/1'];
  assert.equal(
    localizationState?.profile,
    'equator-transfer-state/1',
    'Equator TransferState is absent',
  );
  const dynamicTransfer = transferState['@feature-lab:dynamic-content/1'];
  assert.equal(
    dynamicTransfer?.profile,
    'feature-article-transfer/1',
    'Consumer-owned dynamic-content TransferState is absent',
  );

  const attribute = (name) => {
    const value = probe.getAttribute(name);
    assert.notEqual(value, null, `SSR probe attribute ${name} is absent`);
    return value;
  };

  return {
    document,
    requestId: attribute('data-request-id'),
    label: attribute('data-label'),
    source: attribute('data-source'),
    locale: attribute('data-snapshot-locale'),
    transfer: localizationState,
    dynamicTransfer,
  };
}

const browserRows = Object.freeze([
  Object.freeze({ id: 'chromium', label: 'Chromium', browserType: chromium }),
  Object.freeze({ id: 'firefox', label: 'Firefox', browserType: firefox }),
  Object.freeze({ id: 'webkit', label: 'WebKit', browserType: webkit }),
]);
const assuranceStyle =
  'html,body{min-inline-size:200vw;min-block-size:200vh;margin:0}';
const assuranceNonce = 'browser-assurance';

function inlineHashSources(html, tagName) {
  const pattern =
    tagName === 'script'
      ? /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/giu
      : /<style\b[^>]*>([\s\S]*?)<\/style>/giu;
  return [
    ...new Set(
      [...html.matchAll(pattern)].map(
        (match) =>
          `'sha256-${createHash('sha256')
            .update(match[1] ?? '', 'utf8')
            .digest('base64')}'`,
      ),
    ),
  ];
}

function applyStrictBrowserPolicy(html, url) {
  const documentWithNonce = html.replace(
    /<app-root\b/iu,
    `<app-root ngCspNonce="${assuranceNonce}"`,
  );
  assert.notEqual(
    documentWithNonce,
    html,
    `Browser assurance could not attach the Angular CSP nonce to ${url}: ${html.slice(0, 200)}`,
  );
  const documentWithAssuranceStyle = documentWithNonce.replace(
    /<\/head>/iu,
    `<style data-equator-browser-assurance>${assuranceStyle}</style></head>`,
  );
  assert.notEqual(
    documentWithAssuranceStyle,
    documentWithNonce,
    'Browser assurance could not inject its hashed layout style',
  );
  assert.equal(
    /<[^>]+\son[a-z]+\s*=/iu.test(documentWithAssuranceStyle),
    false,
    'The consumer HTML contains an inline event handler that strict CSP rejects',
  );

  // The policy the consumer is served under, and `specs/09-safe-content-and-ux.spec.md` section 6
  // is what serving it proves: nothing Equator ships needs an inline script, an unsafe evaluation,
  // a sanitizer bypass, or a permissive Trusted Types policy. Script comes from the application's
  // own origin and the hashes of what this document actually contains, attribute-position script
  // and plugin content are denied outright, and Trusted Types are required for script, so a
  // consumer already running under a strict policy pays nothing to add Equator to it.
  const scriptHashes = inlineHashSources(documentWithAssuranceStyle, 'script');
  const styleHashes = inlineHashSources(documentWithAssuranceStyle, 'style');
  const policy = [
    "default-src 'none'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${assuranceNonce}' ${styleHashes.join(' ')}`.trim(),
    "style-src-attr 'none'",
    "require-trusted-types-for 'script'",
    'trusted-types angular angular#bundler',
  ].join('; ');

  return { body: documentWithAssuranceStyle, policy };
}

async function recordPolicyViolations(context) {
  await context.addInitScript(() => {
    globalThis.__equatorCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.__equatorCspViolations.push({
        blockedUri: event.blockedURI,
        columnNumber: event.columnNumber,
        directive: event.effectiveDirective,
        disposition: event.disposition,
        lineNumber: event.lineNumber,
        sourceFile: event.sourceFile,
      });
    });
  });
}

function createBrowserDiagnostics(row) {
  return {
    cspViolations: [],
    consoleErrors: [],
    documentsWithoutPolicy: [],
    engine: row.id,
    pageErrors: [],
    requestFailures: [],
  };
}

const criticalBrowserResourceTypes = new Set([
  'document',
  'font',
  'image',
  'script',
  'stylesheet',
]);

/**
 * Documents a check asserts an error status for. A browser reports every such response on the
 * console, and for these the report is the status the check asserts rather than a fault, so only
 * that report, at exactly that address, is not counted.
 */
const expectedErrorDocuments = new Set();

/**
 * The icon a browser fetches on its own for a document that names none, which the HTML standard's
 * `icon` link type allows. The consumer names none and serves none, so the full Chromium build the
 * back-forward restore runs in reports a 404 the page never caused.
 */
function isFallbackIcon(url) {
  return isSiteUrl(url) && new URL(url).pathname === '/favicon.ico';
}

function attachBrowserDiagnostics(page, diagnostics) {
  page.on('console', (message) => {
    noteActivity(`console ${message.type()}`);
    if (message.type() !== 'error') return;
    if (
      (expectedErrorDocuments.has(message.location().url) ||
        isFallbackIcon(message.location().url)) &&
      message.text().startsWith('Failed to load resource:')
    )
      return;
    diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    noteActivity('pageerror');
    diagnostics.pageErrors.push(error.message);
  });
  page.on('framenavigated', (frame) =>
    noteActivity(`navigated ${frame.url()}`),
  );
  page.on('load', () => noteActivity('load'));
  page.on('domcontentloaded', () => noteActivity('domcontentloaded'));
  if (traceRequests) {
    page.on('request', (request) => {
      rowActivity.inFlight.set(request.url(), Date.now());
      noteActivity(`request ${request.resourceType()}`);
    });
    page.on('requestfinished', (request) => {
      rowActivity.inFlight.delete(request.url());
      noteActivity('requestfinished');
    });
  }
  page.on('requestfailed', (request) => {
    rowActivity.inFlight.delete(request.url());
    noteActivity('requestfailed');
    if (
      isSiteUrl(request.url()) &&
      criticalBrowserResourceTypes.has(request.resourceType())
    ) {
      diagnostics.requestFailures.push(
        `${request.url()}: ${request.failure()?.errorText ?? 'unknown failure'}`,
      );
    }
  });
  // The policy is proven only on a document it was sent with, so landing on one without it is a
  // finding rather than a page that passed.
  page.on('response', (response) => {
    const request = response.request();
    if (
      request.resourceType() !== 'document' ||
      request.frame() !== page.mainFrame() ||
      (response.status() >= 300 && response.status() < 400)
    ) {
      return;
    }
    if (response.headers()['content-security-policy'] === undefined) {
      diagnostics.documentsWithoutPolicy.push(
        `${response.status()} ${response.url()}`,
      );
    }
  });
}

async function collectPolicyDiagnostics(page, diagnostics) {
  if (page.isClosed()) return;
  const violations = await page.evaluate(
    () => globalThis.__equatorCspViolations ?? [],
  );
  diagnostics.cspViolations.push(...violations);
}

function assertBrowserDiagnostics(diagnostics, label) {
  assert.deepEqual(
    diagnostics.consoleErrors,
    [],
    `${label} console errors were reported`,
  );
  assert.deepEqual(
    diagnostics.pageErrors,
    [],
    `${label} page errors were reported`,
  );
  assert.deepEqual(
    diagnostics.requestFailures,
    [],
    `${label} document or script requests failed`,
  );
  assert.deepEqual(
    diagnostics.cspViolations,
    [],
    `${label} strict Content Security Policy was violated`,
  );
  assert.deepEqual(
    diagnostics.documentsWithoutPolicy,
    [],
    `${label} landed on documents served without the strict Content Security Policy`,
  );
  assert.deepEqual(
    edgeFailures,
    [],
    'The server in front of the application failed to serve',
  );
}

async function launchBrowserRow(row, options = {}) {
  try {
    return boundCalls(
      await row.browserType.launch({
        ...options,
        headless: true,
        // The origins a host policy names resolve to nowhere this harness listens, so every request
        // goes to the edge, which reads the origin from it. Measured on all three engines, the
        // redirects to another origin included.
        ...(addresses.localeInOrigin
          ? { proxy: { server: browserOrigin } }
          : {}),
      }),
      'browser',
    );
  } catch (error) {
    throw new Error(
      `${row.label} could not start for Equator browser assurance. ` +
        `Install the pinned engines with "pnpm exec playwright install chromium firefox webkit" and retry. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * End the processes of a browser whose own close did not settle.
 *
 * Playwright gives a launched `Browser` no call that ends its process; only a `BrowserServer` has
 * `kill`. So they are found as the processes under this one, which starts no other: its servers
 * listen in this process, and the only other browser a row launches lives inside the one stage
 * that launches it. Read again afterwards, because a process that was signalled is not yet one
 * that has ended, and the launch that follows should not share the machine with it.
 */
async function endBrowserProcesses() {
  const under = async () => {
    const { processes, reader } = await readProcesses();
    return descendantsOf(processes, process.pid, new Set([reader]));
  };
  for (const { pid } of await under()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      // Gone between the reading and the signal, which is the outcome wanted.
      if (error.code !== 'ESRCH') throw error;
    }
  }
  const deadline = Date.now() + callTimeoutMs;
  let left = await under();
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    left = await under();
  }
  assert.deepEqual(
    left.map(({ pid }) => pid),
    [],
    `The browser's processes were signalled to end and are still running after ${callTimeoutMs}ms`,
  );
}

async function assertTrustedTypesPolicy(page, response, row) {
  assert.notEqual(response, null, `${row.label} navigation has no response`);
  assert.match(
    response.headers()['content-security-policy'] ?? '',
    /require-trusted-types-for 'script'/u,
    `${row.label} did not receive Trusted Types enforcement`,
  );
  const supported = await page.evaluate(
    () => typeof globalThis.trustedTypes === 'object',
  );
  if (row.id === 'chromium') {
    assert.equal(supported, true, 'Chromium unexpectedly lacks Trusted Types');
  }
  return supported;
}

// Read once: evaluating it is what puts `axe` on a page, and a script tag would be refused by the
// page's own hash-only script policy.
const axeSource = createRequire(import.meta.url)('axe-core').source;
// WCAG 2.2 level A and AA as axe-core tags its rules: each edition's rules carry that edition's
// tags, and axe-core has no `wcag22a` tag because it has no rule for a 2.2 level A criterion.
const WCAG_22_AA = Object.freeze([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
]);
// The elements Equator renders, where every rule applies. A directive's host is the application's
// element, and its role, size and place on the page are the application's choice, which
// specification 09 section 9 leaves to the application.
const EQUATOR_RENDERED = Object.freeze([
  'body > div[data-equator-announcer]',
  'localized-message',
  'localization-recovery',
]);
// The values Equator writes onto elements it does not render: the lang attributes on the root and
// on each message, and the ARIA states and labels its directives put on their hosts. These rules
// read a value, or whether the host's role allows the attribute at all, without judging the host
// itself, so they run over the whole document.
const WRITTEN_VALUE_RULES = Object.freeze([
  'aria-prohibited-attr',
  'aria-valid-attr',
  'aria-valid-attr-value',
  'html-has-lang',
  'html-lang-valid',
  'html-xml-lang-mismatch',
  'valid-lang',
]);

async function auditAccessibility(page, row, where) {
  if (!(await page.evaluate(() => 'axe' in globalThis))) {
    await page.evaluate(axeSource);
  }
  const include = [];
  for (const selector of EQUATOR_RENDERED) {
    if ((await page.locator(selector).count()) > 0) include.push(selector);
  }
  assert.ok(
    include.length > 0,
    `${row.id} ${where}: nothing Equator renders is on the page`,
  );
  const violations = await page.evaluate(
    async ({ include, tags, rules }) => {
      const found = [
        ...(
          await globalThis.axe.run(
            { include },
            { runOnly: { type: 'tag', values: tags } },
          )
        ).violations,
        ...(
          await globalThis.axe.run(document, {
            runOnly: { type: 'rule', values: rules },
          })
        ).violations,
      ];
      // An element Equator renders is in both runs, so a value rule can report it twice.
      return [
        ...new Set(
          found.map(
            (violation) =>
              `${violation.id} (${violation.help}) at ${violation.nodes
                .map((node) => node.target.join(' '))
                .join(', ')}`,
          ),
        ),
      ];
    },
    { include, tags: WCAG_22_AA, rules: WRITTEN_VALUE_RULES },
  );
  assert.deepEqual(
    violations,
    [],
    `${row.id} ${where}: what Equator renders or writes violates WCAG 2.2 AA: ${violations.join('; ')}`,
  );
}

async function assertDirectAccessibility(page, row) {
  assert.equal(await page.getByRole('main').count(), 1);
  assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
  // Equator builds this region itself. Nothing in the consumer's templates renders it, which is the
  // property under test: an application that forgets to place an announcer still has one.
  const announcer = page.locator(
    'body > div[data-equator-announcer][role="status"]',
  );
  assert.equal(await announcer.count(), 1);
  assert.equal(await announcer.getAttribute('aria-live'), 'polite');
  assert.equal(await announcer.getAttribute('aria-atomic'), 'true');
  assert.equal(
    await announcer.evaluate((element) => getComputedStyle(element).position),
    'fixed',
    'The announcement region is not visually hidden, so a strict style policy suppressed it',
  );
  assert.equal(
    await page.locator('[data-percent-input]').evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) return 0;
      return element.labels?.length ?? 0;
    }),
    1,
    'The localized input has no programmatic label',
  );
  assert.deepEqual(
    await page
      .locator('button:visible, a[href]:visible')
      .evaluateAll((elements) =>
        elements
          .filter(
            (element) =>
              (element.getAttribute('aria-label') ?? '').trim() === '' &&
              (element.textContent ?? '').trim() === '',
          )
          .map((element) => element.outerHTML),
      ),
    [],
    'Visible buttons and links must have accessible names',
  );
  assert.equal(
    await localeChoice(page, 'en-US').getAttribute('aria-current'),
    'true',
  );
  assert.equal(
    await localeChoice(page, 'ar-EG').getAttribute('aria-current'),
    null,
    'The option that is not current must carry no aria-current at all',
  );
  assert.equal(
    await page.locator('localized-message[data-rich-link] a').count(),
    1,
  );
  const action = page.locator('localized-message[data-rich-action] button');
  assert.equal(await action.count(), 1);
  const actionCount = Number(
    (await page.locator('[data-action-count]').textContent())?.trim(),
  );
  await action.focus();
  await action.press('Enter');
  await page.waitForFunction(
    (expected) =>
      Number(
        document.querySelector('[data-action-count]')?.textContent?.trim(),
      ) === expected,
    actionCount + 1,
  );
  const check = sectionCheck(row, 'accessibility');
  const context = await measuredContext(page);
  recordCapabilityClaim(check, 'directive:LocaleChoice', context);
  recordCapabilityClaim(check, 'directive:LocalizedMessage', context);
  await assertKeyboardLocaleAccessibility(page, check);
}

async function assertKeyboardLocaleAccessibility(page, check) {
  if (!addresses.switchInDocument) {
    await assertKeyboardLocaleNavigation(page);
    return;
  }
  const announcer = page.locator('div[data-equator-announcer][role="status"]');
  // Two events, one ordered stream, both timed.
  //
  // The assertion below is about the order of two things: the document committing to a locale, and
  // the announcer publishing a sentence about it. Reporting only the two values compared says the
  // order was wrong and nothing about what the order was, how far apart the events were, or whether
  // the commit happened at all. Both events are observable from this page, so both are recorded
  // here, with `performance.now()` on each, and the failure prints the sequence.
  //
  // `lang` on the document element is watched rather than polled, so the record is of the mutation
  // itself rather than of a sample that happened to catch it.
  await page.evaluate(() => {
    globalThis.__equatorAnnouncementObserver?.disconnect();
    globalThis.__equatorDocumentLocaleObserver?.disconnect();
    globalThis.__equatorAnnouncementObservations = [];
    const target = document.querySelector('[data-equator-announcer]');
    if (target === null) throw new Error('Locale announcer is absent');
    const record = (extra) => {
      globalThis.__equatorAnnouncementObservations.push({
        at: Math.round(performance.now() * 100) / 100,
        busyArabic: document
          .querySelector('[data-locale-choice="ar-EG"]')
          ?.getAttribute('aria-busy'),
        busyEnglish: document
          .querySelector('[data-locale-choice="en-US"]')
          ?.getAttribute('aria-busy'),
        locale: document.documentElement.lang,
        currentArabic: document
          .querySelector('[data-locale-choice="ar-EG"]')
          ?.getAttribute('aria-current'),
        currentEnglish: document
          .querySelector('[data-locale-choice="en-US"]')
          ?.getAttribute('aria-current'),
        text: target.textContent?.trim() ?? '',
        ...extra,
      });
    };
    const observer = new MutationObserver(() =>
      record({ kind: 'announcement' }),
    );
    observer.observe(target, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    globalThis.__equatorAnnouncementObserver = observer;
    const documentObserver = new MutationObserver(() =>
      record({ kind: 'document-locale' }),
    );
    documentObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang', 'dir'],
    });
    globalThis.__equatorDocumentLocaleObserver = documentObserver;
  });

  /**
   * Wait for an element to hold focus, and say what holds it instead when it never does.
   *
   * Deliberately unlike the selection assertions in this file, which read once and do not retry. A
   * selection restored to a specific wrong offset was computed wrongly, and waiting for a second
   * component to overwrite it would certify the disagreement.
   *
   * Focus is waited for too, because Equator's interaction restore runs between `.focus()` and the
   * read and can take focus back from the control the visitor just moved to. A failed wait names
   * the element holding focus, which is the diagnosis; an immediate read says only `false`.
   *
   * So the reason to keep it is not that focus converges. It is that a failure here has to say what
   * holds focus instead, and a bounded wait is what makes room to ask. The bound is short because
   * nothing here is loading.
   */
  const waitForFocus = async (handle, description) => {
    try {
      await page.waitForFunction(
        (element) => document.activeElement === element,
        handle,
        { timeout: 5_000 },
      );
    } catch {
      const holder = await page.evaluate(() => {
        const element = document.activeElement;
        if (element === null) return null;
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id === '' ? undefined : element.id,
          attributes: Object.fromEntries(
            [...element.attributes]
              .filter((attribute) => attribute.name.startsWith('data-'))
              .map((attribute) => [attribute.name, attribute.value]),
          ),
          text: (element.textContent ?? '').trim().slice(0, 80),
          isBody: element === document.body,
        };
      });
      assert.fail(
        `${description}. After five seconds focus is held by ${JSON.stringify(
          holder,
        )}, and focus on the document body means the element never took it rather than that another element stole it.`,
      );
    }
  };

  const switchWithKeyboard = async ({ expectedLocale, selector }) => {
    const control = page.locator(selector);
    const controlHandle = await control.elementHandle();
    assert.notEqual(controlHandle, null, `${selector} control is absent`);
    const previousAnnouncement = (await announcer.textContent())?.trim() ?? '';
    await page.evaluate(() => {
      globalThis.__equatorAnnouncementObservations = [];
    });
    await control.focus();
    await waitForFocus(
      controlHandle,
      `${selector} could not receive keyboard focus`,
    );
    await control.press('Enter');
    await page.waitForFunction(
      (locale) => document.documentElement.lang === locale,
      expectedLocale,
    );
    const expectedPath = addresses.shownPath('home', expectedLocale);
    await page.waitForURL((url) => url.pathname === expectedPath);
    await page.waitForFunction((previous) => {
      const text =
        document
          .querySelector('[data-equator-announcer]')
          ?.textContent?.trim() ?? '';
      return text.length > 0 && text !== previous;
    }, previousAnnouncement);
    // Read once, on purpose, and not through `waitForFocus`. By this line the commit is
    // observably finished: the document locale changed, the URL changed, and the announcer spoke.
    // Restoring focus across that commit is Equator's own work, so if focus is not back by the time
    // the commit is visible, it is late, and a wait here would hide exactly the defect the
    // assertion exists to catch.
    assert.equal(
      await controlHandle.evaluate(
        (element) => document.activeElement === element,
      ),
      true,
      `${selector} lost focus during the locale commit`,
    );

    // The whole stream, kept for the failure message: the filtered announcements are what the
    // assertions are about, and the unfiltered sequence is what makes a failure readable.
    const observed = await page.evaluate(
      () => globalThis.__equatorAnnouncementObservations ?? [],
    );
    const sequence = JSON.stringify(observed, null, 2);
    const committedAnnouncements = observed.filter(
      (observation) =>
        observation.kind === 'announcement' && observation.text.length > 0,
    );
    assert.ok(
      committedAnnouncements.length > 0,
      `${selector} did not publish a locale announcement. Observed:\n${sequence}`,
    );
    for (const observation of committedAnnouncements) {
      assert.equal(
        observation.locale,
        expectedLocale,
        `${selector} announced before the document locale committed. The sequence below is ordered by \`at\`, and a \`document-locale\` entry after an \`announcement\` one is the defect this assertion is named for:\n${sequence}`,
      );
      const arabic = expectedLocale === 'ar-EG';
      // `null`, not `"false"`: the option that is not current carries no `aria-current`, and
      // `undefined` here would mean the control itself was missing, which this must not pass.
      assert.equal(
        observation.currentArabic,
        arabic ? 'true' : null,
        `${selector} published an announcement with the wrong current state on the Arabic control:\n${sequence}`,
      );
      assert.equal(
        observation.currentEnglish,
        arabic ? null : 'true',
        `${selector} published an announcement with the wrong current state on the English control:\n${sequence}`,
      );
      assert.equal(
        observation.busyArabic,
        null,
        `${selector} published an announcement while the Arabic control was still busy:\n${sequence}`,
      );
      assert.equal(
        observation.busyEnglish,
        null,
        `${selector} published an announcement while the English control was still busy:\n${sequence}`,
      );
    }
    // The wording is the application's, and the application gives the page's title, which the
    // head holds in the arriving locale by the time the change is announced.
    const announced = committedAnnouncements.at(-1).text;
    assert.equal(
      announced,
      await readCatalogMessage(consumerRoot, expectedLocale, 'document.title'),
      `${selector} announced ${JSON.stringify(announced)}, not the page's ${expectedLocale} title that withLocaleAnnouncement gives as the wording:\n${sequence}`,
    );
    recordCapabilityClaim(
      check,
      'feature:withLocaleAnnouncement',
      await measuredContext(page),
    );
  };

  try {
    await switchWithKeyboard({
      expectedLocale: 'ar-EG',
      selector: '[data-locale-choice="ar-EG"]',
    });
    await switchWithKeyboard({
      expectedLocale: 'en-US',
      selector: '[data-locale-choice="en-US"]',
    });
  } finally {
    await page.evaluate(() => {
      globalThis.__equatorAnnouncementObserver?.disconnect();
      globalThis.__equatorDocumentLocaleObserver?.disconnect();
      delete globalThis.__equatorAnnouncementObserver;
      delete globalThis.__equatorDocumentLocaleObserver;
      delete globalThis.__equatorAnnouncementObservations;
    });
  }
}

/**
 * Where the visitor is on the page, plus everything the numbers came from.
 *
 * **Two horizontal offsets, both returned, because in RTL they are different numbers.** One is
 * `Math.abs(scrollX)`, the other `maximum - Math.abs(scrollX)`. They agree in LTR, where `before`
 * is read, and disagree in RTL, where `after` is read, so a check computing one and printing the
 * other decides on a scale its own failure message does not show. Numbers from two expressions
 * cannot be reconciled by anyone reading a failure. One expression produces both, and each is named
 * for the edge it is measured from.
 *
 * In an RTL document `scrollX` is `0` at the inline-start and runs negative to `-maximum` at the
 * inline-end. Measured on a synthetic page with 1720px of real horizontal range, identically on
 * Chromium 149, Firefox 151 and WebKit: `scrollTo(0)` reads `0`, `scrollTo(-500)` reads `-500`,
 * `scrollTo(-99999)` clamps to `-1720`, `scrollTo(+500)` clamps to `0`. So `fromInlineStart` is
 * `Math.abs(scrollX)`, and `fromLeftEdge`, the document x of the viewport's left edge, is
 * `maximum - Math.abs(scrollX)`. In LTR both are `scrollX` and the distinction does not arise.
 *
 * **Which of the two Equator ought to preserve across a direction change is an open product
 * question and this file does not settle it.** The assertion below reads `fromLeftEdge`, because
 * that is the quantity `LocalizationInteractionRestore` computes and restores (`angular.ts:974`),
 * so the check is falsifiable against a commit that lands anywhere else without asserting that the
 * convention is the right one. Both numbers are printed on every failure, which is what makes the
 * question visible instead of buried in a formula.
 *
 * The raw inputs are returned alongside because a failure reporting only the derived number sends
 * an investigator nowhere, which is how this stood red for a while with the cause unattributed.
 *
 * The source is a string so that the settle assertion, which runs as a page predicate and cannot
 * call into this module, evaluates the same expression rather than a second copy of it.
 */
const SCROLL_STATE_SOURCE = `() => {
  const maximum = Math.max(
    0,
    document.documentElement.scrollWidth - globalThis.innerWidth,
  );
  const rtl = document.documentElement.dir === 'rtl';
  return {
    block: globalThis.scrollY,
    fromInlineStart: rtl ? Math.abs(globalThis.scrollX) : globalThis.scrollX,
    fromLeftEdge: rtl
      ? maximum - Math.abs(globalThis.scrollX)
      : globalThis.scrollX,
    maximum,
    raw: {
      dir: document.documentElement.dir,
      scrollX: globalThis.scrollX,
      scrollY: globalThis.scrollY,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: globalThis.innerWidth,
    },
  };
}`;

// The element under the viewport's inline-start edge (the left edge in LTR, the right edge in
// RTL) marked on the way in and matched on the way out.
//
// Probed two pixels in rather than at the boundary, because `elementFromPoint` at exactly
// `innerWidth` is outside the viewport and answers `null`. The block coordinate is a third of the
// way down, far enough from a sticky header to be page content rather than chrome.
//
// `mark` refuses to report success on the document element or the body: those are under every point
// on every page, so a check that accepted them would pass whatever the restore did.
// **Installed into the page rather than passed as source, and this is not a matter of taste.** The
// consumer serves `script-src 'self'` with hashes and no `unsafe-eval`, deliberately, and Playwright
// polls a *string* predicate by calling `eval` inside the page. It evaluates the string once through
// the debugger protocol first, which no page CSP governs, so a string predicate succeeds whenever
// the page is already settled at the first look and rejects with `EvalError` about a hundred
// milliseconds in whenever it genuinely has to wait. A wait that only works when nothing needs
// waiting for. Probed on all three engines with a CSP-carrying fixture: string predicate resolves
// when already true, CSP-rejected when it must poll, on Chromium 149, Firefox 151 and WebKit 26.5
// alike; function predicate resolves in both cases on all three.
//
// `mode` is a runtime argument now rather than something interpolated into source, so there is one
// definition of this and the wait calls the same one the marks and reads call.
const INLINE_START_WITNESS_SOURCE = `globalThis.__equatorInlineStartWitness = (mode) => {
  const rtl = document.documentElement.dir === 'rtl';
  const x = rtl ? globalThis.innerWidth - 2 : 2;
  const y = Math.round(globalThis.innerHeight / 3);
  const held = document.elementFromPoint(x, y);
  const identifiable =
    held !== null &&
    held !== document.documentElement &&
    held !== document.body;
  const describe = (element) =>
    element === null
      ? null
      : element.tagName.toLowerCase() +
        (element.id === '' ? '' : '#' + element.id) +
        (element.classList.length === 0
          ? ''
          : '.' + Array.from(element.classList).join('.'));
  if (mode === 'mark' && identifiable) {
    document
      .querySelectorAll('[data-equator-inline-start-witness]')
      .forEach((previous) =>
        previous.removeAttribute('data-equator-inline-start-witness'),
      );
    held.setAttribute('data-equator-inline-start-witness', '');
  }
  return {
    marked: identifiable,
    cell: held === null ? null : held.closest('[data-inline-cell]')?.dataset.inlineCell ?? null,
    holds:
      held !== null &&
      held.closest('[data-equator-inline-start-witness]') !== null,
    at: { x, y },
    dir: document.documentElement.dir,
    found: describe(held),
    expected: describe(
      document.querySelector('[data-equator-inline-start-witness]'),
    ),
  };
};`;

/**
 * Where an element sits against the viewport, in the one shape both readings print.
 *
 * The actor this is aimed at is the one nothing here has watched: an element scrolled into view
 * because it was not in view. Playwright performs that itself before an action, from outside the
 * page and with no call any wrapper can see, and the two rows below click through
 * `locator.evaluate`, which performs no such check, so for *these* clicks the candidate is the
 * engine rather than the driver. Either way the question is the same and neither instrument could
 * answer it: was the control on screen when the page was placed, and was it still on screen when it
 * was clicked. A rect recorded at both moments answers it, and an `inView` that goes false between
 * them names a scroll nobody had a record of.
 *
 * Rounded, and no layout forced beyond the one `getBoundingClientRect`, because an instrument
 * whose cost changes the outcome is not an instrument. It runs twice a row.
 */
const RECT_AGAINST_VIEWPORT_SOURCE = `globalThis.__equatorRectAgainstViewport = (element, selector) => {
  const rect = element.getBoundingClientRect();
  const width = globalThis.innerWidth;
  const height = globalThis.innerHeight;
  return {
    selector,
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    bottom: Math.round(rect.bottom),
    right: Math.round(rect.right),
    viewport: { width, height },
    scroll: { x: Math.round(globalThis.scrollX), y: Math.round(globalThis.scrollY) },
    inView:
      rect.top >= 0 && rect.left >= 0 && rect.bottom <= height && rect.right <= width,
  };
};`;

/**
 * A locale control clicked from inside the page, with its position recorded if anything is
 * recording.
 *
 * The click is a script call rather than `locator.click()`, deliberately: a driver click carries
 * actionability checks that move the page, and this row is measuring the page's position. The rect
 * is written where the recorder's own readings are, on the recorder's clock, so the click sits on
 * the same timeline as every scroll, frame and mutation beside it. A row with no recorder installed
 * writes nothing and clicks the same way.
 */
// Where each locale is an origin of its own, an option is a link to that origin, and the keyboard
// reaches and follows it as it does any link. The announcement belongs to a switch made in the
// document, which this policy has none of, so what is asserted is that the link is reachable and
// lands where it says.
async function assertKeyboardLocaleNavigation(page) {
  const control = page.locator('[data-locale-choice="ar-EG"]');
  const controlHandle = await control.elementHandle();
  assert.notEqual(controlHandle, null, 'The Arabic option is absent');
  const from = page.url();
  await control.focus();
  await page
    .waitForFunction(
      (element) => document.activeElement === element,
      controlHandle,
      {
        timeout: 5_000,
      },
    )
    .catch(() =>
      assert.fail(
        '[data-locale-choice="ar-EG"] could not receive keyboard focus',
      ),
    );
  await control.press('Enter');
  await page.waitForURL((url) => isShown(url, 'home', 'ar-EG'));
  await page.waitForFunction(() => document.documentElement.lang === 'ar-EG');
  await page.goto(from);
  await page.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );
}

async function clickLocaleChoice(page, locale) {
  const selector = '[data-locale-choice="' + locale + '"]';
  await page.locator(selector).evaluate((element, name) => {
    if (!(element instanceof HTMLElement))
      throw new Error('Locale control is invalid');
    const record = globalThis.__equatorScrollRecord;
    if (
      record !== undefined &&
      globalThis.__equatorRectAgainstViewport !== undefined
    ) {
      // An array rather than a field: this row clicks twice with one recorder installed, and a
      // field would quietly keep the second and describe it as the click the placement pairs with.
      record.clicks ??= [];
      record.clicks.push({
        ...globalThis.__equatorRectAgainstViewport(element, name),
        at: Math.round(performance.now() - record.start),
      });
    }
    element.click();
  }, selector);
}

// Both readings go through the installed function, so there is nothing to keep in step.
const inlineStartWitness = (page, mode) =>
  page.evaluate(
    (requested) => globalThis.__equatorInlineStartWitness(requested),
    mode,
  );

const RECORDER_SOURCE = `() => {
  const state = ${SCROLL_STATE_SOURCE};
  const start = performance.now();
  const record = { positions: [state()], frames: [], start };
  record.positions[0].at = 0;

  // Where the placement sits on this clock, which is a negative number: it happened before the
  // recorder was installed. Without it every reading below is measured from a zero whose relation
  // to the one deliberate scroll in this check is not stated anywhere.
  const placement = globalThis.__equatorScrollPlacement;
  record.placement =
    placement === undefined
      ? null
      : {
          at: Math.round(placement.pageClock - start),
          scrollRestoration: placement.scrollRestoration,
          readyState: placement.readyState,
          target: placement.target ?? null,
        };
  const onScroll = () => {
    record.reading = true;
    const now = state();
    record.reading = false;
    now.at = Math.round(performance.now() - start);
    record.positions.push(now);
  };
  globalThis.addEventListener('scroll', onScroll, { passive: true });

  // Who called, and from where. A scroll event says the page moved; it does not say what moved it,
  // and two hypotheses have now died for want of that. Recorded rather than argued.
  //
  // Empty and off are different readings, so this report distinguishes them. The wrappers are
  // behind a switch because installing them changed the failure rate, so in every unattended run
  // this array is empty because nothing was watching, not because nothing called.
  record.calls = [];
  // Which functions are actually wrapped, rather than whether any are.
  //
  // A boolean has two states for three situations. The three window entry points below are wrapped
  // on every run and the five element-level ones are not, so "the calls array is empty" means
  // something different depending on which call you are looking for, and a reader who cannot see
  // the difference will read a real absence as a switched-off instrument, or worse, the reverse.
  // The list says exactly what an empty array is evidence about.
  record.callsWatched = [];
  const note = (api, detail) => {
    record.calls.push({
      at: Math.round(performance.now() - start),
      api,
      detail,
      // The consumer bundle is minified, so this names functions rather than lines. That is enough
      // to separate Equator from Angular from the engine, which is the question.
      // fromCharCode rather than an escape: this source is produced by a template literal, so a
      // backslash-n here becomes a real newline inside a string literal in the emitted page code,
      // and the page fails to parse. Cost fourteen runs of nothing before it was noticed.
      stack: (new Error().stack ?? '')
        .split(String.fromCharCode(10))
        .slice(2, 8)
        .join(' | '),
    });
  };
  // A label rather than the property name, because five of the eight share three names with the
  // other three. A bare "scrollTo" in the calls array does not say whether the window or an element
  // was asked, and those are different events.
  //
  // No backticks in this comment, or in any comment in this source: it is produced by a template
  // literal, so one closes the literal and the file stops parsing. Second instance of the rule the
  // fromCharCode note below records.
  const wrap = (owner, label, name, describe) => {
    const original = owner[name];
    if (typeof original !== 'function') return;
    owner[name] = function (...args) {
      note(label, describe(args, this));
      return original.apply(this, args);
    };
    record.callsWatched.push(label);
  };
  const where = (element) =>
    element instanceof Element
      ? element.tagName.toLowerCase() +
        (element.id === '' ? '' : '#' + element.id) +
        (element.getAttribute('data-percent-input') === null ? '' : '[data-percent-input]')
      : String(element);
  // The three that stay on, and why they are not the three that cost anything.
  //
  // The set is switched as a whole because the measurement behind it covers the whole set, and
  // nothing in it separates these three. They are the window's own scroll entry points, and the things that call
  // them in this row are countable: Equator's
  // restore calls scrollTo once per commit, the hold re-applies it a handful of times inside a
  // 150ms window, Angular's scroll-position restoration calls it once per navigation, and this
  // file's own disturbance calls it once. A wrapper on a function called single-digit times per row
  // is not what moved a failure rate.
  //
  // The five behind the switch are the ones with a hot path. HTMLElement.prototype.focus is on
  // every focus a hydrating application performs, Element.prototype.scrollTo and scrollIntoView are
  // called from inside focus and from the router's scroller, and the two selection methods are on
  // the path of every input interaction. Whichever of the eight cost the row its runs, it is one of
  // those five, so they stay off, and the question the calls array exists to answer is answerable
  // on every unattended run instead of none.
  wrap(globalThis, 'window.scrollTo', 'scrollTo', (args) => args.map(String).join(','));
  wrap(globalThis, 'window.scrollBy', 'scrollBy', (args) => args.map(String).join(','));
  wrap(globalThis, 'window.scroll', 'scroll', (args) => args.map(String).join(','));
  if (${traceCalls}) {
    wrap(Element.prototype, 'Element.scrollIntoView', 'scrollIntoView', (args, self) => where(self));
    wrap(Element.prototype, 'Element.scrollTo', 'scrollTo', (args, self) => where(self) + ' ' + args.map(String).join(','));
    wrap(HTMLElement.prototype, 'HTMLElement.focus', 'focus', (args, self) => where(self) + ' ' + JSON.stringify(args[0] ?? null));
    wrap(HTMLInputElement.prototype, 'HTMLInputElement.setSelectionRange', 'setSelectionRange', (args, self) => where(self) + ' ' + args.map(String).join(','));
    wrap(HTMLInputElement.prototype, 'HTMLInputElement.select', 'select', (args, self) => where(self));
  }
  // What the engine did, which the wrappers above cannot see.
  //
  // Those wrappers are JavaScript call sites, and a Playwright click focuses natively: no call is
  // made, nothing fires, and the report says the calls that could have moved it were none. That is
  // true, and it was read four times as "nothing touched the page" when what it meant was "nothing
  // that this instrument can see touched the page".
  //
  // Kept deliberately cheap, because heaviness here has already changed the answer once: wrapping
  // every scroll-capable call and subscribing to every request moved this row from 6 in 40 to 9 in
  // 20, which is why those are behind a switch. This is four passive capture listeners on the
  // document that fire a handful of times a row, push one small object, prevent nothing and cancel
  // nothing.
  record.events = [];
  for (const type of ['focusin', 'focusout', 'pointerdown', 'pointerup']) {
    document.addEventListener(
      type,
      (event) => {
        if (record.stopped || record.events.length >= 200) return;
        record.events.push({
          at: Math.round(performance.now() - start),
          type,
          target: where(event.target),
        });
      },
      { capture: true, passive: true },
    );
  }
  // What left the document.
  //
  // Kept because it is what rules replacement out as the explanation. One account of a scroll
  // range collapsing with nothing scrolling it is that the content making the range left the
  // document, and childList over the whole tree is what shows that. It shows the range intact at
  // every sample and nothing leaving the document until eight milliseconds after the position was
  // already zero, so replacement is not the explanation and this observer is what says so.
  //
  // A MutationObserver delivers in a microtask and reads nothing out of layout, so it does not move
  // what it is watching.
  record.mutations = [];

  // And what changed about what stayed.
  //
  // The sixth occurrence closed the account the observer above was installed for. The range never
  // collapsed, maximum read 1980 at every sample, and nothing left or entered the document
  // until eight milliseconds *after* the position was already zero. So the scrolling content was
  // not replaced, and a reset that precedes every other record has two remaining candidates. This
  // is the first: a change to an element that stayed exactly where it was. A dir or lang write,
  // a stylesheet arriving, an overflow or display toggle, a class swap: none of them move a
  // node, none of them call anything, and all of them can zero a scroll position.
  //
  // The same observer sees them for one more option, which makes this the cheapest instrument still
  // available: no wrapping, no layout read, delivered in a microtask. Its own array and its own cap,
  // so a hydrating application's attribute churn cannot crowd out the childList records that
  // already report.
  record.attributes = [];
  const describeNode = (node) =>
    node instanceof Element
      ? where(node)
      : node.nodeName + '(' + String(node.textContent ?? '').slice(0, 24) + ')';
  const short = (value) =>
    value === null || value === undefined ? null : String(value).slice(0, 160);
  const observer = new MutationObserver((entries) => {
    if (record.stopped) return;
    for (const entry of entries) {
      if (entry.type === 'attributes') {
        if (record.attributes.length >= 200) continue;
        record.attributes.push({
          at: Math.round(performance.now() - start),
          target: where(entry.target),
          name: entry.attributeName,
          from: short(entry.oldValue),
          to: short(
            entry.target instanceof Element
              ? entry.target.getAttribute(entry.attributeName)
              : null,
          ),
        });
        continue;
      }
      if (record.mutations.length >= 200) continue;
      if (entry.removedNodes.length === 0 && entry.addedNodes.length === 0)
        continue;
      record.mutations.push({
        at: Math.round(performance.now() - start),
        target: where(entry.target),
        removed: [...entry.removedNodes].map(describeNode),
        added: [...entry.addedNodes].map(describeNode),
      });
    }
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
  });

  // What Equator captured, at the moment it captured it.
  //
  // Equator takes the position by reading scrollX and scrollY off the view, so the read is the
  // capture: wrapping the getter records the value Equator saw and when it saw it, with nothing
  // added to the runtime and nothing prevented. That is what separates the two accounts. A capture
  // before the reset means Equator held a good position and something else lost it. A capture after
  // means Equator restored a zero it had read faithfully, and the question becomes when in the
  // transaction the position is taken, which is what a switch moves.
  //
  // The recorder reads the same two properties on every scroll event, so it says so while it does,
  // and those reads are not recorded as somebody else's.
  record.reads = [];
  const carrier = (() => {
    for (
      let level = globalThis;
      level !== null;
      level = Object.getPrototypeOf(level)
    ) {
      if (Object.getOwnPropertyDescriptor(level, 'scrollX') !== undefined)
        return level;
    }
    return null;
  })();
  for (const axis of carrier === null ? [] : ['scrollX', 'scrollY']) {
    const original = Object.getOwnPropertyDescriptor(carrier, axis);
    if (original === undefined || original.get === undefined) continue;
    Object.defineProperty(globalThis, axis, {
      configurable: true,
      enumerable: original.enumerable,
      get() {
        const value = original.get.call(this);
        if (!record.stopped && !record.reading && record.reads.length < 200) {
          const frames = String(new Error().stack ?? '').split('\\n');
          record.reads.push({
            at: Math.round(performance.now() - start),
            axis,
            value,
            from: (frames[2] ?? frames[1] ?? '').trim().slice(0, 160),
          });
        }
        return value;
      },
    });
  }
  // And what the document did to itself, which is the other candidate.
  //
  // A document that is still loading, or one being restored from the back-forward cache, has its
  // scroll position set by the engine as part of the load. No script runs, no node moves, no
  // scroll-capable call is made, and nothing above would show it. The recorder goes in after
  // hydration has been waited for, so the expectation is that none of these fire, but that
  // expectation has never been read, and the reset it would explain precedes everything else.
  //
  // readyStateAtInstall is the half that makes an empty mean something. If the document was
  // already complete when the recorder went in, these events could not fire and their absence
  // says nothing; if it was not, the absence is a finding. Paid for in advance.
  record.lifecycle = { readyStateAtInstall: document.readyState, events: [] };
  for (const type of [
    'readystatechange',
    'DOMContentLoaded',
    'load',
    'pageshow',
  ]) {
    const target = type === 'load' || type === 'pageshow' ? globalThis : document;
    target.addEventListener(
      type,
      (event) => {
        if (record.stopped || record.lifecycle.events.length >= 50) return;
        record.lifecycle.events.push({
          at: Math.round(performance.now() - start),
          type,
          readyState: document.readyState,
          persisted: event.persisted ?? null,
        });
      },
      { capture: true, passive: true },
    );
  }

  const beat = () => {
    if (record.stopped) return;
    record.frames.push(Math.round(performance.now() - start));
    requestAnimationFrame(beat);
  };
  requestAnimationFrame(beat);
  record.stop = () => {
    record.stopped = true;
    observer.disconnect();
    globalThis.removeEventListener('scroll', onScroll);
  };
  globalThis.__equatorScrollRecord = record;
}`;

// Frame timestamps compress to the gaps between them, because a five-second run at 60fps is three
// hundred numbers that all say the same thing. What a reader needs is the longest interval in which
// no frame ran, and how many frames there were at all.
function frameGaps(frames) {
  if (frames.length === 0) return { frames: 0, longestGapMs: null };
  let longest = frames[0];
  for (let index = 1; index < frames.length; index += 1) {
    longest = Math.max(longest, frames[index] - frames[index - 1]);
  }
  return {
    frames: frames.length,
    firstAt: frames[0],
    lastAt: frames[frames.length - 1],
    longestGapMs: longest,
  };
}

// Everything the recorder holds, read once and stopped. Every failure in the continuity stage wants
// it, so it is not written into any single message.
async function describeRecord(page) {
  const record = await page.evaluate(
    `(() => {
      const held = globalThis.__equatorScrollRecord;
      if (held === undefined) return null;
      held.stop();
      return {
        positions: held.positions,
        frames: held.frames,
        calls: held.calls ?? [],
        callsWatched: held.callsWatched ?? [],
        events: held.events ?? [],
        mutations: held.mutations ?? [],
        reads: held.reads ?? [],
        attributes: held.attributes ?? [],
        lifecycle: held.lifecycle ?? null,
        placement: held.placement ?? null,
        clicks: held.clicks ?? [],
      };
    })()`,
  );
  return record === null
    ? 'no recorder was installed'
    : `${JSON.stringify(record.positions)}, over ${JSON.stringify(frameGaps(record.frames))}, ` +
        `and the calls that could have moved it: ${JSON.stringify(record.calls)}, ` +
        `out of ${JSON.stringify(record.callsWatched)}: an empty array is an absence for those and ` +
        `says nothing about the rest, which are behind EQUATOR_ASSURANCE_TRACE_CALLS=1, ` +
        `nor about the engine, which moves the page without calling anything, ` +
        `with what the engine originated: ${JSON.stringify(record.events)}, ` +
        `what left or entered the document: ${JSON.stringify(record.mutations)}, ` +
        `what read the position: ${JSON.stringify(record.reads)}, ` +
        `what changed about what stayed: ${JSON.stringify(record.attributes)}, ` +
        `what the document did to itself: ${JSON.stringify(record.lifecycle)}, ` +
        `and the placement all of it is measured from: ${JSON.stringify(record.placement)}, ` +
        `and where each control sat when it was clicked: ${JSON.stringify(record.clicks)}. ` +
        `An inView that is true at the placement and false at the first of these is a scroll no wrapper sees`;
}

async function logicalScrollState(page) {
  // Called here rather than passed: a string that evaluates to a function is serialized back as
  // `undefined`, not invoked. Every reader of the source wraps it the same way.
  return page.evaluate(`(${SCROLL_STATE_SOURCE})()`);
}

/**
 * The placement, and the two facts recorded at it rather than argued about afterwards.
 *
 * The recorder installs *after* this call, so its clock starts here-plus-epsilon and every reading
 * it prints is relative to a zero the reader cannot place. Stashing the page clock here lets the
 * recorder state the placement as an offset on its own scale, which is what separates a reset that
 * happened before the watched interval from one that happened inside it.
 *
 * `history.scrollRestoration` is read because an engine restoring a position it remembers is one of
 * the classes of action nothing else here can see, and its value says whether that class is live at
 * all. Read and recorded, never written: setting it would change the thing being measured.
 */
async function placeVisitorMidPage(page, target = null) {
  await page.evaluate((selector) => {
    globalThis.scrollTo(240, 360);
    const element = selector === null ? null : document.querySelector(selector);
    globalThis.__equatorScrollPlacement = {
      pageClock: performance.now(),
      scrollRestoration: history.scrollRestoration,
      readyState: document.readyState,
      target:
        element === null
          ? null
          : globalThis.__equatorRectAgainstViewport(element, selector),
    };
  }, target);
}

async function exerciseLocaleContinuity(page, row) {
  // Focus, selection, composition and scroll are kept across a switch made in the document. A switch
  // that is a document navigation keeps none of them, by what it is rather than by a defect.
  if (!addresses.switchInDocument) return;
  const input = page.locator('[data-percent-input]');
  await input.fill('50%');
  await input.focus();
  await input.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Localized percent control is not an input');
    }
    element.setSelectionRange(1, 2, 'forward');
  });
  // A viewport narrow enough that the page genuinely overflows, restored before returning.
  //
  // Without it the check is decided by incidental layout width: at the default 1280 the fixture has
  // around 10px of horizontal range, so `scrollTo(240)` clamps to the maximum, and an inverted
  // formula that answers the maximum at rest passes by cancellation. A wider page stops the clamp,
  // and the check turns red or green with the layout rather than with the restore.
  const priorViewport = page.viewportSize();
  await page.setViewportSize({ width: 420, height: 700 });
  await page.evaluate(RECT_AGAINST_VIEWPORT_SOURCE);
  await placeVisitorMidPage(page, '[data-locale-choice="ar-EG"]');
  const before = await logicalScrollState(page);
  // Strictly greater than the offset, so 240 is a position in the middle of the range rather than
  // its end. Equal would mean the scroll had clamped, and a clamped start is what made the old
  // check vacuous.
  assert.ok(
    before.maximum > 240,
    `The logical-scroll fixture has too little horizontal range to place a 240px offset mid-page: ${JSON.stringify(before)}`,
  );
  assert.equal(
    before.fromLeftEdge,
    240,
    `The logical-scroll fixture clamped the inline offset, so nothing below distinguishes a preserved position from a lost one: ${JSON.stringify(before)}`,
  );
  // The document is LTR here, where the two offsets are the same number. Asserted rather than
  // assumed, because everything below compares an LTR reading against an RTL one and that is only
  // meaningful while the starting point is unambiguous.
  assert.equal(
    before.fromInlineStart,
    before.fromLeftEdge,
    `The starting position was read in a document that is not LTR, so the two inline offsets already disagree and nothing below compares like with like: ${JSON.stringify(before)}`,
  );
  assert.ok(
    before.block > 0,
    'The logical-scroll fixture did not reach a nonzero block position',
  );

  // Installed before the commit, because the interval that decides this check is the one between
  // the commit and the settle, and nothing was watching it. Two independent records:
  //
  //   `positions`. One entry per `scroll` event, which is every position the page took. A scroll
  //   listener rather than a per-frame read: reading `scrollX` on every frame forces layout on every
  //   frame, and an instrument whose cost changes the outcome is not an instrument.
  //
  //   `frames`: a requestAnimationFrame heartbeat recording nothing but a timestamp. Playwright
  //   polls `waitForFunction` on rAF, so a gap here is a period in which the predicate could not
  //   have run whatever the page was doing. That is the difference between "it never got there" and
  //   "nobody was looking", and it is not answerable after the fact.
  await page.evaluate(`(${RECORDER_SOURCE})()`);

  // The expectation, written by hand: whatever element the visitor had at their inline-start edge
  // before the commit is the element there after it.
  //
  // **Not a number, and deliberately not one.** Every numeric form of this check recomputes an
  // expression Equator also computes, so it agrees with the implementation by construction on what
  // the quantity *means* and can only ever check the arithmetic. A check drawn from the same source
  // as its subject is why a restore that returned the visitor to the wrong content passed this gate
  // on three engines: the assertion and the runtime shared a definition, and the definition was the
  // defect.
  //
  // An element cannot be shared with a formula. It is marked here, before anything moves, and read
  // back afterwards; if the commit replaced the node rather than moving it the mark is gone and this
  // fails, which is also a thing worth failing on.
  await page.evaluate(INLINE_START_WITNESS_SOURCE);
  const witness = await inlineStartWitness(page, 'mark');
  // A strip cell, specifically, and the check refuses to run on anything else.
  //
  // The rest of this page is one column, so every element under the inline-start edge spans the
  // whole width and is found there whichever position the restore lands on. Against a fixture like
  // that this check passes the design it exists to reject, which is what a fixture too small to
  // tell two designs apart does. The strip exists to make the two answers different elements, and
  // requiring a cell here is what stops the check quietly reverting to vacuous if the strip is ever
  // moved out from under the probe.
  assert.ok(
    witness.cell !== null,
    `The viewport's inline-start edge is not over a cell of the inline scroll strip before the commit, so this check cannot tell a correct restore from the mirror-image one. Observed ${JSON.stringify(witness)}`,
  );

  await clickLocaleChoice(page, 'ar-EG');
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'ar-EG' &&
      document.documentElement.dir === 'rtl',
  );
  await page.waitForURL(
    (url) => url.pathname === addresses.shownPath('home', 'ar-EG'),
  );
  const after = await logicalScrollState(page);
  assert.ok(
    after.maximum > 0,
    'The RTL document lost its horizontal scroll range',
  );
  // One read, so the four facts describe the same moment, and one assertion, so a failure carries
  // all of them.
  //
  // These were four separate `assert.equal` calls with no messages. A WebKit 26.5 run failed
  // with `3 !== 1` and nothing else: not which field, not what the selection had become, not
  // whether the element still had focus, not what was in it. `3` is the end of `50%`, so the
  // selection had collapsed to the caret, but that had to be worked out from the fixture rather
  // than read from the failure, which is the difference between a measurement and a guess (4.15).
  const selection = await input.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Localized percent control is not an input');
    }
    return {
      active: document.activeElement === element,
      direction: element.selectionDirection,
      end: element.selectionEnd,
      start: element.selectionStart,
      value: element.value,
    };
  });
  assert.deepEqual(
    {
      active: selection.active,
      direction: selection.direction,
      end: selection.end,
      start: selection.start,
    },
    { active: true, direction: 'forward', end: 2, start: 1 },
    `The selection inside the localized percent control did not survive the RTL commit. Observed ${JSON.stringify(selection)}, and the value is ${JSON.stringify(selection.value)}, so a start equal to its length is a collapsed caret rather than a moved selection.`,
  );
  // The block axis is not asserted here, against `after`, and the reason is worth keeping: that
  // reading is taken the instant the direction flip lands, before the hold has done its work.
  //
  // **The block position is Equator's to keep, and the movement it keeps it against is WebKit's.**
  // On a writing-direction change WebKit reveals an element that already has focus, moving both
  // axes some milliseconds after Equator has written the position, with no scroll call from any
  // script in between. Reproduced with no Equator and no framework in the page;
  // `focus({ preventScroll: true })` is honoured and is not what does it. `holdScroll` re-applies
  // the position against exactly that, so "Block scroll moved during the RTL commit" is a condition
  // worth failing on, read at a moment when the answer has settled. Read at the instant of the flip
  // it fails about one run in five on a page that is behaving correctly.
  //
  // Reported upstream and open: https://bugs.webkit.org/show_bug.cgi?id=323563,
  // WebKit / Scrolling, *"A focused element is revealed after a writing-direction change,
  // overriding the scroll position the page just set"*. The hold stays whatever happens to it:
  // it is what makes three engines agree, and a fix would arrive in one engine's future version
  // while Equator keeps supporting the ones already out. What the bug number changes is that the
  // next person to read this can see whether the behaviour is still WebKit's position.
  //
  // Equator holds the position against it for a bounded window, so the honest moment to read the
  // page is once it has settled, which is where the inline axis was already being read. Both axes
  // are asserted there, together, in one wait. `after` stays as evidence, because where the page
  // went in between is exactly what a failure needs to show.

  // One outcome, required of all three engines, rather than a disjunction that also accepts the
  // inline-start. The engines do not disagree here: they land where Equator sends them, every time.
  // Accepting the inline-start as well admits a frame of a restore in progress as an outcome, and
  // the row then passes with the restore deleted outright, because a page that never restored and
  // a page mid-restore read identically.
  //
  // The wait is the honest instrument here for the same reason it is for focus: Equator has
  // scheduled the scroll and the browser applies it over frames, with nothing of Equator's running
  // in between. The failure prints where the page went and when, so a restore that lands somewhere
  // else and a restore that never happens are different reports rather than the same timeout.
  //
  // Polled on an interval rather than on animation frames. Playwright's default is `raf`, which
  // means the predicate is evaluated inside a `requestAnimationFrame` callback and therefore only
  // while the row is producing frames; the installed playwright-core documents the option as
  // "Defaults to raf". A wait can expire with its own predicate true at the moment it expires,
  // which fails a page that has already done what was asked of it: the predicate is not the
  // problem, the opportunity to ask it is. An interval is also the cheaper instrument here:
  // `elementFromPoint` forces layout, and 100ms costs fifty layouts over the five seconds where
  // frames cost about three hundred. An instrument's own cost cuts both ways.
  const settleStartedAt = Date.now();
  // Why it did not succeed, not merely that it did not. A rejected `waitForFunction` and an expired
  // one are different events with different subjects (the first is about the wait, the second
  // about the page) and folding both into `false` would make the failure message assert a timeout
  // it has not observed.
  let settleFailure = null;
  const settled = await page
    .waitForFunction(
      // Both axes, one moment. The inline axis is an element, whatever the visitor had at their
      // inline-start edge, because a number there would be a formula Equator also computes. The
      // block axis has no such element to hand: the strip's cells are 900px tall, so a block move
      // of a few hundred pixels finds the same cell and an element check cannot see it.
      // What is asserted instead is the reading taken before the commit, carried in from outside
      // the page. That is a value the harness observed, not an expression it recomputed.
      (expectedBlock) =>
        globalThis.__equatorInlineStartWitness('read').holds &&
        Math.abs(globalThis.scrollY - expectedBlock) <= 2,
      before.block,
      {
        // An interval rather than animation frames. The reason first given for this was a
        // hypothesis, that a row whose frames stopped was a row whose predicate stopped being
        // asked, and that hypothesis is dead: the wait was never being asked at all. What is left
        // is cost. `elementFromPoint` forces layout, and 100ms spends fifty of those over the five
        // seconds where frames would spend about three hundred. A judgement, not a measurement, and
        // recorded as one.
        polling: 100,
        timeout: 5_000,
      },
    )
    .then(
      () => true,
      (error) => {
        settleFailure = error;
        return false;
      },
    );
  const settleElapsedMs = Date.now() - settleStartedAt;
  if (!settled) {
    const trajectory = await page.evaluate(
      `(async () => {
        const state = ${SCROLL_STATE_SOURCE};
        const samples = [];
        const start = performance.now();
        while (performance.now() - start < 300) {
          const now = state();
          samples.push({
            at: Math.round(performance.now() - start),
            dir: now.raw.dir,
            scrollX: now.raw.scrollX,
            fromInlineStart: now.fromInlineStart,
            fromLeftEdge: now.fromLeftEdge,
            maximum: now.maximum,
            width: now.raw.scrollWidth,
            inner: now.raw.innerWidth,
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return samples.filter(
          (sample, index) =>
            index === 0 || sample.scrollX !== samples[index - 1].scrollX,
        );
      })()`,
    );
    const settledAt = await logicalScrollState(page);
    const during = await describeRecord(page);
    const held = await inlineStartWitness(page, 'read');

    const inlineHeld = held.holds;
    const blockHeld = Math.abs(settledAt.block - before.block) <= 2;
    assert.fail(
      `The RTL commit did not return the visitor to the position they left. ` +
        `Inline axis: ${inlineHeld ? 'held' : 'MOVED'}. The element at their inline-start edge. ` +
        `Block axis: ${blockHeld ? 'held' : 'MOVED'}. ${before.block} before, ${settledAt.block} once the wait ended. ` +
        (blockHeld || inlineHeld
          ? ''
          : `Both axes moving together is the signature of an engine revealing a focused element rather than of a restore landing wrongly. `) +
        `The wait ended after ${settleElapsedMs}ms of a 5000ms budget, ` +
        (settleElapsedMs < 4_500
          ? `which is not an expiry: it rejected. `
          : `which is an expiry. `) +
        `What ended it: ${settleFailure === null ? 'nothing: it resolved falsy, which should be impossible' : JSON.stringify(String(settleFailure.stack ?? settleFailure))}. ` +
        (held.holds
          ? `And the predicate was true when read immediately afterwards, so this is the wait failing rather than the page. `
          : '') +
        `Marked before the commit: ${JSON.stringify(witness.found)}. At the inline-start edge afterwards: ${JSON.stringify(held)}. ` +
        `A null "expected" there means the commit replaced the node rather than moving it, which is a different defect from a restore that landed wrongly. ` +
        `Everything below is evidence rather than the expectation. ` +
        `Before ${JSON.stringify(before)}, at the first read after the commit ${JSON.stringify(after)}, ` +
        `and once the five seconds had expired ${JSON.stringify(settledAt)}, in which \`fromInlineStart\` is the quantity Equator holds. ` +
        `Sampled for a further 300ms from there, distinct positions only: ${JSON.stringify(trajectory)}. ` +
        `The sampling begins after the wait expires, so it describes where the page has come to rest and says nothing about what happened during the commit. ` +
        `Every position the page took between the commit and the expiry, and the animation frames that ran while it did: ${during}. ` +
        `A long gap in the frames is a period in which the predicate could not have been polled, whatever the page was doing.`,
    );
  }

  await page.evaluate(
    `(() => {
      globalThis.__equatorScrollRecord?.stop();
      delete globalThis.__equatorScrollRecord;
      delete globalThis.__equatorScrollPlacement;
    })()`,
  );

  if (priorViewport !== null) {
    await page.setViewportSize(priorViewport);
  }
  // Both halves end to end and in that order: the switch the visitor just made is written to a
  // cookie, and the cookie decides where a later locale-neutral request lands. Neither half
  // means anything alone: a cookie nobody reads, or a reader with nothing to read.
  const persistedCookies = await page.context().cookies();
  if (
    !persistedCookies.some(
      ({ name, value }) => name === 'equator-locale' && value === 'ar-EG',
    )
  ) {
    // Both readings are taken, because a short message cannot tell an engine that declined to store
    // the cookie from a harness reading the wrong place for it, and only one of those findings is
    // about Equator.
    const documentCookie = await page
      .evaluate('document.cookie')
      .then((value) => JSON.stringify(value))
      .catch((error) => `unreadable: ${String(error)}`);
    assert.fail(
      `The locale switch was not remembered by withPersistence(cookieStore(localeCookie)). ` +
        `The switch itself landed, everything asserted above this is about the page after it committed, so what is missing is the cookie meant to outlive it. ` +
        `The lab writes it from script, as \`equator-locale=ar-EG; Path=/; Max-Age=31536000; SameSite=Lax\` with no \`Secure\`, over ${browserOrigin}. ` +
        `What the document reports: ${documentCookie}. ` +
        `Every cookie this context holds, for every origin: ${JSON.stringify(persistedCookies)}. ` +
        `In the document but not in the context is this harness reading the wrong place. ` +
        `In neither is the engine declining a first-party cookie over loopback, which is a finding about the engine. ` +
        `In both, under another name or value, is Equator writing something other than what it documents.`,
    );
  }
  const remembered = await measuredContext(page);
  const rememberedCheck = sectionCheck(row, 'remembered switch');
  recordCapabilityClaim(rememberedCheck, 'feature:withPersistence', remembered);
  recordCapabilityClaim(rememberedCheck, 'store:cookieStore', remembered);
  // Only an address that names no locale has anywhere to send the visitor, and a policy that
  // prefixes every locale has one at the root.
  if (addresses.entryRedirects) {
    const rememberedEntry = await page.request.fetch(`${browserOrigin}/`, {
      maxRedirects: 0,
    });
    assert.equal(rememberedEntry.status(), 307);
    assert.equal(
      rememberedEntry.headers()['location'],
      addresses.path('home', 'ar-EG'),
    );
    assert.equal(
      rememberedEntry.headers()['cache-control'],
      'private, no-cache',
    );
  }
  assert.equal(
    (await page.locator('[data-percent-model]').textContent())?.trim(),
    '0.5',
  );
  assert.equal(
    await page.locator('[data-source-fallback]').getAttribute('lang'),
    'en',
  );
  assert.equal(
    await page.locator('[data-source-fallback]').getAttribute('dir'),
    'ltr',
  );
  assert.equal(
    await page
      .locator('[data-source-fallback]')
      .getAttribute('data-supplying-locale'),
    'en-US',
  );
  assert.equal(
    await page.locator('[data-person-name]').getAttribute('lang'),
    'ar',
  );
  assert.equal(
    await page.locator('[data-person-name]').getAttribute('dir'),
    'rtl',
  );
  assert.equal(
    await page.locator('[data-comment-id="community-ar"]').getAttribute('lang'),
    'ar',
  );
  assert.equal(
    await page.locator('[data-comment-id="community-ar"]').getAttribute('dir'),
    'rtl',
  );
  assert.equal(
    await page.locator('[data-comment-id="fixed-fr"]').getAttribute('lang'),
    'fr',
  );
  assert.equal(
    await page.locator('[data-comment-id="fixed-fr"]').getAttribute('dir'),
    'ltr',
  );

  await input.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Localized percent control is not an input');
    }
    element.value = 'composition in progress';
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickLocaleChoice(page, 'en-US');
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'en-US' &&
      document.documentElement.dir === 'ltr',
  );
  await page.waitForURL(
    (url) => url.pathname === addresses.shownPath('home', 'en-US'),
  );
  assert.equal(await input.inputValue(), 'composition in progress');
  assert.equal(
    await input.evaluate((element) => document.activeElement === element),
    true,
  );
  await input.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    ),
  );
  assert.equal(
    (await page.locator('[data-percent-model]').textContent())?.trim(),
    '0.5',
  );

  await assertUnrequestedMovementIsUndone(page);
  recordCapabilityClaim(
    sectionCheck(row, 'continuity'),
    'directive:LocalizedInput',
    await measuredContext(page),
  );
}

/**
 * A check whose success path and failure path run on different machinery has only ever been
 * tested on the path that succeeds.
 *
 * Everything above passes on Chromium and Firefox without the runtime's scroll hold ever performing
 * a single re-apply, because nothing on those engines moves the page after the restore. The hold is
 * the part of the restore this check exists for, and on two engines out of three no green run has
 * exercised it at all. On the third it fires about one run in five, which is not a test either: it
 * is a coincidence frequent enough to be mistaken for one.
 *
 * So the movement is supplied on purpose, on every engine, every run. A one-shot disturbance is
 * armed, the page is committed to Arabic, and the first scroll event arriving once the commit has
 * landed *and* the visitor is back at their element scrolls the page to the origin. That is a
 * movement Equator did not request and no visitor made, delivered inside the hold's window by
 * construction rather than by timing: the trigger is Equator's own restore landing, so it can
 * arrive neither early nor late.
 *
 * Two things are then required, and the second is what makes this a check rather than a hope: the
 * position comes back, **and the disturbance actually fired**.
 *
 * Runs last, and puts the page back the way it found it: English, and the caller's viewport.
 */
async function assertUnrequestedMovementIsUndone(page) {
  const priorViewport = page.viewportSize();
  await page.setViewportSize({ width: 420, height: 700 });
  await page.evaluate(RECT_AGAINST_VIEWPORT_SOURCE);
  await placeVisitorMidPage(page, '[data-locale-choice="ar-EG"]');
  const before = await logicalScrollState(page);
  assert.ok(
    before.maximum > 240,
    `The hold case has too little horizontal range to place a 240px offset mid-page: ${JSON.stringify(before)}`,
  );
  // The same three guards the commit check above carries, for the same reason: a starting point
  // that clamped, or that was read in a document already right-to-left, makes everything below
  // measure something other than what it says. Without them a bad placement here surfaces five
  // seconds later as a disturbance that never fired, which points at the wrong thing entirely.
  assert.equal(
    before.raw.dir,
    'ltr',
    `The hold case starts in a document that is not LTR, so the commit below is not a direction change and the movement it guards against does not arise: ${JSON.stringify(before)}`,
  );
  assert.equal(
    before.fromLeftEdge,
    240,
    `The hold case could not place the visitor mid-page; the inline offset clamped: ${JSON.stringify(before)}`,
  );
  assert.ok(
    before.block > 0,
    `The hold case did not reach a nonzero block position: ${JSON.stringify(before)}`,
  );
  await page.evaluate(INLINE_START_WITNESS_SOURCE);
  const witness = await inlineStartWitness(page, 'mark');
  assert.ok(
    witness.cell !== null,
    `The inline-start edge is not over a strip cell before the hold case, so it cannot tell a held position from a lost one. Observed ${JSON.stringify(witness)}`,
  );

  // The same recorder the commit check above installs, for the same reason, arrived here late.
  //
  // A Firefox run failed this with the disturbance never fired, the block axis held at
  // its pre-commit 360 and the inline axis resting at the origin, and the message could say only
  // where the page had come to rest, because nothing was watching the interval that decides this.
  // Whether the restore wrote the inline position at all, wrote it and had it clamped, or wrote it
  // and something moved it afterwards are three different defects that produce that one reading, and
  // no amount of re-reading the failure separates them. `positions` carries `dir` alongside every
  // scroll, so the next occurrence answers it rather than raising it again.
  await page.evaluate(`(${RECORDER_SOURCE})()`);

  await page.evaluate(() => {
    const disturbance = { firedAt: null, from: null, to: null, armed: true };
    globalThis.__equatorDisturbance = disturbance;
    globalThis.addEventListener(
      'scroll',
      () => {
        if (!disturbance.armed) return;
        // Not before the commit has landed (the document is left-to-right until it does, so this
        // cannot fire on the way in) and not before the restore has landed either, which is what
        // the witness says.
        if (document.documentElement.dir !== 'rtl') return;
        if (!globalThis.__equatorInlineStartWitness('read').holds) return;
        disturbance.armed = false;
        disturbance.from = { x: globalThis.scrollX, y: globalThis.scrollY };
        disturbance.firedAt = Math.round(performance.now());
        globalThis.scrollTo(0, 0);
        disturbance.to = { x: globalThis.scrollX, y: globalThis.scrollY };
      },
      { passive: true },
    );
  });

  await clickLocaleChoice(page, 'ar-EG');
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'ar-EG' &&
      document.documentElement.dir === 'rtl',
  );

  const undone = await page
    .waitForFunction(
      (expectedBlock) =>
        globalThis.__equatorDisturbance.firedAt !== null &&
        globalThis.__equatorInlineStartWitness('read').holds &&
        Math.abs(globalThis.scrollY - expectedBlock) <= 2,
      before.block,
      { polling: 100, timeout: 5_000 },
    )
    .then(
      () => true,
      () => false,
    );
  const record = await page.evaluate(() => globalThis.__equatorDisturbance);
  if (!undone) {
    const restingAt = await logicalScrollState(page);
    const stillThere = await inlineStartWitness(page, 'read');
    const during = await describeRecord(page);
    // Which axis, said out loud. Both moving together is an engine revealing a focused element;
    // one moving alone is not, and the two failures have nothing to do with each other.
    const axes =
      `The block axis ${Math.abs(restingAt.block - before.block) <= 2 ? 'held' : 'MOVED'} ` +
      `(${before.block} before, ${restingAt.block} now) and the inline axis ` +
      `${stillThere.holds ? 'held' : 'MOVED'} (${before.fromInlineStart} from the inline-start ` +
      `edge before, ${restingAt.fromInlineStart} now). `;
    assert.fail(
      record.firedAt === null
        ? `The deliberate disturbance never fired, so this run proved nothing about the hold. Its two arming conditions are that the Arabic commit has landed and that the visitor is back at their element; one of them was never met. Observed ${JSON.stringify(record)}, from ${JSON.stringify(before)}, resting at ${JSON.stringify(restingAt)}, with ${JSON.stringify(stillThere)} at the inline-start edge. ${axes}Every position the page took, with the direction it was in at each: ${during}.`
        : `A movement Equator did not request and no visitor made was not undone. The page was scrolled from ${JSON.stringify(record.from)} to ${JSON.stringify(record.to)}, and five seconds later it is at ${JSON.stringify(restingAt)} with ${JSON.stringify(stillThere)} at the inline-start edge, against a block offset of ${before.block} before the commit. The hold either did not run, closed too early, or was closed by something on this page that reads as visitor input. ${axes}Every position the page took, with the direction it was in at each: ${during}.`,
    );
  }
  assert.notEqual(
    record.firedAt,
    null,
    'The hold case passed without its disturbance firing, which the wait is written to make impossible, if this ever fires, the wait has been weakened.',
  );

  // The instrument's own positive control, and this is the one stage that can carry it.
  //
  // An empty calls array is only evidence of absence once the array is known to be able to
  // hold something. Every other reader of this record is a failure message, so the wrappers were
  // last proven to work on a run that was already red, which is the wrong way round. Here the
  // stage has just asserted that its deliberate disturbance fired, and that disturbance calls
  // `globalThis.scrollTo(0, 0)`: a call this file made, at a moment the assertion above proves
  // happened. If the wrapper is uninstalled, misnamed, or shadowed by something the page does, this
  // is empty and says so on a green run rather than on the next red one.
  //
  // Equator's own restore also calls it, and this deliberately does not assert that: what is being
  // proven is that the instrument records a call, not what the runtime called.
  const watched = await page.evaluate(
    `(() => {
      const held = globalThis.__equatorScrollRecord;
      return held === undefined
        ? null
        : { watched: held.callsWatched ?? [], calls: held.calls ?? [] };
    })()`,
  );
  assert.ok(
    watched !== null &&
      watched.watched.includes('window.scrollTo') &&
      watched.calls.some(
        (call) => call.api === 'window.scrollTo' && call.detail === '0,0',
      ),
    `The unconditional call wrappers did not record this file's own scroll to the origin, so an empty calls array in any failure message on this row is not evidence that nothing called. Observed ${JSON.stringify(watched)}.`,
  );

  await page.evaluate(() => {
    globalThis.__equatorScrollRecord?.stop();
    delete globalThis.__equatorScrollRecord;
    delete globalThis.__equatorScrollPlacement;
    delete globalThis.__equatorDisturbance;
  });
  await clickLocaleChoice(page, 'en-US');
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'en-US' &&
      document.documentElement.dir === 'ltr',
  );
  if (priorViewport !== null) {
    await page.setViewportSize(priorViewport);
  }
}

// The inputs the consumer's exercise sheet writes, and the messages it localizes as each locale's
// catalog has them, which the engine's own formatters are handed to write the same lines.
const exerciseInputs = await readExerciseInputs(consumerRoot);
const exerciseSources = new Map(
  await Promise.all(
    builtLocales.map(async (locale) => [
      locale,
      await readExerciseSources(consumerRoot, locale, exerciseInputs),
    ]),
  ),
);

/** The exercise sheet a page shows, read once its client has drawn it. */
async function exerciseSheetOn(page) {
  await page.waitForSelector(
    '[data-route-view="exercise"][data-exercise-drawn="client"]',
    { state: 'attached' },
  );
  return sheetOf(
    await page.evaluate(() => {
      const section = document.querySelector('[data-route-view="exercise"]');
      return {
        locale: section.getAttribute('data-exercise-locale'),
        sheet: section.getAttribute('data-exercise-sheet'),
        policy: section.getAttribute('data-url-policy'),
        // Read as the consumer stage reads a document. The page's policy runs no code built from a
        // string, so the reader is written out here rather than handed over.
        lines: [...section.querySelectorAll('[data-exercise]')].map((line) => {
          const attribute = line.getAttribute('data-exercise-attribute');
          return [
            line.getAttribute('data-exercise'),
            attribute === null
              ? line.textContent
              : (line.getAttribute(attribute) ?? ''),
          ];
        }),
      };
    }),
  );
}

/**
 * Every line of a sheet a page shows, held to what this engine's own formatters write for the same
 * input, and each capability a line shows claimed with what was observed where it was read.
 */
async function holdSheetToAuthority(page, check, sheet, locale, observed) {
  const expected = await page.evaluate(exerciseAuthority, {
    inputs: exerciseInputs,
    locale,
    ...exerciseSources.get(locale),
  });
  claimExercisedContext(check, sheet, expected, observed);
  claimInstalledRelativeTime(check, sheet, expected, observed);
  claimExercisedPipes(check, sheet, expected, observed);
  claimExercisedDirectives(check, sheet, expected, observed);
  claimExercisedFormats(check, sheet, expected, observed);
  claimExercisedControls(
    check,
    sheet,
    expected,
    exerciseInputs.controls,
    observed,
  );
  claimExercisedExtensions(check, sheet, expected, observed);
  await verifyTypedFields(page, check, expected, observed);
}

/**
 * The exercise sheet in this engine: every pipe and formatting function, rendered on request and
 * adopted, prerendered and adopted, and drawn by a client navigation, in each locale the build
 * serves. Each line is held to what this engine's own formatters write for the same input.
 */
async function verifyExerciseSheets(row, context, diagnostics) {
  // A page for each visit. A second load in the same page can find the sheet it is waiting for in
  // the document it is leaving, and read that one.
  const visit = async (read) => {
    const page = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(page, diagnostics);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    await read(page);
    await collectPolicyDiagnostics(page, diagnostics);
    await page.close();
  };
  const verifySheet = async (page, check, locale, observed, sheetPage) => {
    const sheet = await exerciseSheetOn(page);
    assert.equal(sheet.locale, locale, `${check} shows ${sheet.locale}`);
    assert.equal(
      new URL(page.url()).pathname,
      addresses.shownPath(sheetPage, locale),
      `${check}: not shown at the path localizedPaths gives it`,
    );
    recordCapabilityClaim(check, 'declaration:localized-paths', observed);
    // After a client navigation the head follows the page that arrived, which can be a moment
    // behind the sheet itself.
    await page
      .waitForFunction(
        () =>
          document
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content') === 'noindex',
      )
      .catch(() => undefined);
    // Read once, not through a locator, which would wait for a tag that is missing and report the
    // wait instead of the declaration.
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content') ?? null,
      ),
      'noindex',
      `${check}: the exercise route declares equatorIndexing non-indexable, and the head does not keep it out of an index`,
    );
    recordCapabilityClaim(check, 'declaration:route-indexing-class', observed);
    claimSheetParameter(
      check,
      sheet,
      exerciseSheetNames[sheetPage],
      locale,
      observed,
    );
    await holdSheetToAuthority(page, check, sheet, locale, observed);
  };

  for (const locale of builtLocales) {
    for (const [sheetPage, rendered] of [
      ['exercise', 'rendered on request'],
      ['exercise values', 'prerendered'],
    ]) {
      if (!addresses.has(sheetPage, locale)) continue;
      await visit(async (page) => {
        const response = await visitFor(context, sheetPage, locale, (url) =>
          navigateWithScriptGate(page, url, async () => {
            await page.waitForSelector('[data-route-view="exercise"]', {
              state: 'attached',
            });
            await holdServerElements(page);
          }),
        );
        const observed = await measuredContext(page);
        assert.ok(
          observed.adoptedElements > 0,
          `${row.label} kept none of the ${sheetPage} sheet's server elements in ${locale}`,
        );
        const check = sectionCheck(
          row,
          `exercise sheet in ${locale}, ${rendered}`,
        );
        // The sheet declares no caching class, so where the address states its locale and no floor
        // is declared it is a shared success, and whether a cache asks again before serving it
        // stale is the deployment's. No engine: the header is the server's. A prerendered address
        // an engine looks up without decoding it is answered by the host's own file serving
        // (`serveBrowserAsset`), which writes none of the handler's fields, so only an answer
        // carrying the language the handler states is held to the handler's caching.
        const handlerAnswered =
          response?.headers()['content-language'] !== undefined;
        if (
          addresses.localeInPath &&
          addresses.pageCaching === undefined &&
          handlerAnswered
        ) {
          assert.equal(
            response?.headers()['cache-control'],
            declaresNoRevalidation
              ? 'public, max-age=600'
              : 'public, max-age=600, must-revalidate',
            `${check}: not the shared answer revalidateSuccess ${declaresNoRevalidation ? 'false' : 'left to its default'} gives`,
          );
          if (declaresNoRevalidation) {
            recordCapabilityClaim(
              check,
              'declaration:RouteCacheDurations.revalidateSuccess',
              { document: observed.document, policy: observed.policy },
            );
          }
        }
        await verifySheet(page, check, locale, observed, sheetPage);
      });
    }

    await visit(async (page) => {
      await visitFor(context, 'home', locale, (url) => page.goto(url));
      await page.waitForFunction(
        () => document.documentElement.dataset['clientReady'] === 'true',
      );
      await page.locator('[data-route-link="exercise"]').click();
      await page.waitForURL((url) => isShown(url, 'exercise', locale));
      await page.waitForSelector(
        '[data-route-view="exercise"] [data-exercise="formatNumber"]',
      );
      // Only what the navigation measured. The document is still the home page's, which the
      // server wrote, and the sheet in it is not.
      const { engine, policy, clientNavigations } = await measuredContext(page);
      assert.ok(
        clientNavigations > 0,
        `${row.label} reached the exercise sheet in ${locale} without a client navigation`,
      );
      await verifySheet(
        page,
        sectionCheck(row, `exercise sheet in ${locale}, by client navigation`),
        locale,
        { engine, policy, clientNavigations },
        'exercise',
      );
    });
  }
}

/**
 * A navigation the router makes from a history entry, which is how a reader returns to a page: the
 * entry is added and the browser's own event for moving to it is raised.
 */
function throughHistory(page, path) {
  return page.evaluate((target) => {
    history.pushState(null, '', target);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, path);
}

/**
 * An address under one of the aliases the policy declares, in this engine: requested as a document,
 * which the server sends on, and reached by the router, which sends it on too, with the query kept.
 */
async function verifyLocaleAliases(row, context, diagnostics) {
  for (const locale of builtLocales) {
    if (!addresses.has('second under an alias', locale)) continue;
    const page = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(page, diagnostics);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    const aliased = `${addresses.path('second under an alias', locale)}?tab=one`;
    const sentOn = (url) =>
      isShown(url, 'second', locale) && url.searchParams.get('tab') === 'one';
    await page.goto(siteUrl(aliased, locale));
    assert.ok(
      sentOn(new URL(page.url())),
      `${row.label}: ${aliased}, under one of the aliases the policy declares, left the browser at ${page.url()} rather than at the ${locale} second page`,
    );
    await page.waitForSelector('[data-route-view="second"]');
    const requested = await measuredContext(page);
    recordCapabilityClaim(
      sectionCheck(row, `the ${locale} alias, requested`),
      'declaration:locale-aliases',
      { engine: requested.engine, policy: requested.policy },
    );
    await throughHistory(page, addresses.shownPath('home', locale));
    await page.waitForSelector('[data-route-view="home"]');
    await throughHistory(page, aliased);
    await page.waitForURL(sentOn);
    await page.waitForSelector('[data-route-view="second"]');
    const { engine, policy, clientNavigations } = await measuredContext(page);
    assert.ok(
      clientNavigations > 1,
      `${row.label} followed the ${locale} alias without a client navigation`,
    );
    recordCapabilityClaim(
      sectionCheck(row, `the ${locale} alias, reached through history`),
      'declaration:locale-aliases',
      { engine, policy, clientNavigations },
    );
    await collectPolicyDiagnostics(page, diagnostics);
    await page.close();
  }
}

/**
 * The pseudo-locale in this engine, from the pseudo build the consumer stage made beside the
 * production one: its exercise sheet rendered on request and adopted, and drawn by a client
 * navigation from home. Every message on it is one `equator generate --pseudo` transformed, and
 * its number is written in the digits the formatting declaration gives the locale.
 */
async function verifyPseudoLocale(row, diagnostics) {
  const locale = 'en-Arab-XB';
  const { numberingSystem } = configuredFormatting[locale];
  // Under a policy that leaves the locale out of the address the pseudo-locale spells every address
  // as the source locale does, and the reader's stored choice is what shows it.
  const pathOf = (page) =>
    addresses.shownPath(
      page,
      addresses.has(page, locale) ? locale : sourceLocale,
    );
  const pseudoContext = boundCalls(
    await browser.newContext({
      extraHTTPHeaders: { [PSEUDO_BUILD_HEADER]: 'pseudo' },
    }),
    'context',
  );
  await recordPolicyViolations(pseudoContext);
  if (!addresses.localeInAddress) {
    await pseudoContext.addCookies([
      { name: 'equator-locale', value: locale, url: browserOrigin },
    ]);
  }
  const open = async () => {
    const page = boundCalls(await pseudoContext.newPage(), 'page');
    attachBrowserDiagnostics(page, diagnostics);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    return page;
  };
  const holdSheet = async (page, check, observed) => {
    const sheet = await exerciseSheetOn(page);
    assert.equal(sheet.locale, locale, `${check} shows ${sheet.locale}`);
    assert.ok(
      await page.evaluate(
        () =>
          document
            .querySelector('[data-route-view="exercise"]')
            ?.textContent?.includes('⟦') ?? false,
      ),
      `${check} carries no message that equator generate --pseudo transformed`,
    );
    const { decimal } = exerciseInputs;
    assert.equal(
      sheet.lines.get('formatNumber'),
      await page.evaluate(
        ({ value, options, tag, digits }) =>
          new Intl.NumberFormat(tag, {
            ...options,
            numberingSystem: digits,
          }).format(Number(value)),
        {
          value: decimal.value,
          options: decimal.options,
          tag: locale,
          digits: numberingSystem,
        },
      ),
      `${check}: its number is not written in the ${numberingSystem} digits the formatting declaration gives ${locale}`,
    );
    recordCapabilityClaim(check, 'capability:pseudo-locale', observed);
    recordCapabilityClaim(check, 'declaration:locale-formatting', observed);
  };
  try {
    const adoptedPage = await open();
    await navigateWithScriptGate(
      adoptedPage,
      siteUrl(pathOf('exercise'), locale),
      async () => {
        await adoptedPage.waitForSelector('[data-route-view="exercise"]', {
          state: 'attached',
        });
        await holdServerElements(adoptedPage);
      },
    );
    const adopted = await measuredContext(adoptedPage);
    assert.ok(
      adopted.adoptedElements > 0,
      `${row.label} kept none of the ${locale} sheet's server elements`,
    );
    await holdSheet(
      adoptedPage,
      sectionCheck(row, `exercise sheet in ${locale}, rendered on request`),
      adopted,
    );
    await collectPolicyDiagnostics(adoptedPage, diagnostics);
    await adoptedPage.close();

    const drawnPage = await open();
    await drawnPage.goto(siteUrl(pathOf('home'), locale));
    await drawnPage.waitForFunction(
      () => document.documentElement.dataset['clientReady'] === 'true',
    );
    await drawnPage.locator('[data-route-link="exercise"]').click();
    await drawnPage.waitForURL((url) => url.pathname === pathOf('exercise'));
    await drawnPage.waitForSelector(
      '[data-route-view="exercise"] [data-exercise="formatNumber"]',
    );
    const { engine, policy, clientNavigations } =
      await measuredContext(drawnPage);
    assert.ok(
      clientNavigations > 0,
      `${row.label} reached the ${locale} sheet without a client navigation`,
    );
    await holdSheet(
      drawnPage,
      sectionCheck(row, `exercise sheet in ${locale}, by client navigation`),
      { engine, policy, clientNavigations },
    );
    await collectPolicyDiagnostics(drawnPage, diagnostics);
    await drawnPage.close();
  } finally {
    await pseudoContext.close();
  }
}

/**
 * What a page declared it turned out to be, and what a historical route answers, in this engine:
 * each page adopted from the document the server answered with, then reached again by the router
 * through history. An absence and a removal withdraw the canonical address and keep the page out of
 * an index; an operational failure keeps both, because the address is still the page's
 * (`specs/07-routing-rendering-and-seo.spec.md` section 12).
 */
async function verifyDeclaredOutcomes(row, context, diagnostics) {
  const locale = 'en-US';
  const message = (key) => readCatalogMessage(consumerRoot, locale, key);
  const outcomes = [
    {
      page: 'unfiled topic',
      status: 404,
      view: 'topic',
      declared: 'pageAbsent()',
      head: {
        title: await message('document.topic-absent.title'),
        canonical: null,
        robots: 'noindex',
      },
    },
    {
      page: 'retired topic',
      status: 410,
      view: 'topic',
      // The route's own title stays: outcomeDocuments is for an address that reached no route.
      declared: 'pageGone()',
      head: {
        canonical: null,
        robots: 'noindex',
      },
    },
    {
      page: 'unavailable topic',
      status: 503,
      view: 'topic',
      declared: 'pageOperationalFailure(503)',
      head: {
        canonical: addresses.url('unavailable topic', locale),
        robots: null,
      },
    },
    {
      page: 'removed',
      status: 410,
      view: 'not-found',
      declared:
        'a historical route declared gone, whose head outcomeDocuments gives',
      head: {
        title: await message('document.gone.title'),
        canonical: null,
        robots: 'noindex',
      },
    },
  ];
  // The head is read once it says what the declaration makes of it, which for a declaration a page
  // makes after its lookup is a moment after the page itself; then read once more and compared, so
  // a head that never gets there is reported as what it is.
  const settledHead = async (page, expected) => {
    // Written out in each callback, because each runs in the page, where nothing here is in scope.
    await page
      .waitForFunction((wanted) => {
        const head = {
          title: document.title,
          canonical:
            document
              .querySelector('link[rel="canonical"]')
              ?.getAttribute('href') ?? null,
          robots:
            document
              .querySelector('meta[name="robots"]')
              ?.getAttribute('content') ?? null,
        };
        return Object.keys(wanted).every(
          (field) => head[field] === wanted[field],
        );
      }, expected)
      .catch(() => undefined);
    return page.evaluate((fields) => {
      const head = {
        title: document.title,
        canonical:
          document
            .querySelector('link[rel="canonical"]')
            ?.getAttribute('href') ?? null,
        robots:
          document
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content') ?? null,
      };
      return Object.fromEntries(fields.map((field) => [field, head[field]]));
    }, Object.keys(expected));
  };
  const open = async () => {
    const page = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(page, diagnostics);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    return page;
  };

  for (const { page: outcomePage, status, view, declared, head } of outcomes) {
    const page = await open();
    const reach = [
      [
        'adopted',
        async () => {
          const response = await visitFor(
            context,
            outcomePage,
            locale,
            (url) => {
              expectedErrorDocuments.add(url);
              return navigateWithScriptGate(page, url, async () => {
                await page.waitForSelector(`[data-route-view="${view}"]`, {
                  state: 'attached',
                });
                await holdServerElements(page);
              });
            },
          );
          assert.equal(
            response?.status(),
            status,
            `${row.label}: the ${outcomePage} was not answered ${status}`,
          );
          const adopted = await measuredContext(page);
          assert.ok(
            adopted.adoptedElements > 0,
            `${row.label} kept none of the ${outcomePage}'s server elements`,
          );
          return adopted;
        },
      ],
      [
        'reached through history',
        async () => {
          await throughHistory(page, addresses.shownPath('home', locale));
          await page.waitForSelector('[data-route-view="home"]');
          await page.goBack();
          await page.waitForURL((url) => isShown(url, outcomePage, locale));
          await page.waitForSelector(`[data-route-view="${view}"]`);
          const { engine, policy, clientNavigations } =
            await measuredContext(page);
          assert.ok(
            clientNavigations > 1,
            `${row.label} returned to the ${outcomePage} without a client navigation`,
          );
          return { engine, policy, clientNavigations };
        },
      ],
    ];
    for (const [how, reached] of reach) {
      const observed = await reached();
      const check = sectionCheck(row, `${outcomePage}, ${how}`);
      assert.deepEqual(
        await settledHead(page, head),
        head,
        `${check}: the head is not what ${declared} makes of it`,
      );
      // Only the removed route reached no route, so only its head is the one outcomeDocuments gives
      // a removal; the unfiled topic's is the application's own wording for an absence.
      switch (outcomePage) {
        case 'unfiled topic':
          recordCapabilityClaim(check, 'outcome:pageAbsent', observed);
          // The title is the topic-absent message, which only the application's document callback
          // writes.
          recordCapabilityClaim(
            check,
            'declaration:RouteLocalizationOptions.document',
            observed,
          );
          break;
        case 'retired topic':
          recordCapabilityClaim(check, 'outcome:pageGone', observed);
          break;
        case 'unavailable topic':
          recordCapabilityClaim(
            check,
            'outcome:pageOperationalFailure',
            observed,
          );
          break;
        case 'removed':
          recordCapabilityClaim(
            check,
            'declaration:historical-route-outcome',
            observed,
          );
          recordCapabilityClaim(
            check,
            'declaration:outcome-documents',
            observed,
          );
          break;
      }
    }
    await collectPolicyDiagnostics(page, diagnostics);
    await page.close();
  }

  // A route declared historical and replaced: the server sends the reader on, and so does the
  // router, with the query the address carried.
  const page = await open();
  const legacy = `${addresses.shownPath('legacy', locale)}?tab=one`;
  const replaced = (url) =>
    isShown(url, 'second', locale) && url.searchParams.get('tab') === 'one';
  await visitFor(context, 'legacy', locale, (url) =>
    navigateWithScriptGate(page, `${url}?tab=one`, async () => {
      await page.waitForSelector('[data-route-view="second"]', {
        state: 'attached',
      });
      await holdServerElements(page);
    }),
  );
  assert.ok(
    replaced(new URL(page.url())),
    `${row.label}: the legacy route, declared historical and replaced by second, left the browser at ${page.url()}`,
  );
  const adopted = await measuredContext(page);
  assert.ok(
    adopted.adoptedElements > 0,
    `${row.label} kept none of the second page's server elements after the legacy route`,
  );
  recordCapabilityClaim(
    sectionCheck(row, 'legacy route, adopted'),
    'declaration:historical-route-outcome',
    adopted,
  );
  // From home, because the router ignores a navigation to the address it is already showing, and
  // the legacy route's replacement is the page the server sent the browser to.
  await throughHistory(page, addresses.shownPath('home', locale));
  await page.waitForSelector('[data-route-view="home"]');
  await throughHistory(page, legacy);
  await page.waitForURL(replaced);
  await page.waitForSelector('[data-route-view="second"]');
  const { engine, policy, clientNavigations } = await measuredContext(page);
  assert.ok(
    clientNavigations > 1,
    `${row.label} reached the legacy route without a client navigation`,
  );
  recordCapabilityClaim(
    sectionCheck(row, 'legacy route, reached through history'),
    'declaration:historical-route-outcome',
    { engine, policy, clientNavigations },
  );
  await collectPolicyDiagnostics(page, diagnostics);
  await page.close();
}

/**
 * Every field kind as a reader meets it in this engine: the field shows its value as the engine's
 * own formatters write it, refuses an empty entry, and reads that text back as the value.
 *
 * Each step waits on what the field itself reports it read, which the sheet shows, rather than on
 * the form's next render.
 */
async function verifyTypedFields(page, check, expected, observed) {
  const readBy = async (kind, status) => {
    const line = `[data-field-read="${kind}"]`;
    await page
      .waitForFunction(
        ({ line, status }) =>
          JSON.parse(document.querySelector(line)?.textContent ?? 'null')
            ?.status === status,
        { line, status },
        { timeout: 5_000 },
      )
      .catch(() => undefined);
    return JSON.parse((await page.locator(line).textContent()) ?? 'null');
  };
  const typed = async (kind) => {
    const field = page.locator(`[data-field="${kind}"]`);
    const text = expected[`formatLocalizedInput:${kind}`];
    // The field is written once the client has its value, which can land after the sheet is
    // drawn. A field that never shows the text is reported with what it does show.
    await page
      .waitForFunction(
        ({ selector, text }) =>
          document.querySelector(selector)?.value === text,
        { selector: `[data-field="${kind}"]`, text },
        { timeout: 5_000 },
      )
      .catch(() => undefined);
    assert.equal(
      await field.inputValue(),
      text,
      `The LocalizedInput field of @neolorn/equator/forms for ${kind} does not show its value as this engine writes it`,
    );
    await field.fill('');
    assert.notEqual(
      (await readBy(kind, 'incomplete'))?.status,
      'valid',
      `The LocalizedInput field for ${kind} read an empty entry as a value`,
    );
    await field.fill(text);
    assert.deepEqual(
      await readBy(kind, 'valid'),
      { status: 'valid', value: exerciseInputs.controls[kind].value },
      `The LocalizedInput field for ${kind} did not read ${JSON.stringify(text)} as its value`,
    );
  };
  await typed('decimal');
  recordCapabilityClaim(check, 'control:decimal', observed);
  await typed('money');
  recordCapabilityClaim(check, 'control:money', observed);
  await typed('measurement');
  recordCapabilityClaim(check, 'control:measurement', observed);
  await typed('percent');
  recordCapabilityClaim(check, 'control:percent', observed);
  await typed('percentage-points');
  recordCapabilityClaim(check, 'control:percentage-points', observed);
  await typed('plain-date');
  recordCapabilityClaim(check, 'control:plain-date', observed);
  await typed('plain-time');
  recordCapabilityClaim(check, 'control:plain-time', observed);
  await typed('plain-date-time');
  recordCapabilityClaim(check, 'control:plain-date-time', observed);
  await typed('time-zone');
  recordCapabilityClaim(check, 'control:time-zone', observed);
  await typed('duration');
  recordCapabilityClaim(check, 'control:duration', observed);
  await typed('instant');
  recordCapabilityClaim(check, 'control:instant', observed);
  recordCapabilityClaim(check, 'directive:LocalizedInput', observed);
  recordCapabilityClaim(check, 'entry:@neolorn/equator/forms', observed);
}

async function verifyRenderingModes(row, context, diagnostics) {
  const prerenderPath = addresses.path(prerenderedPage, 'en-US');
  const prerenderArtifact = prerenderArtifacts.get(
    `${deploymentOf('en-US').origin}${decodeURIComponent(prerenderPath)}`,
  );
  assert.notEqual(
    prerenderArtifact,
    undefined,
    `${prerenderPath} built prerender artifact is absent`,
  );
  const prerenderPage = boundCalls(await context.newPage(), 'page');
  attachBrowserDiagnostics(prerenderPage, diagnostics);
  prerenderPage.setDefaultTimeout(15_000);
  prerenderPage.setDefaultNavigationTimeout(20_000);
  let prerenderRoot;
  let prerenderRoute;
  const prerenderResponse = await visitFor(
    context,
    prerenderedPage,
    'en-US',
    (url) =>
      navigateWithScriptGate(prerenderPage, url, async () => {
        await prerenderPage.waitForSelector(prerenderedView);
        prerenderRoot = await prerenderPage.$('app-root');
        prerenderRoute = await prerenderPage.$(prerenderedView);
        assert.notEqual(
          prerenderRoot,
          null,
          `${row.label} prerender root is absent`,
        );
        assert.notEqual(
          prerenderRoute,
          null,
          `${row.label} prerender route is absent`,
        );
        assert.equal(
          await prerenderPage.locator('html').getAttribute('data-client-ready'),
          null,
        );
        await holdServerElements(prerenderPage);
      }),
  );
  await assertTrustedTypesPolicy(prerenderPage, prerenderResponse, row);
  assert.equal(
    prerenderResponse.headers()['x-equator-original-document-sha256'],
    prerenderArtifact.digest,
    `${row.label} prerender response did not originate from the built static artifact`,
  );
  await prerenderPage.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );
  assert.equal(
    await prerenderRoot.evaluate(
      (element) => element === document.querySelector('app-root'),
    ),
    true,
    `${row.label} replaced the prerender root`,
  );
  assert.equal(
    await prerenderRoute.evaluate(
      (element, view) => element === document.querySelector(view),
      prerenderedView,
    ),
    true,
    `${row.label} replaced the prerender route`,
  );
  assert.equal(
    await prerenderPage.locator('link[rel="canonical"]').getAttribute('href'),
    addresses.url(prerenderedPage, 'en-US'),
    `${row.label}: the prerendered canonical is not written against the origin provideLocalizedRouter is given`,
  );
  // The image is only in the social block the application's document callback returns, so the
  // head carrying it is that callback's answer and not a default.
  assert.deepEqual(
    await prerenderPage.evaluate(() =>
      [...document.querySelectorAll('meta[property="og:image"]')].map((node) =>
        node.getAttribute('content'),
      ),
    ),
    ['https://site.example/social/preview.png'],
    `${row.label}: the prerendered head does not carry the social block the document callback returns`,
  );
  const prerenderCheck = sectionCheck(row, 'prerender');
  const prerendered = await measuredContext(prerenderPage);
  claimRunningPolicy(prerenderCheck, prerendered);
  recordCapabilityClaim(
    prerenderCheck,
    'declaration:RouteLocalizationOptions.origin',
    prerendered,
  );
  recordCapabilityClaim(
    prerenderCheck,
    'declaration:RouteLocalizationOptions.document',
    prerendered,
  );
  assert.equal(
    (await localeChoice(prerenderPage, 'ar-EG').textContent())?.trim(),
    generatedLocaleNames['ar-EG'],
    `${row.label}: the prerendered choice for ar-EG is not labelled with the name the generated localeNames gives it`,
  );
  recordCapabilityClaim(
    prerenderCheck,
    'declaration:GeneratedConfiguration.localeNames',
    prerendered,
  );
  await localeChoice(prerenderPage, 'ar-EG').click();
  await prerenderPage.waitForURL((url) =>
    isShown(url, prerenderedPage, 'ar-EG'),
  );
  await prerenderPage.waitForFunction(
    () =>
      document.documentElement.lang === 'ar-EG' &&
      document.documentElement.dir === 'rtl',
  );
  recordCapabilityClaim(
    prerenderCheck,
    'directive:LocaleChoice',
    await measuredContext(prerenderPage),
  );
  await collectPolicyDiagnostics(prerenderPage, diagnostics);
  await prerenderPage.goto(
    siteUrl(addresses.shownPath(prerenderedPage, 'ar-EG'), 'ar-EG'),
  );
  await prerenderPage.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );
  assert.equal(
    await prerenderPage.locator(prerenderedArabic.selector).textContent(),
    prerenderedArabic.text,
  );

  const csrPage = boundCalls(await context.newPage(), 'page');
  attachBrowserDiagnostics(csrPage, diagnostics);
  csrPage.setDefaultTimeout(15_000);
  csrPage.setDefaultNavigationTimeout(20_000);
  // The document the page shows, which each claim below observes. A switch that is a document
  // navigation replaces it with another the server answered, and a switch in the document keeps
  // it. The body is asked for as it arrives, while the engine still holds it.
  let shownDocument;
  csrPage.on('response', (response) => {
    const request = response.request();
    if (
      request.resourceType() !== 'document' ||
      request.frame() !== csrPage.mainFrame() ||
      (response.status() >= 300 && response.status() < 400)
    ) {
      return;
    }
    shownDocument = response.text();
    // Read where a claim awaits it, which is where a body the engine no longer holds is reported.
    shownDocument.catch(() => {});
  });
  const csrResponse = await visitFor(context, 'item', 'en-US', (url) =>
    navigateWithScriptGate(csrPage, url, async () => {
      await csrPage.waitForSelector('app-root', { state: 'attached' });
      assert.equal(await csrPage.locator('[data-route-view]').count(), 0);
      assert.equal(
        await csrPage.locator('html').getAttribute('data-client-ready'),
        null,
      );
    }),
  );
  await assertTrustedTypesPolicy(csrPage, csrResponse, row);
  await csrPage.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );
  await csrPage.waitForSelector('[data-route-view="item"]');
  assert.equal(await csrPage.locator('html').getAttribute('lang'), 'en-US');
  assert.equal(await csrPage.locator('html').getAttribute('dir'), 'ltr');

  // Angular answers a route its server table declares `RenderMode.Client` with the application
  // shell and runs nothing on the server for it (`@angular/ssr` 22.1.7, `handleRendering`), so the
  // answer carries no server-context mark and no route, and the route on the page is the browser's.
  const shell = await csrResponse.text();
  assert.doesNotMatch(
    shell,
    /\bng-server-context=/u,
    `${row.label}: item is RenderMode.Client in the table provideLocalizedServerRendering from @neolorn/equator/ssr installs, and the server rendered it`,
  );
  assert.doesNotMatch(
    shell,
    /\bdata-route-view=/u,
    `${row.label}: the shell the server answered for item already shows a route`,
  );
  const shellRender = await clientRenderContext(csrPage, shell);
  assert.equal(
    shellRender.platform,
    'browser',
    `${row.label}: item was drawn on the ${shellRender.platform} platform`,
  );
  // No engine: the table and the response headers are the server's, and the engine only drew the
  // shell they shaped.
  const shellAnswered = {
    platform: shellRender.platform,
    document: shellRender.document,
    policy: shellRender.policy,
  };
  const shellCheck = sectionCheck(row, 'client render shell');
  recordCapabilityClaim(
    shellCheck,
    'feature:provideLocalizedServerRendering',
    shellAnswered,
  );
  recordCapabilityClaim(
    shellCheck,
    'entry:@neolorn/equator/ssr',
    shellAnswered,
  );
  // item declares no caching class, so what its shell carries is the deployment's: the pageCaching
  // floor where the table says it declares one, and otherwise, where the address states its locale,
  // the shared directive, which asks a cache to revalidate a stale success unless the deployment
  // declares revalidateSuccess false.
  const shellCaching = csrResponse.headers()['cache-control'];
  if (addresses.pageCaching !== undefined) {
    assert.equal(
      shellCaching,
      addresses.pageCaching === 'not-stored'
        ? 'private, no-store'
        : 'private, no-cache',
      `${row.label}: the shell answered for item was not raised to the ${addresses.pageCaching} pageCaching floor`,
    );
    recordCapabilityClaim(
      shellCheck,
      'declaration:host-page-floor',
      shellAnswered,
    );
  } else if (addresses.localeInPath) {
    assert.equal(
      shellCaching,
      declaresNoRevalidation
        ? 'public, max-age=600'
        : 'public, max-age=600, must-revalidate',
      `${row.label}: the shell answered for item is not the shared answer revalidateSuccess ${declaresNoRevalidation ? 'false' : 'left to its default'} gives`,
    );
    if (declaresNoRevalidation) {
      recordCapabilityClaim(
        shellCheck,
        'declaration:RouteCacheDurations.revalidateSuccess',
        shellAnswered,
      );
    }
  }

  // The server sent this page's shell with the application's own head, so the head documentMetadata
  // declares for `item` is one only the browser writes.
  const itemHead = async (locale) => {
    const title = await readCatalogMessage(
      consumerRoot,
      locale,
      'document.item.title',
    );
    // A title the render never writes is a wrong head, not a slow one, so the wait's end is read
    // as an answer and the assertion below says which.
    await csrPage
      .waitForFunction((expected) => document.title === expected, title)
      .catch(() => undefined);
    assert.equal(
      await csrPage.title(),
      title,
      `the title the client render of item wrote in ${locale} is not the one documentMetadata declares`,
    );
    assert.equal(
      await csrPage.locator('meta[name="description"]').getAttribute('content'),
      await readCatalogMessage(
        consumerRoot,
        locale,
        'document.item.description',
      ),
      `the description the client render of item wrote in ${locale} is not the one documentMetadata declares`,
    );
    recordCapabilityClaim(
      sectionCheck(row, `client render head in ${locale}`),
      'declaration:document-metadata',
      await clientRenderContext(csrPage, await shownDocument),
    );
  };
  await itemHead('en-US');

  const beforeSwitch = await inlineSourceCensus(csrPage);

  await localeChoice(csrPage, 'ar-EG').click();
  await csrPage
    .waitForURL((url) => isShown(url, 'item', 'ar-EG'))
    .catch(() => undefined);
  assert.equal(
    new URL(csrPage.url()).pathname,
    addresses.shownPath('item', 'ar-EG'),
    'the switch did not move item to the path localizedPaths gives it in ar-EG',
  );
  recordCapabilityClaim(
    sectionCheck(row, 'client render switch'),
    'declaration:localized-paths',
    await clientRenderContext(csrPage, await shownDocument),
  );
  await csrPage.waitForFunction(
    () =>
      document.documentElement.lang === 'ar-EG' &&
      document.documentElement.dir === 'rtl',
  );
  recordCapabilityClaim(
    sectionCheck(row, 'client render'),
    'directive:LocaleChoice',
    await clientRenderContext(csrPage, await shownDocument),
  );
  await itemHead('ar-EG');

  // A locale switch re-renders every localized surface on the page. If Equator emitted inline
  // script or style anywhere in that path, it would appear here, and it would be
  // invisible to the violation count, because this harness's policy carries hashes and a nonce
  // that a strict deployed policy does not.
  //
  // Only a switch made in the document re-renders anything. One that is a document navigation
  // arrives at a new document, which the policy violations collected below already cover.
  if (addresses.switchInDocument) {
    assertNoInlineSourceAdded(
      beforeSwitch,
      await inlineSourceCensus(csrPage),
      'A locale switch',
    );
  }

  await collectPolicyDiagnostics(prerenderPage, diagnostics);
  await collectPolicyDiagnostics(csrPage, diagnostics);
  await prerenderPage.close();
  await csrPage.close();

  await verifyClientRenderedSheet(row, context, diagnostics);
}

/**
 * A declared outcome at a route the browser draws. The item page is RenderMode.Client, so the
 * server has no page that could declare for itself, and `server.ts` declares what became of two
 * items with the application shell as the document. The response carries the declared outcome, the
 * shell arrives as the one the item page is always answered with, and the browser draws the page
 * from it (section 5 of `specs/07-routing-rendering-and-seo.spec.md`).
 *
 * The shells are compared as the application answered them, asked of it directly, because the edge
 * these browsers load through adds its own nonce and style to every document.
 */
async function verifyDeclaredShells(row, context, diagnostics) {
  const locale = 'en-US';
  // The installed core, whose descriptor the request handler composes each response with.
  const { pageGone, pageOperationalFailure, pageOutcomeHttpDescriptor } =
    await import(
      pathToFileURL(
        resolve(
          consumerRoot,
          'node_modules/@neolorn/equator/fesm2022/neolorn-equator-core.mjs',
        ),
      ).href
    );
  const item = await answer(addresses.path('item', locale), { locale });
  assert.equal(item.status, 200, `${row.label}: item was not answered`);
  const shell = await item.text();
  assert.doesNotMatch(
    shell,
    /\bng-server-context=/u,
    `${row.label}: item is RenderMode.Client, and the server rendered it`,
  );
  // What the address resolved to on its own, which each declaration is composed onto.
  const resolved = {
    status: item.status,
    contentLanguage: item.headers.get('content-language') ?? undefined,
    robots: item.headers.get('x-robots-tag') ?? undefined,
  };

  const drawn = async (outcomePage, declaration, declared) => {
    const check = sectionCheck(row, `${outcomePage}, drawn by the browser`);
    const described = pageOutcomeHttpDescriptor(declaration, resolved);
    const direct = await answer(addresses.path(outcomePage, locale), {
      locale,
    });
    assert.equal(
      direct.status,
      described.status,
      `${check}: server.ts declared ${declared} with the application shell, and the application answered ${direct.status}`,
    );
    assert.equal(
      await direct.text(),
      shell,
      `${check}: the shell sent with ${declared} is not the shell item is answered with, so something was written into it`,
    );

    const page = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(page, diagnostics);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    const response = await visitFor(context, outcomePage, locale, (url) => {
      expectedErrorDocuments.add(url);
      return navigateWithScriptGate(page, url, async () => {
        await page.waitForSelector('app-root', { state: 'attached' });
        assert.equal(
          await page.locator('[data-route-view]').count(),
          0,
          `${check}: the page shows a route before its scripts run`,
        );
      });
    });
    const fields = response?.headers() ?? {};
    assert.deepEqual(
      {
        status: response?.status(),
        contentLanguage: fields['content-language'],
        robots: fields['x-robots-tag'],
        cacheControl: fields['cache-control'],
      },
      {
        status: described.status,
        contentLanguage: described.contentLanguage,
        robots: described.robots,
        cacheControl: 'private, no-store',
      },
      `${check}: the answer is not the response pageOutcomeHttpDescriptor describes for ${declared} at an address that resolved to item`,
    );
    const answered = await response.text();
    assert.doesNotMatch(
      answered,
      /\bng-server-context=/u,
      `${check}: the route is RenderMode.Client, and the server rendered it`,
    );
    await page.waitForSelector('[data-route-view="item"]');
    const rendered = await clientRenderContext(page, answered);
    assert.equal(
      rendered.platform,
      'browser',
      `${check}: drawn on the ${rendered.platform} platform`,
    );
    await collectPolicyDiagnostics(page, diagnostics);
    await page.close();
    // No engine: the status and the fields are the server's, and the engine only drew the shell
    // they came with.
    return {
      check,
      fields,
      observed: {
        platform: rendered.platform,
        document: rendered.document,
        policy: rendered.policy,
      },
    };
  };

  const withdrawn = await drawn(
    'withdrawn item',
    pageGone(),
    'declarePageOutcome(pageGone())',
  );
  recordCapabilityClaim(
    withdrawn.check,
    'outcome:declarePageOutcome',
    withdrawn.observed,
  );
  recordCapabilityClaim(
    withdrawn.check,
    'outcome:pageOutcomeHttpDescriptor',
    withdrawn.observed,
  );

  const unreachable = await drawn(
    'unreachable item',
    pageOperationalFailure(503),
    'declareOperationalFailure with a 503',
  );
  assert.equal(
    unreachable.fields['retry-after'],
    '120',
    `${unreachable.check}: the Retry-After the declared failure carried did not reach the response`,
  );
  recordCapabilityClaim(
    unreachable.check,
    'outcome:declareOperationalFailure',
    unreachable.observed,
  );
  recordCapabilityClaim(
    unreachable.check,
    'outcome:pageOutcomeHttpDescriptor',
    unreachable.observed,
  );
}

/**
 * The scopes `app.config.ts` names for a route, on pages the browser adopts.
 *
 * The root component shows on every page whether the lazy page's scope is ready. The exercise
 * route names it in `requiredScopes` and the dossier route names it in `progressiveScopes`, and
 * neither route's own code asks for it, so on each the page says whether the option was honoured.
 * A page the browser adopts is its first render, with no earlier view to keep on screen, so the
 * progressive scope is ready there as the required one is (section 9 of
 * `specs/06-runtime-and-angular.spec.md`). Home names the scope nowhere and is the control.
 *
 * The dossier is then reached by the router from home, where the scope is idle. A coordinated
 * navigation waits for the scope and a progressive one lands first and the scope follows, so in
 * both the page is given until its deadline to show it ready.
 *
 * Read once the page has settled, so what is read is what the browser's own runtime holds and not
 * only the text the server wrote.
 */
async function verifyNamedRouteScopes(row, context, diagnostics) {
  const locale = 'en-US';
  const adopted = async (routePage, view) => {
    const page = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(page, diagnostics);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    await visitFor(context, routePage, locale, (url) =>
      navigateWithScriptGate(page, url, async () => {
        await page.waitForSelector(`[data-route-view="${view}"]`, {
          state: 'attached',
        });
        await holdServerElements(page);
      }),
    );
    const observed = await measuredContext(page);
    assert.ok(
      observed.adoptedElements > 0,
      `${row.label} kept none of the ${routePage} page's server elements`,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset['settled'] === 'true',
    );
    const readiness = (
      await page.locator('[data-lazy-readiness]').textContent()
    )?.trim();
    const changeMode = (
      await page.locator('[data-change-mode]').textContent()
    )?.trim();
    await collectPolicyDiagnostics(page, diagnostics);
    await page.close();
    return { observed, readiness, changeMode };
  };

  const home = await adopted('home', 'home');
  assert.equal(
    home.readiness,
    'idle',
    `${row.label}: home names the lazy scope in no option and its route table entry lists none, and the adopted page does not show it idle`,
  );

  const sheet = await adopted('exercise', 'exercise');
  assert.equal(
    sheet.readiness,
    'ready',
    `${row.label}: requiredScopes names the lazy scope for the exercise route, and the adopted sheet shows it ${sheet.readiness}`,
  );
  recordCapabilityClaim(
    sectionCheck(row, 'a required scope, adopted'),
    'declaration:RouteLocalizationOptions.requiredScopes',
    sheet.observed,
  );

  // The mode the adopted page's own navigation ran its locale transaction in, which the root
  // component shows once the browser has made that navigation. `route-transitions.ts` declares it,
  // and the address table names it where a row declares one other than the default, so only there
  // does the page show the option, and only there is it claimed.
  const declaredMode = addresses.navigationMode ?? 'coordinated';
  assert.equal(
    sheet.changeMode,
    declaredMode,
    `${row.label}: route-transitions.ts declares mode ${declaredMode}, and the navigation the browser made on the adopted sheet ran in ${sheet.changeMode}`,
  );
  if (addresses.navigationMode !== undefined) {
    recordCapabilityClaim(
      sectionCheck(row, 'the declared mode, adopted'),
      'declaration:RouteLocalizationOptions.mode',
      sheet.observed,
    );
  }

  const dossier = await adopted('dossier', 'dossier');
  assert.equal(
    dossier.readiness,
    'ready',
    `${row.label}: progressiveScopes names the lazy scope for the dossier route, the adopted page is a first render with no earlier view, and it shows the scope ${dossier.readiness}`,
  );
  recordCapabilityClaim(
    sectionCheck(row, 'a progressive scope, adopted'),
    'declaration:RouteLocalizationOptions.progressiveScopes',
    dossier.observed,
  );

  const navigated = boundCalls(await context.newPage(), 'page');
  attachBrowserDiagnostics(navigated, diagnostics);
  navigated.setDefaultTimeout(15_000);
  await visitFor(context, 'home', locale, (url) => navigated.goto(url));
  await navigated.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );
  const readinessShown = async () =>
    (await navigated.locator('[data-lazy-readiness]').textContent())?.trim();
  assert.equal(
    await readinessShown(),
    'idle',
    `${row.label}: home names the lazy scope in no option, and before the client navigation the page does not show it idle`,
  );
  await throughHistory(navigated, addresses.shownPath('dossier', locale));
  await navigated.waitForSelector('[data-route-view="dossier"]', {
    state: 'attached',
  });
  // A scope that never arrives ends the wait at the page's deadline, and the assertion below names
  // what was shown.
  await navigated
    .waitForFunction(
      () =>
        document.querySelector('[data-lazy-readiness]')?.textContent?.trim() ===
        'ready',
    )
    .catch(() => undefined);
  const reached = await readinessShown();
  assert.equal(
    reached,
    'ready',
    `${row.label}: progressiveScopes names the lazy scope for the dossier route, a client navigation in ${declaredMode} mode reached it from home, and the page shows the scope ${reached}`,
  );
  const { engine, policy, clientNavigations } =
    await measuredContext(navigated);
  assert.ok(
    clientNavigations > 0,
    `${row.label} reached the dossier without a client navigation`,
  );
  recordCapabilityClaim(
    sectionCheck(row, 'a progressive scope by client navigation'),
    'declaration:RouteLocalizationOptions.progressiveScopes',
    { engine, policy, clientNavigations },
  );
  await collectPolicyDiagnostics(navigated, diagnostics);
  await navigated.close();
}

/**
 * The exercise sheet as a client render draws it, in each locale the build serves: the server
 * answers its route with the application shell, and every line is held to what this engine's own
 * formatters write, as the other sheets are.
 */
async function verifyClientRenderedSheet(row, context, diagnostics) {
  for (const locale of builtLocales) {
    if (!addresses.has('drawn sheet', locale)) continue;
    const page = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(page, diagnostics);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    const check = sectionCheck(
      row,
      `exercise sheet in ${locale}, rendered by the browser`,
    );
    const answered = await visitFor(context, 'drawn sheet', locale, (url) =>
      navigateWithScriptGate(page, url, async () => {
        await page.waitForSelector('app-root', { state: 'attached' });
        assert.equal(
          await page.locator('[data-route-view]').count(),
          0,
          `${check}: the page shows a route before its scripts run`,
        );
      }),
    );
    const shell = await answered.text();
    assert.doesNotMatch(
      shell,
      /\bng-server-context=/u,
      `${check}: the route is RenderMode.Client, and the server rendered it`,
    );
    const sheet = await exerciseSheetOn(page);
    assert.equal(sheet.locale, locale, `${check} shows ${sheet.locale}`);
    const rendered = await clientRenderContext(page, shell);
    assert.equal(
      rendered.platform,
      'browser',
      `${check}: drawn on the ${rendered.platform} platform`,
    );
    // Nothing was adopted and the page is the document's own navigation, so the claims observe the
    // render and nothing that follows one.
    const { engine, policy, platform, document } = rendered;
    // The route raises its shell to per visitor, which no row's floor or policy lowers.
    assert.equal(
      answered.headers()['cache-control'],
      addresses.pageCaching === 'not-stored'
        ? 'private, no-store'
        : 'private, no-cache',
      `${check}: the route declares equatorCaching per-visitor, and a shared cache may keep the shell the @neolorn/equator/http handler answered for it`,
    );
    recordCapabilityClaim(check, 'entry:@neolorn/equator/http', {
      platform,
      document,
      policy,
    });
    // Read once, as the exercise sheets read it: a locator would wait for a missing tag and report
    // the wait rather than the declaration.
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content') ?? null,
      ),
      'noindex',
      `${check}: the route declares equatorIndexing non-indexable, and the head the browser wrote does not keep it out of an index`,
    );
    recordCapabilityClaim(check, 'declaration:route-indexing-class', {
      engine,
      policy,
      platform,
      document,
    });
    // Only where the address states its locale and no floor is declared is the shell otherwise
    // shared, so only there is the class what made it private. No engine: the header is the
    // server's.
    if (addresses.localeInPath && addresses.pageCaching === undefined) {
      recordCapabilityClaim(check, 'declaration:route-caching-class', {
        platform,
        document,
        policy,
      });
    }
    await holdSheetToAuthority(page, check, sheet, locale, {
      engine,
      policy,
      platform,
      document,
    });
    await collectPolicyDiagnostics(page, diagnostics);
    await page.close();
  }
}

/**
 * Inline `<script>` and `<style>` elements currently in the document.
 *
 * The strict policy this harness serves allows the inline content Angular and the harness itself
 * need, through a nonce on `<app-root>` and sha256 hashes computed from the served HTML. The
 * strictest policy a consumer realistically deploys carries neither: plain `script-src 'self'`
 * and `style-src 'self'`, with no hashes and no nonce.
 *
 * So "zero CSP violations" alone does not establish that Equator is safe under such a policy: the
 * allowances could be covering Equator's own output. What settles it is that Equator's runtime work
 * adds none: whatever inline content exists is present at load, and boot, hydration and a locale
 * switch introduce nothing further.
 */
async function inlineSourceCensus(page) {
  return await page.evaluate(() => ({
    scripts: document.querySelectorAll('script:not([src])').length,
    styles: document.querySelectorAll('style').length,
    styleAttributes: document.querySelectorAll('[style]').length,
  }));
}

function assertNoInlineSourceAdded(before, after, label) {
  assert.equal(
    after.scripts,
    before.scripts,
    `${label} added an inline <script> at runtime, which a bare script-src 'self' rejects`,
  );
  assert.equal(
    after.styles,
    before.styles,
    `${label} added an inline <style> at runtime, which a bare style-src 'self' rejects`,
  );
  assert.equal(
    after.styleAttributes,
    before.styleAttributes,
    `${label} added an inline style attribute at runtime, which style-src-attr 'none' rejects`,
  );
}

async function settleBrowserLifecycle(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[aria-busy="true"]').length === 0 &&
      document
        .querySelector('[data-dynamic-content]')
        ?.getAttribute('data-participant-status') === 'ready',
  );
  await page.evaluate(
    () =>
      new Promise((resolveSettle) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setTimeout(resolveSettle, 0));
        });
      }),
  );
}

async function readLifecycleResourceSnapshot(page) {
  return page.evaluate(() => ({
    activeAnimations: document
      .getAnimations()
      .filter((animation) => animation.playState !== 'finished').length,
    announcer: document.querySelectorAll('[data-equator-announcer]').length,
    busy: document.querySelectorAll('[aria-busy="true"]').length,
    canonical: document.querySelectorAll('link[rel="canonical"]').length,
    domElements: document.querySelectorAll('*').length,
    form: document.querySelectorAll('[data-localized-form]').length,
    main: document.querySelectorAll('main').length,
    participantReady: document.querySelectorAll(
      '[data-dynamic-content][data-participant-status="ready"]',
    ).length,
    resources: performance
      .getEntriesByType('resource')
      .map((entry) => {
        const url = new URL(entry.name);
        return `${entry.initiatorType}:${url.pathname}`;
      })
      .sort(),
    root: document.querySelectorAll('app-root').length,
    stylesheets: document.styleSheets.length,
  }));
}

async function commitEnduranceLocale(page, arabic, expectedSourceRequests) {
  const selector = arabic
    ? '[data-locale-choice="ar-EG"]'
    : '[data-locale-choice="en-US"]';
  const locale = arabic ? 'ar-EG' : 'en-US';
  const direction = arabic ? 'rtl' : 'ltr';
  const pathname = addresses.shownPath('home', locale);
  await page.locator(selector).click();
  await page.waitForURL((url) => url.pathname === pathname);
  await page.waitForFunction(
    ({ direction: expectedDirection, locale: expectedLocale }) =>
      document.documentElement.lang === expectedLocale &&
      document.documentElement.dir === expectedDirection,
    { direction, locale },
  );
  await page.waitForFunction(
    (expectedLocale) =>
      document.querySelector('[data-dynamic-article]')?.getAttribute('lang') ===
      expectedLocale,
    locale,
  );
  await page.waitForFunction(
    (expected) =>
      Number(
        document
          .querySelector('[data-dynamic-content]')
          ?.getAttribute('data-source-requests'),
      ) === expected,
    expectedSourceRequests,
  );
  await settleBrowserLifecycle(page);
  assert.equal(
    await page.locator(selector).getAttribute('aria-current'),
    'true',
  );
  assert.equal(await page.locator(selector).getAttribute('aria-busy'), null);
}

async function verifySwitchEndurance(page, row) {
  // Endurance is of switches made in the document. Where each switch is a document navigation it
  // starts a page afresh, so there is nothing for repeated switches to accumulate.
  if (!addresses.switchInDocument) return;
  const requestIds = new Set();
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (let batch = 0; batch < 3; batch += 1) {
    await visitFor(page.context(), 'home', 'en-US', (url) =>
      page.goto(
        `${url}?label=${encodeURIComponent(`${row.id}-endurance-${batch}`)}`,
      ),
    );
    await page.waitForFunction(
      () => document.documentElement.dataset['clientReady'] === 'true',
    );
    assert.equal(
      await page.evaluate(
        () => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
      true,
    );
    assert.equal(
      page.context().pages().length,
      1,
      `${row.label} retained a page from an earlier lifecycle batch`,
    );
    const requestId = await page
      .locator('[data-ssr-probe]')
      .getAttribute('data-request-id');
    assert.notEqual(requestId, null, `${row.label} request identity is absent`);
    assert.equal(
      requestIds.has(requestId),
      false,
      `${row.label} reused an SSR request identity across lifecycle batches`,
    );
    requestIds.add(requestId);

    let sourceRequests = Number(
      await page
        .locator('[data-dynamic-content]')
        .getAttribute('data-source-requests'),
    );
    sourceRequests += 1;
    await commitEnduranceLocale(page, true, sourceRequests);
    // Each locale is held to its own first state, because a page may carry a head element in one
    // locale and not the other, as the social alternates do where only one locale has an address.
    // A leak still shows, as either state growing.
    const arabicBaseline = await readLifecycleResourceSnapshot(page);
    sourceRequests += 1;
    await commitEnduranceLocale(page, false, sourceRequests);
    const settledBaseline = await readLifecycleResourceSnapshot(page);
    for (const baseline of [arabicBaseline, settledBaseline]) {
      assert.equal(baseline.activeAnimations, 0);
      assert.equal(baseline.busy, 0);
      assert.equal(baseline.participantReady, 1);
    }

    for (let index = 0; index < 8; index += 1) {
      sourceRequests += 1;
      const arabic = index % 2 === 0;
      await commitEnduranceLocale(page, arabic, sourceRequests);
      assert.deepEqual(
        await readLifecycleResourceSnapshot(page),
        arabic ? arabicBaseline : settledBaseline,
        `${row.label} lifecycle/resources did not settle in batch ${batch}, switch ${index}`,
      );
    }
  }
  assert.equal(requestIds.size, 3);
}

/**
 * A page restored from the back-forward cache after the stored locale moved, which is the one reuse
 * that does not ask the server (`specs/07-routing-rendering-and-seo.spec.md` section 5).
 *
 * Under Playwright only Chromium restores a page, and only in its new headless mode with
 * Playwright's own `--disable-back-forward-cache` switch left off, so it gets a browser of its own
 * here and the pass before it keeps Playwright's defaults. Playwright turns the cache off in its
 * Firefox and WebKit builds, so there a `pageshow` is dispatched as a restore dispatches it: that
 * runs the listener in the engine, and proves nothing about a restore, which the success line says.
 */
async function verifyBackForwardRestore(row, context, diagnostics) {
  const restores = row.id === 'chromium';
  const restoreBrowser = restores
    ? await launchBrowserRow(row, {
        channel: 'chromium',
        ignoreDefaultArgs: ['--disable-back-forward-cache'],
        // Through the edge under every policy, which keeps this build's own requests to other
        // hosts on the machine.
        proxy: { server: browserOrigin },
      })
    : undefined;
  try {
    const restoreContext =
      restoreBrowser === undefined
        ? context
        : boundCalls(await restoreBrowser.newContext(), 'context');
    if (restoreBrowser !== undefined) {
      await recordPolicyViolations(restoreContext);
    }
    const restorePage = boundCalls(await restoreContext.newPage(), 'page');
    attachBrowserDiagnostics(restorePage, diagnostics);
    restorePage.setDefaultTimeout(15_000);
    restorePage.setDefaultNavigationTimeout(20_000);
    await visitFor(restoreContext, 'home', 'en-US', (url) =>
      restorePage.goto(url),
    );
    await restorePage.waitForFunction(
      () => document.documentElement.dataset['clientReady'] === 'true',
    );
    // Moved by the router first, so the address the page comes back to is one the client wrote,
    // which is the one a reader leaves from once they have used the page. The second page, because
    // every policy here spells it in a way that states a locale exactly where the home page's does.
    await restorePage.locator('[data-route-link="second"]').click();
    await restorePage.waitForURL((url) => isShown(url, 'second', 'en-US'));
    await restorePage.waitForFunction(
      () => document.documentElement.dataset['clientNavigations'] === '1',
    );
    // Marks the document, so a reload cannot pass for the page coming back from memory.
    await restorePage.evaluate(() => {
      globalThis.__equatorLeft = true;
      globalThis.addEventListener('pageshow', (event) => {
        globalThis.__equatorShownPersisted = event.persisted;
      });
    });
    if (restores) {
      // Left for a document at another address, so the history entry the page is at stays its own.
      await visitFor(restoreContext, 'home', 'en-US', (url) =>
        restorePage.goto(url),
      );
      await restorePage.waitForFunction(
        () => document.documentElement.dataset['clientReady'] === 'true',
      );
    }
    // The stored locale moves while the page is away, as another tab moves it. Stored for the
    // session, because a write always states a lifetime, so a write cannot pass for the cookie left
    // alone.
    const storedAt = new URL(restorePage.url()).origin;
    await restoreContext.clearCookies({ name: 'equator-locale' });
    await restoreContext.addCookies([
      { name: 'equator-locale', value: 'ar-EG', url: storedAt },
    ]);
    if (restores) {
      // A restored page fires `pageshow` and no `load`, so the step back is waited for only as far
      // as the commit, and then for either the restored page's `pageshow` or a new document.
      await restorePage.goBack({ waitUntil: 'commit' });
      await restorePage.waitForFunction(
        () =>
          globalThis.__equatorShownPersisted !== undefined ||
          globalThis.__equatorLeft !== true,
      );
    } else {
      await restorePage.evaluate(() =>
        globalThis.dispatchEvent(
          new PageTransitionEvent('pageshow', { persisted: true }),
        ),
      );
    }
    await restorePage.waitForFunction(
      () => document.documentElement.dataset['clientReady'] === 'true',
    );
    assert.deepEqual(
      await restorePage.evaluate(() => ({
        left: globalThis.__equatorLeft === true,
        persisted: globalThis.__equatorShownPersisted === true,
      })),
      { left: true, persisted: true },
      `${row.label} did not bring the page back from its back-forward cache, so nothing here reached the listener`,
    );
    // Where the address states the locale the address decides, and the page stays in it; where it
    // does not the stored locale decides, and the page moves to the one stored since it was left.
    const decides = addresses.localeInAddress ? 'url' : 'stored';
    const expected = decides === 'url' ? 'en-US' : 'ar-EG';
    if (expected === 'en-US') {
      await settleBrowserLifecycle(restorePage);
    } else {
      await restorePage
        .waitForFunction(
          () =>
            document.documentElement.lang === 'ar-EG' &&
            document.documentElement.dir === 'rtl',
          undefined,
          { timeout: 10_000 },
        )
        .catch(() => {});
    }
    assert.equal(
      await restorePage.evaluate(() => document.documentElement.lang),
      expected,
      `${row.label} showed a restored page in the wrong locale after the one withPersistence reads from its cookieStore moved to ar-EG`,
    );
    assert.deepEqual(
      (await restoreContext.cookies(storedAt))
        .filter(({ name }) => name === 'equator-locale')
        .map(({ value, expires }) => ({ value, expires })),
      [{ value: 'ar-EG', expires: -1 }],
      `${row.label} wrote the locale cookie on a restore, which resolves a locale rather than choosing one`,
    );
    const observed = await measuredContext(restorePage);
    const check = sectionCheck(row, 'back-forward restore');
    if (decides === 'url') {
      recordCapabilityClaim(check, 'source:url', observed);
    } else {
      recordCapabilityClaim(check, 'source:stored', observed);
      recordCapabilityClaim(check, 'feature:withPersistence', observed);
      recordCapabilityClaim(check, 'store:cookieStore', observed);
    }
    await collectPolicyDiagnostics(restorePage, diagnostics);
    await restorePage.close();
    return restores ? 'restored' : 'dispatched';
  } finally {
    await restoreBrowser?.close();
  }
}

/**
 * Which source decides a visit in this engine, arranged as the consumer stage arranges it: each
 * visit lands in a locale only one source could have named. The context's locale is the visitor's
 * languages, which the engine states both in `navigator.languages` and in the Accept-Language header
 * of every request, so the server and the client hear the same preference.
 *
 * The address decides at the exercise sheet's Arabic address. The others can decide only where an
 * address names no locale, which is the root under a policy that sends it on to a locale and under
 * one that renders it in any locale.
 */
async function verifyLocaleSources(row, diagnostics) {
  const entry =
    addresses.entryRedirects || !addresses.localeInAddress ? '/' : undefined;
  const visits = [
    {
      source: 'url',
      url: siteUrl(addresses.path('exercise', 'ar-EG'), 'ar-EG'),
      languages: 'en-US',
      cookie: 'en-US',
      lands: 'ar-EG',
    },
    ...(entry === undefined
      ? []
      : [
          {
            source: 'stored',
            languages: 'en-US',
            cookie: 'ar-EG',
            lands: 'ar-EG',
          },
          { source: 'browser', languages: 'ar-EG', lands: 'ar-EG' },
          // A language this consumer does not support, so the visitor's languages decline too.
          { source: 'default', languages: 'ja', lands: 'en-US' },
        ].map((visit) => ({ ...visit, url: siteUrl(entry) }))),
  ];
  const observed = new Map();
  for (const { source, url, languages, cookie, lands } of visits) {
    const visitContext = boundCalls(
      await browser.newContext({ locale: languages }),
      'context',
    );
    try {
      await recordPolicyViolations(visitContext);
      if (cookie !== undefined) {
        await visitContext.addCookies([
          { name: 'equator-locale', value: cookie, url: new URL(url).origin },
        ]);
      }
      const visitPage = boundCalls(await visitContext.newPage(), 'page');
      attachBrowserDiagnostics(visitPage, diagnostics);
      visitPage.setDefaultTimeout(15_000);
      visitPage.setDefaultNavigationTimeout(20_000);
      await visitPage.goto(url);
      const context = await measuredContext(visitPage);
      // Past the second reading of the stores, which could otherwise move the page after this
      // looked.
      await visitPage.waitForFunction(
        () => document.documentElement.dataset['settled'] === 'true',
      );
      assert.equal(
        await visitPage.evaluate(() => document.documentElement.lang),
        lands,
        `${row.label}: the ${source} source did not decide ${lands} at ${url}, visited in ${languages} with ${cookie === undefined ? 'nothing' : cookie} stored`,
      );
      await collectPolicyDiagnostics(visitPage, diagnostics);
      observed.set(source, context);
    } finally {
      await visitContext.close();
    }
  }
  const check = sectionCheck(row, 'locale sources');
  recordCapabilityClaim(check, 'source:url', observed.get('url'));
  if (entry === undefined) return;
  recordCapabilityClaim(check, 'source:stored', observed.get('stored'));
  recordCapabilityClaim(check, 'source:browser', observed.get('browser'));
  recordCapabilityClaim(check, 'source:default', observed.get('default'));
}

/**
 * The first document, rendered by the server and adopted by the client. Scripts wait until the
 * server's markup has been read, so what the client kept can be told from what it replaced.
 */
async function verifyHydration(row, page, releaseScripts, events) {
  enterStage(`${row.id}-hydration-navigation`);
  const navigation = page.goto(
    siteUrl(`${addresses.path('home', 'en-US')}?label=hydration-request`),
    {
      waitUntil: 'load',
    },
  );
  await page.waitForSelector(
    '[data-ssr-probe][data-label="hydration-request"]',
    { state: 'attached' },
  );

  const rootBefore = await page.$('app-root');
  const headingBefore = await page.$('h1');
  const probeBefore = await page.$('[data-ssr-probe]');
  assert.notEqual(rootBefore, null, 'SSR root is absent before hydration');
  assert.notEqual(
    headingBefore,
    null,
    'SSR heading is absent before hydration',
  );
  assert.notEqual(probeBefore, null, 'SSR probe is absent before hydration');
  assert.equal(
    await page.locator('html').getAttribute('data-client-ready'),
    null,
  );
  await holdServerElements(page);

  enterStage(`${row.id}-hydration-adoption`);
  releaseScripts();
  const hydrationResponse = await navigation;
  const trustedTypes = await assertTrustedTypesPolicy(
    page,
    hydrationResponse,
    row,
  );
  await page.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );

  assert.equal(
    await page.locator('html').getAttribute('data-transfer-source'),
    'server-transfer',
  );
  assert.equal(
    await rootBefore.evaluate(
      (element) => element === document.querySelector('app-root'),
    ),
    true,
    'Hydration replaced the root element',
  );
  assert.equal(
    await headingBefore.evaluate(
      (element) => element === document.querySelector('h1'),
    ),
    true,
    'Hydration replaced the localized heading',
  );
  assert.equal(
    await probeBefore.evaluate(
      (element) => element === document.querySelector('[data-ssr-probe]'),
    ),
    true,
    'Hydration replaced the transferred snapshot element',
  );
  assert.equal(
    await page.locator('[data-ssr-probe]').getAttribute('data-source'),
    'server-transfer',
  );
  assert.equal(
    await page.locator('[data-ssr-probe]').getAttribute('data-label'),
    'hydration-request',
  );
  assert.equal(
    await page
      .locator('[data-dynamic-content]')
      .getAttribute('data-source-requests'),
    '0',
    'Hydration reacquired consumer payload instead of adopting its own transfer',
  );
  assert.equal(
    await page.locator('[data-dynamic-title]').textContent(),
    'The Equator localization handbook',
  );
  assert.equal(
    await page
      .locator('[data-dynamic-content]')
      .getAttribute('data-participant-status'),
    'ready',
  );
  assert.match(
    await page.locator('localized-message[data-rich-message]').textContent(),
    /Read the guide/u,
  );
  assert.equal(await page.locator('[data-inert-text] img').count(), 0);

  const adopted = await measuredContext(page);
  recordCapabilityClaim(
    sectionCheck(row, 'hydration'),
    'directive:LocalizedMessage',
    adopted,
  );
  claimLoggedHandOver(
    sectionCheck(row, 'hydration'),
    loggedEvents(events.join('\n')),
    'en-US',
    adopted,
  );
  return trustedTypes;
}

/**
 * The scripts in a build that are catalog modules, by the address they are served at.
 *
 * A catalog module is told from any other script by the one name the generated loaders read from
 * it, since its file name is a content hash. It is read from the files rather than from the answer
 * in the page, because reading an answer there takes a second request, and under a policy that puts
 * each locale on an origin of its own that request leaves through the browser's proxy and reaches
 * nothing.
 */
async function catalogModulesOf(browserRoot) {
  const modules = new Set();
  for (const name of await readdir(browserRoot, { recursive: true })) {
    if (extname(name) !== '.js') continue;
    const body = await readFile(resolve(browserRoot, name), 'utf8');
    if (/export\s*\{[^}]*\bas compiledCatalog\b/u.test(body)) {
      modules.add(`/${name.split(sep).join('/')}`);
    }
  }
  return modules;
}

/**
 * What a visitor reads when no catalog loads at all, and where its retry leads. Every catalog
 * module answers 503, which is how a bad deploy or an outage reaches a browser, and the page shows
 * the sentence withRecoveryMessage selects, in the page's locale, until the retry brings the
 * catalogs back.
 *
 * The retry is Equator's either way, and how it reaches the catalog is the engine's. The HTML
 * standard drops a module whose fetch failed, so an engine that follows it fetches the catalog
 * again and the page recovers where it stands. An engine that still keeps the failure answers the
 * import with it and sends nothing; the attempt then fails with a reason the application reads, and
 * this one reloads the document on it. Which of the two happened is read from the network, so each
 * is held to its own end.
 */
async function verifyRecovery(row, context) {
  const locale = 'ar-EG';
  const catalogModules = await catalogModulesOf(
    deploymentOf(locale).browserRoot,
  );
  assert.ok(
    catalogModules.size > 0,
    `No script in the ${locale} build exports a compiled catalog`,
  );
  const page = boundCalls(await context.newPage(), 'page');
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(20_000);
  // The row's own diagnostics would count the refusals as faults. These are held to naming them.
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(`${message.location().url} ${message.text()}`);
    }
  });
  const events = logOf(page);
  const refused = new Set();
  const fetchedAgain = [];
  let outage = true;
  let reloaded = false;
  page.on('request', (request) => {
    if (
      !outage &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame()
    ) {
      reloaded = true;
    }
  });
  await page.route('**/*.js', async (route) => {
    const url = route.request().url();
    if (catalogModules.has(new URL(url).pathname)) {
      if (outage) {
        refused.add(url);
        await route.fulfill({ status: 503, body: '' });
        return;
      }
      if (!reloaded) fetchedAgain.push(url);
    }
    await route.continue();
  });
  await visitFor(context, 'item', locale, (url) => page.goto(url));

  const recovery = page.locator('localization-recovery [role="alert"]');
  await recovery.waitFor();
  assert.ok(
    refused.size > 0,
    'The page asked for no catalog module, so the outage refused nothing',
  );
  assert.equal(
    (await recovery.locator('p').textContent()).trim(),
    await readCatalogMessage(consumerRoot, locale, 'recovery.unavailable'),
    `LocalizationRecovery did not show the ${locale} sentence withRecoveryMessage selects`,
  );
  // Marked with the language subtag, as Equator marks every message it renders.
  assert.equal(
    await recovery.getAttribute('lang'),
    new Intl.Locale(locale).language,
  );
  assert.equal(await recovery.getAttribute('dir'), 'rtl');
  await auditAccessibility(page, row, 'recovery in ar-EG');
  const retry = recovery.locator('button');
  assert.equal(
    (await retry.textContent()).trim(),
    await readCatalogMessage(consumerRoot, locale, 'control.retry'),
    `LocalizationRecovery did not label its retry with the ${locale} label withRecoveryMessage selects`,
  );

  outage = false;
  await retry.click();
  // The engine answers the retry's import one of two ways, a request for the catalog or a failure
  // the application reloads on, and whichever shows first decides what the rest is held to.
  const decided = Date.now() + 15_000;
  while (fetchedAgain.length === 0 && !reloaded && Date.now() < decided) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const inPlace = fetchedAgain.length > 0;
  assert.ok(
    inPlace || reloaded,
    'The engine kept the failed catalog module, and the page did not reload on the reason retryFailed gave',
  );
  // Both ways back end on the page in its locale, so that is what is waited for.
  const title = page.locator('h1');
  await title.waitFor();
  assert.equal(
    (await title.textContent()).trim(),
    await readCatalogMessage(consumerRoot, locale, 'app-title'),
    'The retry did not bring the page back in its locale',
  );
  assert.equal(await recovery.count(), 0, 'The recovery stayed up');
  const retried = loggedEvents(events.join('\n')).filter(
    (event) => event.phase === 'initialization' && event.transitionId > 0,
  );
  if (inPlace) {
    assert.equal(
      reloaded,
      false,
      'The engine fetched the catalog again for the retry, and the page reloaded anyway',
    );
    assert.ok(
      retried.some((event) => event.status === 'succeeded'),
      `The retry fetched the catalog again and did not succeed. The sink was told:\n${JSON.stringify(retried, null, 2)}`,
    );
  } else {
    // How the attempt ended is not read from the log here. The reload follows the failure in the
    // same task, and Chromium did not deliver the page's last console line before it unloaded.
    assert.ok(
      retried.some((event) => event.status === 'started'),
      `The engine did not fetch the catalog again, and the sink was told of no retry. It was told:\n${JSON.stringify(retried, null, 2)}`,
    );
  }
  process.stderr.write(
    `[assurance] ${row.id}-recovery: ${inPlace ? 'the engine fetched the catalog again' : 'the engine kept the failed module, and the page reloaded'}\n`,
  );
  assert.deepEqual(pageErrors, [], 'The outage threw in the page');
  const unexplained = consoleErrors.filter(
    (error) => ![...refused].some((url) => error.includes(url)),
  );
  assert.deepEqual(
    unexplained,
    [],
    'The page reported errors other than the refused catalog modules',
  );

  const check = sectionCheck(row, 'recovery');
  const observed = await measuredContext(page);
  recordCapabilityClaim(check, 'feature:withRecoveryMessage', observed);
  recordCapabilityClaim(check, 'directive:LocalizationRecovery', observed);
  await page.close();
}

/**
 * The recovery on a page the server drew, which a browser reaches when it can neither adopt what
 * the server transferred nor load a catalog itself. The transfer is edited on the way, so it is
 * refused whole under `specs/05-compiled-artifacts-and-trust.spec.md` section 2, and the catalog
 * modules are out as above. The server's elements are held before any script runs, so the
 * recovery is read in a page that kept them.
 */
async function verifyRecoveryOnDrawnPage(row, context) {
  const locale = 'en-US';
  const page = boundCalls(await context.newPage(), 'page');
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(20_000);
  // A stored choice would decide the locale once the transfer is refused, and the stages before
  // this one leave one behind. It stays away until the recovery has been read: the page reads
  // the store only once its scripts run, which is after the visit returns.
  const before = (await context.cookies()).filter(
    ({ name }) => name === 'equator-locale',
  );
  await context.clearCookies({ name: 'equator-locale' });
  try {
    await verifyRecoveryOverRefusedTransfer(row, context, page, locale);
  } finally {
    await context.clearCookies({ name: 'equator-locale' });
    await context.addCookies(before);
  }
}

async function verifyRecoveryOverRefusedTransfer(row, context, page, locale) {
  const catalogModules = await catalogModulesOf(
    deploymentOf(locale).browserRoot,
  );
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let edited = false;
  let releaseScripts;
  const scripts = new Promise((release) => {
    releaseScripts = release;
  });
  const refused = new Set();
  await page.route('**/*.js', async (route) => {
    await scripts;
    const url = route.request().url();
    if (catalogModules.has(new URL(url).pathname)) {
      refused.add(url);
      await route.fulfill({ status: 503, body: '' });
      return;
    }
    await route.continue();
  });
  try {
    await visitFor(context, 'second', locale, async (url) => {
      const navigation = page.goto(url, { waitUntil: 'commit' });
      navigation.catch(() => {});
      await navigation;
      await page.waitForSelector('[data-route-view="second"]', {
        state: 'attached',
      });
      await page.waitForSelector(
        'script[type="application/json"][id$="-state"]',
        {
          state: 'attached',
        },
      );
      await holdServerElements(page);
      // Edited where Angular reads it, before any script runs. Angular writes the transfer with its
      // slashes escaped, and either spelling is the profile.
      edited = await page.evaluate(() => {
        const transfer = document.querySelector(
          'script[type="application/json"][id$="-state"]',
        );
        // The text node rather than the element: a script's text is a Trusted Types sink, and a
        // JSON block is never run for the policy to be asked about.
        const text = transfer?.firstChild;
        if (!(text instanceof Text)) return false;
        const refused = text.data.replace(
          /("profile":"equator-transfer-state(?:\/|\\u002F))1"/u,
          '$10"',
        );
        if (refused === text.data) return false;
        text.data = refused;
        return true;
      });
    });
  } finally {
    releaseScripts();
  }
  assert.ok(
    edited,
    'The second page carried no transfer to edit, so nothing was refused',
  );
  const recovery = page.locator('localization-recovery [role="alert"]');
  await recovery.waitFor().catch(() => {
    assert.fail(
      'No LocalizationRecovery showed over the refused transfer, so the page had no withRecoveryMessage to fall back on',
    );
  });
  assert.ok(
    refused.size > 0,
    'The page asked for no catalog module, so it adopted what the server sent after all',
  );
  assert.equal(
    (await recovery.locator('p').textContent()).trim(),
    await readCatalogMessage(consumerRoot, locale, 'recovery.unavailable'),
    `LocalizationRecovery did not show the ${locale} sentence withRecoveryMessage selects over the server's page`,
  );
  const observed = await measuredContext(page);
  assert.ok(
    observed.adoptedElements > 0,
    `${row.label} kept none of the second page's server elements, so the recovery was not read in a page the server drew`,
  );
  assert.deepEqual(pageErrors, [], 'The refused transfer threw in the page');
  const check = sectionCheck(row, 'recovery on a page the server drew');
  recordCapabilityClaim(check, 'feature:withRecoveryMessage', observed);
  recordCapabilityClaim(check, 'directive:LocalizationRecovery', observed);
  await page.close();
}

/**
 * A context for pages a stage opens and closes itself: the row's cookies and storage, and the same
 * policy-violation recording, in a context nothing else uses.
 */
async function isolatedContext(from) {
  const isolated = boundCalls(
    await browser.newContext({ storageState: await from.storageState() }),
    'context',
  );
  await recordPolicyViolations(isolated);
  return isolated;
}

/** The cookies a stage's own context ended with, handed back to the row's, which reads them next. */
async function returnCookies(isolated, to) {
  const cookies = await isolated.cookies();
  await to.clearCookies();
  if (cookies.length > 0) await to.addCookies(cookies);
  returnedCookies = cookies;
}

/** What the planted stall closes in place of a page, a context or a browser: nothing, ever. */
class NeverClosing {
  close() {
    return new Promise(() => {});
  }
  evaluate() {
    return Promise.resolve();
  }
}
/** The engines whose row has met the planted stall, which each row meets once. */
const stalledEngines = new Set();

/**
 * Close a page and its own context. A close the browser never finishes is recorded as an
 * occurrence and ended by closing the context; a context whose close does not settle either is
 * thrown as an unanswering browser, which the row replaces.
 */
async function closeIsolated(isolatedPage, isolated) {
  if (
    selfTest?.startsWith('unanswering-browser') &&
    !stalledEngines.has(browserDiagnostics.engine)
  ) {
    stalledEngines.add(browserDiagnostics.engine);
    await closePageWithItsContext(
      boundCalls(new NeverClosing(), 'page'),
      boundCalls(new NeverClosing(), 'context'),
      () => assert.fail('The planted context closed'),
    );
  }
  await closePageWithItsContext(isolatedPage, isolated, (error) =>
    recordOccurrence({
      kind: 'page-close-unsettled',
      signature: `${verificationStage}: page.close did not settle within ${callTimeoutMs}ms, so its context was closed in its place`,
      detail: error.message.split('\n')[0],
    }),
  );
}

async function verifyLocalizedNotFound(row, context, diagnostics) {
  // An address this application does not serve, under a locale it does. The locale resolved
  // perfectly well; only the page is unknown, and the application's own not-found route is what
  // answers. Treating that as a localization failure abandoned the navigation and rendered
  // nothing at all.
  //
  // Where the address states the locale, the reader's stored choice is English. An answer that
  // settles no locale writes no cookie, so that choice is still there when the page has hydrated
  // and the stores are read again, and only the address keeps the page in Arabic.
  const decides = addresses.localeInAddress ? 'url' : undefined;
  // Each page here has a context of its own, so a close the browser never finishes can be ended by
  // closing that context, which the rest of the row does not use.
  const missingBrowserContext = await isolatedContext(context);
  const missing = boundCalls(await missingBrowserContext.newPage(), 'page');
  attachBrowserDiagnostics(missing, diagnostics);
  missing.setDefaultTimeout(15_000);
  let missingOrigin;
  const missingResponse = await visitFor(
    missingBrowserContext,
    'missing',
    'ar-EG',
    async (missingUrl) => {
      expectedErrorDocuments.add(missingUrl);
      missingOrigin = new URL(missingUrl).origin;
      if (decides !== 'url') {
        return missing.goto(missingUrl, { waitUntil: 'networkidle' });
      }
      await missingBrowserContext.clearCookies({ name: 'equator-locale' });
      await missingBrowserContext.addCookies([
        { name: 'equator-locale', value: 'en-US', url: missingOrigin },
      ]);
      const response = await navigateWithScriptGate(
        missing,
        missingUrl,
        async () => {
          await missing.waitForSelector('[ng-server-context]', {
            state: 'attached',
          });
          await holdServerElements(missing);
        },
      );
      await missing.waitForLoadState('networkidle');
      return response;
    },
  );
  // The status is Equator's, and the page is the application's: a not-found page answered 200
  // tells a crawler the address exists.
  assert.equal(
    missingResponse?.status(),
    404,
    'A not-found in Arabic did not answer 404',
  );
  await missing.waitForFunction(
    () => document.querySelector('[data-route-view="not-found"]') !== null,
    undefined,
    { timeout: 10_000 },
  );
  const missingContext = await measuredContext(missing);
  // Past the second reading of the stores, which would move the page after this looked.
  await missing.waitForFunction(
    () => document.documentElement.dataset['settled'] === 'true',
  );
  assert.equal(
    await missing.evaluate(() => document.documentElement.lang),
    'ar-EG',
    'A not-found in Arabic did not answer in Arabic',
  );
  await collectPolicyDiagnostics(missing, diagnostics);
  const notFound = sectionCheck(row, 'not found');
  claimRunningPolicy(notFound, missingContext);
  if (decides === 'url') {
    assert.ok(
      missingContext.adoptedElements > 0,
      `${row.label}: the not-found page kept none of the server's elements`,
    );
    assert.deepEqual(
      (await missingBrowserContext.cookies(missingOrigin))
        .filter(({ name }) => name === 'equator-locale')
        .map(({ value }) => value),
      ['en-US'],
      `${row.label}: the stored choice under the not-found page is no longer en-US, so nothing here had the address outrank it`,
    );
    recordCapabilityClaim(notFound, 'source:url', missingContext);
  }
  await returnCookies(missingBrowserContext, context);
  await closeIsolated(missing, missingBrowserContext);
}

// Apart from the check above, so each ends by closing its own page and context: a browser that
// stops answering there is replaced after a check that passed, and the next one runs in the fresh
// browser.
async function verifyUnprefixedNotFound(context, diagnostics) {
  // An address with no prefix that nothing serves in any locale, which is what a hand-written
  // `href` to a page that does not exist produces. Spec 07 section 15: a 404 where it stands, in
  // the default locale, with no negotiation, and with no canonical or alternate relationship,
  // because there is no page for one to name.
  //
  // The path deliberately opens with a segment no language tag can be: `/no-such-page` would
  // not test this, because `no` is Norwegian and `no-such-page` parses as a language tag, so
  // Equator reads it as intent toward an unsupported locale and answers 404 where it stands.
  if (addresses.entryRedirects) {
    const unprefixedBrowserContext = await isolatedContext(context);
    const unprefixed = boundCalls(
      await unprefixedBrowserContext.newPage(),
      'page',
    );
    attachBrowserDiagnostics(unprefixed, diagnostics);
    unprefixed.setDefaultTimeout(15_000);
    expectedErrorDocuments.add(`${browserOrigin}/nothing-is-mounted-here`);
    const unprefixedResponse = await unprefixed.goto(
      `${browserOrigin}/nothing-is-mounted-here`,
      { waitUntil: 'networkidle' },
    );
    assert.equal(
      unprefixedResponse?.status(),
      404,
      'The not-found page reached without a prefix did not answer 404',
    );
    await unprefixed.waitForFunction(
      () => document.querySelector('[data-route-view="not-found"]') !== null,
      undefined,
      { timeout: 10_000 },
    );
    assert.equal(
      new URL(unprefixed.url()).pathname,
      '/nothing-is-mounted-here',
      'An address with no locale prefix that nothing serves was sent somewhere instead of answered where it stands',
    );
    assert.equal(
      await unprefixed.evaluate(() => document.documentElement.lang),
      'en-US',
      'The not-found page reached without a prefix is not in the default locale',
    );
    assert.ok(
      (await unprefixed.title()).length > 0,
      'The not-found page reached without a prefix has no document title',
    );
    assert.deepEqual(
      await unprefixed.evaluate(() =>
        [
          ...document.head.querySelectorAll(
            'link[rel="canonical"], link[rel="alternate"][hreflang]',
          ),
        ].map((link) => link.outerHTML),
      ),
      [],
      'The not-found page reached without a prefix names a canonical or an alternate address',
    );
    await collectPolicyDiagnostics(unprefixed, diagnostics);
    await returnCookies(unprefixedBrowserContext, context);
    await closeIsolated(unprefixed, unprefixedBrowserContext);
  }
}

async function verifyRouteDeferredScope(row, context, diagnostics) {
  // A scope used nowhere but behind a lazy route boundary, reached by navigating to the route
  // that defers it. Nothing here preloads anything: the generated route table names the scopes
  // that route must have ready and the Router adapter loads them on activation.
  //
  // This stage exists because that derivation was covered by nothing. The unit tests load the
  // scope by calling `preloadScope` themselves and the Router adapter's test declares its scopes
  // through `requiredScopes`, so both prove the loading API works when something calls it, not
  // that a route causes it. Deleting the derivation entirely left every gate passing, which is
  // how a page that rendered no text reached a release.
  //
  // Both locales, directly rather than through a transition, because the derived list carries
  // the startup scopes as well: a route that renders in one locale and not the other is the
  // shape the omission took.
  for (const [locale, expected] of [
    ['en-US', 'Lazy scope ready.'],
    ['ar-EG', 'النطاق الكسول جاهز.'],
  ]) {
    const deferred = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(deferred, diagnostics);
    deferred.setDefaultTimeout(15_000);
    // Held before any script runs, so the count below says whether the client kept the page the
    // server drew with the deferred scope rather than drawing it again.
    const lazyUrl = await visitFor(context, 'lazy', locale, async (url) => {
      await navigateWithScriptGate(deferred, url, async () => {
        await deferred.waitForSelector('[data-route-view="lazy"]', {
          state: 'attached',
        });
        await holdServerElements(deferred);
      });
      return url;
    });
    assert.equal(
      (
        await deferred.locator('[data-route-view="lazy"]').textContent()
      )?.trim(),
      expected,
      `provideLocalizedRouter did not load the scope the generated route table's scopes name behind ${lazyUrl} in ${locale} when that route activated`,
    );
    const adopted = await measuredContext(deferred);
    assert.ok(
      adopted.adoptedElements > 0,
      `${row.label} kept none of the lazy page's server elements in ${locale}`,
    );
    const check = sectionCheck(row, 'route-deferred scope');
    recordCapabilityClaim(check, 'feature:provideLocalizedRouter', adopted);
    recordCapabilityClaim(
      check,
      'declaration:GeneratedRouteProjectionEntry.scopes',
      adopted,
    );
    await collectPolicyDiagnostics(deferred, diagnostics);
    await deferred.close();

    // The same route reached by the router from a page that needs none of its scope, so the scope
    // arrives because the navigation's route names it.
    const navigated = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(navigated, diagnostics);
    navigated.setDefaultTimeout(15_000);
    await visitFor(context, 'home', locale, (url) => navigated.goto(url));
    await navigated.waitForFunction(
      () => document.documentElement.dataset['clientReady'] === 'true',
    );
    await throughHistory(navigated, addresses.shownPath('lazy', locale));
    // Attached rather than visible: the route activates only once its scopes have loaded, so an
    // empty view is the missing scope, which the assertion below names.
    await navigated.waitForSelector('[data-route-view="lazy"]', {
      state: 'attached',
    });
    assert.equal(
      (
        await navigated.locator('[data-route-view="lazy"]').textContent()
      )?.trim(),
      expected,
      `a client navigation to lazy in ${locale} did not load the scope the generated route table's scopes name for it`,
    );
    const { engine, policy, clientNavigations } =
      await measuredContext(navigated);
    assert.ok(
      clientNavigations > 0,
      `${row.label} reached lazy in ${locale} without a client navigation`,
    );
    recordCapabilityClaim(
      sectionCheck(row, 'route-deferred scope by client navigation'),
      'declaration:GeneratedRouteProjectionEntry.scopes',
      { engine, policy, clientNavigations },
    );
    await collectPolicyDiagnostics(navigated, diagnostics);
    await navigated.close();
  }
}

/**
 * A switch to Arabic on a page the server did not draw for the client: the prerendered second page,
 * adopted, and the same page drawn by the router after a link from home. Every effect of a change
 * that a page carries is held here, because each runs over what the page shows, and a page the
 * build wrote or the client drew is a different page to run over from the one the server answered.
 */
async function verifySwitchOnDrawnPages(row, context, diagnostics) {
  const before = (await context.cookies()).filter(
    ({ name }) => name === 'equator-locale',
  );
  const visit = async (label, open) => {
    const page = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(page, diagnostics);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    const events = logOf(page);
    const observed = await open(page);
    await switchOnPage(
      page,
      sectionCheck(row, `locale switch on the second page, ${label}`),
      observed,
      events,
    );
    await collectPolicyDiagnostics(page, diagnostics);
    await page.close();
  };
  try {
    // Under a policy that leaves the locale out of the address the second page is spelled the same in
    // every locale, so it is answered on request and never prerendered.
    if (addresses.prerendered.includes('second')) {
      await visit('prerendered', async (page) => {
        await visitFor(context, 'second', 'en-US', (url) =>
          navigateWithScriptGate(page, url, async () => {
            await page.waitForSelector('[data-route-view="second"]', {
              state: 'attached',
            });
            await holdServerElements(page);
          }),
        );
        const observed = await measuredContext(page);
        assert.match(
          observed.document,
          /\bng-server-context=["'][^"']*\bssg\b/u,
          `${row.label} answered the second page with a document the build did not write`,
        );
        assert.ok(
          observed.adoptedElements > 0,
          `${row.label} kept none of the prerendered second page's elements`,
        );
        return observed;
      });
    }
    await visit('drawn by a client navigation', async (page) => {
      await visitFor(context, 'home', 'en-US', (url) => page.goto(url));
      await page.waitForFunction(
        () => document.documentElement.dataset['clientReady'] === 'true',
      );
      await page.locator('[data-route-link="second"]').click();
      await page.waitForURL((url) => isShown(url, 'second', 'en-US'));
      await page.waitForSelector('[data-route-view="second"]');
      // Only what the navigation measured. The document is still the home page's, which the server
      // wrote, and the second page in it is not.
      const { engine, policy, clientNavigations } = await measuredContext(page);
      assert.ok(
        clientNavigations > 0,
        `${row.label} reached the second page without a client navigation`,
      );
      return { engine, policy, clientNavigations };
    });
  } finally {
    await context.clearCookies({ name: 'equator-locale' });
    await context.addCookies(before);
  }
}

/** The switch to Arabic and back on the page `page` shows, held and claimed under `observed`. */
async function switchOnPage(page, check, observed, events) {
  await localeChoice(page, 'ar-EG').click();
  await page
    .waitForURL((url) => isShown(url, 'second', 'ar-EG'))
    .catch(() => undefined);
  assert.ok(
    isShown(new URL(page.url()), 'second', 'ar-EG'),
    `${check}: withRouting did not move the address to the Arabic second page; it is at ${page.url()}`,
  );
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'ar-EG' &&
      document.documentElement.dir === 'rtl',
  );
  const title = await readCatalogMessage(
    consumerRoot,
    'ar-EG',
    'document.second.title',
  );
  // An answer that never comes is a wrong answer, so the wait's end is read and the assertion says
  // what was there instead.
  const settled = (predicate, argument) =>
    page
      .waitForFunction(predicate, argument, { timeout: 5_000 })
      .catch(() => undefined);
  await settled((expected) => document.title === expected, title);
  assert.equal(
    await page.title(),
    title,
    `${check}: the head does not carry the Arabic title documentMetadata declares for the second page`,
  );
  await settled(
    (expected) =>
      document.querySelector('[data-equator-announcer]')?.textContent ===
      expected,
    title,
  );
  assert.equal(
    await page.locator('[data-equator-announcer]').textContent(),
    title,
    `${check}: the change was not announced in the page's Arabic title that withLocaleAnnouncement gives as the wording`,
  );
  assert.deepEqual(
    await overlayRoot(page),
    { lang: 'ar-EG', dir: 'rtl' },
    `${check}: the LocalizationOverlayAdapter installed with withOverlayLocale did not move the overlay root to Arabic`,
  );
  await settled(() =>
    document
      .querySelector('[data-dynamic-title]')
      ?.textContent?.includes('دليل Equator للترجمة'),
  );
  assert.match(
    (await page.locator('[data-dynamic-title]').textContent()) ?? '',
    /دليل Equator للترجمة/u,
    `${check}: the dynamic content's LocalizationParticipant did not bring its Arabic article`,
  );
  assert.deepEqual(
    (await page.context().cookies(new URL(page.url()).origin))
      .filter(({ name }) => name === 'equator-locale')
      .map(({ value }) => value),
    ['ar-EG'],
    `${check}: withPersistence did not remember the choice in its cookieStore`,
  );
  assert.equal(
    await localeChoice(page, 'ar-EG').getAttribute('aria-current'),
    'true',
    `${check}: the LocaleChoice option for ar-EG is not the current one`,
  );
  claimLoggedChange(
    check,
    loggedEvents(events.join('\n')),
    'ar-EG',
    'succeeded',
    observed,
  );
  recordCapabilityClaim(check, 'directive:LocaleChoice', observed);
  recordCapabilityClaim(check, 'feature:withRouting', observed);
  recordCapabilityClaim(check, 'declaration:document-metadata', observed);
  recordCapabilityClaim(check, 'feature:withLocaleAnnouncement', observed);
  recordCapabilityClaim(check, 'feature:withOverlayLocale', observed);
  recordCapabilityClaim(check, 'extension:overlay-adapter', observed);
  recordCapabilityClaim(check, 'extension:locale-participant', observed);
  recordCapabilityClaim(check, 'feature:withPersistence', observed);
  recordCapabilityClaim(check, 'store:cookieStore', observed);

  await localeChoice(page, 'en-US').click();
  await page.waitForURL((url) => isShown(url, 'second', 'en-US'));
  await page.waitForFunction(() => document.documentElement.lang === 'en-US');
}

/** Where an embedded page's claims were asserted: the engine, the document, adoption and navigation. */
async function measuredEmbeddedContext(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );
  const reported = await page.evaluate(() => ({
    clientNavigations: document.documentElement.dataset['clientNavigations'],
    adoptedElements: (globalThis.__equatorServerElements ?? []).filter(
      (element) => element.isConnected,
    ).length,
  }));
  return {
    engine: page.context().browser(),
    document: await page.content(),
    adoptedElements: reported.adoptedElements,
    clientNavigations: Number(reported.clientNavigations),
  };
}

/** What the embedded panel shows, and what the page around it says about its own language. */
function embeddedPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-panel]');
    return {
      document: [
        document.documentElement.getAttribute('lang'),
        document.documentElement.getAttribute('dir'),
      ],
      locale: panel?.getAttribute('lang'),
      direction: panel?.getAttribute('dir'),
      heading: document
        .querySelector('[data-heading]')
        ?.getAttribute('data-supplying'),
      greeting: document
        .querySelector('[data-greeting]')
        ?.getAttribute('data-supplying'),
    };
  });
}

/** Where the embedded panel keeps a choice, read from outside the page. */
async function embeddedStores(page) {
  const kept = await page.evaluate(() => ({
    tab: sessionStorage.getItem('embedded-tab-locale'),
    device: localStorage.getItem('embedded-locale'),
  }));
  const account = (await page.context().cookies(embedded.origin)).find(
    ({ name }) => name === 'embedded-account-locale',
  );
  return { ...kept, account: account?.value ?? null };
}

/**
 * The panel opened from the file the build wrote, reached from there by a client navigation, and
 * moved between locales by a choice and by five restores, each arranged so the page can only land
 * where one store or one source puts it.
 *
 * A restore is the one time a page already on screen asks its sources again (`pageshow` with
 * `persisted`, dispatched here as the engine dispatches it), so it is where a source or a store is
 * seen deciding after a client navigation. It resolves a locale rather than choosing one, so it
 * writes nothing, and the stores are read after each to hold it to that. The stores are asked in
 * the order `app.config.ts` lists them: this tab, this device, the account, then this page's
 * memory.
 */
async function verifyEmbeddedPanel(row, languages) {
  const context = boundCalls(
    await browser.newContext({ locale: languages }),
    'context',
  );
  const page = boundCalls(await context.newPage(), 'page');
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(20_000);
  const faults = [];
  page.on('pageerror', (error) => faults.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') faults.push(message.text());
  });
  const logged = logOf(page);
  const at = (label) =>
    sectionCheck(row, `embedded panel under ${languages}, ${label}`);
  const shows = async (locale, check) => {
    await page
      .waitForFunction(
        (expected) =>
          document.querySelector('[data-panel]')?.getAttribute('lang') ===
          expected,
        locale,
        { timeout: 10_000 },
      )
      .catch(() => undefined);
    const shown = await embeddedPanel(page);
    const scripts = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.endsWith('.js'))
        .map(
          (entry) =>
            `${entry.name.split('/').at(-1)} (${Math.round(entry.responseEnd)}ms)`,
        ),
    );
    assert.deepEqual(
      [shown.document, shown.locale],
      [['en', 'ltr'], locale],
      `${check}: the panel is not in ${locale}, or withoutDocumentLocale did not leave the host page's lang alone${outstandingRequestsNote(page)}\nScripts the page loaded: ${scripts.join(', ')}\nWhat the panel's sink was told, where a restore's events say how it ended:\n${logged.join('\n')}`,
    );
    return shown;
  };
  const restore = (arrange) =>
    page.evaluate((steps) => {
      for (const [where, key, value] of steps) {
        const storage = where === 'tab' ? sessionStorage : localStorage;
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      }
      globalThis.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      );
    }, arrange);
  const account = async (value) => {
    await context.clearCookies({ name: 'embedded-account-locale' });
    if (value !== null) {
      await context.addCookies([
        {
          name: 'embedded-account-locale',
          value,
          url: embedded.origin,
          httpOnly: true,
        },
      ]);
    }
  };
  try {
    // The panel drawn for the request and adopted as it was drawn. Under en-US the reader's
    // languages name a locale the panel offers; under fr-FR only the account's choice does.
    for (const [source, locale] of languages === 'en-US'
      ? [['browser', 'en-US']]
      : [['stored', 'en-US']]) {
      const check = at(`the server's ${source} decision, adopted`);
      await account(source === 'stored' ? locale : null);
      await navigateWithScriptGate(page, `${embedded.origin}/`, async () => {
        await page.waitForSelector('[data-route-view="panel"]', {
          state: 'attached',
        });
        await holdServerElements(page);
      });
      const observed = await measuredEmbeddedContext(page);
      assert.match(
        observed.document,
        /\bng-server-context=["'][^"']*\bssr\b/u,
        `${check} was not drawn for the request`,
      );
      assert.ok(
        observed.adoptedElements > 0,
        `${check} kept none of the server's elements`,
      );
      await shows(locale, check);
      recordCapabilityClaim(check, 'feature:withLocaleSources', observed);
      if (source === 'stored') {
        recordCapabilityClaim(check, 'source:stored', observed);
        recordCapabilityClaim(check, 'store:profileStore', observed);
      } else {
        recordCapabilityClaim(check, 'source:browser', observed);
      }
      await account(null);
    }

    // A choice kept on this device reaches no server, so the page is drawn or written without it,
    // and the stores are read again once the page is adopted: the choice corrects it then, and
    // is written nowhere else by doing so (specs/03-locale-identity-and-resolution.spec.md
    // section 8).
    await page.evaluate(() => localStorage.setItem('embedded-locale', 'ar'));
    for (const [path, view, rendered] of [
      ['/', 'panel', 'ssr'],
      ['/about', 'about', 'ssg'],
    ]) {
      const check = at(
        `a device choice corrects the ${rendered} page after hydration`,
      );
      const source = 'stored';
      // From a blank page, because a page showing the same view would answer the capture below
      // with its own elements rather than the ones the new document was given.
      await page.goto('about:blank');
      const loggedBefore = logged.length;
      await navigateWithScriptGate(
        page,
        `${embedded.origin}${path}`,
        async () => {
          await page.waitForSelector(`[data-route-view="${view}"]`, {
            state: 'attached',
          });
          await holdServerElements(page);
        },
      );
      const observed = await measuredEmbeddedContext(page);
      assert.match(
        observed.document,
        new RegExp(`\\bng-server-context=["'][^"']*\\b${rendered}\\b`, 'u'),
        `${check}: the page did not come from the ${rendered} render`,
      );
      assert.ok(
        observed.adoptedElements > 0,
        `${check} kept none of the elements it was given`,
      );
      await shows('ar', check);
      const restore = loggedEvents(logged.slice(loggedBefore).join('\n'))
        .filter(
          (event) =>
            event.phase === 'persistence' && event.correlationId === undefined,
        )
        .map(({ status, targetLocale }) => [status, targetLocale ?? null]);
      assert.deepEqual(
        restore,
        [
          ['started', null],
          ['succeeded', 'ar'],
        ],
        `${check}: the LocalizationObservabilitySink installed with withObservability was not told that the stores were read once the page was adopted and that the read ended in a change to ar`,
      );
      assert.deepEqual(
        await embeddedStores(page),
        { tab: null, device: 'ar', account: null },
        `${check}: the ${source} locale localStorageStore resolved was written back`,
      );
      recordCapabilityClaim(check, 'source:stored', observed);
      recordCapabilityClaim(check, 'store:localStorageStore', observed);
    }
    await page.evaluate(() => localStorage.removeItem('embedded-locale'));
    await page.goto('about:blank');

    await navigateWithScriptGate(page, `${embedded.origin}/about`, async () => {
      await page.waitForSelector('[data-route-view="about"]', {
        state: 'attached',
      });
      await holdServerElements(page);
    });
    {
      const check = at('the prerendered page');
      const observed = await measuredEmbeddedContext(page);
      assert.match(
        observed.document,
        /\bng-server-context=["'][^"']*\bssg\b/u,
        `${check} was not the file the build wrote`,
      );
      assert.ok(
        observed.adoptedElements > 0,
        `${check} kept none of the build's elements`,
      );
      const source = 'default';
      const shown = await shows('ar-EG', check);
      assert.deepEqual(
        [shown.heading, shown.greeting],
        ['ar-EG', 'ar'],
        `${check}: the greeting the ar-EG catalog leaves out did not come from ar, the next locale in localeFallbacks, on the page the ${source} source withLocaleSources lists last decided`,
      );
      recordCapabilityClaim(check, 'feature:withoutDocumentLocale', observed);
      recordCapabilityClaim(check, 'feature:withLocaleSources', observed);
      recordCapabilityClaim(check, 'source:default', observed);
      recordCapabilityClaim(check, 'capability:fallback-chain', observed);
    }

    await page.locator('[data-link="panel"]').click();
    await page.waitForSelector('[data-route-view="panel"]', {
      state: 'attached',
    });

    {
      const check = at('a choice after a client navigation');
      await page.locator('[data-choose="ar"]').click();
      await shows('ar', check);
      const observed = await measuredEmbeddedContext(page);
      assert.ok(
        observed.clientNavigations > 0,
        `${check}: the panel was not reached by a client navigation`,
      );
      assert.deepEqual(
        await embeddedStores(page),
        { tab: 'ar', device: 'ar', account: 'ar' },
        `${check}: withPersistence did not write the choice to the tab's store written against LocalizationPersistenceStore, the localStorageStore and the profileStore`,
      );
      recordCapabilityClaim(check, 'feature:withPersistence', observed);
      recordCapabilityClaim(check, 'feature:withoutDocumentLocale', observed);
      recordCapabilityClaim(check, 'store:localStorageStore', observed);
      recordCapabilityClaim(check, 'store:profileStore', observed);
      recordCapabilityClaim(check, 'extension:persistence-store', observed);
    }

    {
      const check = at('a restore the device decides');
      const source = 'stored';
      await restore([
        ['tab', 'embedded-tab-locale', null],
        ['device', 'embedded-locale', 'en-US'],
      ]);
      await shows('en-US', check);
      assert.deepEqual(
        await embeddedStores(page),
        { tab: null, device: 'en-US', account: 'ar' },
        `${check}: the ${source} source read the localStorageStore ahead of the account, and the restore wrote nothing`,
      );
      const observed = await measuredEmbeddedContext(page);
      recordCapabilityClaim(check, 'source:stored', observed);
      recordCapabilityClaim(check, 'store:localStorageStore', observed);
      recordCapabilityClaim(check, 'feature:withLocaleSources', observed);
    }

    {
      // Nothing durable holds a choice now, and the page is in English: only the choice this page
      // made, which its memory kept and the restore above did not overwrite, can bring it back to ar.
      const check = at('a restore the page memory decides');
      await account(null);
      await restore([['device', 'embedded-locale', null]]);
      await shows('ar', check);
      const observed = await measuredEmbeddedContext(page);
      assert.deepEqual(
        await embeddedStores(page),
        { tab: null, device: null, account: null },
        `${check}: the memoryStore listed last did not keep the choice the page made`,
      );
      recordCapabilityClaim(check, 'store:memoryStore', observed);
    }

    {
      const check = at('a restore the account decides');
      await account('en-US');
      await restore([]);
      await shows('en-US', check);
      const observed = await measuredEmbeddedContext(page);
      assert.deepEqual(
        await embeddedStores(page),
        { tab: null, device: null, account: 'en-US' },
        `${check}: the profileStore's transport did not answer with the account's choice`,
      );
      recordCapabilityClaim(check, 'store:profileStore', observed);
    }

    {
      const check = at("a restore the tab's store decides");
      await restore([['tab', 'embedded-tab-locale', 'ar-EG']]);
      const shown = await shows('ar-EG', check);
      const observed = await measuredEmbeddedContext(page);
      assert.deepEqual(
        await embeddedStores(page),
        { tab: 'ar-EG', device: null, account: 'en-US' },
        `${check}: the store the application wrote against LocalizationPersistenceStore was not read first`,
      );
      recordCapabilityClaim(check, 'extension:persistence-store', observed);
      assert.equal(
        shown.greeting,
        'ar',
        `${check}: the greeting the ar-EG catalog leaves out did not come from the localeFallbacks chain after a client navigation`,
      );
      recordCapabilityClaim(check, 'capability:fallback-chain', observed);
    }

    {
      // Forgetting drops the choice from every store and moves nothing, so the page stays in the
      // locale it was in (specs/03-locale-identity-and-resolution.spec.md section 8).
      const check = at('the choice forgotten');
      await page.locator('[data-forget]').click();
      // The account forgets over a request, so the stores are read until they are empty or the
      // bound passes, and then asserted.
      const forgetting = Date.now() + 10_000;
      let kept = await embeddedStores(page);
      while (
        Date.now() < forgetting &&
        (kept.tab ?? kept.device ?? kept.account) !== null
      ) {
        await page.waitForTimeout(100);
        kept = await embeddedStores(page);
      }
      assert.deepEqual(
        kept,
        { tab: null, device: null, account: null },
        `${check}: forgetRememberedLocale did not reach every store withPersistence lists`,
      );
      await shows('ar-EG', check);
      const observed = await measuredEmbeddedContext(page);
      recordCapabilityClaim(check, 'feature:withPersistence', observed);
    }

    assert.deepEqual(
      faults,
      [],
      `${row.label} reported errors on the embedded panel`,
    );
  } finally {
    await context.close();
  }
}

/**
 * The recovery in an application whose router Equator does not hold: the page around the panel
 * moves its history while the panel cannot start, and the recovery stays in place across that
 * client navigation. The panel's settings page is rendered in the browser only, so its start is the
 * one that loads catalogs, and every catalog module is refused.
 */
async function verifyEmbeddedRecovery(row) {
  const catalogModules = await catalogModulesOf(embedded.browserRoot);
  assert.ok(
    catalogModules.size > 0,
    'No script in the embedded build exports a compiled catalog',
  );
  const context = boundCalls(
    await browser.newContext({ locale: 'fr-FR' }),
    'context',
  );
  const page = boundCalls(await context.newPage(), 'page');
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(20_000);
  const refused = new Set();
  await page.route('**/*.js', async (route) => {
    const url = route.request().url();
    if (catalogModules.has(new URL(url).pathname)) {
      refused.add(url);
      await route.fulfill({ status: 503, body: '' });
      return;
    }
    await route.continue();
  });
  try {
    const check = sectionCheck(
      row,
      'embedded recovery across a client navigation',
    );
    await page.goto(`${embedded.origin}/settings`);
    const recovery = page.locator('localization-recovery [role="alert"]');
    await recovery.waitFor().catch(() => {
      assert.fail(
        `${check}: no LocalizationRecovery showed when every catalog was refused, so the panel had no withRecoveryMessage to fall back on`,
      );
    });
    const expected = /recovery\.unavailable: (.+)\n/u.exec(
      await readFile(
        resolve(consumerRoot, 'embedded/i18n/shell/ar-EG.yaml'),
        'utf8',
      ),
    )?.[1];
    await page.evaluate(() => {
      globalThis.history.pushState(null, '', '/about');
      globalThis.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    await page.waitForFunction(
      () => document.documentElement.dataset['clientNavigations'] === '1',
    );
    const observed = await measuredEmbeddedContext(page);
    assert.deepEqual(
      {
        shown: (await recovery.textContent())?.trim(),
        lang: await recovery.getAttribute('lang'),
        at: new URL(page.url()).pathname,
        refused: refused.size > 0,
      },
      { shown: expected, lang: 'ar', at: '/about', refused: true },
      `${check}: the ar-EG sentence withRecoveryMessage selects did not stay in place after the router moved`,
    );
    recordCapabilityClaim(check, 'feature:withRecoveryMessage', observed);
    recordCapabilityClaim(check, 'directive:LocalizationRecovery', observed);
  } finally {
    await context.close();
  }
}

/** The language and direction of the root the application attaches overlays to. */
function overlayRoot(page) {
  return page.locator('[data-overlay-root]').evaluate((root) => ({
    lang: root.getAttribute('lang'),
    dir: root.getAttribute('dir'),
  }));
}

/** A switch to Arabic and back on the hydrated page, through the options the page renders. */
async function verifyLocaleSwitches(row, page, events) {
  enterStage(`${row.id}-arabic-route-switch`);
  await localeChoice(page, 'ar-EG').click();
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'ar-EG' &&
      document.documentElement.dir === 'rtl' &&
      document
        .querySelector('h1')
        ?.textContent?.includes('مختبر ميزات Equator') &&
      document
        .querySelector('[data-incremental-message]')
        ?.textContent?.includes('حد الترجمة التدريجي جاهز.') &&
      document
        .querySelector('[data-dynamic-title]')
        ?.textContent?.includes('دليل Equator للترجمة'),
  );
  await page.waitForURL(
    (url) =>
      isShown(url, 'home', 'ar-EG') &&
      url.searchParams.get('label') === 'hydration-request',
  );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute('href'),
    addresses.shownUrl('home', 'ar-EG'),
    'withRouting did not move the canonical address to the Arabic page',
  );
  // Nothing the application renders reaches the overlay root, so only the adapter can move it.
  assert.deepEqual(
    await overlayRoot(page),
    { lang: 'ar-EG', dir: 'rtl' },
    'The LocalizationOverlayAdapter installed with withOverlayLocale did not move the overlay root to Arabic',
  );
  assert.match(
    await page.locator('localized-message[data-rich-message]').textContent(),
    /اقرأ الدليل/,
  );
  assert.equal(await page.locator('[data-inert-text] img').count(), 0);
  assert.match(
    await page.locator('[data-source-fallback]').textContent(),
    /Source fallback remains truthful/,
  );
  // A switch that is a document navigation arrives at a page its own origin rendered, and adopts
  // that page's content rather than fetching it.
  assert.equal(
    await page
      .locator('[data-dynamic-content]')
      .getAttribute('data-source-requests'),
    addresses.switchInDocument ? '1' : '0',
    "The dynamic content's LocalizationParticipant did not fetch the Arabic content once, or did not adopt the page's own",
  );
  assert.equal(
    await page.locator('[data-comment-id="community-ar"]').getAttribute('lang'),
    'ar',
  );
  assert.equal(
    await page.locator('[data-comment-id="community-ar"]').getAttribute('dir'),
    'rtl',
  );
  assert.equal(
    await page
      .locator('[data-comment-id="community-multilingual"]')
      .getAttribute('data-representation'),
    'multilingual',
  );

  enterStage(`${row.id}-english-route-switch`);
  await localeChoice(page, 'en-US').click();
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'en-US' &&
      document.documentElement.dir === 'ltr' &&
      document
        .querySelector('h1')
        ?.textContent?.includes('Equator feature lab') &&
      document
        .querySelector('[data-incremental-message]')
        ?.textContent?.includes('Incremental localization boundary ready.'),
  );
  await page.waitForURL(
    (url) =>
      isShown(url, 'home', 'en-US') &&
      url.searchParams.get('label') === 'hydration-request',
  );
  assert.equal(
    await page
      .locator('[data-dynamic-content]')
      .getAttribute('data-source-requests'),
    addresses.switchInDocument ? '2' : '0',
  );
  assert.deepEqual(
    await overlayRoot(page),
    { lang: 'en-US', dir: 'ltr' },
    'The LocalizationOverlayAdapter did not move the overlay root back to English',
  );

  const check = sectionCheck(row, 'locale switches');
  const context = await measuredContext(page);
  // Where the locale is the origin, the change is a document navigation, and that is what the sink
  // is told rather than a commit.
  claimLoggedChange(
    check,
    loggedEvents(events.join('\n')),
    'ar-EG',
    addresses.switchInDocument ? 'succeeded' : 'redirected',
    context,
  );
  recordCapabilityClaim(check, 'directive:LocaleChoice', context);
  recordCapabilityClaim(check, 'directive:LocalizedMessage', context);
  recordCapabilityClaim(check, 'extension:locale-participant', context);
  recordCapabilityClaim(check, 'extension:overlay-adapter', context);
  recordCapabilityClaim(check, 'feature:withOverlayLocale', context);
  recordCapabilityClaim(check, 'feature:withRouting', context);
  claimRunningPolicy(check, context);
}

/** A router link to a child route, then back and forward through history. */
async function verifyClientNavigation(row, page) {
  const initialUrl = page.url();
  assert.equal(
    await page.locator('[data-route-view="home"]').textContent(),
    'Home route',
  );
  // Read once, as the indexing class is on the exercise sheet, so a missing link fails here by name.
  const xDefault = () =>
    page.evaluate(
      () =>
        document
          .querySelector('link[rel="alternate"][hreflang="x-default"]')
          ?.getAttribute('href') ?? null,
    );
  assert.equal(
    await xDefault(),
    addresses.xDefault,
    'the home page the browser adopted does not carry the x-default xDefaultPath or xDefaultUrl declares',
  );
  recordCapabilityClaim(
    sectionCheck(row, 'x-default on the adopted home page'),
    'declaration:x-default',
    await measuredContext(page),
  );
  enterStage(`${row.id}-child-route-navigation`);
  await page.locator('[data-route-link="second"]').click();
  await page.waitForURL((url) => isShown(url, 'second', 'en-US'));
  await page.waitForFunction(
    (canonical) =>
      document
        .querySelector('[data-route-view="second"]')
        ?.textContent?.trim() === 'Second route' &&
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') ===
        canonical,
    addresses.url('second', 'en-US'),
  );
  assert.equal(
    await page.locator('[data-route-view="second"]').textContent(),
    'Second route',
  );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute('href'),
    addresses.url('second', 'en-US'),
    'withRouting did not move the canonical to the second page on a client navigation, written against the origin provideLocalizedRouter is given',
  );
  recordCapabilityClaim(
    sectionCheck(row, 'canonical after a client navigation'),
    'declaration:RouteLocalizationOptions.origin',
    await measuredContext(page),
  );
  assert.equal(
    (await localeChoice(page, 'ar-EG').textContent())?.trim(),
    generatedLocaleNames['ar-EG'],
    'after a client navigation the choice for ar-EG is not labelled with the name the generated localeNames gives it',
  );
  recordCapabilityClaim(
    sectionCheck(row, 'locale names after a client navigation'),
    'declaration:GeneratedConfiguration.localeNames',
    await measuredContext(page),
  );
  assert.equal(
    await xDefault(),
    addresses.xDefault,
    'the second page the router reached does not carry the x-default xDefaultPath or xDefaultUrl declares',
  );
  recordCapabilityClaim(
    sectionCheck(row, 'x-default after a client navigation'),
    'declaration:x-default',
    await measuredContext(page),
  );
  const secondUrl = page.url();

  enterStage(`${row.id}-history-back`);
  await page.goBack();
  await page.waitForSelector('[data-route-view="home"]');
  assert.equal(page.url(), initialUrl);

  enterStage(`${row.id}-history-forward`);
  await page.goForward();
  await page.waitForSelector('[data-route-view="second"]');
  assert.equal(page.url(), secondUrl);

  const check = sectionCheck(row, 'client navigation');
  const context = await measuredContext(page);
  recordCapabilityClaim(check, 'feature:withRouting', context);
  claimRunningPolicy(check, context);
}

/** A route with a parameter whose spelling differs by locale, reached and then switched. */
async function verifyDynamicArticle(row, page) {
  enterStage(`${row.id}-dynamic-article-route`);
  await page.locator('[data-route-link="home"]').click();
  await page.waitForURL((url) => isShown(url, 'home', 'en-US'));
  await page.locator('[data-route-link="article"]').click();
  await page.waitForURL((url) => isShown(url, 'article', 'en-US'));
  await page.waitForFunction(
    () =>
      document.title === 'The Equator localization handbook' &&
      document
        .querySelector('[data-route-view="article"]')
        ?.getAttribute('data-entity-id') === 'handbook',
  );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute('href'),
    addresses.url('article', 'en-US'),
    'withRouting did not move the canonical to the article on a client navigation',
  );
  // Only a locale the article has an address in is an alternate of it.
  const arabicAlternate = page.locator(
    'link[rel="alternate"][hreflang="ar-EG"]',
  );
  if (addresses.has('article', 'ar-EG')) {
    assert.equal(
      await arabicAlternate.getAttribute('href'),
      addresses.url('article', 'ar-EG'),
      "withRouting did not advertise the article's Arabic address",
    );
  } else {
    assert.equal(
      await arabicAlternate.count(),
      0,
      'withRouting advertised an Arabic alternate the article has no address for',
    );
  }
  // The switcher's address and the alternate above are one derivation read twice, and each reader
  // forms its own string: the head states where the page lives, absolutely, on the origin this
  // application is deployed at; the option states where the reader is going, as a path on the host
  // they are actually on. This lab is served from localhost and declares `https://site.example`,
  // so an option carrying the head's string would take the reader off the machine they are on,
  // which is why they are asserted apart rather than compared to each other.
  //
  // The slug is the loaded one, so this also says the option waited for the declaration: before it
  // arrived there was no Arabic spelling to build an address from.
  const arabicAddress = await localeChoice(page, 'ar-EG').getAttribute('href');
  //
  // An option links only an address that serves its locale to a reader who states nothing, so
  // where the article has no Arabic address the option switches and links nowhere.
  assert.equal(
    arabicAddress,
    addresses.has('article', 'ar-EG')
      ? addresses.address('article', 'ar-EG')
      : null,
  );

  enterStage(`${row.id}-dynamic-article-locale-switch`);
  await localeChoice(page, 'ar-EG').click();
  await page.waitForURL(
    (url) =>
      decodeURIComponent(url.pathname) ===
        decodeURIComponent(addresses.shownPath('article', 'ar-EG')) &&
      (!addresses.localeInOrigin || url.origin === addresses.origin('ar-EG')),
  );
  // The link said where the click would go, and it went there. A switcher whose href is derived
  // separately from the switch can disagree with it (on the query the reader is carrying, or on
  // the slug the page declared) and the reader finds that out by opening it in a new tab.
  if (arabicAddress !== null) {
    assert.equal(new URL(arabicAddress, page.url()).href, page.url());
  }
  await page.waitForFunction(
    () =>
      document.title === 'دليل Equator للترجمة' &&
      document.documentElement.lang === 'ar-EG' &&
      document
        .querySelector('[data-dynamic-title]')
        ?.textContent?.includes('دليل Equator للترجمة'),
  );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute('href'),
    addresses.shownUrl('article', 'ar-EG'),
  );

  const check = sectionCheck(row, 'dynamic article');
  const context = await measuredContext(page);
  recordCapabilityClaim(check, 'directive:LocaleChoice', context);
  recordCapabilityClaim(check, 'feature:withRouting', context);
  claimRunningPolicy(check, context);
}

/**
 * One engine's pass, the same on every engine. The browser, context and page are the module's, so
 * the failure block can read the page a failing row was on.
 */
async function verifyBrowserRow(row) {
  const evidence = browserRowEvidence(row);
  evidence.outcome = 'started';
  browserDiagnostics = createBrowserDiagnostics(row);
  let diagnostics = browserDiagnostics;
  let events;
  let trustedTypes;

  // The row's browser, its context and its page, brought to where the stages after the opening
  // expect them. A function, because a browser replaced part of the way through the row is opened
  // the same way, through the same launch.
  const openRow = async () => {
    enterStage(`${row.id}-browser-launch`);
    browser = await launchBrowserRow(row);
    evidence.version = browser.version();
    context = boundCalls(await browser.newContext(), 'context');
    await recordPolicyViolations(context);
    page = boundCalls(await context.newPage(), 'page');
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);

    // Attached before the first navigation, so a bound tripping in any stage describes what the
    // row was doing rather than only naming the stage.
    attachBrowserDiagnostics(page, diagnostics);
    events = logOf(page);

    let releaseScripts;
    const scriptGate = new Promise((resolveGate) => {
      releaseScripts = resolveGate;
    });
    releaseScriptRequests = releaseScripts;

    await page.route('**/*.js', async (route) => {
      await scriptGate;
      await route.continue();
    });

    trustedTypes = await verifyHydration(row, page, releaseScripts, events);

    enterStage(`${row.id}-event-replay`);
    await page.locator('[data-counter]').click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-counter]')
        ?.textContent?.includes('count 1'),
    );
  };
  await openRow();

  // A browser that left a page's close and then its context's close outstanding is not answering,
  // and the checks of the step that met it had passed. It is ended, the occurrence is recorded,
  // and the row is opened again in a fresh one, so the stages that follow run there.
  const replaceBrowser = async (unanswering) => {
    const stage = verificationStage;
    enterStage(`${row.id}-browser-replacement`);
    // A copy, taken before the browser is ended: its pages go on writing to the one they were
    // attached with, and what a browser reports while its process is ended is not the
    // application's.
    browserDiagnostics = structuredClone(diagnostics);
    diagnostics = browserDiagnostics;
    const stalled = browser;
    context = undefined;
    page = undefined;
    await replaceUnansweringBrowser({
      browser:
        selfTest === 'unanswering-browser-process'
          ? boundCalls(new NeverClosing(), 'browser')
          : stalled,
      endProcess: endBrowserProcesses,
      record: ({ processEnded }) =>
        recordOccurrence({
          kind: 'browser-replaced',
          signature: replacementSignature({
            stage,
            timeoutMs: callTimeoutMs,
            processEnded,
          }),
          detail: unanswering.message.split('\n')[0],
        }),
      launch: openRow,
    });
    // The step that met the stall had handed its cookies back to a context that went with the
    // browser, and the stages that follow read them from the row's.
    if (returnedCookies !== undefined) {
      await context.clearCookies();
      if (returnedCookies.length > 0) await context.addCookies(returnedCookies);
    }
    enterStage(stage);
  };

  enterStage(`${row.id}-localized-not-found`);
  await stepClosingItsOwnPages(
    () => verifyLocalizedNotFound(row, context, diagnostics),
    replaceBrowser,
  );
  await stepClosingItsOwnPages(
    () => verifyUnprefixedNotFound(context, diagnostics),
    replaceBrowser,
  );

  enterStage(`${row.id}-route-deferred-scope`);
  await verifyRouteDeferredScope(row, context, diagnostics);

  enterStage(`${row.id}-recovery`);
  await verifyRecovery(row, context);

  enterStage(`${row.id}-recovery-on-drawn-page`);
  await verifyRecoveryOnDrawnPage(row, context);

  // Where the change is a document navigation there is no switch in a page to hold.
  if (addresses.switchInDocument) {
    enterStage(`${row.id}-switch-on-drawn-pages`);
    await verifySwitchOnDrawnPages(row, context, diagnostics);
  }

  enterStage(`${row.id}-incremental-hydration-after-locale-change`);
  {
    // The order that would break hydration if anything did. A deferred block is still inert server
    // HTML, written in the render locale, when the locale commits, and hydration adopts that DOM
    // rather than writing it. What this asserts is that adoption is not the end of the story: the
    // ordinary update pass runs over the claimed DOM and writes the committed locale into it.
    //
    // Clearing the container first is neither needed nor effective: a claimed block does not read
    // English inside an Arabic page (measured across eight binding kinds, every one corrected), and
    // `ViewContainerRef.clear()` iterates live views, which a dehydrated view is not. This stage is
    // what holds the invariant.
    const probe = boundCalls(await context.newPage(), 'page');
    attachBrowserDiagnostics(probe, diagnostics);
    probe.setDefaultTimeout(15_000);
    if (addresses.switchInDocument) {
      // The English page's own address, because the site's root answers in the locale an earlier
      // stage left in the cookie, and a page that opens in Arabic makes the click below a no-op.
      await visitFor(context, 'home', 'en-US', (url) =>
        probe.goto(url, { waitUntil: 'networkidle' }),
      );
      assert.equal(
        await probe.evaluate(() => document.documentElement.lang),
        'en-US',
        'The page opened in Arabic, so no locale would commit before the deferred block hydrates',
      );
      await probe.locator('[data-locale-choice="ar-EG"]').click();
    } else {
      // No locale commits in a document here, so the Arabic block is hydrated from the Arabic
      // origin's own server HTML, which is the same claim reached the only way this policy has.
      await probe.goto(siteUrl(addresses.path('home', 'ar-EG'), 'ar-EG'), {
        waitUntil: 'networkidle',
      });
    }
    await probe.waitForFunction(
      () => document.documentElement.lang === 'ar-EG',
    );
    await probe.locator('[data-incremental-action]').click();
    // The refusal names the text the block kept, because a timeout names only the wait, and a
    // boundary left in the render locale is the one defect this stage exists to report: whether
    // Angular stops writing over claimed DOM or the content stops following the commit, what the
    // reader sees is the server's words inside a page in another language.
    const expectedMessage = 'حد الترجمة التدريجي جاهز.';
    await probe
      .waitForFunction(
        (expected) =>
          document
            .querySelector('[data-incremental-message]')
            ?.textContent?.includes(expected) === true,
        expectedMessage,
        { timeout: 10_000 },
      )
      .catch(async () => {
        const found = await probe
          .locator('[data-incremental-message]')
          .textContent()
          .catch(() => 'ABSENT');
        assert.fail(
          `The deferred block, hydrated with ar-EG committed, kept ${JSON.stringify(found?.trim())} rather than ${JSON.stringify(expectedMessage)}: localized content inside a hydration boundary is not part of the committed representation`,
        );
      });
    // The click that triggered hydration is also a click on the button inside the block, and it
    // still lands. Rebuilding the content in the committed locale must not cost the interaction
    // that asked for it.
    //
    // Waited for rather than read once, and the two are not interchangeable. The wait above is on
    // the *message*, and the count is written by a different pass; reading it immediately
    // afterwards asks whether the count has already landed, not whether it lands. The count is '0'
    // at the first sample and '1' from roughly 50ms onward, stable for the remaining two seconds,
    // so a single read depends on timing the behaviour does not fix.
    //
    // The failure names the value it actually found, because 'expected 1' on its own cannot tell a
    // lost interaction from one that had not arrived yet, and that distinction is the whole
    // question this stage exists to answer.
    const expectedCount = '1';
    await probe
      .waitForFunction(
        (expected) =>
          document.querySelector('[data-incremental-count]')?.textContent ===
          expected,
        expectedCount,
        { timeout: 10_000 },
      )
      .catch(async () => {
        const found = await probe
          .locator('[data-incremental-count]')
          .textContent()
          .catch(() => 'ABSENT');
        assert.fail(
          `Rebuilding the deferred boundary lost the interaction that triggered it: the count settled at ${JSON.stringify(found)}, expected ${JSON.stringify(expectedCount)}`,
        );
      });
    await probe.close();
  }

  enterStage(`${row.id}-incremental-hydration`);
  const incrementalBefore = await page.$('[data-incremental-boundary]');
  assert.notEqual(
    incrementalBefore,
    null,
    'Incremental SSR boundary is absent',
  );
  await page.locator('[data-incremental-action]').click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-incremental-count]')
        ?.textContent?.trim() === '1',
  );
  assert.equal(
    await incrementalBefore.evaluate(
      (element) =>
        element === document.querySelector('[data-incremental-boundary]'),
    ),
    true,
    'Incremental hydration replaced its transferred boundary',
  );

  await verifyLocaleSwitches(row, page, events);

  await verifyClientNavigation(row, page);

  await verifyDynamicArticle(row, page);

  await collectPolicyDiagnostics(page, diagnostics);

  enterStage(`${row.id}-focus-selection-composition-scroll`);
  await visitFor(context, 'home', 'en-US', (url) =>
    page.goto(`${url}?label=${row.id}-continuity`),
  );
  await page.waitForFunction(
    () => document.documentElement.dataset['clientReady'] === 'true',
  );
  await exerciseLocaleContinuity(page, row);
  await assertDirectAccessibility(page, row);
  await auditAccessibility(page, row, 'home in en-US');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.evaluate(
      () => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
    true,
  );
  await page.locator('[data-locale-choice="ar-EG"]').click();
  await page.waitForURL((url) => isShown(url, 'home', 'ar-EG'));
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'ar-EG' &&
      document.documentElement.dir === 'rtl',
  );
  await auditAccessibility(page, row, 'home in ar-EG');
  await page.locator('[data-locale-choice="en-US"]').click();
  await page.waitForURL((url) => isShown(url, 'home', 'en-US'));
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'en-US' &&
      document.documentElement.dir === 'ltr',
  );
  await collectPolicyDiagnostics(page, diagnostics);

  enterStage(`${row.id}-prerender-csr`);
  await verifyRenderingModes(row, context, diagnostics);

  enterStage(`${row.id}-exercise-sheets`);
  await verifyExerciseSheets(row, context, diagnostics);

  enterStage(`${row.id}-declared-outcomes`);
  await verifyDeclaredOutcomes(row, context, diagnostics);

  enterStage(`${row.id}-declared-shells`);
  await verifyDeclaredShells(row, context, diagnostics);

  enterStage(`${row.id}-named-route-scopes`);
  await verifyNamedRouteScopes(row, context, diagnostics);

  enterStage(`${row.id}-locale-aliases`);
  await verifyLocaleAliases(row, context, diagnostics);

  enterStage(`${row.id}-pseudo-locale`);
  await verifyPseudoLocale(row, diagnostics);

  enterStage(`${row.id}-locale-sources`);
  await verifyLocaleSources(row, diagnostics);

  enterStage(`${row.id}-switch-endurance`);
  await verifySwitchEndurance(page, row);
  await collectPolicyDiagnostics(page, diagnostics);

  enterStage(`${row.id}-back-forward-restore`);
  const backForward = await verifyBackForwardRestore(row, context, diagnostics);

  if (embedded !== undefined) {
    // Once where the reader's languages name no locale the panel offers, and once where they do.
    for (const languages of ['fr-FR', 'en-US']) {
      enterStage(`${row.id}-embedded-panel-${languages}`);
      await verifyEmbeddedPanel(row, languages);
    }
    enterStage(`${row.id}-embedded-recovery`);
    await verifyEmbeddedRecovery(row);
  }

  assertBrowserDiagnostics(diagnostics, `${row.label} ${evidence.version}`);
  Object.assign(evidence, { outcome: 'verified', trustedTypes, backForward });

  await context.close();
  context = undefined;
  page = undefined;
  await browser.close();
  browser = undefined;
}

let browser;
let context;
let page;
/** The cookies the last step with a context of its own handed back to the row's. */
let returnedCookies;
let releaseScriptRequests = () => {};
let verificationFailure;
let verificationDiagnostics;
/** The diagnostics of the row in progress, which the failure block reports. */
let browserDiagnostics;
/**
 * Every browser row, from before the first one starts, with how far each got.
 *
 * The failure block below is the only reader of this, and a row enters on the way in rather than
 * on the way out. A row recorded on the way out is a row that passed, so the block would describe
 * the engines that had already succeeded and say nothing about the one that had not, nor about the
 * ones that never started. Identity on entry, outcome on exit.
 */
const browserEvidence = browserRows.map((row) => ({
  id: row.id,
  label: row.label,
  outcome: 'not started',
}));

function browserRowEvidence(row) {
  const evidence = browserEvidence.find(({ id }) => id === row.id);
  assert.notEqual(
    evidence,
    undefined,
    `Browser assurance has no evidence entry for ${row.id}.`,
  );
  return evidence;
}

try {
  if (selfTest === 'diagnostics') {
    throw new Error('Self-test escape: a failure inside the verified run.');
  }

  enterStage('host-outcomes');
  // Only a policy that prefixes every locale has an address naming none, and so an entry to send
  // a visitor on from.
  if (addresses.entryRedirects) {
    // No remembered preference, and still not publicly cacheable.
    //
    // Making this `public` because the answer is the same for every visitor who
    // arrives without a cookie, which is true and is not the question. The two fetches below are the
    // question: they are the same URL, they get different answers, and a shared cache keys on the URL.
    // Whichever of them is stored public is the one every subsequent visitor receives.
    const localeEntry = await answer('/', { redirect: 'manual' });
    assert.equal(localeEntry.status, 307);
    assert.equal(
      localeEntry.headers.get('location'),
      addresses.path('home', 'en-US'),
    );
    assert.equal(localeEntry.headers.get('cache-control'), 'private, no-cache');
    // The same URL with a remembered preference. The visitor lands in Arabic instead of landing in
    // English and switching by hand, and this is the response that proves the one above cannot be
    // public. Different body, different `Location`, same cache key.
    const negotiatedEntry = await answer('/', {
      redirect: 'manual',
      headers: { cookie: 'equator-locale=ar-EG' },
    });
    assert.equal(negotiatedEntry.status, 307);
    assert.equal(
      negotiatedEntry.headers.get('location'),
      addresses.path('home', 'ar-EG'),
    );
    assert.equal(
      negotiatedEntry.headers.get('cache-control'),
      'private, no-cache',
    );
    assert.notEqual(
      localeEntry.headers.get('location'),
      negotiatedEntry.headers.get('location'),
      'Both entry fetches produced the same address, so this run proves nothing about two answers sharing one cache key.',
    );
    // A preference for a language this application does not offer is ignored rather than turned
    // into an error about a URL that was perfectly valid.
    const unusableEntry = await answer('/', {
      redirect: 'manual',
      headers: { cookie: 'equator-locale=zz-ZZ' },
    });
    assert.equal(unusableEntry.status, 307);
    assert.equal(
      unusableEntry.headers.get('location'),
      addresses.path('home', 'en-US'),
    );
    // And a preference for a locale this policy *does* address, which this build did not generate.
    // `zz-ZZ` above was refused by the policy alone and proves nothing about the build; `en-Arab-XB`
    // has a prefix written for it in `route-policy.ts` and exists only under
    // `equator generate --pseudo`. Until the served policy was narrowed to the generated locale set
    // this answered `/en-arab-xb`, and the address behind it rendered as a success in markup
    // labelled `lang="en-Arab-XB"` with English text inside it (4.16).
    const unbuiltEntry = await answer('/', {
      redirect: 'manual',
      headers: { cookie: 'equator-locale=en-Arab-XB' },
    });
    assert.equal(unbuiltEntry.status, 307);
    assert.equal(
      unbuiltEntry.headers.get('location'),
      addresses.path('home', 'en-US'),
    );
  }
  // Where no address names a locale there is no address of an unbuilt one to ask for, and none
  // that states its own locale to hold to a public answer. Where the origin names it, no deployment
  // answers at an unbuilt locale's origin, so the question has no server to put it to.
  if (addresses.localeInAddress && !addresses.localeInOrigin) {
    // The address directly, which is the half no preference check reaches: a link, a bookmark, or a
    // crawler that read the prefix somewhere and came back for it.
    const unbuiltAddress = await answer(
      addresses.path('second', 'en-Arab-XB'),
      { redirect: 'manual', locale: 'en-Arab-XB' },
    );
    assert.equal(unbuiltAddress.status, 404);
    // The control for both, in the same shape and through the same policy: a locale this build does
    // have still answers at its own address, so neither assertion above is passing because the
    // application stopped resolving anything.
    const builtAddress = await answer(addresses.path('second', 'ar-EG'), {
      redirect: 'manual',
      locale: 'ar-EG',
    });
    assert.equal(builtAddress.status, 200);
    assert.equal(builtAddress.headers.get('content-language'), 'ar-EG');
    // The cache header on a 200, which nothing in this file had ever read.
    //
    // That gap is why the fixture's `successMaxAge: 0` went unnoticed twice. A zero makes every
    // `public` response revalidate on every request, so it behaves privately, so a classification
    // that should have been private and was not looks exactly like one that is right. Two separate
    // defects (locale entry, and a locale-neutral 200) were each safe here by that accident
    // rather than by the design, and neither could have been caught by a gate that reads the
    // classification's consequences only for redirects.
    //
    // The fixture now sets 600, and this pins what falls out. The Arabic second page's address states
    // its own locale, so it is the same document for every visitor and `public` is the right answer: this is the
    // control that keeps the varying classification from quietly spreading to addresses that do not
    // vary. `Vary` must be absent for the same reason.
    assert.equal(
      builtAddress.headers.get('cache-control'),
      declaresNoRevalidation
        ? 'public, max-age=600'
        : 'public, max-age=600, must-revalidate',
    );
    assert.equal(builtAddress.headers.get('vary'), null);
  }
  // A route that declares itself per visitor. The toolkit read the declaration out of the route
  // file, the generated table carries it, and the handler raised the page to it.
  const perVisitorPage = await answer(addresses.path('lazy', 'en-US'), {
    redirect: 'manual',
  });
  assert.equal(perVisitorPage.status, 200);
  assert.equal(
    perVisitorPage.headers.get('cache-control'),
    'private, no-cache',
  );
  // A miswritten locale segment is corrected only where the locale is a segment of every address.
  if (addresses.entryRedirects) {
    const correction = await answer('/EN-US/Second/', { redirect: 'manual' });
    assert.equal(correction.status, 308);
    assert.equal(
      correction.headers.get('location'),
      addresses.path('second', 'en-US'),
    );
    assert.equal(
      correction.headers.get('cache-control'),
      'public, max-age=86400',
    );
  }
  const historicalReplacement = await answer(
    `${addresses.path('legacy', 'en-US')}?tab=one`,
    { redirect: 'manual' },
  );
  assert.equal(historicalReplacement.status, 308);
  assert.equal(
    historicalReplacement.headers.get('location'),
    `${addresses.address('second', 'en-US')}?tab=one`,
  );
  // The floor a deployment declares for every page, where its table says it declares one. The
  // second page is otherwise shared under this policy, so the floor is what makes it private, and
  // the replacement above is a redirect, which carries no page and keeps the class routing gave it.
  if (addresses.pageCaching !== undefined) {
    const floored = await answer(addresses.path('second', 'en-US'), {
      redirect: 'manual',
    });
    assert.equal(floored.status, 200);
    assert.equal(
      floored.headers.get('cache-control'),
      addresses.pageCaching === 'not-stored'
        ? 'private, no-store'
        : 'private, no-cache',
      'The floor this deployment declares for every page did not raise one',
    );
    assert.equal(
      historicalReplacement.headers.get('cache-control'),
      'public, max-age=86400',
      'The floor this deployment declares for every page reached a redirect',
    );
  }
  // The locale a retired address answers in is the one it states, so only an address that states
  // one can show it is not the default.
  const goneLocale = addresses.localeInAddress ? 'ar-EG' : 'en-US';
  const historicalGone = await answer(addresses.path('removed', goneLocale), {
    redirect: 'manual',
    locale: goneLocale,
  });
  assert.equal(historicalGone.status, 410);
  assert.equal(historicalGone.headers.get('content-language'), goneLocale);
  assert.equal(historicalGone.headers.get('x-robots-tag'), 'noindex');
  assert.equal(
    historicalGone.headers.get('cache-control'),
    'private, no-store',
  );
  // An empty segment written into an address that is otherwise one, which no policy repairs.
  const malformed = await answer(
    addresses.path('second', 'en-US').replace(/\/(?=[^/]*$)/u, '//'),
    { redirect: 'manual' },
  );
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('content-language'), 'en-US');
  assert.equal(malformed.headers.get('x-robots-tag'), 'noindex');
  assert.equal(malformed.headers.get('cache-control'), 'private, no-store');
  // A locale-shaped first segment names a locale only where every locale is one.
  if (addresses.entryRedirects) {
    const unsupported = await answer('/fr/second', { redirect: 'manual' });
    assert.equal(unsupported.status, 404);
    assert.equal(unsupported.headers.get('content-language'), 'en-US');
    assert.equal(unsupported.headers.get('x-robots-tag'), 'noindex');
  }
  const nonIndexable = await answer(addresses.path('item', 'en-US'));
  assert.equal(nonIndexable.status, 200);
  assert.equal(nonIndexable.headers.get('content-language'), 'en-US');
  assert.equal(nonIndexable.headers.get('x-robots-tag'), 'noindex');
  const prerendered = await answer(addresses.path(prerenderedPage, 'en-US'));
  assert.equal(prerendered.status, 200);
  assert.equal(prerendered.headers.get('content-language'), 'en-US');
  const prerenderedDocument = new JSDOM(await prerendered.text()).window
    .document;
  assert.equal(
    prerenderedDocument
      .querySelector('link[rel="canonical"]')
      ?.getAttribute('href'),
    addresses.url(prerenderedPage, 'en-US'),
  );
  // A revalidation of that page, which is what a browser sends on a reload and a cache sends when
  // its copy goes stale. The engine answers a matching ETag with 304 and no content, and a 304 sent
  // on as 200 is an empty page the cache then keeps for this address.
  const etag = prerendered.headers.get('etag');
  assert.ok(
    etag !== null,
    'the prerendered page carries no ETag, so nothing here can revalidate it',
  );
  const revalidated = await answer(addresses.path(prerenderedPage, 'en-US'), {
    headers: { 'if-none-match': etag },
  });
  assert.equal(
    revalidated.status,
    304,
    `a revalidation of the prerendered page answered ${revalidated.status}`,
  );
  assert.equal(await revalidated.text(), '');
  // The fields RFC 9110 section 15.4.5 has a 304 repeat from the 200 it stands for, and no
  // description of a representation it does not carry.
  assert.equal(
    revalidated.headers.get('cache-control'),
    prerendered.headers.get('cache-control'),
  );
  assert.equal(
    revalidated.headers.get('vary'),
    prerendered.headers.get('vary'),
  );
  assert.equal(revalidated.headers.get('content-language'), null);
  // A page that declares its own spelling of a parameter, asked for under the codec's. The runtime
  // corrects the address during the render, and a correction is a routing outcome with the status
  // section 5 of the routing specification gives it, whatever the engine's own default is.
  if (
    addresses.has('declared dossier', 'ar-EG') &&
    addresses.path('dossier', 'ar-EG') !==
      addresses.path('declared dossier', 'ar-EG')
  ) {
    const corrected = await answer(addresses.path('dossier', 'ar-EG'), {
      redirect: 'manual',
      locale: 'ar-EG',
    });
    assert.equal(
      corrected.status,
      308,
      `the codec's spelling of the declared dossier answered ${corrected.status}`,
    );
    assert.equal(
      new URL(
        corrected.headers.get('location') ?? '',
        addresses.origin('ar-EG'),
      ).pathname,
      addresses.path('declared dossier', 'ar-EG'),
    );
    assert.equal(await corrected.text(), '');
  }
  // A page asked for under another locale's slug is sent to its own, which needs a slug per locale.
  if (addresses.has('article under the English slug', 'ar-EG')) {
    const articleAlias = await answer(
      addresses.path('article under the English slug', 'ar-EG'),
      { redirect: 'manual', locale: 'ar-EG' },
    );
    assert.equal(articleAlias.status, 308);
    assert.equal(
      articleAlias.headers.get('location'),
      addresses.address('article', 'ar-EG'),
    );
  }

  // Follow it. Asserting the redirect and stopping there proves Equator can name the address, not
  // that anything serves it, and this is precisely the address that does not serve itself.
  //
  // The build writes the page at the decoded spelling on disk while the browser asks for it encoded.
  // An `@angular/ssr` that looks it up without decoding keeps its key percent-encoded and misses
  // the asset the same build produced, leaving the address to the fixture's directory fallback.
  // From 22.1.7 it decodes first (`baf1ca1`; `AngularServerApp.buildServerAssetPathFromRequest`,
  // read at 22.2.1) and serves this address from its own prerendered file: 200,
  // `ng-server-context="ssg"`.
  //
  // The assertion does not move with the version. It says the address serves, in the language it
  // claims, from whichever half of this deployment answers, which is the deployment requirement in
  // section 9.1 measured rather than written down, and it holds whichever half answers. A check
  // written against the mechanism would stay green when the mechanism changes and tell nobody.
  //
  // Only a policy that writes the Arabic article at an address of its own has that address to ask
  // for.
  if (addresses.has('article', 'ar-EG')) {
    const encodedArticle = await answer(addresses.path('article', 'ar-EG'), {
      locale: 'ar-EG',
    });
    assert.equal(
      encodedArticle.status,
      200,
      'the prerendered non-ASCII address is not served',
    );
    const encodedDocument = new JSDOM(await encodedArticle.text()).window
      .document;
    assert.equal(encodedDocument.documentElement.lang, 'ar-EG');
    assert.equal(
      encodedDocument.title,
      '\u062f\u0644\u064a\u0644 Equator \u0644\u0644\u062a\u0631\u062c\u0645\u0629',
    );
    assert.equal(
      encodedDocument
        .querySelector('link[rel="canonical"]')
        ?.getAttribute('href'),
      addresses.url('article', 'ar-EG'),
    );
  }
  const articleResponse = await answer(addresses.path('article', 'en-US'));
  assert.equal(articleResponse.status, 200);
  const articleDocument = new JSDOM(await articleResponse.text()).window
    .document;
  assert.equal(articleDocument.title, 'The Equator localization handbook');
  assert.equal(
    articleDocument
      .querySelector('meta[name="description"]')
      ?.getAttribute('content'),
    'Consumer-owned content coordinated through metadata only.',
  );
  assert.equal(
    articleDocument
      .querySelector('link[rel="canonical"]')
      ?.getAttribute('href'),
    addresses.url('article', 'en-US'),
  );
  assert.deepEqual(
    [...articleDocument.querySelectorAll('link[rel="alternate"]')].map(
      (node) => [node.getAttribute('hreflang'), node.getAttribute('href')],
    ),
    [
      ...builtLocales
        .filter((locale) => addresses.has('article', locale))
        .map((locale) => [locale, addresses.url('article', locale)]),
      ['x-default', new URL('/', addresses.origin('en-US')).href],
    ],
  );

  // The sitemap, fetched from the running build rather than derived beside it.
  //
  // Three claims, and the third is the one this exists for. Every address the file publishes is
  // served by this site: fetched, one by one, and answered 200 in the language it claims. The file
  // validates as a document. And the alternates it carries for a page are the alternates that
  // page's own head carries, element for element, because both come from `projectRouteSeo` and
  // there is no second derivation to drift.
  const sitemapResponse = await answer('/sitemap.xml');
  assert.equal(sitemapResponse.status, 200);
  assert.match(
    sitemapResponse.headers.get('content-type') ?? '',
    /^application\/xml/u,
    'the sitemap is not served as XML',
  );
  const sitemapText = await sitemapResponse.text();
  const sitemapDocument = new JSDOM(sitemapText, {
    contentType: 'text/xml',
  }).window.document;

  const publishedUrls = [...sitemapDocument.querySelectorAll('url')].map(
    (entry) => entry.querySelector('loc')?.textContent ?? '',
  );
  // The two parameterless indexable routes and the one article, at each address the table gives
  // them in a locale this build generated. `items` is non-indexable and `lazy` is not published,
  // so neither is here: the indexing class does in a sitemap what it does in the head. A sitemap
  // agrees with the origin of the deployment serving it, so where each locale is an origin of its
  // own the file lists that origin's locale alone.
  const sitemapLocales = new Map(
    ['second', 'article', 'home'].flatMap((page) =>
      deploymentOf('en-US')
        .locales.filter((locale) => addresses.has(page, locale))
        .map((locale) => [addresses.url(page, locale), locale]),
    ),
  );
  assert.deepEqual(
    publishedUrls,
    [...sitemapLocales.keys()],
    `the sitemap publishes the wrong set of addresses:\n${publishedUrls.join('\n')}`,
  );

  // What the routes claim, read out of the served file. `second` is `reference`, which the
  // declaration in `app.config.ts` maps to monthly at 0.5, and it declares its own `updated` date.
  // The article's class is not in that table, so it claims nothing, and its entry is complete
  // without one.
  const secondEntry = [...sitemapDocument.querySelectorAll('url')].find(
    (entry) =>
      entry.querySelector('loc')?.textContent ===
      addresses.url('second', 'en-US'),
  );
  assert.equal(
    secondEntry?.querySelector('lastmod')?.textContent,
    '2026-09-01',
  );
  assert.equal(
    secondEntry?.querySelector('changefreq')?.textContent,
    'monthly',
  );
  assert.equal(secondEntry?.querySelector('priority')?.textContent, '0.5');
  const articleEntry = [...sitemapDocument.querySelectorAll('url')].find(
    (entry) =>
      entry.querySelector('loc')?.textContent ===
      addresses.url('article', 'en-US'),
  );
  assert.equal(articleEntry?.querySelector('changefreq'), null);
  assert.equal(articleEntry?.querySelector('priority'), null);

  // The head and the sitemap, compared rather than each written out. `articleDocument` above is
  // the page this site served at that address; these are the links the same site published for it.
  assert.deepEqual(
    [...(articleEntry?.getElementsByTagName('xhtml:link') ?? [])].map(
      (node) => [node.getAttribute('hreflang'), node.getAttribute('href')],
    ),
    [...articleDocument.querySelectorAll('link[rel="alternate"]')].map(
      (node) => [node.getAttribute('hreflang'), node.getAttribute('href')],
    ),
    'the sitemap and the head advertise different alternates',
  );

  // Every entry served. The file states the site's own origin and the harness reaches it on a
  // loopback port, so the path is what is fetched, which is the same substitution a reader makes.
  //
  // Read out of the page rather than off the response headers, for the reason the encoded article
  // above gives: this deployment has two halves that answer, and which one answers an address
  // moves with the engine's version. The prerendered file carries the language on the document and
  // no robots meta, whichever half hands it over; `Content-Language` and `X-Robots-Tag` are set by
  // the half that runs Equator. So a header assertion here would be a claim about the plumbing, and
  // what the sitemap promises is a page: at this address, in this language, open to a crawler.
  for (const published of publishedUrls) {
    const path = new URL(published).pathname;
    const served = await answer(path, {
      locale: sitemapLocales.get(published),
    });
    assert.equal(
      served.status,
      200,
      `${published} is published and not served`,
    );
    const servedDocument = new JSDOM(await served.text()).window.document;
    assert.equal(
      servedDocument.documentElement.lang,
      sitemapLocales.get(published),
      `${published} is served in the wrong language`,
    );
    // Equator writes this element only for a page it classes out of the index, so its absence is
    // the assertion. An indexable page carries no robots meta at all.
    assert.equal(
      servedDocument.querySelector('meta[name="robots"]'),
      null,
      `${published} is published in the sitemap and refused to crawlers`,
    );
  }

  enterStage('server-seat');
  await verifySeatAgainstDeployments();

  enterStage('parallel-ssr');
  const [alphaHtml, bravoHtml, titledHtml, dossierHtml] = await Promise.all([
    render('alpha-request', 'en-US'),
    render('bravo-request', 'ar-EG'),
    // 8.2. The one route in this application that declares a `title` in its route config, rendered
    // under a locale whose title is not that string.
    //
    // `second` declares `'Second route, declared in English'`. Angular's `DefaultTitleStrategy`
    // writes a declared title after `NavigationEnd`, which is after Equator has written the
    // localized one, so on a server render this is where the two writers meet. The provider line in
    // `app.config.ts` is what decides it: take it out and this document says the English string
    // under `lang="ar-EG"`, with nothing thrown and nothing logged.
    render('titled-request', 'ar-EG', 'second'),
    // 8.4. The route whose slug no codec can translate, server-rendered.
    //
    // `dossierSlugCodec` is identity, so left to itself Equator advertises the English slug under
    // the Arabic prefix. The page's component loads the record and declares the per-locale
    // spellings, and this is the only place that proves the declaration survives a server render:
    // it lands on a promise after the route activates, so a render that serialized the head before
    // the application went stable would ship the codec's answer and look entirely normal.
    render('dossier-request', 'en-US', 'dossier'),
  ]);
  const alpha = readSnapshot(alphaHtml);
  const bravo = readSnapshot(bravoHtml);

  assert.equal(alpha.document.documentElement.lang, 'en-US');
  assert.equal(alpha.document.documentElement.dir, 'ltr');
  assert.equal(alpha.document.title, 'Equator feature lab');
  assert.equal(
    alpha.document
      .querySelector('meta[name="description"]')
      ?.getAttribute('content'),
    'Equator localization runtime feature laboratory.',
  );
  assert.equal(
    alpha.document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    addresses.url('home', 'en-US'),
  );
  assert.deepEqual(
    [...alpha.document.querySelectorAll('link[rel="alternate"]')].map((node) =>
      node.getAttribute('hreflang'),
    ),
    [
      ...builtLocales.filter((locale) => addresses.has('home', locale)),
      'x-default',
    ],
  );
  assert.match(
    alpha.document.querySelector('h1')?.textContent ?? '',
    /Equator feature lab/,
  );
  assert.equal(
    alpha.document
      .querySelector('[data-incremental-message]')
      ?.textContent?.trim(),
    'Incremental localization boundary ready.',
  );
  assert.equal(bravo.document.documentElement.lang, 'ar-EG');
  assert.equal(bravo.document.documentElement.dir, 'rtl');
  assert.equal(bravo.document.title, 'مختبر ميزات Equator');

  // Asserted on the rendered document, and asserted twice: what the title is, and what it is not.
  // The second is the load-bearing one: the failure mode is a *different valid title*, not a
  // missing one, so an assertion that the title is non-empty would be green for the defect.
  const titled = readSnapshot(titledHtml);
  assert.equal(titled.document.documentElement.lang, 'ar-EG');
  assert.equal(
    titled.document
      .querySelector('[data-route-view]')
      ?.getAttribute('data-route-view'),
    'second',
    'the titled route did not render, so its title proves nothing',
  );
  // 8.3. This route's own title, from the Arabic catalog, keyed by its route id. Not the home
  // page's title, which is what an application serves when the strategy keys on nothing, and not
  // the English string its route config declares, which is what Angular writes on its own.
  // Three distinct strings, so this assertion cannot pass by accident on any of the three paths.
  assert.equal(titled.document.title, 'العنوان الثاني');
  assert.notEqual(
    titled.document.title,
    'Second route, declared in English',
    'Angular wrote the route-declared title over the localized one',
  );
  assert.notEqual(
    titled.document.title,
    bravo.document.title,
    'the titled route served the home page metadata, so route ids are not being read',
  );
  assert.equal(
    titled.document
      .querySelector('meta[name="description"]')
      ?.getAttribute('content'),
    'عنوان ثانٍ، لإثبات أن بيانات كل صفحة خاصة بها.',
  );
  const dossier = readSnapshot(dossierHtml);
  assert.equal(
    dossier.document
      .querySelector('[data-route-view]')
      ?.getAttribute('data-entity-id'),
    'dossier',
    'the dossier route did not load its record, so its address proves nothing',
  );
  const dossierAlternate = (hreflang) =>
    dossier.document
      .querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`)
      ?.getAttribute('href');
  // Only a policy that writes the Arabic dossier at an address of its own advertises one.
  if (addresses.has('declared dossier', 'ar-EG')) {
    assert.equal(
      dossierAlternate('ar-EG'),
      addresses.url('declared dossier', 'ar-EG'),
    );
    // The codec's own answer, stated so this cannot pass by falling back to it.
    assert.notEqual(
      dossierAlternate('ar-EG'),
      addresses.url('dossier', 'ar-EG'),
    );
  }
  assert.equal(
    dossier.document
      .querySelector('link[rel="canonical"]')
      ?.getAttribute('href'),
    addresses.url('declared dossier', 'en-US'),
  );
  assert.match(
    bravo.document.querySelector('h1')?.textContent ?? '',
    /مختبر ميزات Equator/,
  );
  assert.equal(
    bravo.document
      .querySelector('[data-incremental-message]')
      ?.textContent?.trim(),
    'حد الترجمة التدريجي جاهز.',
  );
  // 8.1. Open Graph, on a server-rendered Arabic page, in the spelling ogp.me specifies.
  //
  // The failure this is written against is the one a hand-written implementation produces: the
  // runtime locale emitted unchanged, so the tag reads `ar-EG`. That is valid BCP 47, it matches
  // every other locale-shaped value in this document, and ogp.me says "Of the format
  // `language_TERRITORY`". Asserted on the rendered document rather than on the helper, because the
  // helper being right does not prove the head carries what it returned.
  const openGraph = (snapshot, name) =>
    [...snapshot.document.querySelectorAll(`meta[property="${name}"]`)].map(
      (node) => node.getAttribute('content'),
    );

  // The other languages a page is available in are the locales it has an address in, so under
  // locale-neutral the English page lists none and the Arabic one lists English.
  const socialLocale = { 'en-US': 'en_US', 'ar-EG': 'ar_EG' };
  const socialAlternates = (page, own) =>
    builtLocales
      .filter((locale) => locale !== own && addresses.has(page, locale))
      .map((locale) => socialLocale[locale]);
  assert.deepEqual(openGraph(bravo, 'og:locale'), ['ar_EG']);
  assert.deepEqual(
    openGraph(bravo, 'og:locale:alternate'),
    socialAlternates('home', 'ar-EG'),
  );
  assert.deepEqual(openGraph(alpha, 'og:locale'), ['en_US']);
  assert.deepEqual(
    openGraph(alpha, 'og:locale:alternate'),
    socialAlternates('home', 'en-US'),
  );

  // The page's own locale must not also be listed as an alternate: that would say the page is
  // available in the language it is written in.
  for (const [snapshot, own] of [
    [alpha, 'en_US'],
    [bravo, 'ar_EG'],
  ]) {
    assert.equal(
      openGraph(snapshot, 'og:locale:alternate').includes(own),
      false,
      `${own} is listed as an alternate of itself`,
    );
  }

  // Open Graph is addressed by `property`. A block written with `name` is silently ignored by the
  // crawler it was written for, and nothing about it looks wrong, so the attribute is pinned.
  assert.equal(
    bravo.document.querySelectorAll('meta[name="og:locale"]').length,
    0,
    'Open Graph tags must use property=, not name=',
  );
  // And the card tag is the other way round, which is why both are checked.
  assert.equal(
    bravo.document
      .querySelector('meta[name="twitter:card"]')
      ?.getAttribute('content'),
    'summary_large_image',
  );
  assert.equal(
    bravo.document.querySelectorAll('meta[property="twitter:card"]').length,
    0,
    'card tags must use name=, not property=',
  );

  // The rest of the block, including the four ogp.me calls required, and the description in Arabic
  // rather than the source locale.
  assert.deepEqual(openGraph(bravo, 'og:title'), ['مختبر ميزات Equator']);
  assert.deepEqual(openGraph(bravo, 'og:type'), ['website']);
  assert.deepEqual(openGraph(bravo, 'og:image'), [
    'https://site.example/social/preview.png',
  ]);
  assert.deepEqual(openGraph(bravo, 'og:url'), [
    addresses.shownUrl('home', 'ar-EG'),
  ]);

  assert.equal(alpha.label, 'alpha-request');
  assert.equal(bravo.label, 'bravo-request');
  assert.equal(alpha.source, 'server-transfer');
  assert.equal(bravo.source, 'server-transfer');
  assert.equal(alpha.locale, 'en-US');
  assert.equal(bravo.locale, 'ar-EG');
  // The addresses travel, and they have to: the server rendered a switcher with them in its links,
  // and a client that hydrated without them would blank those links until the first navigation.
  //
  // They carry the reader's query, and the alternates in the same document do not: `?label=` is
  // this harness's own request marker and stands in for any query a reader arrives with. One
  // derivation, two readers, each forming its own string: a canonical URL states where the page
  // lives and omits the query by `specs/07-routing-rendering-and-seo.spec.md` section 10, and a
  // switch moves the reader to the page they are actually on.
  //
  // `en-Arab-XB` is absent because this server build generated no pseudo-locale, so the policy the
  // adapter holds no longer addresses it. The narrowing is the policy's, not a rule of its own.
  const homeAddresses = (label) =>
    Object.fromEntries(
      builtLocales
        .filter((locale) => addresses.has('home', locale))
        .map((locale) => [
          locale,
          `${addresses.address('home', locale)}?label=${label}`,
        ]),
    );
  assert.deepEqual(alpha.transfer.route, {
    routeId: 'route:_index',
    projectionIdentity: alpha.transfer.route.projectionIdentity,
    canonicalPath: addresses.path('home', 'en-US'),
    addresses: homeAddresses('alpha-request'),
  });
  assert.match(
    alpha.transfer.route.projectionIdentity,
    /^sha256-[A-Za-z0-9_-]{43}$/u,
  );
  assert.deepEqual(bravo.transfer.route, {
    routeId: 'route:_index',
    projectionIdentity: alpha.transfer.route.projectionIdentity,
    canonicalPath: addresses.shownPath('home', 'ar-EG'),
    addresses: homeAddresses('bravo-request'),
  });
  assert.equal(alpha.transfer.formatting.locale, 'en-US');
  assert.equal(bravo.transfer.formatting.locale, 'ar-EG');
  assert.deepEqual(alpha.transfer.participants, [
    {
      profile: 'equator-participant-state/1',
      participantId: 'feature-article',
      coordination: 'required',
      current: {
        targetLocale: 'en-US',
        transitionId: 0,
        report: {
          status: 'ready',
          representation: {
            kind: 'locale-bound',
            supplyingLocale: 'en-US',
            direction: 'ltr',
          },
          identity: {
            resourceId: 'article:handbook',
            representationId: 'article-en',
            revision: 'a-1',
            correlationId: 'source-a:en-US:a-1',
          },
        },
      },
      attempt: {
        status: 'ready',
        targetLocale: 'en-US',
        transitionId: 0,
        report: {
          status: 'ready',
          representation: {
            kind: 'locale-bound',
            supplyingLocale: 'en-US',
            direction: 'ltr',
          },
          identity: {
            resourceId: 'article:handbook',
            representationId: 'article-en',
            revision: 'a-1',
            correlationId: 'source-a:en-US:a-1',
          },
        },
      },
    },
  ]);
  assert.equal(bravo.transfer.participants[0]?.current?.targetLocale, 'ar-EG');
  assert.equal(
    bravo.transfer.participants[0]?.current?.report?.representation
      ?.supplyingLocale,
    'ar-EG',
  );
  assert.equal(
    JSON.stringify(alpha.transfer).includes('consumer-owned-dynamic-payload'),
    false,
    'Equator TransferState retained consumer payload',
  );
  assert.equal(
    JSON.stringify(alpha.transfer).includes(
      'The Equator localization handbook',
    ),
    false,
    'Equator TransferState retained consumer article text',
  );
  assert.equal(
    alpha.dynamicTransfer.article.payloadMarker,
    'consumer-owned-dynamic-payload',
  );
  assert.equal(
    alpha.dynamicTransfer.article.title,
    'The Equator localization handbook',
  );
  assert.equal(alpha.dynamicTransfer.article.supplyingLocale, 'en-US');
  assert.equal(bravo.dynamicTransfer.article.supplyingLocale, 'ar-EG');
  assert.equal(
    alpha.document.querySelector('[data-dynamic-title]')?.textContent?.trim(),
    'The Equator localization handbook',
  );
  assert.equal(
    bravo.document.querySelector('[data-dynamic-title]')?.textContent?.trim(),
    'دليل Equator للترجمة',
  );
  // An attribute-position label has to be in the server's HTML, not written on hydration. A
  // crawler and a screen reader on a page that has not hydrated read the markup as delivered.
  assert.equal(
    alpha.document.querySelector('[data-label]')?.getAttribute('aria-label'),
    'Equator feature lab',
  );
  assert.equal(
    bravo.document.querySelector('[data-label]')?.getAttribute('aria-label'),
    'مختبر ميزات Equator',
  );
  assert.equal(
    alpha.document.querySelector('[data-label-alt]')?.getAttribute('alt'),
    'static alt',
  );
  assert.notEqual(alpha.requestId, bravo.requestId);
  assert.equal(alphaHtml.includes('bravo-request'), false);
  assert.equal(bravoHtml.includes('alpha-request'), false);

  enterStage('ssr-endurance');
  const enduranceRows = Array.from({ length: 32 }, (_, index) => ({
    label: `endurance-${String(index).padStart(2, '0')}`,
    locale: index % 2 === 0 ? 'en-US' : 'ar-EG',
  }));
  const enduranceHtml = await Promise.all(
    enduranceRows.map((row) => render(row.label, row.locale)),
  );
  const enduranceSnapshots = enduranceHtml.map(readSnapshot);
  assert.equal(
    new Set(enduranceSnapshots.map((snapshot) => snapshot.requestId)).size,
    enduranceRows.length,
    'Parallel SSR reused request identities',
  );
  for (const [index, row] of enduranceRows.entries()) {
    const snapshot = enduranceSnapshots[index];
    const html = enduranceHtml[index];
    assert.notEqual(snapshot, undefined);
    assert.notEqual(html, undefined);
    assert.equal(snapshot.label, row.label);
    assert.equal(snapshot.locale, row.locale);
    assert.equal(snapshot.source, 'server-transfer');
    assert.equal(snapshot.document.documentElement.lang, row.locale);
    assert.equal(
      snapshot.document.documentElement.dir,
      row.locale === 'ar-EG' ? 'rtl' : 'ltr',
    );
    assert.equal(snapshot.transfer.participants.length, 1);
    assert.ok(
      snapshot.transfer.participants.length <= 128,
      'SSR participant state exceeded its explicit bound',
    );
    assert.equal(
      JSON.stringify(snapshot.transfer).includes(
        'consumer-owned-dynamic-payload',
      ),
      false,
      'Equator TransferState retained consumer payload during endurance',
    );
    assert.equal(
      snapshot.dynamicTransfer.article.payloadMarker,
      'consumer-owned-dynamic-payload',
    );
    for (const other of enduranceRows) {
      if (other.label !== row.label) {
        assert.equal(
          html.includes(other.label),
          false,
          `${row.label} SSR output leaked ${other.label}`,
        );
      }
    }
  }

  for (const row of browserRows) {
    await verifyBrowserRow(row);
  }
  // The last stage has no successor to report it, so it reports itself.
  leaveStage();
  clearTimeout(stageWatchdog);

  // Read on the green run rather than trusted on a red one. The success line below is built from
  // this array, so a row dropped from the loop would shorten the report and change nothing else:
  // the run would pass having verified two engines while claiming three.
  for (const evidence of browserEvidence) {
    assert.equal(
      evidence.outcome,
      'verified',
      `Browser assurance finished without verifying the ${evidence.label} row, which it reports on: ${JSON.stringify(browserEvidence)}`,
    );
  }

  process.stdout.write(
    [
      `${consumerProfile.label} (Angular ${consumerProfile.angular}, TypeScript ${consumerProfile.typescript}, RxJS ${consumerProfile.rxjs}): SSR isolation, rendering modes, accessibility, strict CSP, and live hydration verified.`,
      ...(offSiteRequests.length === 0
        ? []
        : [
            `Refused at the edge, asked for by a browser rather than a page: ${[...new Set(offSiteRequests)].join(', ')}.`,
          ]),
      ...browserEvidence.map(
        (evidence) =>
          `${evidence.label} ${evidence.version}: Trusted Types ${evidence.trustedTypes ? 'enforced' : 'unsupported by engine; CSP directive retained'}; back-forward restore ${evidence.backForward === 'restored' ? 'verified on a page the engine restored' : "not run, because Playwright turns off this engine's back-forward cache; its listener ran on a dispatched pageshow"}.`,
      ),
    ].join('\n') + '\n',
  );
} catch (error) {
  verificationFailure = error;

  let pageState;
  try {
    pageState = await page?.evaluate(() => ({
      dataset: { ...document.documentElement.dataset },
      probe: document
        .querySelector('[data-ssr-probe]')
        ?.getAttributeNames()
        .reduce(
          (attributes, name) => ({
            ...attributes,
            [name]: document
              .querySelector('[data-ssr-probe]')
              ?.getAttribute(name),
          }),
          {},
        ),
    }));
  } catch (diagnosticError) {
    pageState = { diagnosticError: String(diagnosticError) };
  }
  try {
    if (page !== undefined && browserDiagnostics !== undefined) {
      await collectPolicyDiagnostics(page, browserDiagnostics);
    }
  } catch (diagnosticError) {
    browserDiagnostics.diagnosticError = String(diagnosticError);
  }

  verificationDiagnostics = {
    stage: verificationStage,
    stageElapsedMs: Date.now() - stageEnteredAt,
    browserEvidence,
    browserDiagnostics,
    edgeFailures,
    offSiteRequests,
    pageState,
  };
} finally {
  releaseScriptRequests();
  await Promise.race([
    browser?.close() ?? Promise.resolve(),
    new Promise((resolveClose) => setTimeout(resolveClose, 5_000)),
  ]);
  await closeServer();
}

if (verificationFailure !== undefined) {
  const details = describeError(verificationFailure);
  process.stderr.write(
    `Equator browser assurance failed.\n${details}\n${JSON.stringify(verificationDiagnostics, null, 2)}\n`,
  );
  process.exitCode = 1;
}
