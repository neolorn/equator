// First, and on its own line, for the reason `locale-cookie-defaults.test.ts` states: the stores
// reach `@angular/common`, whose bundle needs a compiler that no plain Node process has.
import '@angular/compiler';

/**
 * What a store hands back for the text it was holding.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 3 bounds untrusted locale text, and a
 * remembered locale is untrusted: a cookie is whatever the client sent and a profile endpoint is
 * whatever answered. Text that is not shaped like a language tag, or is longer than any tag, is
 * read as nothing rather than repaired. Asked through the profile store, which needs no browser.
 */
import { describe, expect, it } from 'vitest';

import { profileStore } from '../src/persistence.js';

/** What the store reads when its transport answers with this. */
function readOf(answer: string | undefined): Promise<string | undefined> {
  const store = profileStore({
    read: () => answer,
    write: () => undefined,
  })();
  return Promise.resolve(store.read());
}

describe('text a store was holding', () => {
  it('is nothing when the store holds nothing', async () => {
    expect(await readOf(undefined)).toBeUndefined();
  });

  it('is nothing when it is empty', async () => {
    expect(await readOf('')).toBeUndefined();
  });

  it('is handed back when it is letters, digits and hyphens', async () => {
    expect(await readOf('ar-EG')).toBe('ar-EG');
    expect(await readOf('es-419')).toBe('es-419');
  });

  it('is handed back at 64 characters and nothing at 65', async () => {
    const atBound = `en-${'a'.repeat(61)}`;

    expect(atBound).toHaveLength(64);
    expect(await readOf(atBound)).toBe(atBound);
    expect(await readOf(`${atBound}a`)).toBeUndefined();
  });

  it('is nothing when anything else leads it', async () => {
    expect(await readOf(';en-US')).toBeUndefined();
  });

  it('is nothing when anything else follows it', async () => {
    expect(await readOf('en-US;')).toBeUndefined();
  });

  it('is nothing when anything else sits inside it', async () => {
    expect(await readOf('en US')).toBeUndefined();
  });
});
