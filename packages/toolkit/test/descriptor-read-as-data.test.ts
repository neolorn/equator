/**
 * An extension descriptor is read as data, so nothing in it runs.
 *
 * `specs/01-standards-profile.spec.md` section 9: the toolkit reads a descriptor as data and never
 * executes application code to discover one. A getter is code, and refusing the descriptor after
 * calling it would be too late, so the case counts calls as well as asking for the refusal.
 */
import { describe, expect, it } from 'vitest';

import { defineExtensionRegistry } from '../src/index.js';

function descriptorWithGetter(onRead: () => void, inside: 'record' | 'array') {
  const descriptor: Record<string, unknown> = {
    kind: 'message-function',
    id: 'demo:uppercase',
    operandType: 'string',
    resultType: 'string',
    selector: 'none',
    maximumOutputLength: 64,
  };
  const getter = {
    enumerable: true,
    get: () => {
      onRead();
      return 'plain';
    },
  };
  if (inside === 'record') {
    Object.defineProperty(descriptor, 'options', {
      enumerable: true,
      value: Object.defineProperty({}, 'emphasis', {
        enumerable: true,
        get: () => {
          onRead();
          return { type: 'string' };
        },
      }),
    });
    return [descriptor];
  }
  const list: unknown[] = [descriptor];
  Object.defineProperty(list, 1, getter);
  return list;
}

describe('an extension descriptor carrying an accessor', () => {
  it.each([
    ['a record', 'record'],
    ['an array', 'array'],
  ] as const)(
    'is refused inside %s without the accessor running',
    (_label, inside) => {
      let reads = 0;
      const result = defineExtensionRegistry(
        descriptorWithGetter(() => {
          reads += 1;
        }, inside) as never,
      );
      expect(result.ok).toBe(false);
      expect(reads).toBe(0);
    },
  );
});
