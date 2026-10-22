import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  type Catalog,
  type ExtensionRegistry,
} from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

import { testProjectConfiguration } from './fixtures.js';

/**
 * A catalog that references an extension is checked against the registry the project declares.
 *
 * The catalog below is parsed against a registry that knows the function, so the parser accepts
 * it, and then analyzed against the project's own registry. A reference the project's registry
 * does not hold, and an option the registered function does not declare, are both errors at the
 * point the catalog set is analyzed, because that is where the catalog and the registry meet.
 */

const upper = {
  kind: 'message-function',
  id: 'acme:upper',
  operandType: 'string',
  resultType: 'string',
  selector: 'none',
  maximumOutputLength: 64,
} as const;

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([upper]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

function catalog(text: string): Catalog {
  const parsed = parseCatalog(text, {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
    extensions: registry(),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function errors(
  catalogs: readonly Catalog[],
  extensions?: ExtensionRegistry,
): readonly string[] {
  const result = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs,
    ...(extensions === undefined ? {} : { extensions }),
  });
  return result.diagnostics
    .filter(({ severity }) => severity === 'error')
    .map(({ code, summary }) => `${code} ${summary}`);
}

describe('a catalog reference to an extension', () => {
  it('is accepted when the project registry holds it', () => {
    expect(
      errors([catalog('messages:\n  title: "{$x :acme:upper}"\n')], registry()),
    ).toEqual([]);
  });

  it('is an error when the project registry does not hold it', () => {
    expect(
      errors([catalog('messages:\n  title: "{$x :acme:upper}"\n')]),
    ).toEqual([
      'EQ1805 Message function "acme:upper" has no registered application-local descriptor.',
    ]);
  });

  it('is an error when it passes an option the function does not declare', () => {
    expect(
      errors(
        [catalog('messages:\n  title: "{$x :acme:upper mode=loud}"\n')],
        registry(),
      ),
    ).toEqual([
      'EQ1805 Custom message function "acme:upper" does not declare option "mode".',
    ]);
  });
});
