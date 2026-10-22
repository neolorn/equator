// First, and on its own line, for the reason `locale-cookie-defaults.test.ts` states: the stores
// reach `@angular/common`, whose bundle needs a compiler that no plain Node process has.
import '@angular/compiler';

import { DOCUMENT } from '@angular/common';
import { Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';

import {
  type CookieStoreOptions,
  type LocalizationProfileTransport,
  cookieStore,
  memoryStore,
  profileStore,
} from '../src/persistence.js';

/**
 * The stores, asked through the port the runtime asks them through.
 *
 * Each names itself, hands back what it was given, and declines to act where it cannot. The id is
 * what a removal report names a store by, so it is asserted as the value it is.
 */

/** A document whose cookie jar is one string, recording what was last written to it. */
function jar(): { cookie: string; written: string | undefined } {
  const state = {
    written: undefined as string | undefined,
    get cookie(): string {
      return '';
    },
    set cookie(value: string) {
      state.written = value;
    },
  };
  return state;
}

function cookieStoreOn(
  platform: 'browser' | 'server',
  document: { cookie: string },
  options: CookieStoreOptions = {},
) {
  const injector = Injector.create({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: DOCUMENT, useValue: document },
    ],
  });
  return runInInjectionContext(injector, cookieStore(options));
}

describe('the memory store', () => {
  it('names itself, and reads back what was written', async () => {
    const store = memoryStore()();

    expect(store.id).toBe('memory');
    expect(await store.read()).toBeUndefined();

    await store.write('ar-EG');

    expect(await store.read()).toBe('ar-EG');
  });

  it('keeps one value per store built from the factory', async () => {
    const factory = memoryStore();
    const first = factory();
    const second = factory();

    await first.write('ar-EG');

    expect(await second.read()).toBeUndefined();
  });
});

describe('the cookie store', () => {
  it('names itself', () => {
    expect(cookieStoreOn('browser', jar()).id).toBe('cookie');
  });

  it('writes nothing while rendering on the server', async () => {
    // Setting a cookie there means setting a response header, and the response is the host's.
    const document = jar();
    const store = cookieStoreOn('server', document);

    await store.write('ar-EG');

    expect(document.written).toBeUndefined();
  });

  it('forgets nothing while rendering on the server', async () => {
    // An expiry is a write of the same cookie, and the response it would be set on is the host's.
    const document = jar();
    const store = cookieStoreOn('server', document);

    await store.forget?.();

    expect(document.written).toBeUndefined();
  });

  it('writes the domain it was configured with', async () => {
    const document = jar();
    const store = cookieStoreOn('browser', document, {
      domain: 'site.example',
    });

    await store.write('ar-EG');

    expect(document.written?.split('; ')).toContain('Domain=site.example');
  });

  it('writes no domain when none was configured', async () => {
    const document = jar();
    const store = cookieStoreOn('browser', document);

    await store.write('ar-EG');

    expect(document.written).toBeTypeOf('string');
    expect(document.written).not.toContain('Domain=');
  });
});

describe('the profile store', () => {
  it('names itself, and reads and writes through the transport', async () => {
    const sent: string[] = [];
    const store = profileStore({
      read: () => Promise.resolve('ar-EG'),
      write: (locale) => {
        sent.push(locale);
      },
    })();

    expect(store.id).toBe('profile');
    expect(await store.read()).toBe('ar-EG');

    await store.write('en-US');

    expect(sent).toEqual(['en-US']);
  });

  it('reads an answer that is not a locale tag as nothing', async () => {
    const store = profileStore({
      read: () => '<script>',
      write: () => undefined,
    })();

    expect(await store.read()).toBeUndefined();
  });

  it('hands back what the transport answers a write with', () => {
    // The runtime awaits a write before it reports the choice remembered, so a transport's promise
    // has to be the one it waits on.
    const pending = Promise.resolve();
    const store = profileStore({
      read: () => undefined,
      write: () => pending,
    })();

    expect(store.write('en-US')).toBe(pending);
  });

  it('does nothing for a removal the transport has since withdrawn', async () => {
    const transport: {
      -readonly [
        Key in keyof LocalizationProfileTransport
      ]: LocalizationProfileTransport[Key];
    } = {
      read: () => undefined,
      write: () => undefined,
      forget: () => undefined,
    };
    const store = profileStore(transport)();
    delete transport.forget;

    expect(await store.forget?.()).toBeUndefined();
  });
});
