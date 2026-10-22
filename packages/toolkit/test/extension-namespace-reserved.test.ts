import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  type ExtensionDescriptorInput,
} from '../src/index.js';
import { parseExtensionRegistry } from '../src/extensions.js';

const descriptors: readonly ExtensionDescriptorInput[] = [
  {
    kind: 'identifier-segment',
    id: 'equator:native-message-part',
    syntax: 'lower-kebab',
    maximumLength: 5,
  },
  {
    kind: 'message-function',
    id: 'equator:uppercase',
    operandType: 'string',
    resultType: 'string',
    selector: 'none',
    maximumOutputLength: 64,
  },
];

// What is built in is named under this namespace, so a descriptor registered there would bound a
// built-in by rules no registry fingerprint records as required.
describe('a descriptor in the equator namespace', () => {
  it.each(descriptors)(
    'is refused where a registry is defined ($id)',
    (descriptor) => {
      const defined = defineExtensionRegistry([descriptor]);
      expect(defined.ok).toBe(false);
      expect(defined.diagnostics.map(({ code }) => code)).toContain('EQ1805');
    },
  );

  it.each(descriptors)(
    'is refused where a registry file is read ($id)',
    (descriptor) => {
      const parsed = parseExtensionRegistry(
        JSON.stringify({
          profile: 'equator-extension-registry/1',
          descriptors: [descriptor],
        }),
      );
      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics.map(({ code }) => code)).toContain('EQ1805');
    },
  );

  it('leaves a provider namespace that only begins with the word alone', () => {
    const defined = defineExtensionRegistry([
      { ...descriptors[0], id: 'equatorial:part' } as ExtensionDescriptorInput,
    ]);
    expect(defined.ok).toBe(true);
  });
});
