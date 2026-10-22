/**
 * What a target message may change about the contract its source message set.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: a target inherits the effective source
 * contract. It may repeat a repeatable slot and change nesting compatibly, and it must not invent a
 * slot, alter a shape or exceed cardinality. An input keeps its source type the same way. Each
 * refusal is reported against the message in the target catalog.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const configuration = testProjectConfiguration(['en-US', 'ar-EG']);

function catalog(
  role: 'source' | 'target',
  locale: string,
  lines: readonly string[],
): Catalog {
  const result = parseCatalog([...lines, ''].join('\n'), {
    role,
    providerId: 'home',
    scopeId: 'shell',
    locale,
    sourcePath: `i18n/shell/${locale}.yaml`,
  });
  if (!result.ok) throw new Error(`fixture ${locale} failed to parse`);
  return result.value;
}

function analyze(source: readonly string[], target: readonly string[]) {
  return analyzeCatalogSet({
    configuration,
    catalogs: [
      catalog('source', 'en-US', source),
      catalog('target', 'ar-EG', target),
    ],
  });
}

/** The code, the pointer and the file of each finding. */
function findings(
  source: readonly string[],
  target: readonly string[],
): readonly string[] {
  return analyze(source, target).diagnostics.map(
    ({ code, path, span }) =>
      `${code} ${path.join('/')} ${span?.sourcePath ?? ''}`,
  );
}

const one = (message: string): readonly string[] => [
  'messages:',
  `  note: ${JSON.stringify(message)}`,
];

const refusedAtTheMessage = ['EQ1304 messages/note i18n/shell/ar-EG.yaml'];

describe('a target message', () => {
  it('is refused at the message when it retypes an input', () => {
    expect(
      findings(one('Hello {$name :string}'), one('Hello {$name :number}')),
    ).toEqual(refusedAtTheMessage);
  });

  it('is refused at the message when it uses a slot the source does not have', () => {
    expect(
      findings(one('Read this'), one('Read {#strong}this{/strong}')),
    ).toEqual(refusedAtTheMessage);
  });

  it('is refused at the message when it leaves out a slot the source requires', () => {
    expect(
      findings(one('Read {#strong}this{/strong}'), one('Read this')),
    ).toEqual(refusedAtTheMessage);
  });

  it('is refused when it changes the shape of a slot', () => {
    expect(
      findings(one('Read {#mark}this{/mark}'), one('Read this {#mark/}')),
    ).toEqual(refusedAtTheMessage);
  });

  it('is refused when it repeats a slot the source uses once', () => {
    expect(
      findings(
        one('Read {#strong}this{/strong}'),
        one('{#strong}Read{/strong} {#strong}this{/strong}'),
      ),
    ).toEqual(refusedAtTheMessage);
  });

  it('may repeat a slot the source repeats', () => {
    expect(
      findings(
        one('{#strong}Read{/strong} {#strong}this{/strong}'),
        one('{#strong}Read{/strong} {#strong}this{/strong}'),
      ),
    ).toEqual([]);
  });

  it('is refused when it moves a slot under a parent the source does not use', () => {
    expect(
      findings(
        one('{#emphasis}Read{/emphasis} {#strong}this{/strong}'),
        one('{#emphasis}Read {#strong}this{/strong}{/emphasis}'),
      ),
    ).toEqual(refusedAtTheMessage);
  });

  it('is refused when one of two uses of a slot sits under a new parent', () => {
    expect(
      findings(
        one(
          '{#emphasis}Read{/emphasis} {#strong}this{/strong} {#strong}now{/strong}',
        ),
        one(
          '{#emphasis}Read {#strong}this{/strong}{/emphasis} {#strong}now{/strong}',
        ),
      ),
    ).toEqual(refusedAtTheMessage);
  });
});

describe('a target entry declared empty', () => {
  it('is recorded as empty under its locale', () => {
    const result = analyze(
      ['messages:', '  note: Read this'],
      ['messages:', '  note:', '    empty: true'],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scopes[0]?.messages[0]?.targets).toEqual([
      { locale: 'ar-EG', kind: 'empty' },
    ]);
  });
});
