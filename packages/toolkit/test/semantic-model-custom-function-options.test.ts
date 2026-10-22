/**
 * A registered message function as a message calls it: its operand, and the options it declares.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7 forbids a message from contradicting a
 * registered function contract. The descriptor is that contract: a call needs an operand, may write
 * only the options the descriptor declares, must write the ones it marks required, and a literal
 * written for one has to be a value the descriptor admits. Each refusal is reported on the message
 * that makes the call.
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
      kind: 'message-function',
      id: 'demo:label',
      operandType: 'string',
      options: {
        tone: { type: 'string', values: ['loud', 'plain'] },
        width: { type: 'integer' },
      },
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 64,
    },
    {
      kind: 'message-function',
      id: 'demo:measure',
      operandType: 'number',
      options: {
        system: { type: 'string', required: true },
        precision: { type: 'integer' },
      },
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 64,
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

interface Refusal {
  readonly code: string;
  readonly path: readonly (string | number)[];
}

/**
 * The refusals of one source message. The catalog is parsed under the full registry and analysed
 * under `analyzedWith`, which differs where a case needs a registry that lost a function. `rebuilt`
 * stands between the two for a catalog a caller assembled rather than parsed.
 */
function refusals(
  message: string,
  analyzedWith: ExtensionRegistry = registry(),
  rebuilt: (catalog: Catalog) => Catalog = (catalog) => catalog,
): readonly Refusal[] {
  const configuration = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    }),
  );
  if (!configuration.ok) throw new Error('Configuration fixture failed');
  const catalog = parseCatalog(
    ['messages:', `  subject: ${JSON.stringify(message)}`, ''].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/function-lab',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
      extensions: registry(),
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [rebuilt(catalog.value)],
    extensions: analyzedWith,
  });
  return graph.ok
    ? []
    : graph.diagnostics.map(({ code, path }) => ({ code, path: [...path] }));
}

const onTheMessage = [{ code: 'EQ1805', path: ['messages', 'subject'] }];

describe('a call to a registered function', () => {
  it('is accepted with an operand and none of its optional options', () => {
    expect(refusals('{$name :demo:label}')).toEqual([]);
  });

  it('is refused on its message without an operand', () => {
    expect(refusals('{:demo:label}')).toEqual(onTheMessage);
  });

  it('is refused on its message once no registry declares the function', () => {
    const emptied = defineExtensionRegistry([]);
    if (!emptied.ok) throw new Error(JSON.stringify(emptied.diagnostics));
    expect(refusals('{$name :demo:label}', emptied.value)).toEqual(
      onTheMessage,
    );
  });
});

describe('an option written on a registered function', () => {
  it('is accepted as a literal the descriptor lists', () => {
    expect(refusals('{$name :demo:label tone=loud}')).toEqual([]);
  });

  it('is accepted as an input, which no literal set can judge', () => {
    expect(refusals('{$name :demo:label tone=$tone}')).toEqual([]);
  });

  it('is refused on its message as a literal the descriptor does not list', () => {
    expect(refusals('{$name :demo:label tone=shout}')).toEqual(onTheMessage);
  });

  it('is refused on its message when the descriptor does not declare it', () => {
    expect(refusals('{$name :demo:label colour=red}')).toEqual(onTheMessage);
  });
});

describe('an option key held without a value', () => {
  /** The parsed catalog with the one function call's `tone` option present and undefined. */
  function withoutToneValue(catalog: Catalog): Catalog {
    const subject = catalog.messages['subject'];
    if (subject?.kind !== 'message' || subject.semantics.kind !== 'pattern') {
      throw new Error('Catalog fixture failed');
    }
    const pattern = subject.semantics.pattern.map((part) =>
      typeof part === 'string' ||
      part.kind !== 'expression' ||
      part.function === undefined
        ? part
        : {
            ...part,
            function: { ...part.function, options: { tone: undefined } },
          },
    );
    return {
      ...catalog,
      messages: {
        subject: { ...subject, semantics: { ...subject.semantics, pattern } },
      },
    } as unknown as Catalog;
  }

  it('is read as an option the call did not write', () => {
    expect(
      refusals('{$name :demo:label tone=loud}', registry(), withoutToneValue),
    ).toEqual([]);
  });
});

describe('an option a descriptor marks required', () => {
  it('is accepted when the call writes it', () => {
    expect(refusals('{$length :demo:measure system=metric}')).toEqual([]);
  });

  it('is refused on its message when the call leaves it out', () => {
    expect(refusals('{$length :demo:measure}')).toEqual(onTheMessage);
    expect(refusals('{$length :demo:measure precision=2}')).toEqual(
      onTheMessage,
    );
  });
});
