import { describe, expect, it } from 'vitest';

import {
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The sizes a request target is read within, each at its limit and one past it.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 4 has a structurally unsafe target rejected
 * before anything is resolved, and section 6 has a query and a fragment kept only as safely parsed
 * bounded values. A bound is two cases: the largest value that is read, and the smallest that is
 * refused with `malformed`. A target inside every bound that names no route is `not-found`, which
 * is how the cases below tell a target that was read from one that was refused.
 *
 * The bounds on a query entry and on a fragment hold twice, on the text as it arrived and on the
 * canonical spelling a correction would write, so each is reached here with a spelling that is
 * short as written and long once encoded.
 */

const SLUG: RouteParameterCodec<string> = Object.freeze({
  parse: (value: string) => Object.freeze({ ok: true as const, value }),
  serialize: (value: string) => value,
});

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: `sha256-${'RequestTargetBoundsIdentity'.padEnd(43, '0')}`,
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug: SLUG } },
};

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const resolve = (target: string) =>
  resolveLocalizedRoute(target, POLICY, PROJECTION);

const statusOf = (target: string) => resolve(target).status;

/** A path of exactly this many characters, in segments short enough to be read. */
const pathOfLength = (length: number): string => {
  let path = '/en-us';
  while (path.length < length) {
    path += `/${'x'.repeat(Math.min(1000, length - path.length - 1))}`;
  }
  return path;
};

/** A character that is one character as written and three once percent-encoded. */
const WIDENS = ':';
/** An escape that is three characters as written and one once decoded. */
const NARROWS = '%61';

describe('the length of a whole target', () => {
  it('is read at 8,192 characters and refused at 8,193', () => {
    const atTheBound = pathOfLength(8192);
    const pastTheBound = pathOfLength(8193);
    expect(atTheBound).toHaveLength(8192);
    expect(pastTheBound).toHaveLength(8193);
    expect(statusOf(atTheBound)).toBe('not-found');
    expect(statusOf(pastTheBound)).toBe('malformed');
  });
});

describe('the length of one path segment', () => {
  it('is read at 1,024 characters and refused at 1,025', () => {
    expect(statusOf(`/en-us/articles/${'x'.repeat(1024)}`)).toBe('success');
    expect(statusOf(`/en-us/articles/${'x'.repeat(1025)}`)).toBe('malformed');
  });

  it('is refused where its escapes are well formed and are not UTF-8', () => {
    expect(statusOf('/en-us/articles/%ff')).toBe('malformed');
    expect(statusOf('/en-us/articles/%c3%28')).toBe('malformed');
  });
});

describe('the length of a query', () => {
  it('is read at 2,048 characters as written and refused at 2,049', () => {
    const entry = (name: string, escapes: number, tail = '') =>
      `${name}=${NARROWS.repeat(escapes)}${tail}`;
    const head = [entry('a', 170), entry('b', 170), entry('c', 170)].join('&');
    const atTheBound = `${head}&${entry('d', 169)}`;
    const pastTheBound = `${head}&${entry('d', 169, 'x')}`;
    expect(atTheBound).toHaveLength(2048);
    expect(pastTheBound).toHaveLength(2049);
    // Read, and corrected to the spelling without the escapes nothing needed.
    expect(resolve(`/en-us/second?${atTheBound}`)).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
    });
    expect(statusOf(`/en-us/second?${pastTheBound}`)).toBe('malformed');
  });

  it('is read at 2,048 characters once encoded and refused at 2,049', () => {
    const entry = (name: string, wide: number, tail = '') =>
      `${name}=${WIDENS.repeat(wide)}${tail}`;
    const head = [entry('a', 170), entry('b', 170), entry('c', 170)].join('&');
    const canonical = (query: string) =>
      query.replaceAll(WIDENS, encodeURIComponent(WIDENS));
    const atTheBound = `${head}&${entry('d', 169)}`;
    const pastTheBound = `${head}&${entry('d', 169, 'x')}`;
    expect(canonical(atTheBound)).toHaveLength(2048);
    expect(canonical(pastTheBound)).toHaveLength(2049);
    expect(resolve(`/en-us/second?${atTheBound}`)).toMatchObject({
      status: 'redirect',
      location: `/en-us/second?${canonical(atTheBound)}`,
    });
    expect(statusOf(`/en-us/second?${pastTheBound}`)).toBe('malformed');
  });
});

