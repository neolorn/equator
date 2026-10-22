import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HttpClient, provideHttpClient, withFetch } from '@angular/common/http';
import {
  Component,
  EnvironmentInjector,
  createEnvironmentInjector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ROUTES, type Routes } from '@angular/router';
import { createPathPrefixLocalePolicy } from '@neolorn/equator';
import {
  provideLocalizedServerRendering,
  type LocalizedServerRenderingOptions,
} from '@neolorn/equator/ssr';
import { configuration } from '#i18n';
import { firstValueFrom } from 'rxjs';

import { appRouteProjection } from './localization.routes';

/**
 * The two things `provideLocalizedServerRendering` hands on to Angular's server rendering.
 *
 * `appShell` and `rendering` are Angular's own, and Equator reads neither. What an application is
 * owed is that each one arrives: a shell it names is a route Angular can render, and a bound it
 * sets on a fetched response is the bound that response is held to. Both are read here through
 * what Angular publishes, the `ROUTES` token and `HttpClient`, in an injector built from the
 * providers the call returns.
 *
 * Angular's `provideServerRendering` declares the process a server by setting a global the first
 * time it is called. Spec files share one global, so each case puts it back as it found it, and
 * the last case holds the file to that.
 */

const policy = createPathPrefixLocalePolicy({
  defaultLocale: configuration.defaultLocale,
  locales: Object.fromEntries(
    configuration.locales.map((locale) => [locale, locale.toLowerCase()]),
  ),
});

@Component({ selector: 'server-shell', template: '' })
class ServerShell {}

const globals = globalThis as {
  ngServerMode?: boolean | undefined;
  fetch: typeof fetch;
};
const declaredAtLoad = 'ngServerMode' in globals;
const valueAtLoad = globals.ngServerMode;

/** A response of `bytes` bytes that states its length, as a server answering in full does. */
const answering = (bytes: number): typeof fetch =>
  (() =>
    Promise.resolve(
      new Response('x'.repeat(bytes), {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'content-length': String(bytes),
        },
      }),
    )) as typeof fetch;

describe('provideLocalizedServerRendering', () => {
  let injector: EnvironmentInjector | undefined;
  let declared = false;
  let value: boolean | undefined;
  let nativeFetch: typeof fetch;

  beforeEach(() => {
    declared = 'ngServerMode' in globals;
    value = globals.ngServerMode;
    nativeFetch = globals.fetch;
  });

  afterEach(() => {
    injector?.destroy();
    injector = undefined;
    globals.fetch = nativeFetch;
    if (declared) globals.ngServerMode = value;
    else delete globals.ngServerMode;
    TestBed.resetTestingModule();
  });

  /** An injector holding what the call returned, beside an `HttpClient` that fetches. */
  function installed(
    options?: LocalizedServerRenderingOptions,
  ): EnvironmentInjector {
    const rendering =
      options === undefined
        ? provideLocalizedServerRendering(
            policy,
            appRouteProjection,
            configuration,
            [],
          )
        : provideLocalizedServerRendering(
            policy,
            appRouteProjection,
            configuration,
            [],
            options,
          );
    injector = createEnvironmentInjector(
      [rendering, provideHttpClient(withFetch())],
      TestBed.inject(EnvironmentInjector),
    );
    return injector;
  }

  const shellRoutes = (from: EnvironmentInjector): Routes =>
    (from.get(ROUTES, []) as readonly Routes[])
      .flat()
      .filter((route) => route.component === ServerShell);

  const fetched = (
    from: EnvironmentInjector,
    bytes: number,
  ): Promise<string> => {
    globals.fetch = answering(bytes);
    return firstValueFrom(
      from
        .get(HttpClient)
        .get('https://data.example/payload', { responseType: 'text' }),
    );
  };

  it('installs with no options, and adds no route of its own', async () => {
    const from = installed();

    expect(shellRoutes(from)).toEqual([]);
    await expect(fetched(from, 64)).resolves.toHaveLength(64);
  });

  it('makes the application shell a route Angular can render', () => {
    const from = installed({ appShell: ServerShell });

    expect(shellRoutes(from)).toHaveLength(1);
  });

  it('holds a fetched response to the bound `rendering` sets', async () => {
    const from = installed({ rendering: { maxResponseBodySize: 16 } });

    await expect(fetched(from, 16)).resolves.toHaveLength(16);
    await expect(fetched(from, 64)).rejects.toBeDefined();
    expect(shellRoutes(from)).toEqual([]);
  });

  it('hands on both together', async () => {
    const from = installed({
      appShell: ServerShell,
      rendering: { maxResponseBodySize: 16 },
    });

    expect(shellRoutes(from)).toHaveLength(1);
    await expect(fetched(from, 64)).rejects.toBeDefined();
  });
});

describe('the global Angular reads to tell a server from a browser', () => {
  it('is as this file found it', () => {
    expect('ngServerMode' in globals).toBe(declaredAtLoad);
    expect(globals.ngServerMode).toBe(valueAtLoad);
  });
});
