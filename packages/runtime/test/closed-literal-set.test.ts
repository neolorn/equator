/**
 * A value outside an input's closed literal set, handed to the evaluator.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7: the value is a contract violation,
 * and nothing may turn it into a member of the set, pick a member in its place, or print it. Each
 * refused value is one a lenient runtime could plausibly have mapped onto `active`: by case, by
 * trimming, by string conversion, or by falling back to the first member.
 */
import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import { render } from './message-harness.js';

const STATUS: readonly CompiledInputContract[] = Object.freeze([
  {
    name: 'status',
    type: 'string',
    enum: Object.freeze(['active', 'disabled']),
    optional: false,
    nullable: false,
  },
]);

const MESSAGE = [
  '.input {$status :string}',
  '.match $status',
  'active {{Active}}',
  'disabled {{Disabled}}',
  '* {{Status: {$status}}}',
].join('\n');

function outcome(status: unknown): unknown {
  try {
    return render(MESSAGE, STATUS, { status });
  } catch (error) {
    return error instanceof LocalizationError ? error.diagnostic : error;
  }
}

describe('a value outside a closed literal set', () => {
  it('renders a member of the set as authored', () => {
    expect(outcome('active')).toBe('Active');
    expect(outcome('disabled')).toBe('Disabled');
  });

  it.each([
    ['a value the set does not name', 'paused'],
    ['a member in another case', 'ACTIVE'],
    ['a member with surrounding space', ' active '],
    ['a value that converts to a member', { toString: () => 'active' }],
    ['a string wrapper around a member', Object('active')],
  ])('is refused, not coerced or substituted: %s', (_label, status) => {
    const result = outcome(status);

    expect(result).toMatchObject({
      code: 'invalid-message-input',
      outcome: 'operational-failure',
    });
    expect(result).not.toBe('Active');
    expect(JSON.stringify(result)).not.toContain('paused');
    expect(JSON.stringify(result)).not.toContain('ACTIVE');
  });
});
