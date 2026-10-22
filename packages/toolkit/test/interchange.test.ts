import { describe, expect, it } from 'vitest';

import {
  PSEUDO_LOCALE_BIDI,
  PSEUDO_LOCALE_ACCENTED,
  createPseudoCatalog,
  exportXliff22,
  importXliff22,
  parseCatalog,
  type Catalog,
  type CatalogParseOptions,
} from '../src/index.js';
import { pseudoLocalizeMessage } from '../src/pseudo-localization.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';
import { writtenCatalog } from './fixtures.js';

const sourceOptions: CatalogParseOptions = {
  role: 'source',
  providerId: '@example/app',
  scopeId: 'shell',
  locale: 'en-US',
};

const targetOptions: CatalogParseOptions = {
  ...sourceOptions,
  role: 'target',
  locale: 'ar-EG',
};

function catalog(source: string, options: CatalogParseOptions): Catalog {
  const parsed = parseCatalog(source, options);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('fixture catalog is invalid');
  return parsed.value;
}

const source = catalog(
  [
    'messages:',
    '  greeting:',
    '    message: "Hello {#strong}{$name}{/strong}."',
    '    description: "Greeting"',
    '    context: "Home page"',
    '    inputs:',
    '      name: string',
    '    slots:',
    '      strong: strong',
    '  count: |-',
    '    .input {$count :number}',
    '    .match $count',
    '    1 {{One item}}',
    '    * {{Other items: {$count}}}',
    '  spacer:',
    '    empty: true',
    '',
  ].join('\n'),
  sourceOptions,
);

const target = catalog(
  [
    'messages:',
    '  greeting: "مرحبًا {#strong}{$name}{/strong}."',
    '  count: |-',
    '    .input {$count :number}',
    '    .match $count',
    '    1 {{عنصر واحد}}',
    '    * {{عناصر أخرى: {$count}}}',
    '  spacer:',
    '    empty: true',
    '',
  ].join('\n'),
  targetOptions,
);

