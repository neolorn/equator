import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  pageAbsent,
  pageGone,
  pageOperationalFailure,
  pageOutcomeHttpDescriptor,
  ɵopenPageOutcomeChannel,
  ɵrememberPageOutcome,
  ɵtakePageOutcome,
  type RouteHttpDescriptor,
} from '@neolorn/equator/core';

/**
 * Exactly which members a declared outcome's descriptor has.
 *
 * A descriptor is read by membership as well as by value: a header is written for each member
 * present, so a member present and undefined is not the same answer as a member left out. Each
 * case states the whole descriptor.
 */

const BARE: RouteHttpDescriptor = { status: 200, cache: 'public' };

const FULL: RouteHttpDescriptor = {
  status: 200,
  contentLanguage: 'ar-EG',
  variesBy: 'locale-preference',
  robots: 'noindex, nofollow',
  cache: 'varies-by-locale-preference',
};

describe('the descriptor of an outcome declared at an address with nothing to carry', () => {
  it('has a status, a robots value and a cache class for an absence', () => {
    expect(pageOutcomeHttpDescriptor(pageAbsent(), BARE)).toStrictEqual({
      status: 404,
      robots: 'noindex',
      cache: 'private-no-store',
    });
  });

  it('has the removal status for a removal', () => {
    expect(pageOutcomeHttpDescriptor(pageGone(), BARE)).toStrictEqual({
      status: 410,
      robots: 'noindex',
      cache: 'private-no-store',
    });
  });

  it('has a status and a cache class for an operational failure', () => {
    expect(
      pageOutcomeHttpDescriptor(pageOperationalFailure(503), BARE),
    ).toStrictEqual({ status: 503, cache: 'private-no-store' });
  });
});

describe('the descriptor of an outcome declared at an address that carries everything', () => {
  it('keeps the language and how it was chosen for an absence', () => {
    expect(pageOutcomeHttpDescriptor(pageAbsent(), FULL)).toStrictEqual({
      status: 404,
      contentLanguage: 'ar-EG',
      variesBy: 'locale-preference',
      robots: 'noindex, nofollow',
      cache: 'private-no-store',
    });
  });

  it('keeps the language, how it was chosen and the indexing for a failure', () => {
    expect(
      pageOutcomeHttpDescriptor(pageOperationalFailure(429), FULL),
    ).toStrictEqual({
      status: 429,
      contentLanguage: 'ar-EG',
      variesBy: 'locale-preference',
      robots: 'noindex, nofollow',
      cache: 'private-no-store',
    });
  });
});

describe('the statuses an operational failure may name', () => {
  it('admits the first and the last status a response can carry', () => {
    expect(pageOperationalFailure(200).status).toBe(200);
    expect(pageOperationalFailure(599).status).toBe(599);
  });

  it('refuses the statuses on either side of them', () => {
    for (const status of [199, 600, 503.5]) {
      expect(() => pageOperationalFailure(status)).toThrow(LocalizationError);
    }
  });
});

describe('two renders open at once', () => {
  it('keeps each declaration with the request it was made against', () => {
    const first = new Request('https://site.example/en-us/second');
    const second = new Request('https://site.example/en-us/second');
    ɵopenPageOutcomeChannel(first);
    ɵopenPageOutcomeChannel(second);

    expect(ɵrememberPageOutcome(first, pageAbsent())).toBe(true);
    expect(ɵrememberPageOutcome(second, pageGone())).toBe(true);

    expect(ɵtakePageOutcome(first)).toEqual({ outcome: 'absent' });
    expect(ɵtakePageOutcome(second)).toEqual({ outcome: 'gone' });
  });
});

describe('where the open channels are held', () => {
  it('is one map under the name of the entry point in the global symbol registry', () => {
    // A server loads this module in two bundles, and a later build may load it beside an earlier
    // one. The name is what every copy asks the registry for, so it is the name that makes them
    // one channel.
    const request = new Request('https://site.example/en-us/second');
    ɵopenPageOutcomeChannel(request);

    const held = (globalThis as unknown as Record<symbol, unknown>)[
      Symbol.for('@neolorn/equator/page-outcome-channels')
    ];

    expect(held).toBeInstanceOf(WeakMap);
    expect((held as WeakMap<Request, unknown>).has(request)).toBe(true);
    expect(ɵtakePageOutcome(request)).toBeUndefined();
  });
});
