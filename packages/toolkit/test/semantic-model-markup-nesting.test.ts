/**
 * Markup as one pattern nests it: what closes what, what may sit inside what, and where a refusal
 * is reported.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: an interactive slot is neither inside
 * nor around another, `code` contains only text and formatted values, and a target may change
 * nesting compatibly but may not invent a slot. A kind is the declared one where the entry declares
 * it, so a slot declared as `code` under another name holds the same rule. Nesting belongs to the
 * message rather than to one slot, so its refusals point at the message, and an option refusal
 * points at the slot that carries the option.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  parseConfiguration,
  type Catalog,
  type ExtensionRegistry,
} from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'rich-slot-kind',
      id: 'demo:badge',
      shape: 'paired',
      interactive: false,
      textProjection: 'binding-required',
      options: { tone: ['info', 'warning'] },
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

interface Refusal {
  readonly code: string;
  readonly path: readonly (string | number)[];
}

function catalog(
  role: 'source' | 'target',
  locale: string,
  entry: readonly string[],
): Catalog {
  const parsed = parseCatalog(
    ['messages:', '  subject:', ...entry, ''].join('\n'),
    {
      role,
      providerId: '@neolorn/nesting-lab',
      scopeId: 'shell',
      locale,
      sourcePath: `i18n/shell/${locale}.yaml`,
      extensions: registry(),
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

/** The refusals of a source entry, and of the target entry translating it when one is given. */
function refusals(
  source: readonly string[],
  target?: readonly string[],
): readonly Refusal[] {
  const locales = target === undefined ? ['en-US'] : ['en-US', 'ar-EG'];
  const configuration = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales,
    }),
  );
  if (!configuration.ok) throw new Error('Configuration fixture failed');
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [
      catalog('source', 'en-US', source),
      ...(target === undefined ? [] : [catalog('target', 'ar-EG', target)]),
    ],
    extensions: registry(),
  });
  return graph.ok
    ? []
    : graph.diagnostics.map(({ code, path }) => ({ code, path: [...path] }));
}

const message = (text: string): string =>
  `    message: ${JSON.stringify(text)}`;
const onTheMessage = [{ code: 'EQ1303', path: ['messages', 'subject'] }];

describe('a closing markup element', () => {
  it('is accepted when it closes the slot opened last', () => {
    expect(
      refusals([message('{#strong}Save {#emphasis}now{/emphasis}{/strong}')]),
    ).toEqual([]);
  });

  it('is refused on its message when it names another slot', () => {
    expect(refusals([message('{#strong}Save{/emphasis}')])).toEqual(
      onTheMessage,
    );
  });
});

describe('an opening markup element', () => {
  it('is refused on its message when nothing closes it', () => {
    expect(refusals([message('{#strong}Save now')])).toEqual(onTheMessage);
    expect(
      refusals([message('{#strong}Save {#emphasis}now{/emphasis}')]),
    ).toEqual(onTheMessage);
  });
});

describe('an interactive slot', () => {
  it('is accepted inside a slot that is not interactive', () => {
    expect(
      refusals([message('{#strong}Read {#link}the terms{/link}{/strong}')]),
    ).toEqual([]);
  });

  it('is refused on its message inside another interactive slot', () => {
    expect(
      refusals([message('{#action}Open {#link}the terms{/link}{/action}')]),
    ).toEqual(onTheMessage);
  });
});

describe('a slot inside code', () => {
  it('is refused on its message for the built-in name', () => {
    expect(
      refusals([message('{#code}npm {#strong}test{/strong}{/code}')]),
    ).toEqual(onTheMessage);
  });

  it('is refused on its message for a slot declared as code', () => {
    expect(
      refusals([
        message('{#snippet}npm {#strong}test{/strong}{/snippet}'),
        '    slots:',
        '      snippet: code',
      ]),
    ).toEqual(onTheMessage);
  });

  it('is accepted where the declared kind of a slot named code is another', () => {
    expect(
      refusals([
        message('{#code}npm {#strong}test{/strong}{/code}'),
        '    slots:',
        '      code: emphasis',
      ]),
    ).toEqual([]);
  });
});

describe('a target that nests a slot inside one the source does not have', () => {
  it('is refused as inventing a slot', () => {
    expect(
      refusals(
        [message('Read {#link}the terms{/link}')],
        [message('{#aside}{#link}the terms{/link}{/aside}')],
      ).map(({ code }) => code),
    ).toEqual(['EQ1304', 'EQ1304']);
  });
});

describe('an option the kind of a slot does not admit', () => {
  it('is refused at the slot that carries it', () => {
    expect(
      refusals([
        message('{#badge tone=danger}New{/badge}'),
        '    slots:',
        '      badge: demo:badge',
      ]),
    ).toEqual([
      { code: 'EQ1805', path: ['messages', 'subject', 'slots', 'badge'] },
    ]);
  });
});