describe('Equator XLIFF 2.2 interchange', () => {
  it('round-trips MessageFormat, slots, metadata contracts, and explicit empty values', () => {
    const exported = exportXliff22({ source, target });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value).toContain('version="2.2"');
    // The empty translation is a refinement of the segment's state, not a foreign attribute on
    // <target>, which is one of the two elements in a unit that admit no foreign attributes.
    expect(exported.value).toContain('subState="equator:empty"');
    expect(exported.value).not.toContain('equator:empty="true"');
    expect(exported.value).toContain('equator:contract');

    const imported = importXliff22({
      document: exported.value,
      source,
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(writtenCatalog(imported.value)).toBe(writtenCatalog(target));
    claimCapability('capability:xliff');
  });

  it('round-trips text beyond the Basic Multilingual Plane', () => {
    // XML 1.0 section 2.2 allows U+10000 to U+10FFFF, where emoji live, and so do CJK extension B
    // characters that Japanese and Chinese names are written with.
    const beyond = `${String.fromCodePoint(0x20bb7)} ${String.fromCodePoint(0x1f600)}`;
    const wide = catalog(
      [
        'messages:',
        `  greeting: "${beyond} {#strong}{$name}{/strong}."`,
        '  count: |-',
        '    .input {$count :number}',
        '    .match $count',
        '    1 {{one}}',
        '    * {{other {$count}}}',
        '  spacer:',
        '    empty: true',
        '',
      ].join('\n'),
      targetOptions,
    );

    const exported = exportXliff22({ source, target: wide });
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    if (!exported.ok) return;
    const imported = importXliff22({ document: exported.value, source });
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
    if (!imported.ok) return;
    expect(writtenCatalog(imported.value)).toBe(writtenCatalog(wide));
  });

  it('refuses a document type declaration where XML allows one, after the XML declaration', () => {
    const exported = exportXliff22({ source, target });
    if (!exported.ok) throw new Error('export failed');
    // Placed where an entity payload is legal XML. Before the XML declaration it would be refused
    // as a misplaced declaration, which says nothing about whether a DTD is read.
    const document = exported.value.replace(
      /^(<\?xml[^>]*\?>)/u,
      '$1<!DOCTYPE xliff [<!ENTITY xxe SYSTEM "file:///secret">]>',
    );
    expect(document).toContain('?><!DOCTYPE');
    const imported = importXliff22({ document, source });
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.diagnostics[0]?.summary).toBe(
      'XLIFF cannot contain DTDs, entities, or processing instructions.',
    );
  });

  it('rejects external entities and does not silently accept stale source units', () => {
    const exported = exportXliff22({ source, target });
    if (!exported.ok) throw new Error('export failed');
    expect(
      importXliff22({
        document: `<!DOCTYPE xliff [<!ENTITY xxe SYSTEM "file:///secret">]>${exported.value}`,
        source,
      }).ok,
    ).toBe(false);

    const changedSource = catalog(
      writtenCatalog(source).replace('Hello ', 'Welcome '),
      sourceOptions,
    );
    const stale = importXliff22({
      document: exported.value,
      source: changedSource,
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.diagnostics).toMatchObject([
      { code: 'EQ1803', severity: 'warning' },
    ]);
    expect(stale.value.messages['greeting']).toBeUndefined();
    expect(stale.value.messages['count']).toBeDefined();
    claimCapability('capability:xliff');
  });
});

describe('Equator pseudo-locales', () => {
  const plain = 'Open https://site.example {#strong}{$name}{/strong}';

  it('transforms only human-language pattern text', () => {
    const result = pseudoLocalizeMessage(plain, { lengthFactor: 0.35 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('https://site.example');
    expect(result.value).toContain('{$name}');
    expect(result.value).toContain('{#strong}');
  });

  /**
   * Each behaviour switched on with the others off.
   *
   * Each behaviour is its own switch, so each can be asked about alone. A test that only checks
   * "output differs from source" passes for any of them and distinguishes none.
   */
  it('applies markers without touching length', () => {
    const marked = pseudoLocalizeMessage('Hello there', {
      markers: true,
    });
    const plainResult = pseudoLocalizeMessage('Hello there', {});
    expect(marked.ok && plainResult.ok).toBe(true);
    if (!marked.ok || !plainResult.ok) return;
    expect(marked.value).toContain('⟦');
    expect(marked.value).toContain('⟧');
    expect(plainResult.value).not.toContain('⟦');
    // The marker pair is the only difference, so length moved by exactly two.
    expect([...marked.value].length).toBe([...plainResult.value].length + 2);
  });

  it('expands and contracts, and the two move length in opposite directions', () => {
    const source = 'Notifications are unavailable right now';
    const neutral = pseudoLocalizeMessage(source, {});
    const expanded = pseudoLocalizeMessage(source, { lengthFactor: 0.5 });
    const contracted = pseudoLocalizeMessage(source, {
      lengthFactor: -0.5,
    });
    expect(neutral.ok && expanded.ok && contracted.ok).toBe(true);
    if (!neutral.ok || !expanded.ok || !contracted.ok) return;
    const length = (value: string): number => [...value].length;
    // Asserted against the *accented* baseline rather than the source, so this measures the factor
    // and not the substitution. Both directions, because a check on expansion alone ships
    // contraction untested behind it.
    expect(length(expanded.value)).toBeGreaterThan(length(neutral.value));
    expect(length(contracted.value)).toBeLessThan(length(neutral.value));
  });

  it('refuses a length factor outside the range it can honour', () => {
    const tooFar = pseudoLocalizeMessage('Hello', { lengthFactor: -2 });
    expect(tooFar.ok).toBe(false);
    expect(tooFar.diagnostics.map(({ code }) => code)).toContain('EQ1804');
  });

  it('creates an ordinary target catalog under the tag it is given', () => {
    const expanded = createPseudoCatalog(source, {
      locale: PSEUDO_LOCALE_ACCENTED,
      lengthFactor: 0.35,
      markers: true,
    });
    const contracted = createPseudoCatalog(source, {
      locale: PSEUDO_LOCALE_BIDI,
      lengthFactor: -0.35,
      markers: true,
    });
    expect(expanded.ok).toBe(true);
    expect(contracted.ok).toBe(true);
    if (!expanded.ok || !contracted.ok) return;
    expect(expanded.value.locale).toBe(PSEUDO_LOCALE_ACCENTED);
    expect(contracted.value.locale).toBe(PSEUDO_LOCALE_BIDI);
    expect(expanded.value.role).toBe('target');
    expect(expanded.value.messages['greeting']?.inputs).toEqual({});
    expect(expanded.value.messages['spacer']?.kind).toBe('empty');
    claimCapability('capability:pseudo-locale');
  });

  it('parses a registered message function instead of rejecting it', () => {
    // The transform re-parses each message to find its literal runs. Without the application's
    // own function names it rejects the message the source catalog accepted moments earlier, so
    // deriving a pseudo-locale would fail outright for any application registering an extension.
    const withExtension =
      'Custom function: {$name :feature:uppercase emphasis=loud}';

    const unregistered = pseudoLocalizeMessage(withExtension, {});
    expect(unregistered.ok).toBe(false);
    expect(unregistered.diagnostics.map(({ code }) => code)).toContain(
      'EQ1203',
    );

    const registered = pseudoLocalizeMessage(withExtension, {}, [
      {
        name: 'feature:uppercase',
        selects: false,
        operandType: 'string',
        resultType: 'string',
        options: ['emphasis'],
      },
    ]);
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.value).toContain(':feature:uppercase');
    expect(registered.value).toContain('{$name');
  });

  it('refuses a private-use tag, which is why the shipped tags use regions', () => {
    // Both external checks pass for this tag: it canonicalizes, and it maximizes to an Arab-script
    // locale that the direction lookup reads as rtl. Equator's own catalog-identity rule is the
    // only one that refuses it, so a reader comparing the tags against the platform will conclude
    // the prettier form works. It does not, and this is the check that says so.
    expect(Intl.getCanonicalLocales('en-Arab-x-pscontr')).toEqual([
      'en-Arab-x-pscontr',
    ]);
    expect(new Intl.Locale('en-Arab-x-pscontr').script).toBe('Arab');

    const refused = createPseudoCatalog(source, {
      locale: 'en-Arab-x-pscontr',
      lengthFactor: -0.35,
    });
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics.map(({ code }) => code)).toContain('EQ1003');

    // The control: the same call under the shipped tag succeeds, so the refusal above is the
    // private-use subtag and not something else about the source catalog or the settings.
    const accepted = createPseudoCatalog(source, {
      locale: PSEUDO_LOCALE_BIDI,
      lengthFactor: -0.35,
    });
    expect(accepted.ok).toBe(true);
    claimCapability('capability:pseudo-locale');
  });

  /**
   * The placeholder assertion that matters, made on the rendered message rather than the catalog
   * string. A catalog-level check passes for a transform that accents the inside of `{$name}`,
   * because the accented text still contains the substring being looked for.
   */
  it('leaves a placeholder resolvable after transformation', () => {
    const transformed = pseudoLocalizeMessage('Welcome, {$name}!', {
      lengthFactor: 0.5,
      markers: true,
    });
    expect(transformed.ok).toBe(true);
    if (!transformed.ok) return;
    expect(transformed.value).toContain('{$name}');
    expect(transformed.value).not.toContain('nåmé');
    expect(transformed.value).not.toContain('{$nåmé}');
  });
});

/**
 * A conformant XLIFF 2.2 document that Equator did not write.
 *
 * Round-tripping Equator's own export can never catch a conformance defect: whatever the exporter
 * writes, the importer is built to read. A check of that kind passes an importer that requires
 * Equator's own prefix spellings and exactly one `<file>`.
 *
 * The document below carries the same information and none of the same serialization decisions:
 *
 * - the core namespace is bound to a prefix rather than being the default, so every core element is
 *   written `x:file`, `x:unit`, `x:segment`;
 * - the metadata module is bound to `m:` instead of `mda:`, and declared on the unit that uses it
 *   rather than on the root, which is where a namespace may legally be declared;
 * - there are two `<file>` elements and Equator's is the second, because XLIFF 2.2 Core declares
 *   `<file>` with `maxOccurs="unbounded"` and a translation-management system holding several
 *   catalogs in one document is conformant;
 * - the placeholder is carried in an `equiv` attribute rather than in `<originalData>`, which is
 *   the other legal way to say what an inline code stands for and is not the way Equator writes it.
 *
 * The unit contract is lifted from a real export rather than invented, because its
 * `sourceFingerprint` is what ties a translation to the source revision it was made from, and a
 * hand-written one would either be wrong or would have to reimplement the fingerprint.
 */
function contractJson(exported: string): string {
  const match = /<mda:meta type="equator:contract">([^<]*)<\/mda:meta>/u.exec(
    exported,
  );
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1] as string;
}

