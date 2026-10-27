/**
 * Holds a page's scripts back until the caller has read what the server sent, then lets them run.
 *
 * A page keeps one route for as long as it lives, and the route is never removed. Removing it
 * switches the engine's interception off, and a page that has just been given its scripts is at
 * that moment asking for the next ones: a lazy chunk Chromium paused for a route that is going
 * away is continued by nobody, and the page waits on it for good. Playwright 1.63.0 clears its
 * own record that interception is on before the engine has acknowledged `Fetch.disable`, so a
 * request it hears of in between is given no route, and the paused request that follows has no
 * owner (`_updateProtocolRequestInterception`, `_onRequestWillBeSent` and `_onRequestPaused` in
 * its Chromium network manager).
 */

/** The part of a script request the gate answers. */
export interface ScriptRoute {
  fallback(): Promise<void>;
  continue(): Promise<void>;
}

/** The part of a page the gate drives, so a page of the self-test's own can stand in for a browser's. */
export interface ScriptGatedPage<Response> {
  route(
    url: string,
    handler: (route: ScriptRoute) => Promise<unknown>,
  ): Promise<unknown>;
  goto(url: string, options: { readonly waitUntil: 'load' }): Promise<Response>;
}

interface Gate {
  readonly state: { closed: Promise<void> | null };
  readonly routed: Promise<unknown>;
}

const SCRIPTS = '**/*.js';

/** Each page's gate: the promise its scripts wait on, or `null` while nothing holds them. */
const gates = new WeakMap<object, Gate>();

function gateOf(page: ScriptGatedPage<unknown>): Gate {
  let gate = gates.get(page);
  if (gate === undefined) {
    const state: Gate['state'] = { closed: null };
    gate = {
      state,
      // A script asked for while nothing holds it falls through to whatever else the page routes,
      // as it would with no route here at all.
      routed: page.route(SCRIPTS, (route) =>
        state.closed === null
          ? route.fallback()
          : state.closed.then(() => route.continue()),
      ),
    };
    gates.set(page, gate);
  }
  return gate;
}

/**
 * Navigates `page` to `url` with every script held until `beforeScripts` settles, and answers with
 * the navigation's response once the page has loaded.
 */
export async function navigateWithScriptGate<Response>(
  page: ScriptGatedPage<Response>,
  url: string,
  beforeScripts: () => Promise<unknown>,
): Promise<Response> {
  const gate = gateOf(page);
  await gate.routed;
  // Assigned by the executor below, which runs before the constructor returns.
  let releaseScripts!: () => void;
  gate.state.closed = new Promise<void>((resolveGate) => {
    releaseScripts = resolveGate;
  });
  const navigation = page.goto(url, { waitUntil: 'load' });
  // When the wait below fails, its error is the one to report. The navigation then rejects as the
  // page closes under it, and unhandled, that rejection ends the process before the wait's error is
  // printed.
  navigation.catch(() => {});

  try {
    await beforeScripts();
    releaseScripts();
    return await navigation;
  } finally {
    releaseScripts();
    gate.state.closed = null;
  }
}
