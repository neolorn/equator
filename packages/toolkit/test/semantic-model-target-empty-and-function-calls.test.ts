/**
 * A target entry beside a source entry of the other kind, and a function call a target writes.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` sections 5 and 7. An entry is a message or is
 * declared empty, in the source and in a target independently, and plural coverage is a question
 * about two messages: where either side is empty there are no variants to be short of. A target
 * calls a registered function under the same descriptor the source does, so a call the descriptor
 * refuses is refused on the target's message.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  type Catalog,
  type ExtensionRegistry,
} from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const configuration = testProjectConfiguration(['en-US', 'ar-EG']);

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'message-function',
      id: 'demo:measure',
      operandType: 'number',
      options: { system: { type: 'string', required: true } },
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 64,
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

function catalog(
  role: 'source' | 'target',
  locale: string,
  entry: readonly string[],
): Catalog {
  const result = parseCatalog(
    ['messages:', '  note:', ...entry, ''].join('\n'),
    {
      role,
      providerId: 'home',
      scopeId: 'shell',
      locale,
      sourcePath: `i18n/shell/${locale}.yaml`,
      extensions: registry(),
    },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

/** The code, the pointer and the file of each finding. */
function findings(
  source: readonly string[],
  target: readonly string[],
): readonly string[] {
  return analyzeCatalogSet({
    configuration,
    catalogs: [
      catalog('source', 'en-US', source),
      catalog('target', 'ar-EG', target),
    ],
    extensions: registry(),
  }).diagnostics.map(
    ({ code, path, span }) =>
      `${code} ${path.join('/')} ${span?.sourcePath ?? ''}`,
  );
}

const message = (text: string): string =>
  `    message: ${JSON.stringify(text)}`;
const empty = ['    empty: true'];
const counted = [
  '    message: |-',
  '      .input {$count :number}',
  '      .match $count',
  '      one {{One item}}',
  '      * {{{$count} items}}',
];

describe('plural coverage', () => {
  it('is asked of a target that selects where the source does', () => {
    expect(findings(counted, counted)).toEqual([
      'EQ1308 messages/note i18n/shell/ar-EG.yaml',
    ]);
  });

  it('is not asked of a target declared empty', () => {
    expect(findings(counted, empty)).toEqual([]);
  });

  it('is not asked of a target written for a source declared empty', () => {
    expect(findings(empty, [message('A note')])).toEqual([]);
  });
});

describe('a function call a target writes', () => {
  const source = [message('{$length :demo:measure system=metric}')];

  it('is accepted with the option its descriptor requires', () => {
    expect(
      findings(source, [message('{$length :demo:measure system=imperial}')]),
    ).toEqual([]);
  });

  it('is refused on the target message without that option', () => {
    expect(findings(source, [message('{$length :demo:measure}')])).toEqual([
      'EQ1805 messages/note i18n/shell/ar-EG.yaml',
    ]);
  });
});
