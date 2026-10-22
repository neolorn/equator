import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * How the segments of an address are compared with the segments of a route.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 6: a static segment in another case is a
 * variant of one canonical address and is corrected to it, and a dynamic identity is never
 * case-folded or rewritten except through its codec. A fixed segment in the lower-case spelling a
 * generated path has is therefore compared without regard to case, a localized segment written
 * with a capital is compared as written, and a parameter is whatever its codec reads and writes
 * back. Section 2: an address whose parameter the codec declines names no route.
 *
 * Table order decides between two routes that both read an address, whichever way each is looked
 * up, so several cases below put a fixed route in front of one that takes a parameter.
 */

const SLUG: RouteParameterCodec<string> = Object.freeze({
  parse: (value: string) => Object.freeze({ ok: true as const, value }),
  serialize: (value: string) => value,
});

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'de-DE': 'de-de', 'ru-RU': 'ru-ru' },
});

const identity = (name: string): string => `sha256-${name.padEnd(43, '0')}`;

/** Routes with fixed segments only, some respelled for German with a capital in them. */
const SPELLED: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: identity('RouteSegmentMatchingSpelledIdentity'),
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'info', path: 'info', parameterNames: [] },
      { id: 'reader', path: 'reader', parameterNames: [] },
      { id: 'ebooks', path: 'ebooks', parameterNames: [] },
      { id: 'joined', path: 'ab', parameterNames: [] },
      { id: 'split', path: 'a/b', parameterNames: [] },
    ],
  },
  localizedPaths: {
    info: { 'de-DE': 'Info' },
    reader: { 'de-DE': 'eBooks' },
  },
};

/** Fixed routes written before a route that reads any single segment as its parameter. */
const CAUGHT: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: identity('RouteSegmentMatchingCaughtIdentity'),
    routes: [
      { id: 'street', path: 'strasse', parameterNames: [] },
      { id: 'reader', path: 'reader', parameterNames: [] },
      { id: 'news', path: 'news', parameterNames: [] },
      { id: 'topic', path: ':slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: {
    reader: { 'de-DE': 'eBooks' },
    news: { 'ru-RU': 'Новости' },
  },
  parameters: { topic: { slug: SLUG } },
};

const resolve = (target: string, projection: RouteRuntimeProjection) =>
  resolveLocalizedRoute(target, POLICY, projection);

describe('a fixed segment in the generated lower-case spelling', () => {
  it('answers in its own spelling', () => {
    expect(resolve('/de-de/ebooks', SPELLED)).toMatchObject({
      status: 'success',
      routeId: 'ebooks',
      canonicalPath: '/de-de/ebooks',
    });
  });

  it('reads another case and corrects it', () => {
    expect(resolve('/de-de/EBOOKS', SPELLED)).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
      routeId: 'ebooks',
      location: '/de-de/ebooks',
    });
  });

  it('is one segment, and is not two that run together to the same text', () => {
    expect(resolve('/en-us/a/b', SPELLED)).toMatchObject({
      status: 'success',
      routeId: 'split',
    });
    expect(resolve('/en-us/ab', SPELLED)).toMatchObject({
      status: 'success',
      routeId: 'joined',
    });
  });
});

describe('a localized segment written with a capital', () => {
  it('answers as written', () => {
    expect(resolve('/de-de/Info', SPELLED)).toMatchObject({
      status: 'success',
      routeId: 'info',
      canonicalPath: '/de-de/Info',
    });
    expect(resolve('/de-de/eBooks', SPELLED)).toMatchObject({
      status: 'success',
      routeId: 'reader',
      canonicalPath: '/de-de/eBooks',
    });
  });

  it('does not read another case of itself', () => {
    // English and Russian both spell the route `info`, so the address is their spelling of it and
    // is corrected to the German one. It is not answered in place as though German spelled it so.
    expect(resolve('/de-de/info', SPELLED)).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
      location: '/de-de/Info',
    });
  });

  it('does not read a different segment of the same length in the table', () => {
    expect(resolve('/de-de/Other', SPELLED)).toMatchObject({
      status: 'not-found',
      requestedLocale: 'de-DE',
    });
  });

  it('is the page of the one locale that writes it so, where no locale is in the address', () => {
    const neutral = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'de-DE'],
    });
    // English reads `/Info` as another case of its own `info`. German spells it exactly, and an
    // exact spelling is an address of its own before it is a variant of anybody else's.
    expect(resolveLocalizedRoute('/Info', neutral, SPELLED)).toMatchObject({
      status: 'success',
      locale: 'de-DE',
      routeId: 'info',
      canonicalPath: '/Info',
    });
    expect(resolveLocalizedRoute('/info', neutral, SPELLED)).toMatchObject({
      status: 'success',
      locale: 'en-US',
      routeId: 'info',
    });
  });
});

