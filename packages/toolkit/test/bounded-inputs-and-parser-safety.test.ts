import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  exportXliff22,
  importXliff22,
  parseCatalog,
  parseConfiguration,
  type Catalog,
  type CatalogParseOptions,
  type ExtensionDescriptorInput,
} from '../src/index.js';
import { parseAuthoredChangePlan } from '../src/authoring-transaction.js';
import { parseExtensionRegistry } from '../src/extensions.js';
import { RESOURCE_LIMITS } from '../src/resource-limits.js';
import { toolkitDiagnostic, toolkitFailure } from '../src/diagnostics.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

const sourceOptions: CatalogParseOptions = {
  role: 'source',
  providerId: '@example/app',
  scopeId: 'shell',
  locale: 'en-US',
};

function catalog(
  source: string,
  options: CatalogParseOptions = sourceOptions,
): Catalog {
  const result = parseCatalog(source, options);
  if (!result.ok) throw new Error('The catalog fixture below is invalid.');
  return result.value;
}

describe('bounded authored inputs', () => {
  it('bounds diagnostic count, text, path depth, and spoofing controls', () => {
    // The override sits inside the summary ceiling, so it is the replacement that keeps it out of
    // the text rather than the truncation.
    const diagnostic = toolkitDiagnostic(
      'EQ1701',
      `Order \u202e12345 shipped ${'x'.repeat(3_000)}`,
      { path: Array.from({ length: 100 }, (_, index) => `segment-${index}`) },
    );
    expect([...diagnostic.summary]).toHaveLength(
      RESOURCE_LIMITS.diagnosticSummaryCharacters,
    );
    expect(diagnostic.summary).not.toContain('\u202e');
    expect(diagnostic.summary.startsWith('Order \ufffd12345 shipped ')).toBe(
      true,
    );
    expect(diagnostic.path).toHaveLength(
      RESOURCE_LIMITS.diagnosticPathSegments,
    );
    expect(
      toolkitFailure(
        Array.from(
          { length: RESOURCE_LIMITS.diagnostics + 10 },
          () => diagnostic,
        ),
      ).diagnostics,
    ).toHaveLength(RESOURCE_LIMITS.diagnostics);
  });

  it('replaces a control, an override and an isolate inside the bounded text', () => {
    // Inside the bound, because a control past the ceiling is dropped with the rest of the text
    // and says nothing about whether one inside it is replaced.
    const diagnostic = toolkitDiagnostic('EQ1701', 'a\u0007b\u202ec\u2066d', {
      path: ['x\u202ey'],
    });
    expect(diagnostic.summary).toBe('a\ufffdb\ufffdc\ufffdd');
    expect(diagnostic.path).toEqual(['x\ufffdy']);
  });

  it('refuses a catalog over the message ceiling with EQ1101, the code its ceilings share', () => {
    const count = RESOURCE_LIMITS.messagesPerCatalog + 1;
    const lines = ['messages:'];
    for (let index = 0; index < count; index += 1) {
      lines.push(`  m${index}: "x"`);
    }
    const result = parseCatalog(`${lines.join('\n')}\n`, {
      role: 'source',
      providerId: '@example/app',
      scopeId: 'shell',
      locale: 'en-US',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]).toMatchObject({ code: 'EQ1101' });
    expect(result.diagnostics[0]?.summary).toContain(
      'message implementation ceiling',
    );
  });

  it('refuses JSON nested past what the parser itself can recurse through', () => {
    // The depth ceiling below is checked on the parsed tree, and the parser recurses once per
    // level, so a nesting deep enough overflows the stack before the tree exists.
    const nested = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    for (const [what, parse, code] of [
      ['configuration', () => parseConfiguration(nested), 'EQ1001'],
      ['extension registry', () => parseExtensionRegistry(nested), 'EQ1805'],
      ['change plan', () => parseAuthoredChangePlan(nested), 'EQ1805'],
    ] as const) {
      const result = parse();
      expect(result.ok, what).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostics[0], what).toMatchObject({ code });
      expect(result.diagnostics[0]?.summary, what).toContain('depth');
    }
    // Brackets inside a string are text, and counting them would refuse a document for its words.
    const quoted = parseConfiguration(`{"unknown": "${'['.repeat(1000)}"}`);
    expect(
      quoted.ok ? [] : quoted.diagnostics.map(({ summary }) => summary),
    ).not.toContainEqual(expect.stringContaining('depth'));
  });

  it('rejects over-deep JSON before recursive construction', () => {
    const nested = `${'{"unknown":'.repeat(70)}null${'}'.repeat(70)}`;
    const result = parseConfiguration(nested);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]).toMatchObject({ code: 'EQ1001' });
    expect(result.diagnostics[0]?.summary).toContain('depth ceiling');
  });

  it('rejects structural bidi controls and noncharacters without rejecting ordinary message Unicode', () => {
    const structural = parseCatalog(
      'messages:\n  unsafe\u202e-id: "Text"\n',
      sourceOptions,
    );
    expect(structural.ok).toBe(false);
    // The identifier grammar refuses this key as well, so the refusal asserted is the one that
    // names the control.
    expect(structural.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'EQ1101',
        summary: expect.stringContaining('invisible or bidi controls'),
      }),
    );
    const noncharacter = parseCatalog(
      'messages:\n  title: "Unsafe \ufdd0"\n',
      sourceOptions,
    );
    expect(noncharacter.ok).toBe(false);
    expect(
      parseCatalog(
        'messages:\n  title: "Arabic مرحبًا and emoji 🧭"\n',
        sourceOptions,
      ).ok,
    ).toBe(true);
  });

  it('snapshots programmatic extension descriptors without invoking accessors or accepting cycles', () => {
    const accessor = {
      kind: 'identifier-segment',
      id: 'example:sku',
      syntax: 'ascii-token',
      maximumLength: 32,
    } as Record<string, unknown>;
    Object.defineProperty(accessor, 'trap', {
      enumerable: true,
      get: () => {
        throw new Error('must not execute');
      },
    });
    expect(
      defineExtensionRegistry([accessor as unknown as ExtensionDescriptorInput])
        .ok,
    ).toBe(false);

    // A throwing getter is refused whether or not it ran, because the throw is caught and reported
    // like any other refusal. One that answers a valid value and counts its calls is the only way
    // to tell a snapshot that never ran it from one that did.
    let reads = 0;
    const answering = {
      kind: 'identifier-segment',
      syntax: 'ascii-token',
      maximumLength: 32,
    } as Record<string, unknown>;
    Object.defineProperty(answering, 'id', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'example:sku';
      },
    });
    expect(
      defineExtensionRegistry([
        answering as unknown as ExtensionDescriptorInput,
      ]).ok,
    ).toBe(false);
    expect(reads).toBe(0);

    const cyclicOptions: Record<string, unknown> = {};
    cyclicOptions['cycle'] = cyclicOptions;
    expect(
      defineExtensionRegistry([
        {
          kind: 'rich-slot-kind',
          id: 'example:badge',
          shape: 'paired',
          interactive: false,
          textProjection: 'children',
          options: cyclicOptions,
        } as unknown as ExtensionDescriptorInput,
      ]).ok,
    ).toBe(false);
  });
});

