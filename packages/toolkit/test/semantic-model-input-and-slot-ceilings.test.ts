/**
 * The ceilings on how many inputs and how many rich slots one source message may have.
 *
 * Each is a bound a message may sit exactly at. One past it is refused against the message, with
 * the code of the contract that overflowed.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { RESOURCE_LIMITS } from '../src/resource-limits.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

function refusals(entry: readonly string[]): readonly string[] {
  const catalog = parseCatalog(
    ['messages:', '  subject:', ...entry, ''].join('\n'),
    {
      role: 'source',
      providerId: 'home',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  return analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
  }).diagnostics.map(({ code, path }) => `${code} ${path.join('/')}`);
}

const message = (text: string): string =>
  `    message: ${JSON.stringify(text)}`;

function withInputs(count: number): readonly string[] {
  return [
    message(
      Array.from({ length: count }, (_, index) => `{$v${index}}`).join(' '),
    ),
  ];
}

function withUsedSlots(count: number): readonly string[] {
  return [
    message(
      Array.from({ length: count }, (_, index) => `{#s${index}/}`).join(' '),
    ),
  ];
}

/** Slots the entry declares and the message does not use, which count toward the same ceiling. */
function withDeclaredSlots(count: number): readonly string[] {
  return [
    message('Text'),
    '    slots:',
    ...Array.from({ length: count }, (_, index) => [
      `      s${index}:`,
      '        shape: standalone',
    ]).flat(),
  ];
}

describe('the input ceiling', () => {
  it('admits a message with exactly that many inputs', () => {
    expect(refusals(withInputs(RESOURCE_LIMITS.inputsPerMessage))).toEqual([]);
  });

  it('refuses a message with one more', () => {
    expect(refusals(withInputs(RESOURCE_LIMITS.inputsPerMessage + 1))).toEqual([
      'EQ1302 messages/subject',
    ]);
  });
});

describe('the slot ceiling', () => {
  it('admits a message that uses exactly that many slots', () => {
    expect(refusals(withUsedSlots(RESOURCE_LIMITS.slotsPerMessage))).toEqual(
      [],
    );
  });

  it('refuses a message that uses one more', () => {
    expect(
      refusals(withUsedSlots(RESOURCE_LIMITS.slotsPerMessage + 1)),
    ).toEqual(['EQ1303 messages/subject']);
  });

  it('admits an entry that declares exactly that many slots', () => {
    expect(
      refusals(withDeclaredSlots(RESOURCE_LIMITS.slotsPerMessage)),
    ).toEqual([]);
  });

  it('refuses an entry that declares one more', () => {
    expect(
      refusals(withDeclaredSlots(RESOURCE_LIMITS.slotsPerMessage + 1)),
    ).toEqual(['EQ1303 messages/subject']);
  });
});
