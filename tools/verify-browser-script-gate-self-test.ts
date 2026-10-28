// Drives the browser rows' script gate with a page of its own in place of a browser. A script the
// page asks for during a gated navigation waits for the caller, one asked for at any other time is
// handed on at once, and the page's route is installed once and never removed, because a route
// removed while the page is still asking for scripts leaves a request paused with no one to
// continue it.

import assert from 'node:assert/strict';

import {
  navigateWithScriptGate,
  type ScriptRoute,
} from './browser-script-gate.ts';

const turn = () => new Promise((resolve) => setImmediate(resolve));

interface Navigation {
  readonly url: string;
  readonly options: unknown;
  readonly resolve: (response: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

class Page {
  routes: {
    readonly pattern: string;
    readonly handler: (route: ScriptRoute) => Promise<unknown>;
  }[] = [];
  unrouted = 0;
  navigations: Navigation[] = [];
  route(pattern: string, handler: (route: ScriptRoute) => Promise<unknown>) {
    this.routes.push({ pattern, handler });
    return Promise.resolve();
  }
  unroute() {
    this.unrouted += 1;
    return Promise.resolve();
  }
  unrouteAll() {
    this.unrouted += 1;
    return Promise.resolve();
  }
  goto(url: string, options: unknown) {
    // Assigned by the executor below, which runs before the constructor returns.
    let settle!: Pick<Navigation, 'resolve' | 'reject'>;
    const navigation = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    this.navigations.push({ url, options, ...settle });
    return navigation;
  }
  // A script request, handed to the route as the engine hands it, and what became of it.
  request() {
    assert.equal(this.routes.length, 1, 'the page does not have one route');
    const outcome = { continued: false, fellBack: false };
    void this.routes[0]!.handler({
      continue: () => {
        outcome.continued = true;
        return Promise.resolve();
      },
      fallback: () => {
        outcome.fellBack = true;
        return Promise.resolve();
      },
    });
    return outcome;
  }
}

// A script asked for during the navigation waits for the caller, and one asked for once the caller
// has read the page is continued without waiting for the navigation to end.
{
  const page = new Page();
  let read!: () => void;
  const reading = new Promise<void>((resolve) => {
    read = resolve;
  });
  const navigated = navigateWithScriptGate(page, 'http://host/', () => reading);
  await turn();
  assert.deepEqual(
    page.navigations.map(({ url, options }) => [url, options]),
    [['http://host/', { waitUntil: 'load' }]],
    'the page was not sent to the address, or not waited on until it loaded',
  );
  assert.equal(page.routes[0]!.pattern, '**/*.js');
  const held = page.request();
  await turn();
  assert.deepEqual(
    held,
    { continued: false, fellBack: false },
    'a script ran before the caller had read the page',
  );
  read();
  await turn();
  assert.deepEqual(
    held,
    { continued: true, fellBack: false },
    'the script held for the caller was not continued once the caller had read the page',
  );
  const late = page.request();
  await turn();
  assert.deepEqual(
    late,
    { continued: true, fellBack: false },
    'a script asked for while the page was still loading was not continued',
  );
  page.navigations[0]!.resolve('the response');
  assert.equal(await navigated, 'the response');

  // Nothing holds the page now: a lazy chunk it asks for is handed on at once, to whatever else
  // the page routes.
  const lazy = page.request();
  assert.deepEqual(
    lazy,
    { continued: false, fellBack: true },
    'a script asked for after the navigation was held or answered by the gate itself',
  );

  // The page is navigated again: the route it has is the one it keeps.
  const again = navigateWithScriptGate(page, 'http://host/about', () =>
    Promise.resolve(),
  );
  await turn();
  page.navigations[1]!.resolve('the second response');
  assert.equal(await again, 'the second response');
  assert.equal(
    page.routes.length,
    1,
    'a second navigation gave the page a second route',
  );
  assert.equal(
    page.unrouted,
    0,
    'the route was removed from a page that may still be asking for scripts',
  );
}

// A caller whose reading fails: its error is the one reported, the scripts it held are let go, and
// the page is left with nothing held.
{
  const page = new Page();
  let fail!: (reason: unknown) => void;
  const reading = new Promise((_, reject) => {
    fail = reject;
  });
  const navigated = navigateWithScriptGate(page, 'http://host/', () => reading);
  await turn();
  const held = page.request();
  fail(new Error('the server sent no panel'));
  await assert.rejects(navigated, /the server sent no panel/u);
  await turn();
  assert.deepEqual(
    held,
    { continued: true, fellBack: false },
    'a script stayed held after the caller failed',
  );
  assert.deepEqual(page.request(), { continued: false, fellBack: true });
  assert.equal(page.unrouted, 0);
  page.navigations[0]!.reject(new Error('page closed'));
  await turn();
}

// Each page has a gate of its own.
{
  const first = new Page();
  const second = new Page();
  let read!: () => void;
  const reading = new Promise<void>((resolve) => {
    read = resolve;
  });
  const navigated = navigateWithScriptGate(
    first,
    'http://host/',
    () => reading,
  );
  await turn();
  const other = navigateWithScriptGate(second, 'http://host/', () =>
    Promise.resolve(),
  );
  await turn();
  second.navigations[0]!.resolve('second');
  assert.equal(await other, 'second');
  const held = first.request();
  await turn();
  assert.equal(
    held.continued,
    false,
    'one page ending its navigation let go the scripts of another',
  );
  read();
  first.navigations[0]!.resolve('first');
  assert.equal(await navigated, 'first');
}

console.log('browser script gate self-test: every path behaved as required');