function foreignDocument(
  contract: string,
  options: { readonly fileId: string; readonly extraFileId?: string },
): string {
  const otherFile =
    options.extraFileId === undefined
      ? []
      : [
          `  <x:file id="${options.extraFileId}" original="other/catalog.json">`,
          '    <x:unit id="unrelated">',
          '      <x:segment>',
          '        <x:source xml:space="preserve">Not Equator.</x:source>',
          '        <x:target xml:space="preserve">Laysa Equator.</x:target>',
          '      </x:segment>',
          '    </x:unit>',
          '  </x:file>',
        ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<x:xliff xmlns:x="urn:oasis:names:tc:xliff:document:2.2" version="2.2" srcLang="en-US" trgLang="ar-EG">',
    ...otherFile,
    `  <x:file id="${options.fileId}" original="i18n/shell/en-US.yaml">`,
    '    <x:unit id="greeting" name="greeting">',
    '      <m:metadata xmlns:m="urn:oasis:names:tc:xliff:metadata:2.0">',
    '        <m:metaGroup category="equator:unit">',
    `          <m:meta type="equator:contract">${contract}</m:meta>`,
    '        </m:metaGroup>',
    '      </m:metadata>',
    '      <x:segment state="translated">',
    '        <x:source xml:space="preserve">Hello <x:ph id="c0" equiv="{$name}"/>.</x:source>',
    '        <x:target xml:space="preserve">Ahlan <x:ph id="c0" equiv="{$name}"/>.</x:target>',
    '      </x:segment>',
    '    </x:unit>',
    '  </x:file>',
    '</x:xliff>',
    '',
  ].join('\n');
}

