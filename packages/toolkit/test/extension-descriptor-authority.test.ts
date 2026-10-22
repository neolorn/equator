import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  type ExtensionDescriptorInput,
} from '../src/index.js';
import { parseExtensionRegistry } from '../src/extensions.js';

/**
 * A descriptor is data the toolkit checks, never a claim it takes on trust.
 *
 * The fingerprint is derived from what the descriptor declares, so one written into the descriptor
 * is a value nothing verified, and code in a descriptor is something the toolkit would have to run
 * to learn what it declares. Both are refused where the registry is read, as is a descriptor
 * outside a provider namespace and a registry under a profile this release does not read.
 */

const uppercase = {
  kind: 'message-function',
  id: 'fixture:uppercase',
  operandType: 'string',
  resultType: 'string',
  selector: 'none',
  maximumOutputLength: 64,
} as const;

function registryFile(
  descriptors: readonly unknown[],
  profile = 'equator-extension-registry/1',
): string {
  return JSON.stringify({ profile, descriptors });
}

function refusal(result: ReturnType<typeof parseExtensionRegistry>) {
  expect(result.ok).toBe(false);
  return result.diagnostics.map(({ code }) => code);
}

describe('an extension descriptor', () => {
  it('is accepted as plain declared data, with a fingerprint the toolkit derives', () => {
    const parsed = parseExtensionRegistry(registryFile([uppercase]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.descriptors[0]?.fingerprint).toMatch(/^sha256-/u);
  });

  it('is refused when it carries a fingerprint of its own', () => {
    const supplied = `sha256-${'A'.repeat(43)}`;
    expect(
      refusal(
        parseExtensionRegistry(
          registryFile([{ ...uppercase, fingerprint: supplied }]),
        ),
      ),
    ).toContain('EQ1805');
    const defined = defineExtensionRegistry([
      {
        ...uppercase,
        fingerprint: supplied,
      } as unknown as ExtensionDescriptorInput,
    ]);
    expect(defined.ok).toBe(false);
  });

  it('is refused when it carries code', () => {
    const defined = defineExtensionRegistry([
      {
        ...uppercase,
        format: (value: string) => value.toUpperCase(),
      } as unknown as ExtensionDescriptorInput,
    ]);
    expect(defined.ok).toBe(false);
    expect(defined.diagnostics.map(({ code }) => code)).toContain('EQ1805');
  });

  it('is refused outside a provider namespace, and under a profile this release does not read', () => {
    expect(
      refusal(
        parseExtensionRegistry(
          registryFile([{ ...uppercase, id: 'uppercase' }]),
        ),
      ),
    ).toContain('EQ1805');
    expect(
      refusal(
        parseExtensionRegistry(
          registryFile([uppercase], 'equator-extension-registry/2'),
        ),
      ),
    ).toContain('EQ1805');
  });
});
