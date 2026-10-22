import { describe, expect, it } from 'vitest';

import {
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a request spelling outside Unicode Normalization Form C is read as.
 *
 * A canonical address is in that form, so a spelling that is not is a variant of the one that is
 * and is corrected to it. Two spellings stand for the rest: a letter followed by a combining acute,
 * which the form writes as one character, and U+212A, the Kelvin sign, which the form writes as the
 * ASCII capital `K`.
 */

const KELVIN = '%E2%84%AA';
const E_THEN_ACUTE = 'e%CC%81';
const E_ACUTE = '%C3%A9';

/** Reads any segment as itself. */
const TEXT: RouteParameterCodec<string> = {
  parse: (value: string) => ({ ok: true, value }),
  serialize: (value: string) => value,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RequestNormalFormTestIdentity01234567890123',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'kit', path: 'kit', parameterNames: [] },
      { id: 'cafe', path: 'cafe', parameterNames: [] },
      { id: 'page', path: 'pages/:slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: { cafe: { 'fr-FR': 'café' } },
  parameters: { page: { slug: TEXT } },
};

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'fr-FR': 'fr', 'uk-UA': 'uk' },
});

const resolved = (target: string) =>
  resolveLocalizedRoute(target, POLICY, PROJECTION);

const correctedTo = (location: string) => ({
  status: 'redirect',
  reason: 'canonical-correction',
  httpStatus: 308,
  location,
});

describe('a request spelling that is not in normal form C', () => {
  it('is corrected in a localized static segment', () => {
    expect(resolved(`/fr/caf${E_ACUTE}`)).toMatchObject({
      status: 'success',
      routeId: 'cafe',
    });
    expect(resolved(`/fr/caf${E_THEN_ACUTE}`)).toMatchObject({
      ...correctedTo(`/fr/caf${E_ACUTE}`),
      routeId: 'cafe',
    });
  });

  it('is handed to a codec in that form, and corrected', () => {
    expect(resolved(`/en-us/pages/caf${E_THEN_ACUTE}`)).toMatchObject({
      ...correctedTo(`/en-us/pages/caf${E_ACUTE}`),
      routeId: 'page',
    });
    expect(resolved(`/en-us/pages/${KELVIN}`)).toMatchObject(
      correctedTo('/en-us/pages/K'),
    );
  });

  it('is corrected in a query value and in a fragment', () => {
    expect(
      resolved(`/en-us/kit?q=caf${E_THEN_ACUTE}#${E_THEN_ACUTE}`),
    ).toMatchObject(correctedTo(`/en-us/kit?q=caf${E_ACUTE}#${E_ACUTE}`));
  });

  it('is an ASCII-case variant where the form writes an ASCII capital', () => {
    expect(resolved('/en-us/KIT')).toMatchObject(correctedTo('/en-us/kit'));
    expect(resolved(`/en-us/${KELVIN}it`)).toMatchObject({
      ...correctedTo('/en-us/kit'),
      routeId: 'kit',
    });
    expect(resolved(`/u${KELVIN}/kit`)).toMatchObject({
      ...correctedTo('/uk/kit'),
      locale: 'uk-UA',
    });
  });
});
