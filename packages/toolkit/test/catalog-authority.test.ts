import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  type ExtensionRegistry,
} from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * A catalog names only what the application registered.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 1: a message function and a slot kind are trusted
 * because the application writes them in its own source, and a catalog MUST NOT acquire that
 * authority by any route. The two routes a catalog can write are calling a function and declaring
 * a slot's kind, so each is refused when it names something the application never registered, and
 * each is accepted once the application has.
 */

const configuration = testProjectConfiguration(['en-US']);

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'message-function',
      id: 'demo:uppercase',
      operandType: 'string',
      options: {},
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 128,
    },
    {
      kind: 'rich-slot-kind',
      id: 'demo:badge',
      shape: 'paired',
      interactive: false,
      textProjection: 'binding-required',
      options: {},
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

function parse(body: string, extensions?: ExtensionRegistry) {
  return parseCatalog(body, {
    role: 'source',
    providerId: '@example/authority',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
    ...(extensions === undefined ? {} : { extensions }),
  });
}

const calling = 'messages:\n  greeting: "Hello {$name :demo:uppercase}"\n';
const declaring = [
  'messages:',
  '  badge:',
  '    message: "{#badge}New{/badge}"',
  '    slots:',
  '      badge: demo:badge',
  '',
].join('\n');

describe('a catalog calling a message function', () => {
  it('is refused when the application registered none by that name', () => {
    const result = parse(calling);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('EQ1203');
  });

  it('is accepted when the application registered it', () => {
    expect(parse(calling, registry()).ok).toBe(true);
  });
});

describe('a catalog declaring a slot kind', () => {
  it('is refused when the application registered no kind by that name', () => {
    // The catalog parses: a slot's kind is a name, and whether the name is registered is a
    // question about the whole catalog set, which analysis answers.
    const parsed = parse(declaring);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const analyzed = analyzeCatalogSet({
      configuration,
      catalogs: [parsed.value],
    });
    expect(analyzed.ok).toBe(false);
    expect(analyzed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'EQ1303',
        summary: expect.stringContaining('unregistered semantic kind'),
      }),
    );
  });

  it('is accepted when the application registered it', () => {
    const extensions = registry();
    const parsed = parse(declaring, extensions);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      analyzeCatalogSet({ configuration, catalogs: [parsed.value], extensions })
        .ok,
    ).toBe(true);
  });
});
