import { afterEach, describe, expect, it } from 'vitest';

import {
  renderedText,
  resetLocalizationTestEnvironment,
} from '@neolorn/equator/testing';

/**
 * The testing surface, held to what it promises a consumer's own suite.
 *
 * `specs/12-verification.spec.md` section 12 has a release supply the testing surface an
 * application verifies its own use with. A helper that stopped doing its one job would leave every
 * suite written against it asserting on something else, and nothing in the application would be
 * wrong, so the helpers are asserted here on inputs where their job is the whole answer.
 */
describe('the testing helpers', () => {
  afterEach(() => {
    resetLocalizationTestEnvironment();
  });

  it('reads an element as the sentence it shows, whatever the template indented', () => {
    const element = document.createElement('p');
    element.innerHTML =
      '\n    Saved\n      <strong>3</strong>\n\tminutes ago\n  ';
    expect(renderedText(element)).toBe('Saved 3 minutes ago');
  });

  it('puts back the address and the storages a localized test moved', () => {
    history.replaceState(null, '', '/ar-EG/orders');
    localStorage.setItem('equator-locale', 'ar-EG');
    sessionStorage.setItem('equator-locale', 'ar-EG');
    document.cookie = 'equator-locale=ar-EG; Path=/';

    resetLocalizationTestEnvironment();

    expect(location.pathname).toBe('/');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('equator-locale');
  });
});
