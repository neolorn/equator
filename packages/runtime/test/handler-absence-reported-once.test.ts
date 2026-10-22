/**
 * How often a declaration the handler sets aside is reported while developing.
 *
 * A renderer's declaration is taken as it is returned, so one written without the types can state
 * an absence and carry a status as well. The report is remembered by the resolution and the outcome
 * and, for a failure alone, its status, so an absence is reported once however that member varies.
 */
import { afterEach, expect, it, vi } from 'vitest';

import {
  createLocaleRequestHandler,
  type LocaleRenderer,
} from '../http/src/handler.js';
import type {
  LocaleUrlPolicy,
  RouteRuntimeProjection,
} from '@neolorn/equator/core';

const POLICY: LocaleUrlPolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: ['assets'],
  omitDefaultPrefix: false,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-AbsenceReportedOnceTestIdentity012345678901',
    routes: [{ id: 'route:_index', path: '', parameterNames: [] }],
  },
  localizedPaths: {},
};

afterEach(() => {
  vi.restoreAllMocks();
});

it('reports an absence declared at a refused address once', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let status = 0;
  const render = (() => ({
    pageOutcome: { outcome: 'absent', status: (status += 1) },
    response: new Response('drawn'),
  })) as unknown as LocaleRenderer;
  const handler = createLocaleRequestHandler({
    policy: POLICY,
    projection: PROJECTION,
    cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
    cookie: false,
    render,
  });
  const first = await handler(new Request('https://site.example/en-us/none'));
  const second = await handler(new Request('https://site.example/en-us/none'));
  expect([first.status, second.status]).toStrictEqual([404, 404]);
  expect(status).toBe(2);
  expect(warn).toHaveBeenCalledTimes(1);
});