describe('one entry of a query', () => {
  it('has a name of at most 128 characters once encoded', () => {
    const atTheBound = `${WIDENS.repeat(42)}ab`;
    const pastTheBound = WIDENS.repeat(43);
    expect(encodeURIComponent(atTheBound)).toHaveLength(128);
    expect(encodeURIComponent(pastTheBound)).toHaveLength(129);
    expect(statusOf(`/en-us/second?${atTheBound}=1`)).toBe('redirect');
    expect(statusOf(`/en-us/second?${pastTheBound}=1`)).toBe('malformed');
  });

  it('has a name of at most 128 characters as written', () => {
    expect(statusOf(`/en-us/second?${'n'.repeat(128)}=1`)).toBe('success');
    expect(statusOf(`/en-us/second?${NARROWS.repeat(43)}=1`)).toBe('malformed');
  });

  it('has a value of at most 512 characters once encoded', () => {
    const atTheBound = `${WIDENS.repeat(170)}ab`;
    const pastTheBound = WIDENS.repeat(171);
    expect(encodeURIComponent(atTheBound)).toHaveLength(512);
    expect(encodeURIComponent(pastTheBound)).toHaveLength(513);
    expect(statusOf(`/en-us/second?q=${atTheBound}`)).toBe('redirect');
    expect(statusOf(`/en-us/second?q=${pastTheBound}`)).toBe('malformed');
  });

  it('has a value of at most 512 characters as written', () => {
    expect(statusOf(`/en-us/second?q=${'v'.repeat(512)}`)).toBe('success');
    expect(statusOf(`/en-us/second?q=${NARROWS.repeat(171)}`)).toBe(
      'malformed',
    );
  });

  it('is refused where it has a value and no name', () => {
    expect(statusOf('/en-us/second?=x')).toBe('malformed');
    expect(statusOf('/en-us/second?a=1&=x')).toBe('malformed');
  });

  it('is refused where its name or its value cannot be read', () => {
    expect(statusOf('/en-us/second?%ff=1')).toBe('malformed');
    expect(statusOf('/en-us/second?a=%ff')).toBe('malformed');
  });

  it('reaches the resolution decoded, in the order written', () => {
    const resolution = resolve('/en-us/second?a=1&b=two&c=a%20b');
    expect(resolution).toMatchObject({ status: 'success', routeId: 'second' });
    expect(resolution).toHaveProperty('query', [
      { name: 'a', value: '1' },
      { name: 'b', value: 'two' },
      { name: 'c', value: 'a b' },
    ]);
  });

  it('is absent from the resolution of an address with no query', () => {
    expect(resolve('/en-us/second')).toHaveProperty('query', []);
  });
});

describe('a fragment', () => {
  it('reaches the resolution decoded', () => {
    expect(resolve('/en-us/second#top')).toMatchObject({
      status: 'success',
      fragment: 'top',
    });
    expect(resolve('/en-us/second?a=1#top')).toMatchObject({
      status: 'success',
      fragment: 'top',
    });
  });

  it('is absent from the resolution of an address with none', () => {
    expect(resolve('/en-us/second')).not.toHaveProperty('fragment');
  });

  it('is read at 512 characters once encoded and refused at 513', () => {
    const atTheBound = `${WIDENS.repeat(170)}ab`;
    const pastTheBound = WIDENS.repeat(171);
    expect(statusOf(`/en-us/second#${atTheBound}`)).toBe('redirect');
    expect(statusOf(`/en-us/second#${pastTheBound}`)).toBe('malformed');
  });

  it('is read at 512 characters as written and refused at 513', () => {
    expect(statusOf(`/en-us/second#${'f'.repeat(512)}`)).toBe('success');
    expect(statusOf(`/en-us/second#${NARROWS.repeat(171)}`)).toBe('malformed');
  });

  it('is refused where it cannot be read, and is not dropped', () => {
    expect(statusOf('/en-us/second#%ff')).toBe('malformed');
    expect(statusOf('/en-us/second#a%00b')).toBe('malformed');
  });
});
