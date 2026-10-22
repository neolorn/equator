import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApplicationRef,
  Component,
  PLATFORM_ID,
  REQUEST,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { LocalizationError, pageAbsent, pageGone } from '@neolorn/equator/core';
import {
  LocalizedPageOutcome,
  LocalizedRouteParameters,
} from '@neolorn/equator/router';

/**
 * A declaration made while its navigation is still in flight, and one made before any.
 *
 * A resolver or a guard declares what it loaded before the page it loaded it for is on screen.
 * `LocalizedPageOutcome` and `LocalizedRouteParameters` both stamp such a declaration with the
 * navigation that made it, so it belongs to the page that navigation produces: it is readable
 * once the page commits, a navigation that never arrives takes its declaration with it, and a
 * declaration made with no page at all is discarded rather than given to whichever page loads
 * first.
 *
 * The two services are taken on a plain Router, because what is asserted is which navigation a
 * declaration belongs to and not what the document does with it.
 */

@Component({ standalone: true, template: '' })
class Blank {}

const SLUGS = { slug: { 'ar-EG': 'ملف' } } as const;
const SECTIONS = { section: { 'ar-EG': 'قسم' } } as const;

const ROUTES: Routes = [
  {
    path: 'declared',
    component: Blank,
    resolve: {
      // Two resolvers each declaring the parameter they loaded, and one the outcome.
      record: () => {
        inject(LocalizedRouteParameters).declare(SLUGS);
        inject(LocalizedPageOutcome).declare(pageGone());
        return true;
      },
      section: () => {
        inject(LocalizedRouteParameters).declare(SECTIONS);
        return true;
      },
    },
  },
  { path: 'plain', component: Blank },
  {
    path: 'refused',
    component: Blank,
    canActivate: [
      () => {
        inject(LocalizedRouteParameters).declare({
          slug: { 'ar-EG': 'مرفوض' },
        });
        inject(LocalizedPageOutcome).declare(pageAbsent());
        return false;
      },
    ],
  },
];

interface Services {
  readonly router: Router;
  readonly outcome: LocalizedPageOutcome;
  readonly parameters: LocalizedRouteParameters;
}

function services(providers: readonly unknown[] = []): Services {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter(ROUTES), ...(providers as never[])],
  });
  return {
    router: TestBed.inject(Router),
    outcome: TestBed.inject(LocalizedPageOutcome),
    parameters: TestBed.inject(LocalizedRouteParameters),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('a declaration made while its navigation is in flight', () => {
  it('belongs to the page that navigation produces', async () => {
    const { router, outcome, parameters } = services();

    expect(await router.navigateByUrl('/declared')).toBe(true);

    expect(outcome.current()).toEqual(pageGone());
    expect(parameters.current()).toEqual({ ...SLUGS, ...SECTIONS });
  });

  it('is not readable by the page after it', async () => {
    const { router, outcome, parameters } = services();
    await router.navigateByUrl('/declared');

    expect(await router.navigateByUrl('/plain')).toBe(true);

    expect(outcome.current()).toBeUndefined();
    expect(parameters.current()).toBeUndefined();
  });

  it('is discarded with a navigation that never arrived', async () => {
    const { router, outcome, parameters } = services();
    await router.navigateByUrl('/declared');

    expect(await router.navigateByUrl('/refused')).toBe(false);

    // The page on screen is still the one that declared a removal and its own spellings.
    expect(outcome.current()).toEqual(pageGone());
    expect(parameters.current()).toEqual({ ...SLUGS, ...SECTIONS });
  });
});

describe('a declaration made before any navigation completed', () => {
  it('is discarded and reported, and is not given to the first page that loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { router, parameters } = services();

    parameters.declare(SLUGS);

    expect(parameters.current()).toBeUndefined();
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).startsWith(
          '[Equator] LocalizedRouteParameters.declare()',
        ),
      ),
    ).toHaveLength(1);

    await router.navigateByUrl('/plain');
    expect(parameters.current()).toBeUndefined();
  });
});

describe('a removal declared while rendering ahead of a request', () => {
  it('fails the build as a route that is unavailable, naming the removal', () => {
    const { outcome } = services([
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: REQUEST, useValue: null },
    ]);
    // Held, because a destroyed test application cannot be torn down after it.
    const destroy = vi
      .spyOn(TestBed.inject(ApplicationRef), 'destroy')
      .mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      outcome.declare(pageGone());
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalizationError);
    const { diagnostic } = thrown as LocalizationError;
    expect(diagnostic.code).toBe('route-unavailable');
    // The build log is where this is read, so it says which of the three outcomes was declared.
    expect(diagnostic.message).toContain('a permanent removal');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