describe('Equator XLIFF import of a document Equator did not write', () => {
  const foreignSource = catalog(
    [
      'messages:',
      '  greeting:',
      '    message: "Hello {$name}."',
      '    inputs:',
      '      name: string',
      '',
    ].join('\n'),
    sourceOptions,
  );
  const foreignTarget = catalog(
    ['messages:', '  greeting: "Ahlan {$name}."', ''].join('\n'),
    targetOptions,
  );
  const reference = exportXliff22({
    source: foreignSource,
    target: foreignTarget,
  });

  it('declares the version-stamped core namespace that matches its version attribute', () => {
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    expect(reference.value).toContain(
      'xmlns="urn:oasis:names:tc:xliff:document:2.2"',
    );
    expect(reference.value).toContain('version="2.2"');
    // XLIFF 2.2's modules keep their :2.0 designations. Moving them with the core namespace is the
    // plausible over-correction, and it would make the metadata module unrecognised.
    expect(reference.value).toContain(
      'xmlns:mda="urn:oasis:names:tc:xliff:metadata:2.0"',
    );
    expect(reference.value).not.toContain(
      'urn:oasis:names:tc:xliff:document:2.0',
    );
  });

  it('imports one written with different prefixes and several files', () => {
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    const document = foreignDocument(contractJson(reference.value), {
      fileId: 'example:app:shell',
      extraFileId: 'example:other:catalog',
    });
    const imported = importXliff22({ document, source: foreignSource });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(writtenCatalog(imported.value)).toBe(writtenCatalog(foreignTarget));
    claimCapability('capability:xliff');
  });

  it('names the catalog it could not find when no file belongs to it', () => {
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    const document = foreignDocument(contractJson(reference.value), {
      fileId: 'example:other:catalog',
    });
    const imported = importXliff22({ document, source: foreignSource });
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.diagnostics[0]?.summary).toContain('@example/app:shell');
    claimCapability('capability:xliff');
  });

  it('refuses a document that carries the same catalog twice', () => {
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    const document = foreignDocument(contractJson(reference.value), {
      fileId: 'example:app:shell',
      extraFileId: 'example:app:shell',
    });
    const imported = importXliff22({ document, source: foreignSource });
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    // The first of the two files holds a unit with no contract, so reading it would fail too; the
    // refusal has to be the one that names the duplicate, or file order decided the outcome.
    expect(imported.diagnostics[0]?.summary).toContain(
      'contains 2 files for the Equator catalog "@example/app:shell"',
    );
    claimCapability('capability:xliff');
  });

  it('does not read Equator metadata out of a prefix bound to another namespace', () => {
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    // `mda:` spelled exactly as Equator writes it, bound to something else. Matching on the
    // authored prefix would accept this; matching on the namespace does not.
    const document = foreignDocument(contractJson(reference.value), {
      fileId: 'example:app:shell',
    }).replace(
      'xmlns:m="urn:oasis:names:tc:xliff:metadata:2.0"',
      'xmlns:m="urn:example:not-the-metadata-module"',
    );
    const imported = importXliff22({ document, source: foreignSource });
    // The unit has no readable Equator contract, so it is reported rather than absorbed. The
    // assertion is that `greeting` did not come back, whichever way the import resolves.
    const importedMessageIds = imported.ok
      ? Object.keys(imported.value.messages)
      : [];
    expect(importedMessageIds).not.toContain('greeting');
    expect(imported.diagnostics.length).toBeGreaterThan(0);
    claimCapability('capability:xliff');
  });
});