describe('XLIFF parser safety', () => {
  const source = catalog('messages:\n  title: "Rock & Roll"\n');
  const target = catalog('messages:\n  title: "روك & رول"\n', {
    ...sourceOptions,
    role: 'target',
    locale: 'ar-EG',
  });

  it('round-trips escaped ampersands without treating decoded text as an entity', () => {
    const exported = exportXliff22({ source, target });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value).toContain('&amp;');
    const imported = importXliff22({
      document: exported.value,
      source,
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.messages['title']).toMatchObject({
      message: 'روك & رول',
    });
    claimCapability('capability:xliff');
  });

  it('rejects processing instructions, repeated declarations, and unsafe CDATA', () => {
    const exported = exportXliff22({ source, target });
    if (!exported.ok) throw new Error('XLIFF fixture export failed.');
    expect(
      importXliff22({
        document: exported.value.replace(
          '<xliff ',
          '<?xml-stylesheet href="unsafe"?><xliff ',
        ),
        source,
      }).ok,
    ).toBe(false);
    expect(
      importXliff22({
        document: exported.value.replace(
          '<xliff ',
          '<?xml version="1.0"?><xliff ',
        ),
        source,
      }).ok,
    ).toBe(false);
    expect(
      importXliff22({
        document: exported.value.replace(
          'روك &amp; رول',
          '<![CDATA[unsafe\u0001]]>',
        ),
        source,
      }).ok,
    ).toBe(false);
    claimCapability('capability:xliff');
  });

  // `specs/12-verification.spec.md` section 4 asks for exhaustion of parsing to be refused, and
  // either document below is also refused later for elements XLIFF does not define, so each case
  // asks for the ceiling by name.
  it.each([
    ['depth', '<a>'.repeat(100) + '</a>'.repeat(100)],
    ['node', '<a/>'.repeat(250_001)],
  ])(
    'refuses a document past the %s ceiling at that ceiling',
    (ceiling, inner) => {
      const exported = exportXliff22({ source, target });
      if (!exported.ok) throw new Error('XLIFF fixture export failed.');
      const document = exported.value.split('روك &amp; رول');
      expect(document).toHaveLength(2);
      const imported = importXliff22({
        document: document.join(inner),
        source,
      });
      expect(imported.ok).toBe(false);
      expect(imported.diagnostics[0]?.summary).toContain(`${ceiling} ceiling`);
    },
  );
});
