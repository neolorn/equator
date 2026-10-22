import { describe, expect, it } from 'vitest';

import {
  createLocaleRequestHandler,
  type LocaleRequestOutcome,
} from '../http/src/handler.js';
import {
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The locale a renderer is told to draw in, beside the language the response says it is in.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 15 has a missing page under a supported
 * locale use that locale for its content, and a response tells one story: the body a renderer draws
 * and the `Content-Language` the handler writes name one locale at every address with a body.
 */

const CACHE = { successMaxAge: 600, permanentRedirectMaxAge: 86_400 } as const;

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-HandlerRenderLocaleTestIdentity012345678901',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
    ],
  },
  historical: { retired: { kind: 'gone' } },
};

const PREFIX = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

/** What the renderer was told and what the response then said, for one address. */
const drawn = async (
  policy: LocaleUrlPolicy,
  address: string,
  headers: Record<string, string> = {},
) => {
  const outcomes: LocaleRequestOutcome[] = [];
  const observed: (string | undefined)[] = [];
  const response = await createLocaleRequestHandler({
    policy,
    projection: PROJECTION,
    cache: CACHE,
    cookie: false,
    render: (outcome) => {
      outcomes.push(outcome);
      return new Response('<!doctype html><html></html>');
    },
    ɵobserve: ({ locale }) => observed.push(locale),
  })(new Request(address, { headers }));
  return {
    status: response.status,
    told: outcomes[0]?.locale,
    observed: observed[0],
    contentLanguage: response.headers.get('content-language'),
  };
};

describe('the locale a renderer is handed', () => {
  it('is the prefix locale at a missing page under a prefix the policy serves', async () => {
    expect(
      await drawn(PREFIX, 'https://site.example/ar-eg/nothing-here'),
    ).toEqual({
      status: 404,
      told: 'ar-EG',
      observed: 'ar-EG',
      contentLanguage: 'ar-EG',
    });
  });

  it('is the prefix locale at a removed page under a prefix the policy serves', async () => {
    expect(await drawn(PREFIX, 'https://site.example/ar-eg/retired')).toEqual({
      status: 410,
      told: 'ar-EG',
      observed: 'ar-EG',
      contentLanguage: 'ar-EG',
    });
  });

  it('is the default locale where the address states no locale the policy serves', async () => {
    const unsupported = await drawn(
      PREFIX,
      'https://site.example/fr-fr/second',
      { 'accept-language': 'ar-EG' },
    );
    const unprefixed = await drawn(
      PREFIX,
      'https://site.example/nothing-here',
      { 'accept-language': 'ar-EG' },
    );

    expect(unsupported).toEqual({
      status: 404,
      told: 'en-US',
      observed: 'en-US',
      contentLanguage: 'en-US',
    });
    expect(unprefixed).toEqual(unsupported);
  });

  it('is the origin locale at a missing page under a locale origin', async () => {
    const host = createHostLocalePolicy({
      defaultLocale: 'en-US',
      origins: {
        'en-US': 'https://en.site.example',
        'ar-EG': 'https://ar.site.example',
      },
    });

    expect(await drawn(host, 'https://ar.site.example/nothing-here')).toEqual({
      status: 404,
      told: 'ar-EG',
      observed: 'ar-EG',
      contentLanguage: 'ar-EG',
    });
  });

  it('is the negotiated locale at a missing locale-neutral address', async () => {
    const neutral = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    });

    expect(
      await drawn(neutral, 'https://site.example/nothing-here', {
        'accept-language': 'ar-EG',
      }),
    ).toMatchObject({ status: 404, told: 'ar-EG', contentLanguage: 'ar-EG' });
    expect(
      await drawn(neutral, 'https://site.example/nothing-here'),
    ).toMatchObject({ status: 404, told: 'en-US', contentLanguage: 'en-US' });
  });

  it('is the resolved locale at a page', async () => {
    expect(await drawn(PREFIX, 'https://site.example/ar-eg/second')).toEqual({
      status: 200,
      told: 'ar-EG',
      observed: 'ar-EG',
      contentLanguage: 'ar-EG',
    });
  });
});