describe('an XLIFF translation carrying a directional control', () => {
  // Specification 09 section 7.1 refuses these in an authored catalog value, and a translation
  // arriving through XLIFF becomes one. A translator pasting from another tool cannot see them.
  const RLO = String.fromCodePoint(0x202e);
  const LRI = String.fromCodePoint(0x2066);
  const plainSource = catalog(
    'messages:\n  greeting:\n    message: "Hello"\n    description: "Greeting"\n',
    sourceOptions,
  );
  const plainTarget = catalog(
    'messages:\n  greeting:\n    message: "Ahlan"\n    description: "Tahiya"\n',
    targetOptions,
  );
  const exported = exportXliff22({ source: plainSource, target: plainTarget });
  const document = exported.ok ? exported.value : '';

  it('exports the fixture every case below edits', () => {
    expect(exported.ok).toBe(true);
    expect(document).toContain('>Ahlan</target>');
    expect(document).toContain('appliesTo="target">Tahiya</note>');
    expect(importXliff22({ document, source: plainSource }).ok).toBe(true);
  });

  it('is refused in the translation, with the code a catalog gets', () => {
    for (const text of [`Ah${RLO}lan`, `Ah${LRI}lan`]) {
      const imported = importXliff22({
        document: document.replace('>Ahlan</target>', `>${text}</target>`),
        source: plainSource,
      });
      expect(imported.ok).toBe(false);
      expect(imported.diagnostics.map(({ code }) => code)).toContain('EQ1103');
    }
  });

  it('is refused in the translator guidance the catalog stores', () => {
    const imported = importXliff22({
      document: document.replace(
        'appliesTo="target">Tahiya</note>',
        `appliesTo="target">Ta${RLO}hiya</note>`,
      ),
      source: plainSource,
    });
    expect(imported.ok).toBe(false);
    expect(imported.diagnostics.map(({ code }) => code)).toContain('EQ1103');
  });
});

describe('an XLIFF document that is not text', () => {
  // Specification 10 section 2: a document arrives from a build script, where no declared type
  // holds, so a value that is not text is a diagnostic naming its type and never the value.
  it('is refused with EQ1801 naming the type it was', () => {
    for (const [document, type] of [
      [42, 'number'],
      [Buffer.from('<xliff/>'), 'object'],
      [undefined, 'undefined'],
    ] as const) {
      const imported = importXliff22({
        document: document as unknown as string,
        source,
      });
      expect(imported.ok, type).toBe(false);
      expect(imported.diagnostics[0]?.code).toBe('EQ1801');
      expect(imported.diagnostics[0]?.summary).toContain(type);
      expect(imported.diagnostics[0]?.summary).not.toContain('xliff/');
    }
  });
});