describe('a route that takes a parameter, written after fixed routes', () => {
  const encoded = (segment: string) => encodeURIComponent(segment);

  it('reads a value that only upper-cases to an earlier fixed segment', () => {
    // The sharp s has no upper-case letter of its own and upper-cases to two.
    expect(resolve(`/de-de/${encoded('straße')}`, CAUGHT)).toMatchObject({
      status: 'success',
      routeId: 'topic',
      parameters: { slug: 'straße' },
    });
    expect(resolve('/de-de/strasse', CAUGHT)).toMatchObject({
      status: 'success',
      routeId: 'street',
    });
  });

  it('reads the lower-case of an earlier segment that is written with a capital', () => {
    expect(resolve('/de-de/ebooks', CAUGHT)).toMatchObject({
      status: 'success',
      routeId: 'topic',
      parameters: { slug: 'ebooks' },
    });
    expect(resolve('/de-de/eBooks', CAUGHT)).toMatchObject({
      status: 'success',
      routeId: 'reader',
    });
  });

  it('reads the lower-case of an earlier segment in a script with no ASCII in it', () => {
    expect(resolve(`/ru-ru/${encoded('новости')}`, CAUGHT)).toMatchObject({
      status: 'success',
      routeId: 'topic',
      parameters: { slug: 'новости' },
    });
    expect(resolve(`/ru-ru/${encoded('Новости')}`, CAUGHT)).toMatchObject({
      status: 'success',
      routeId: 'news',
    });
  });
});

describe('what a parameter route declines', () => {
  const taking = (
    slug: RouteParameterCodec<string>,
  ): RouteRuntimeProjection => ({
    generated: {
      profile: 'equator-route-projection/1',
      identity: identity('RouteSegmentMatchingCodecIdentity'),
      routes: [
        { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
      ],
    },
    parameters: { article: { slug } },
  });

  const notFound = { status: 'not-found', requestedLocale: 'en-US' };

  it('answers an address its codec reads and writes back', () => {
    expect(resolve('/en-us/articles/hello', taking(SLUG))).toMatchObject({
      status: 'success',
      routeId: 'article',
      parameters: { slug: 'hello' },
    });
  });

  it('declines an address with more segments than it has, or fewer', () => {
    expect(resolve('/en-us/articles/hello/extra', taking(SLUG))).toMatchObject(
      notFound,
    );
    expect(resolve('/en-us/articles', taking(SLUG))).toMatchObject(notFound);
  });

  it('declines where the codec reports a parse and gives no value', () => {
    const codec: RouteParameterCodec<string> = {
      parse: () => ({ ok: true }),
      serialize: () => 'fixed',
    };
    expect(resolve('/en-us/articles/hello', taking(codec))).toMatchObject(
      notFound,
    );
  });

  it('declines where the codec has no spelling for the value it read', () => {
    const codec: RouteParameterCodec<string> = {
      parse: (value: string) => ({ ok: true, value }),
      serialize: () => undefined,
    };
    expect(resolve('/en-us/articles/hello', taking(codec))).toMatchObject(
      notFound,
    );
  });

  it('declines where the codec spells the value as something a segment cannot hold', () => {
    for (const spelling of ['a/b', '..', '']) {
      const codec: RouteParameterCodec<string> = {
        parse: (value: string) => ({ ok: true, value }),
        serialize: () => spelling,
      };
      expect(
        resolve('/en-us/articles/hello', taking(codec)),
        spelling,
      ).toMatchObject(notFound);
    }
  });
});
