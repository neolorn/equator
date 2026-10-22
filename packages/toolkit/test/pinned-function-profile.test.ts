/**
 * The function set is the pinned edition's, and nothing from another edition is let in beside it.
 *
 * `specs/01-standards-profile.spec.md` section 7 admits later draft material only by moving the
 * whole profile, and section 8 lists the ten functions of LDML 48.2 with their status. A name
 * outside that table is refused at authoring, which is where a later edition's function would
 * first be written.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { MESSAGE_FUNCTION_PROFILE } from '../src/message-format.js';

const PINNED = [
  ['string', 'stable'],
  ['number', 'stable'],
  ['integer', 'stable'],
  ['offset', 'stable'],
  ['currency', 'stable'],
  ['percent', 'stable'],
  ['unit', 'draft'],
  ['datetime', 'draft'],
  ['date', 'draft'],
  ['time', 'draft'],
] as const;

function parse(message: string) {
  return parseCatalog(`messages:\n  sample: ${JSON.stringify(message)}\n`, {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
  });
}

describe('the function profile of LDML 48.2', () => {
  it('is exactly the ten functions the pinned edition defines, with their status there', () => {
    expect(
      MESSAGE_FUNCTION_PROFILE.map(({ name, status }) => [name, status]),
    ).toEqual(PINNED);
  });

  it.each(['relativetime', 'list', 'duration', 'ordinal', 'math'])(
    'refuses :%s, a name outside the pinned table',
    (name) => {
      const result = parse(`{$value :${name}}`);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map(({ code }) => code)).toContain('EQ1203');
    },
  );
});
