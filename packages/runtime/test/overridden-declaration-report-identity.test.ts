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
    identity: 'sha256-HandlerDevelopmentReportsTestIdentity012345',
    routes: [{ id: 'route:_index', path: '', parameterNames: [] }],
  },
  localizedPaths: {},
};

afterEach(() => {
  vi.restoreAllMocks();
});

// A declaration is taken as the renderer returned it, so one written past the type checker can
// carry any text. Only an operational failure contributes a status to the identity a report is
// remembered under; these two spell the same identity and are one report.
it('reports two overridden declarations that spell one identity once', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const declarations: unknown[] = [
    { outcome: 'operational-failure', status: ':' },
    { outcome: 'operational-failure:' },
  ];
  let asked = 0;
  const render = (() => ({
    pageOutcome: declarations[asked++],
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
  expect(asked).toBe(2);
  expect(warn).toHaveBeenCalledTimes(1);
});
