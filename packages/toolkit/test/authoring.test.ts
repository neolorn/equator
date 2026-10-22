import { describe, expect, it } from 'vitest';

import {
  parseCatalog,
  parseConfiguration,
  type CatalogParseOptions,
} from '../src/index.js';
import { formatConfiguration } from '../src/configuration.js';
import { writtenCatalog } from './fixtures.js';

const sourceCatalogOptions: CatalogParseOptions = {
  role: 'source',
  providerId: '@neolorn/example',
  scopeId: 'account',
  locale: 'en-US',
  sourcePath: 'i18n/account/en-US.yaml',
};

const targetCatalogOptions: CatalogParseOptions = {
  ...sourceCatalogOptions,
  role: 'target',
  locale: 'ar-EG',
  sourcePath: 'i18n/account/ar-EG.yaml',
};

function expectFailureCode(
  result:
    ReturnType<typeof parseConfiguration> | ReturnType<typeof parseCatalog>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  expect(
    result.diagnostics.some((diagnostic) => diagnostic.code === code),
  ).toBe(true);
}

describe('Equator project configuration', () => {
  it('canonicalizes locale declarations and builds a prototype-safe alias table', () => {
    const result = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'EN-us',
        defaultLocale: 'ar-eg',
        locales: ['EN-us', 'ar-eg'],
        aliases: {
          arabic: 'ar-eg',
          constructor: 'EN-us',
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceLocale).toBe('en-US');
    expect(result.value.defaultLocale).toBe('ar-EG');
    expect(result.value.locales).toEqual(['en-US', 'ar-EG']);
    expect(Object.getPrototypeOf(result.value.aliases)).toBeNull();
    expect(result.value.aliases['constructor']).toBe('en-US');
    expect(Object.isFrozen(result.value.aliases)).toBe(true);
  });

  it('accepts name locales the application is not translated into', () => {
    // The whole point of the key: `ja` and `ko` are not in `locales` and must not have to be.
    // An application translated into English and Arabic still renders names people wrote in
    // Japanese, and nothing in its sources says so.
    const result = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
        personNameLocales: ['JA', 'ko-kr'],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.personNameLocales).toEqual(['ja', 'ko-KR']);
    expect(Object.isFrozen(result.value.personNameLocales)).toBe(true);
  });

  it('defaults name locales to none when the key is absent', () => {
    const result = parseConfiguration(
      '{"locales":["en"],"defaultLocale":"en","sourceLocale":"en","schemaVersion":1}',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.personNameLocales).toEqual([]);
  });

  it('reports a malformed or repeated name locale against its own position', () => {
    const malformed = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'en',
        defaultLocale: 'en',
        locales: ['en'],
        personNameLocales: ['ja', 'not a locale'],
      }),
    );
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(
      malformed.diagnostics.some(
        ({ code, path }) =>
          code === 'EQ1003' && path[0] === 'personNameLocales' && path[1] === 1,
      ),
    ).toBe(true);

    const repeated = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'en',
        defaultLocale: 'en',
        locales: ['en'],
        personNameLocales: ['ja', 'JA'],
      }),
    );
    expect(repeated.ok).toBe(false);
    if (repeated.ok) return;
    expect(
      repeated.diagnostics.some(
        ({ code, path }) =>
          code === 'EQ1004' && path[0] === 'personNameLocales',
      ),
    ).toBe(true);
  });

  it('writes name locales back in the declaration and omits them when there are none', () => {
    const declared = parseConfiguration(
      '{"schemaVersion":1,"sourceLocale":"en","defaultLocale":"en","locales":["en"],"personNameLocales":["ja"]}',
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    expect(formatConfiguration(declared.value)).toBe(
      [
        '{',
        '  "schemaVersion": 1,',
        '  "sourceLocale": "en",',
        '  "defaultLocale": "en",',
        '  "locales": [',
        '    "en"',
        '  ],',
        '  "personNameLocales": [',
        '    "ja"',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('formats the minimal declaration deterministically and omits empty aliases', () => {
    const result = parseConfiguration(
      '{"locales":["en"],"defaultLocale":"en","sourceLocale":"en","schemaVersion":1}',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatConfiguration(result.value)).toBe(
      [
        '{',
        '  "schemaVersion": 1,',
        '  "sourceLocale": "en",',
        '  "defaultLocale": "en",',
        '  "locales": [',
        '    "en"',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it.each([
    ['comments', '{"schemaVersion":1,// no\n"sourceLocale":"en"}'],
    ['trailing commas', '{"schemaVersion":1,}'],
    ['empty input', ''],
  ])('rejects JSON extensions: %s', (_label, source) => {
    expectFailureCode(parseConfiguration(source), 'EQ1001');
  });

  it('detects duplicate keys before configuration construction', () => {
    const result = parseConfiguration(
      '{"schemaVersion":1,"schemaVersion":1,"sourceLocale":"en","defaultLocale":"en","locales":["en"]}',
      { sourcePath: 'equator.config.json' },
    );

    expectFailureCode(result, 'EQ1001');
    expect(result.diagnostics[0]?.path).toEqual(['schemaVersion']);
    expect(result.diagnostics[0]?.span?.sourcePath).toBe('equator.config.json');
    expect(result.diagnostics[0]?.span?.start.line).toBe(0);
  });

  it('rejects unknown configuration fields through a closed schema', () => {
    const result = parseConfiguration(
      '{"schemaVersion":1,"sourceLocale":"en","defaultLocale":"en","locales":["en"],"remoteCatalog":"https://example.test"}',
    );
    expectFailureCode(result, 'EQ1002');
  });

  it('rejects the withdrawn `profile` declaration', () => {
    // `profile` was a second version marker beside `schemaVersion` that told Equator nothing it did
    // not already know, and the standards bundle it named is a property of the Equator release
    // rather than of the consumer's project: it is recorded on compiled artifacts, where
    // compatibility checking actually reads it.
    //
    // The closed schema is what makes the withdrawal a real one. Without this, re-adding the key
    // to `schemas.ts` would pass every other test in the suite, because nothing else in the
    // codebase would notice a field that is merely accepted and ignored.
    const result = parseConfiguration(
      '{"schemaVersion":1,"profile":"equator-1","sourceLocale":"en","defaultLocale":"en","locales":["en"]}',
    );
    expectFailureCode(result, 'EQ1002');
  });

  it('rejects duplicate canonical locales and undeclared source/default locales', () => {
    const duplicate = parseConfiguration(
      '{"schemaVersion":1,"sourceLocale":"en-US","defaultLocale":"en-US","locales":["en-US","EN-us"]}',
    );
    expectFailureCode(duplicate, 'EQ1004');

    const undeclared = parseConfiguration(
      '{"schemaVersion":1,"sourceLocale":"en","defaultLocale":"ar","locales":["en"]}',
    );
    expectFailureCode(undeclared, 'EQ1004');
  });

  it('rejects malformed, shadowing, and unsupported aliases', () => {
    const malformed = parseConfiguration(
      '{"schemaVersion":1,"sourceLocale":"en","defaultLocale":"en","locales":["en"],"aliases":{"bad_alias":"en"}}',
    );
    expectFailureCode(malformed, 'EQ1005');

    const shadowing = parseConfiguration(
      '{"schemaVersion":1,"sourceLocale":"en-US","defaultLocale":"en-US","locales":["en-US"],"aliases":{"en-us":"en-US"}}',
    );
    expectFailureCode(shadowing, 'EQ1006');

    const unsupported = parseConfiguration(
      '{"schemaVersion":1,"sourceLocale":"en","defaultLocale":"en","locales":["en"],"aliases":{"arabic":"ar"}}',
    );
    expectFailureCode(unsupported, 'EQ1006');
  });
});

describe('Equator canonical catalogs', () => {
  it('normalizes source shorthand, structured messages, inputs, slots, and empty output', () => {
    const result = parseCatalog(
      [
        'messages:',
        '  account.title: "Account"',
        '  account.greeting:',
        '    message: "Hello {$name}"',
        '    description: "Greets the signed-in person"',
        '    inputs:',
        '      name: string',
        '    slots:',
        '      strong: strong',
        '  account.separator:',
        '    empty: true',
        '',
      ].join('\n'),
      sourceCatalogOptions,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerId).toBe('@neolorn/example');
    expect(result.value.scopeId).toBe('account');
    expect(result.value.messages['account.title']?.kind).toBe('message');
    expect(result.value.messages['account.greeting']?.inputs['name']).toEqual({
      type: 'string',
      optional: false,
      nullable: false,
    });
    expect(result.value.messages['account.greeting']?.slots['strong']).toEqual({
      kind: 'strong',
      optional: false,
      repeatable: false,
    });
    expect(result.value.messages['account.separator']?.kind).toBe('empty');
    expect(Object.getPrototypeOf(result.value.messages)).toBeNull();
  });

  it('preserves a valid message named constructor in a prototype-safe map', () => {
    const result = parseCatalog(
      'messages:\n  constructor: "Safe"\n',
      sourceCatalogOptions,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value.messages)).toBeNull();
    expect(result.value.messages['constructor']).toMatchObject({
      kind: 'message',
      message: 'Safe',
    });
  });

  it('formats catalogs deterministically and round-trips the normalized value', () => {
    const source = [
      'messages:',
      '  z.last: "Last"',
      '  a.first:',
      '    message: "First {$value}"',
      '    inputs:',
      '      value:',
      '        nullable: true',
      '        type: string',
      '',
    ].join('\n');
    const parsed = parseCatalog(source, sourceCatalogOptions);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const formatted = writtenCatalog(parsed.value);
    expect(formatted.indexOf('a.first')).toBeLessThan(
      formatted.indexOf('z.last'),
    );
    const reparsed = parseCatalog(formatted, sourceCatalogOptions);
    expect(reparsed).toEqual(parsed);
    expect(writtenCatalog(reparsed.ok ? reparsed.value : parsed.value)).toBe(
      formatted,
    );
  });

  it('allows target wording and metadata but rejects target-owned input and slot contracts', () => {
    const accepted = parseCatalog(
      'messages:\n  account.title:\n    message: "الحساب"\n    context: "Page heading"\n',
      targetCatalogOptions,
    );
    expect(accepted.ok).toBe(true);

    const inputs = parseCatalog(
      'messages:\n  account.greeting:\n    message: "مرحبًا {$name}"\n    inputs:\n      name: string\n',
      targetCatalogOptions,
    );
    expectFailureCode(inputs, 'EQ1105');

    const slots = parseCatalog(
      'messages:\n  account.greeting:\n    message: "مرحبًا"\n    slots:\n      strong: strong\n',
      targetCatalogOptions,
    );
    expectFailureCode(slots, 'EQ1105');
  });

  it.each([
    ['directives', '%YAML 1.2\n---\nmessages:\n  title: "Hi"\n'],
    ['anchors and aliases', 'messages:\n  title: &copy "Hi"\n  other: *copy\n'],
    ['custom tags', 'messages:\n  title: !unsafe "Hi"\n'],
    ['merge keys', 'messages:\n  <<: { title: "Hi" }\n'],
    ['complex keys', 'messages:\n  ? [a, b]\n  : "Hi"\n'],
    [
      'multiple documents',
      'messages:\n  title: "Hi"\n---\nmessages:\n  title: "Hi"\n',
    ],
    ['non-finite numbers', 'messages:\n  title: !!float .inf\n'],
  ])('rejects unsafe YAML structure: %s', (_label, source) => {
    expectFailureCode(parseCatalog(source, sourceCatalogOptions), 'EQ1101');
  });

  it('detects duplicate YAML keys before construction', () => {
    const result = parseCatalog(
      'messages:\n  title: "First"\n  title: "Second"\n',
      sourceCatalogOptions,
    );
    expectFailureCode(result, 'EQ1103');
    expect(result.diagnostics[0]?.path).toEqual(['messages', 'title']);
    expect(result.diagnostics[0]?.span?.start.line).toBe(2);
  });

  it('rejects unknown root features and malformed message identities through closed contracts', () => {
    const deferredFeature = parseCatalog(
      'messages:\n  title: "Hi"\nfuture-feature:\n  status: "status.{value}"\n',
      sourceCatalogOptions,
    );
    expectFailureCode(deferredFeature, 'EQ1102');

    const identity = parseCatalog(
      'messages:\n  Not.Valid: "Hi"\n',
      sourceCatalogOptions,
    );
    expectFailureCode(identity, 'EQ1102');
  });

  it('rejects malformed provider, scope, and locale context independently of content', () => {
    expectFailureCode(
      parseCatalog('messages:\n  title: "Hi"\n', {
        ...sourceCatalogOptions,
        providerId: 'Bad Provider',
      }),
      'EQ1104',
    );
    expectFailureCode(
      parseCatalog('messages:\n  title: "Hi"\n', {
        ...sourceCatalogOptions,
        scopeId: 'BadScope',
      }),
      'EQ1104',
    );
    expectFailureCode(
      parseCatalog('messages:\n  title: "Hi"\n', {
        ...sourceCatalogOptions,
        locale: 'en_US',
      }),
      'EQ1003',
    );
  });
});
