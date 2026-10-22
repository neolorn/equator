/**
 * A catalog that tries to carry, name or fetch code.
 *
 * `specs/01-standards-profile.spec.md` section 9: a catalog may reference a registered function
 * and never carries, fetches, discovers or executes its code. A catalog is read against a closed
 * schema, so a field that could hold a module, a handler or an import is refused where it is
 * written rather than read and ignored.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';

const OPTIONS = {
  role: 'source',
  providerId: '@example/app',
  scopeId: 'shell',
  locale: 'en-US',
  sourcePath: 'i18n/shell/en-US.yaml',
} as const;

describe('a catalog carries no code', () => {
  it('reads a message record with its authored fields', () => {
    expect(
      parseCatalog(
        'messages:\n  title:\n    message: Hello\n    description: Page title\n',
        OPTIONS,
      ).ok,
    ).toBe(true);
  });

  it.each([
    [
      'a handler beside a message',
      'messages:\n  title:\n    message: Hello\n    handler: ./title.js\n',
      ['messages', 'title', 'handler'],
    ],
    [
      'an import list beside the messages',
      'messages:\n  title: Hello\nimports:\n  - ./functions.js\n',
      ['imports'],
    ],
  ])('refuses %s at the field that carries it', (_label, source, path) => {
    const result = parseCatalog(source, OPTIONS);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.map((diagnostic) => diagnostic.path),
    ).toContainEqual(path);
  });
});