describe('an XLIFF unit whose id is not an xs:NMTOKEN', () => {
  const plainSource = catalog(
    'messages:\n  greeting: "Hello"\n',
    sourceOptions,
  );
  const plainTarget = catalog(
    'messages:\n  greeting: "Ahlan"\n',
    targetOptions,
  );
  const exported = exportXliff22({ source: plainSource, target: plainTarget });
  const document = exported.ok ? exported.value : '';

  it('makes the document one Equator cannot import, and does not repeat the id', () => {
    expect(document).toContain('<unit id="greeting" name="greeting">');
    for (const id of ['../../greeting', 'greeting/..', 'a b']) {
      const imported = importXliff22({
        document: document.replace(
          '<unit id="greeting" name="greeting">',
          `<unit id="${id}" name="greeting">`,
        ),
        source: plainSource,
      });
      expect(imported.ok, id).toBe(false);
      expect(
        imported.diagnostics.map(({ code }) => code),
        id,
      ).toContain('EQ1802');
      for (const { summary } of imported.diagnostics) {
        expect(summary, id).not.toContain(id);
      }
    }
  });
});

/**
 * `specs/01-standards-profile.spec.md` section 10: XLIFF is never a source of message identity. The
 * source catalog decides which messages exist and what each is called, so a unit naming anything
 * else is reported rather than imported, whether the message is missing or the identity the unit
 * carries was rewritten while the message id stayed.
 */
describe('an XLIFF unit that does not belong to the source catalog', () => {
  const wider = catalog(
    `${writtenCatalog(source)}  farewell: "Goodbye."\n`,
    sourceOptions,
  );
  const widerTarget = catalog(
    `${writtenCatalog(target)}  farewell: "مع السلامة."\n`,
    targetOptions,
  );

  function refusals(result: ReturnType<typeof importXliff22>) {
    return result.diagnostics.filter(
      ({ code, severity }) => code === 'EQ1803' && severity === 'error',
    );
  }

  it('is reported when it names a message the source lacks', () => {
    const exported = exportXliff22({ source: wider, target: widerTarget });
    if (!exported.ok) throw new Error('export failed');
    const imported = importXliff22({ document: exported.value, source });
    expect(refusals(imported)).toHaveLength(1);
    if (imported.ok)
      expect(imported.value.messages['farewell']).toBeUndefined();
  });

  it('is reported when it carries another identity for a message the source has', () => {
    const exported = exportXliff22({ source, target });
    if (!exported.ok) throw new Error('export failed');
    const rewritten = exported.value.split('@example/app:shell:greeting');
    expect(rewritten).toHaveLength(2);
    const imported = importXliff22({
      document: rewritten.join('@example/other:shell:greeting'),
      source,
    });
    expect(refusals(imported)).toHaveLength(1);
    if (imported.ok)
      expect(imported.value.messages['greeting']).toBeUndefined();
  });
});

/**
 * `specs/01-standards-profile.spec.md` section 10: XLIFF processing never fetches a DTD or an
 * entity. A declaration is refused where it appears, by the rule written for it, and an entity
 * reference the XML predefined set does not name is refused rather than left for something
 * downstream to resolve. A document with a DOCTYPE is also refused by the element-name rule, so the
 * case asks for the summary that names the rule it is about.
 */
describe('an XLIFF document reaching for an external resource', () => {
  function exported(): string {
    const result = exportXliff22({ source, target });
    if (!result.ok) throw new Error('export failed');
    return result.value;
  }

  function summaries(document: string) {
    const imported = importXliff22({ document, source });
    return {
      ok: imported.ok,
      summaries: imported.diagnostics.map(({ summary }) => summary),
    };
  }

  it('is refused at a DOCTYPE declaring an external entity, by the DTD rule', () => {
    const document = exported().replace(
      '<xliff',
      '<!DOCTYPE xliff [<!ENTITY xxe SYSTEM "file:///secret">]><xliff',
    );
    const result = summaries(document);
    expect(result.ok).toBe(false);
    expect(result.summaries.join('\n')).toMatch(/DTDs, entities/u);
  });

  it('is refused at an entity reference the document never declared', () => {
    const document = exported().split('مرحبًا');
    expect(document).toHaveLength(2);
    expect(summaries(document.join('&xxe; مرحبًا')).ok).toBe(false);
  });

  it('imports the same document without the reference', () => {
    expect(summaries(exported()).ok).toBe(true);
  });
});
