import { expect, it } from 'vitest';

import type { PersonNameProfileSet } from '@neolorn/equator/core';
import { formatPersonName, personName } from '../src/formatting.js';

/** One row, every cell the same pattern, in the axis order the generator documents. */
function one(pattern: string): PersonNameProfileSet {
  const patterns = [pattern, '{0}.', '{0} {1}', ' '];
  const cells: number[] = [];
  for (let cell = 0; cell < 3 * 3 * 3 * 2; cell += 1) cells.push(0);
  return {
    profile: 'cldr-48.2/equator-person-names-1',
    patterns,
    rows: [['en', cells, 1, 2, 3, 3, 1, 0, ['und'], []]],
  } as unknown as PersonNameProfileSet;
}

it('leaves the white space of a literal that stands alone as the pattern wrote it', () => {
  const result = formatPersonName(
    personName('en', { given: 'Mary', surname: 'Hamish' }),
    { locale: 'en' },
    {},
    one('{given}{given2}  {surname}'),
  );
  expect(result.ok && result.value.text).toBe('Mary  Hamish');
});
