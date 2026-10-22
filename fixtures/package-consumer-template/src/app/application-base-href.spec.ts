import { describe, expect, it } from 'vitest';

import { APP_BASE_HREF, PlatformLocation } from '@angular/common';
import { Injector, runInInjectionContext } from '@angular/core';
import { applicationBaseHref } from '@neolorn/equator';

/**
 * The sub-path an application is deployed under, where nothing declares one.
 *
 * `applicationBaseHref()` reads Angular's own two declarations in Angular's order: the
 * `APP_BASE_HREF` token, then the document's `<base href>`. `base-href.spec.ts` covers an
 * application that declares one. An application used without the Router may provide neither, and a
 * document may carry no `<base>` element, and both mean the same thing as a deployment at the
 * root: no base path at all, rather than a failure to start.
 */

function inAnInjector(
  providers: Parameters<typeof Injector.create>[0]['providers'],
): string {
  return runInInjectionContext(Injector.create({ providers }), () =>
    applicationBaseHref(),
  );
}

/** A platform location over a document with this `<base href>`, or with none. */
const documentWith = (baseHref: string | null) => ({
  provide: PlatformLocation,
  useValue: { getBaseHrefFromDOM: () => baseHref },
});

describe('applicationBaseHref', () => {
  it('is empty where no token and no platform location is provided', () => {
    expect(inAnInjector([])).toBe('');
  });

  it('is empty where the document carries no base element', () => {
    expect(inAnInjector([documentWith(null)])).toBe('');
  });

  it('is the document base where there is one, and the token ahead of it', () => {
    expect(inAnInjector([documentWith('/app/')])).toBe('/app/');
    expect(
      inAnInjector([
        documentWith('/app/'),
        { provide: APP_BASE_HREF, useValue: '/mounted/' },
      ]),
    ).toBe('/mounted/');
  });
});
