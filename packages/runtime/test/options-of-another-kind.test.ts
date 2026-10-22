import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import { refuseOptionsOfAnotherKind } from '../router/src/navigation-scopes.js';
import {
  createLocalizationContext,
  createLocalizationRuntime,
} from '../src/localization.js';
import { createLocalizationEventEmitter } from '../src/observability.js';
import {
  LocalizationError,
  createDefaultLocalePrefixPolicy,
  createHostLocalePolicy,
  createIdentifierParameterCodec,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  localizedServerRoutes,
  validateRouteProjection,
  ɵfunctionOption,
  ɵnamedOption,
  ɵtextOption,
  type GeneratedConfiguration,
  type LocalizationSetup,
} from '@neolorn/equator/core';

import { compileSet, loadersFor, scope } from './catalog-store-harness.js';

/**
 * An option given a value of another kind than its declaration names.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md`: an option declared as an object or as
 * a list is held to that kind where the configuration is given, and anything else is a
 * configuration fault. An application that is not type-checked can pass any value, and the cases
 * here pass each kind an option does not take to every constructor a unit test can call: the four
 * policy constructors, the identifier codec, the request handler with the policy, the projection
 * and the generated configuration it reads, the server routes, the options of the Router
 * integration, and the localization context.
 *
 * An option declared as a function, as text, or as one of a set of named values, is held the same
 * way. The features and the testing helpers that take one are built inside an Angular application,
 * so the cases here call the checks they call, and the sink of a context, which a unit test can
 * hand over.
 */

/** Every kind of value that is not an object, with the words a refusal names it in. */
const NOT_AN_OBJECT: readonly (readonly [string, unknown, string])[] = [
  ['null', null, 'null'],
  ['text', 'text', 'a string'],
  ['a number', 7, 'a number'],
  ['a boolean', true, 'a boolean'],
  ['a list', ['x'], 'a list'],
  ['an empty list', [], 'a list'],
  ['a function', () => undefined, 'a function'],
];

/** Every kind of value that is not a list, with the words a refusal names it in. */
const NOT_A_LIST: readonly (readonly [string, unknown, string])[] = [
  ['null', null, 'null'],
  ['text', 'text', 'a string'],
  ['a number', 7, 'a number'],
  ['a boolean', true, 'a boolean'],
  ['an object', { a: 1 }, 'an object'],
  ['an empty object', {}, 'an object'],
  ['a function', () => undefined, 'a function'],
];

/** Every kind of value that is not a function, with the words a refusal names it in. */
const NOT_A_FUNCTION: readonly (readonly [string, unknown, string])[] = [
  ['null', null, 'null'],
  ['text', 'text', 'a string'],
  ['a number', 7, 'a number'],
  ['a boolean', true, 'a boolean'],
  ['a list', ['x'], 'a list'],
  ['an object', { call: () => undefined }, 'an object'],
];

/** Every kind of value that is none of the names an option declares. */
const NOT_A_NAME: readonly (readonly [string, unknown])[] = [
  ['nothing', undefined],
  ['null', null],
  ['other text', 'cookie'],
  ['a name in another case', 'URL'],
  ['a number', 7],
  ['a list of one name', ['url']],
  ['an object', { url: true }],
  ['a function', () => 'url'],
];

/** The diagnostic a call refuses with, or `undefined` when it did not refuse. */
const refusal = (call: () => unknown) => {
  try {
    call();
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic;
    throw error;
  }
};

const LOCALES = { 'en-US': 'en-us', 'ar-EG': 'ar-eg' } as const;
const ORIGINS = {
  'en-US': 'https://en.example',
  'ar-EG': 'https://ar.example',
} as const;

const prefixed = (options: object) =>
  createPathPrefixLocalePolicy({
    defaultLocale: 'en-US',
    locales: LOCALES,
    ...options,
  } as never);
const defaulted = (options: object) =>
  createDefaultLocalePrefixPolicy({
    defaultLocale: 'en-US',
    locales: LOCALES,
    ...options,
  } as never);
const neutral = (options: object) =>
  createLocaleNeutralPolicy({
    defaultLocale: 'en-US',
    locales: ['en-US', 'ar-EG'],
    ...options,
  } as never);
const hosted = (options: object) =>
  createHostLocalePolicy({
    defaultLocale: 'en-US',
    origins: ORIGINS,
    ...options,
  } as never);

const GENERATED = {
  profile: 'equator-route-projection/1',
  identity: 'sha256-OptionsOfAnotherKindTestIdentity01234567890',
  routes: [
    { id: 'home', path: '', parameterNames: [] },
    { id: 'item', path: 'item/:id', parameterNames: ['id'] },
  ],
} as const;
const PROJECTION = {
  generated: GENERATED,
  parameters: { item: { id: createIdentifierParameterCodec() } },
  localizedPaths: { item: { 'ar-EG': 'ar-item/:id' } },
  historical: { retired: { kind: 'gone' } },
} as const;
const CONFIGURATION = {
  locales: ['en-US', 'ar-EG'],
} as unknown as GeneratedConfiguration;
const CACHE = { successMaxAge: 600, permanentRedirectMaxAge: 86_400 } as const;

const projected = (options: object) =>
  validateRouteProjection({ ...PROJECTION, ...options } as never);
const handling = (options: object) =>
  createLocaleRequestHandler({
    policy: prefixed({}),
    projection: PROJECTION,
    cache: CACHE,
    cookie: false,
    ...options,
  } as never);
const serverRoutes = (declarations: unknown, options?: unknown) =>
  localizedServerRoutes(
    prefixed({}),
    PROJECTION as never,
    CONFIGURATION,
    declarations as never,
    options as never,
  );

/** A localization context from options the harness makes valid, with some replaced. */
const context = (options: (valid: Record<string, unknown>) => unknown) => {
  const set = compileSet();
  return createLocalizationRuntime(
    options({
      setup: {
        configuration: set.configuration,
        catalogSet: set.descriptor,
        catalogLoaders: loadersFor(set),
      } as unknown as LocalizationSetup,
      bootstrapScopes: [scope('shell')],
    }) as never,
  );
};

const SHELL = scope('shell');

/** Each option declared as an object, with the call that hands it a value. */
const OBJECTS: readonly (readonly [string, (value: unknown) => unknown])[] = [
  [
    'createPathPrefixLocalePolicy(options)',
    (v) => createPathPrefixLocalePolicy(v as never),
  ],
  ['createPathPrefixLocalePolicy locales', (v) => prefixed({ locales: v })],
  ['createPathPrefixLocalePolicy aliases', (v) => prefixed({ aliases: v })],
  [
    'createDefaultLocalePrefixPolicy(options)',
    (v) => createDefaultLocalePrefixPolicy(v as never),
  ],
  ['createDefaultLocalePrefixPolicy locales', (v) => defaulted({ locales: v })],
  ['createDefaultLocalePrefixPolicy aliases', (v) => defaulted({ aliases: v })],
  [
    'createLocaleNeutralPolicy(options)',
    (v) => createLocaleNeutralPolicy(v as never),
  ],
  [
    'createHostLocalePolicy(options)',
    (v) => createHostLocalePolicy(v as never),
  ],
  ['createHostLocalePolicy origins', (v) => hosted({ origins: v })],
  [
    'createIdentifierParameterCodec(pattern)',
    (v) => createIdentifierParameterCodec(v as never),
  ],
  [
    'createLocaleRequestHandler(options)',
    (v) => createLocaleRequestHandler(v as never),
  ],
  ['createLocaleRequestHandler policy', (v) => handling({ policy: v })],
  ['createLocaleRequestHandler projection', (v) => handling({ projection: v })],
  ['createLocaleRequestHandler cache', (v) => handling({ cache: v })],
  ['createLocaleRequestHandler cookie', (v) => handling({ cookie: v })],
  [
    'createLocaleRequestHandler configuration',
    (v) => handling({ configuration: v }),
  ],
  [
    'a written-out path-prefix policy, locales',
    (v) => handling({ policy: { ...prefixed({}), locales: v } }),
  ],
  [
    'a written-out path-prefix policy, prefixes',
    (v) => handling({ policy: { ...prefixed({}), prefixes: v } }),
  ],
  [
    'a written-out path-prefix policy, aliases',
    (v) => handling({ policy: { ...prefixed({}), aliases: v } }),
  ],
  [
    'a written-out host policy, locales',
    (v) => handling({ policy: { ...hosted({}), locales: v } }),
  ],
  [
    'a written-out host policy, origins',
    (v) => handling({ policy: { ...hosted({}), origins: v } }),
  ],
  [
    'a written-out locale-neutral policy, locales',
    (v) => handling({ policy: { ...neutral({}), locales: v } }),
  ],
  ['a projection', (v) => validateRouteProjection(v as never)],
  ['a projection, generated', (v) => projected({ generated: v })],
  [
    'a projection, a generated route',
    (v) => projected({ generated: { ...GENERATED, routes: [v] } }),
  ],
  ['a projection, parameters', (v) => projected({ parameters: v })],
  [
    'a projection, the parameters of a route',
    (v) => projected({ parameters: { item: v } }),
  ],
  [
    'a projection, a codec',
    (v) => projected({ parameters: { item: { id: v } } }),
  ],
  ['a projection, localizedPaths', (v) => projected({ localizedPaths: v })],
  [
    'a projection, the localized paths of a route',
    (v) => projected({ localizedPaths: { item: v } }),
  ],
  ['a projection, historical', (v) => projected({ historical: v })],
  [
    'a projection, a historical outcome',
    (v) => projected({ historical: { retired: v } }),
  ],
  ['localizedServerRoutes options', (v) => serverRoutes([], v)],
  ['the Router integration, options', (v) => refuseOptionsOfAnotherKind(v)],
  [
    'the Router integration, a scope',
    (v) => refuseOptionsOfAnotherKind({ requiredScopes: [v] }),
  ],
  [
    'the Router integration, documentMetadata',
    (v) => refuseOptionsOfAnotherKind({ documentMetadata: v }),
  ],
  [
    'the Router integration, the document metadata of a route',
    (v) => refuseOptionsOfAnotherKind({ documentMetadata: { home: v } }),
  ],
  [
    'the Router integration, outcomeDocuments',
    (v) => refuseOptionsOfAnotherKind({ outcomeDocuments: v }),
  ],
  ['a localization context, options', (v) => context(() => v)],
  [
    'a localization context, setup',
    (v) => context((valid) => ({ ...valid, setup: v })),
  ],
];

/** Each option declared as a list, with the call that hands it a value. */
const LISTS: readonly (readonly [string, (value: unknown) => unknown])[] = [
  [
    'createPathPrefixLocalePolicy localeNeutralRoots',
    (v) => prefixed({ localeNeutralRoots: v }),
  ],
  [
    'createDefaultLocalePrefixPolicy localeNeutralRoots',
    (v) => defaulted({ localeNeutralRoots: v }),
  ],
  ['createLocaleNeutralPolicy locales', (v) => neutral({ locales: v })],
  [
    'createLocaleNeutralPolicy localeNeutralRoots',
    (v) => neutral({ localeNeutralRoots: v }),
  ],
  [
    'createHostLocalePolicy localeNeutralRoots',
    (v) => hosted({ localeNeutralRoots: v }),
  ],
  [
    'a written-out path-prefix policy, localeNeutralRoots',
    (v) => handling({ policy: { ...prefixed({}), localeNeutralRoots: v } }),
  ],
  [
    'a written-out host policy, localeNeutralRoots',
    (v) => handling({ policy: { ...hosted({}), localeNeutralRoots: v } }),
  ],
  [
    'a written-out locale-neutral policy, localeNeutralRoots',
    (v) => handling({ policy: { ...neutral({}), localeNeutralRoots: v } }),
  ],
  [
    'a generated configuration, locales',
    (v) => handling({ configuration: { locales: v } }),
  ],
  [
    'a projection, the generated routes',
    (v) => projected({ generated: { ...GENERATED, routes: v } }),
  ],
  [
    'a projection, the parameter names of a generated route',
    (v) =>
      projected({
        generated: {
          ...GENERATED,
          routes: [{ id: 'home', path: '', parameterNames: v }],
        },
      }),
  ],
  ['localizedServerRoutes declarations', (v) => serverRoutes(v)],
  [
    'the Router integration, the scopes of a route',
    (v) => refuseOptionsOfAnotherKind({ progressiveScopes: { home: v } }),
  ],
  [
    'a localization context, bootstrapScopes',
    (v) => context((valid) => ({ ...valid, bootstrapScopes: v })),
  ],
];

/**
 * The name each option is refused under.
 *
 * A refusal is read by whoever wrote the configuration, far from the call that checked it, so the
 * name is what tells them which of several options to look at. The whole message is asserted for
 * that reason: a check that named another option, or none, would refuse the same values.
 */
const NAMED: Readonly<Record<string, string>> = {
  'createPathPrefixLocalePolicy(options)':
    'The options of a path-prefix policy',
  'createPathPrefixLocalePolicy locales': 'locales',
  'createPathPrefixLocalePolicy aliases': 'aliases',
  'createDefaultLocalePrefixPolicy(options)':
    'The options of a default-locale-prefix policy',
  'createDefaultLocalePrefixPolicy locales': 'locales',
  'createDefaultLocalePrefixPolicy aliases': 'aliases',
  'createLocaleNeutralPolicy(options)':
    'The options of a locale-neutral policy',
  'createHostLocalePolicy(options)': 'The options of a host policy',
  'createHostLocalePolicy origins': 'origins',
  'createLocaleRequestHandler(options)':
    'The options of createLocaleRequestHandler',
  'createLocaleRequestHandler policy': 'A locale URL policy',
  'createLocaleRequestHandler projection': 'A route projection',
  'createLocaleRequestHandler cache': 'cache',
  'createLocaleRequestHandler cookie': 'cookie',
  'createLocaleRequestHandler configuration': 'The generated configuration',
  'a projection': 'A route projection',
  'a projection, generated': 'The generated half of a route projection',
  'a projection, a generated route': 'A route of a generated route projection',
  'a projection, parameters': 'The parameters of a route projection',
  'a projection, the parameters of a route': 'The parameters of route item',
  'a projection, a codec': 'The codec of item/id',
  'a projection, localizedPaths': 'The localized paths of a route projection',
  'a projection, the localized paths of a route':
    'The localized paths of route item',
  'a projection, historical': 'The historical outcomes of a route projection',
  'a projection, a historical outcome': 'The historical outcome of "retired"',
  'localizedServerRoutes options': 'The options of the localized server routes',
  'the Router integration, options':
    'The options of the localized Router integration',
  'the Router integration, a scope': 'A scope in requiredScopes',
  'the Router integration, documentMetadata': 'documentMetadata',
  'the Router integration, the document metadata of a route':
    'documentMetadata of home',
  'the Router integration, outcomeDocuments': 'outcomeDocuments',
  'a localization context, options': 'The options of a localization context',
  'a localization context, setup': 'The setup of a localization context',
  'createPathPrefixLocalePolicy localeNeutralRoots': 'localeNeutralRoots',
  'createDefaultLocalePrefixPolicy localeNeutralRoots': 'localeNeutralRoots',
  'createLocaleNeutralPolicy locales': 'locales',
  'createLocaleNeutralPolicy localeNeutralRoots': 'localeNeutralRoots',
  'createHostLocalePolicy localeNeutralRoots': 'localeNeutralRoots',
  'a generated configuration, locales':
    'The locales of the generated configuration',
  'a projection, the generated routes':
    'The routes of a generated route projection',
  'a projection, the parameter names of a generated route':
    'The parameter names of a generated route',
  'localizedServerRoutes declarations':
    'The declarations of the localized server routes',
  'the Router integration, the scopes of a route':
    'progressiveScopes of route home',
  'a localization context, bootstrapScopes': 'bootstrapScopes',
};

/** What a policy written out by hand is refused with, which names the table and not its kind. */
const WRITTEN_OUT = (said: string): string =>
  `This ${said}, which no policy constructor writes. Build the policy with its constructor, which checks each table against the others.`;
const UNLISTED: Readonly<Record<string, (value: unknown) => string>> = {
  'createIdentifierParameterCodec(pattern)': () =>
    'A route parameter pattern must be a regular expression.',
  'a written-out path-prefix policy, locales': () =>
    WRITTEN_OUT('path-prefix locale URL policy names no locales'),
  'a written-out path-prefix policy, prefixes': () =>
    WRITTEN_OUT(
      'path-prefix locale URL policy spells en-US as "en-us", which is not a path segment its prefix table reads back as that locale',
    ),
  'a written-out path-prefix policy, aliases': () =>
    WRITTEN_OUT('path-prefix locale URL policy carries no alias table'),
  'a written-out host policy, locales': () =>
    WRITTEN_OUT('locale-host locale URL policy names no locales'),
  'a written-out host policy, origins': () =>
    WRITTEN_OUT(
      'locale-host locale URL policy serves en-US at "https://en.example", which is not a normalized origin its origin table reads back as that locale',
    ),
  'a written-out locale-neutral policy, locales': () =>
    WRITTEN_OUT('locale-neutral locale URL policy names no locales'),
  'a written-out path-prefix policy, localeNeutralRoots': (value) =>
    WRITTEN_OUT(
      `path-prefix locale URL policy lists ${JSON.stringify(value)} as its locale-neutral roots, which are not distinct path segments`,
    ),
  'a written-out host policy, localeNeutralRoots': (value) =>
    WRITTEN_OUT(
      `locale-host locale URL policy lists ${JSON.stringify(value)} as its locale-neutral roots, which are not distinct path segments`,
    ),
  'a written-out locale-neutral policy, localeNeutralRoots': (value) =>
    WRITTEN_OUT(
      `locale-neutral locale URL policy lists ${JSON.stringify(value)} as its locale-neutral roots, which are not distinct path segments`,
    ),
};

/** The whole diagnostic an option is refused with when it is given a value of another kind. */
const refusedWith = (
  option: string,
  declared: 'an object' | 'a list',
  value: unknown,
  kind: string,
) => {
  const name = NAMED[option];
  if (name !== undefined) {
    return {
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: `${name} must be ${declared}, and ${kind} was given.`,
      reason: 'malformed-input',
    };
  }
  const unlisted = UNLISTED[option];
  if (unlisted === undefined)
    throw new Error(`No refusal is written down for ${option}.`);
  return {
    code: 'invalid-configuration',
    outcome: 'operational-failure',
    message: unlisted(value),
    ...(option.startsWith('a written-out')
      ? {}
      : { reason: 'malformed-input' }),
  };
};

describe('an option declared as an object', () => {
  for (const [option, call] of OBJECTS) {
    it.each(NOT_AN_OBJECT)(
      `${option} is refused when it is %s`,
      (_, value, kind) => {
        expect(refusal(() => call(value))).toStrictEqual(
          refusedWith(option, 'an object', value, kind),
        );
      },
    );
  }
});

describe('an option declared as a list', () => {
  for (const [option, call] of LISTS) {
    it.each(NOT_A_LIST)(
      `${option} is refused when it is %s`,
      (_, value, kind) => {
        expect(refusal(() => call(value))).toStrictEqual(
          refusedWith(option, 'a list', value, kind),
        );
      },
    );
  }
});

describe('a locale that is not text', () => {
  it.each<readonly [string, unknown]>([
    ['a number', 7],
    ['null', null],
    ['a list of one tag', ['en-US']],
    ['an object', { tag: 'en-US' }],
  ])('is refused in a list of locales when it is %s', (_, locale) => {
    expect(
      refusal(() => neutral({ locales: ['en-US', locale] })),
    ).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: 'A route locale that is not text is invalid.',
      reason: 'malformed-input',
    });
  });
});

describe('a scope option of the Router integration', () => {
  it.each([
    [null, 'null'],
    ['text', 'a string'],
    [7, 'a number'],
    [true, 'a boolean'],
    [() => undefined, 'a function'],
  ])('is refused when it is neither a list nor a table: %j', (value, kind) => {
    for (const name of ['requiredScopes', 'progressiveScopes']) {
      expect(
        refusal(() => refuseOptionsOfAnotherKind({ [name]: value })),
      ).toStrictEqual({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: `${name} must be an object, and ${kind} was given.`,
        reason: 'malformed-input',
      });
    }
  });
});

describe('the codec of a route parameter', () => {
  const read = () => ({ ok: true, value: 'x' });
  const write = () => 'x';

  it.each<readonly [string, unknown]>([
    ['an object with neither function', {}],
    ['an object with parse alone', { parse: read }],
    ['an object with serialize alone', { serialize: write }],
    ['an object whose parse is text', { parse: 'parse', serialize: write }],
    ['an object whose serialize is text', { parse: read, serialize: 'write' }],
  ])('is refused when it is %s', (_, codec) => {
    expect(
      refusal(() => projected({ parameters: { item: { id: codec } } })),
    ).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message:
        'The codec of item/id must carry a parse and a serialize function.',
      reason: 'malformed-input',
    });
  });

  it('is taken when it carries both', () => {
    expect(
      refusal(() =>
        projected({
          parameters: { item: { id: { parse: read, serialize: write } } },
        }),
      ),
    ).toBeUndefined();
  });
});

describe('an option declared as a function', () => {
  it.each(NOT_A_FUNCTION)('is refused when it is %s', (_, value, kind) => {
    expect(refusal(() => ɵfunctionOption(value, 'The option'))).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: `The option must be a function, and ${kind} was given.`,
      reason: 'malformed-input',
    });
  });

  it('is refused when it is left out, named as undefined with no article', () => {
    expect(
      refusal(() => ɵfunctionOption(undefined, 'The option')),
    ).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: 'The option must be a function, and undefined was given.',
      reason: 'malformed-input',
    });
  });

  it('is taken as given when it is one', () => {
    const given = (): number => 1;
    expect(ɵfunctionOption(given, 'The option')).toBe(given);
  });
});

describe('an option declared as text', () => {
  it.each([
    ['null', null, 'null'],
    ['a number', 7, 'a number'],
    ['a boolean', true, 'a boolean'],
    ['a list of text', ['text'], 'a list'],
    ['an object', { toString: () => 'text' }, 'an object'],
    ['a function', () => 'text', 'a function'],
  ])('is refused when it is %s', (_, value, kind) => {
    expect(refusal(() => ɵtextOption(value, 'The option'))).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: `The option must be text, and ${kind} was given.`,
      reason: 'malformed-input',
    });
  });

  it('is refused when it is left out, named as undefined with no article', () => {
    expect(refusal(() => ɵtextOption(undefined, 'The option'))).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: 'The option must be text, and undefined was given.',
      reason: 'malformed-input',
    });
  });

  it('is taken as given when it is text, empty text included', () => {
    expect(ɵtextOption('shell', 'The option')).toBe('shell');
    expect(ɵtextOption('', 'The option')).toBe('');
  });
});

describe('an option declared as one of a set of named values', () => {
  it.each(NOT_A_NAME)('is refused when it is %s', (_, value) => {
    expect(
      refusal(() => ɵnamedOption(value, ['url', 'stored'], 'The option')),
    ).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      reason: 'malformed-input',
    });
  });

  it('names the values it takes and never the one it was given', () => {
    expect(
      refusal(() => ɵnamedOption('cookie', ['url', 'stored'], 'The option'))
        ?.message,
    ).toBe('The option must be one of url, stored, and other text was given.');
  });

  it.each<readonly [string, unknown, string]>([
    ['left out', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a symbol', Symbol.iterator, 'a symbol'],
    ['a big integer', 7n, 'a bigint'],
  ])('names a value that is %s as it reads in a sentence', (_, value, kind) => {
    expect(
      refusal(() => ɵnamedOption(value, ['url', 'stored'], 'The option'))
        ?.message,
    ).toBe(`The option must be one of url, stored, and ${kind} was given.`);
  });

  it('names the kind of a value that is not text', () => {
    expect(
      refusal(() => ɵnamedOption(7, ['url', 'stored'], 'The option'))?.message,
    ).toBe('The option must be one of url, stored, and a number was given.');
  });

  it('is taken as given when it is one of them', () => {
    expect(ɵnamedOption('stored', ['url', 'stored'], 'The option')).toBe(
      'stored',
    );
  });
});

describe('the caching floor of the request handler', () => {
  // Section 3 of the routing specification holds an option declared as one of a set of named
  // values to them where the configuration is given, so a floor nobody declared stops the handler
  // from being made, and no request is answered under it.
  it.each<readonly [string, unknown, string]>([
    ['null', null, 'null'],
    ['a class that does not exist', 'shared', 'other text'],
    ['a class in another case', 'Per-Visitor', 'other text'],
    ['a number', 7, 'a number'],
    ['a list of one class', ['per-visitor'], 'a list'],
    ['an object', { class: 'per-visitor' }, 'an object'],
  ])('is refused where the handler is made when it is %s', (_, floor, kind) => {
    expect(
      refusal(() => handling({ cache: { ...CACHE, pageCaching: floor } })),
    ).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: `pageCaching must be one of per-visitor, not-stored, and ${kind} was given.`,
      reason: 'malformed-input',
    });
  });

  it.each([undefined, 'per-visitor', 'not-stored'])(
    'is taken when it is %j',
    (floor) => {
      expect(
        handling({
          cache: floor === undefined ? CACHE : { ...CACHE, pageCaching: floor },
        }),
      ).toBeTypeOf('function');
      expect(handling({ cache: { ...CACHE, pageCaching: floor } })).toBeTypeOf(
        'function',
      );
    },
  );
});

describe('an observability sink', () => {
  const SINKS: readonly (readonly [string, unknown])[] = [
    ...NOT_AN_OBJECT.map(([label, value]) => [label, value] as const),
    ['an object with no emit', {}],
    ['an object whose emit is text', { emit: 'text' }],
  ];

  it.each(SINKS)('is refused by the emitter when it is %s', (_, value) => {
    expect(
      refusal(() => createLocalizationEventEmitter(value as never)),
    ).toMatchObject({ code: 'invalid-configuration' });
  });

  it.each(SINKS)('is refused by a context when it is %s', (_, value) => {
    const set = compileSet();
    expect(
      refusal(() =>
        createLocalizationContext({
          setup: {
            configuration: set.configuration,
            catalogSet: set.descriptor,
            catalogLoaders: loadersFor(set),
          } as unknown as LocalizationSetup,
          observability: value as never,
        }),
      ),
    ).toMatchObject({ code: 'invalid-configuration' });
  });

  it('is taken when it is an object that emits', () => {
    expect(
      refusal(() => createLocalizationEventEmitter({ emit: () => undefined })),
    ).toBeUndefined();
  });
});

// A refusal is read far from the call that caused it, so it names the option and the call.
describe('the refusal of a localization context', () => {
  const setup = () => {
    const set = compileSet();
    return {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loadersFor(set),
    } as unknown as LocalizationSetup;
  };

  it('names the options and the setup of createLocalizationContext()', () => {
    expect(
      refusal(() => createLocalizationContext(null as never))?.message,
    ).toBe(
      'The options of createLocalizationContext() must be an object, and null was given.',
    );
    expect(
      refusal(() => createLocalizationContext({ setup: 7 } as never))?.message,
    ).toBe(
      'The setup of createLocalizationContext() must be an object, and a number was given.',
    );
  });

  it('names the options, the setup and the scope list of a context built from them', () => {
    expect(
      refusal(() => createLocalizationRuntime(null as never))?.message,
    ).toBe(
      'The options of a localization context must be an object, and null was given.',
    );
    expect(
      refusal(() => context((valid) => ({ ...valid, setup: 7 })))?.message,
    ).toBe(
      'The setup of a localization context must be an object, and a number was given.',
    );
    expect(
      refusal(() =>
        context((valid) => ({ ...valid, bootstrapScopes: [SHELL, SHELL] })),
      )?.message,
    ).toBe('bootstrapScopes contains a duplicate generated scope.');
  });

  it('names the sink and its emit function', () => {
    expect(
      refusal(() => createLocalizationEventEmitter(null as never))?.message,
    ).toBe('The observability sink must be an object, and null was given.');
    expect(
      refusal(() => createLocalizationEventEmitter({ emit: 'text' } as never))
        ?.message,
    ).toBe(
      'emit of The observability sink must be a function, and a string was given.',
    );
    expect(
      refusal(() =>
        createLocalizationContext({
          setup: setup(),
          observability: 7 as never,
        }),
      )?.message,
    ).toBe('The observability sink must be an object, and a number was given.');
  });
});

describe('options of the kind their declaration names', () => {
  it('are taken by each constructor', () => {
    expect(
      prefixed({ aliases: { en: 'en-US' }, localeNeutralRoots: ['api'] }),
    ).toMatchObject({ aliases: { en: 'en-US' }, localeNeutralRoots: ['api'] });
    expect(defaulted({}).omitDefaultPrefix).toBe(true);
    expect(
      neutral({ localeNeutralRoots: ['api'] }).localeNeutralRoots,
    ).toStrictEqual(['api']);
    expect(
      hosted({ localeNeutralRoots: ['api'] }).localeNeutralRoots,
    ).toStrictEqual(['api']);
    expect(
      createIdentifierParameterCodec(/^[a-z]+$/u).parse('abc'),
    ).toStrictEqual({ ok: true, value: 'abc' });
    expect(projected({})).toBeDefined();
    expect(handling({ cookie: {}, configuration: CONFIGURATION })).toBeTypeOf(
      'function',
    );
    expect(serverRoutes([], {})).toBeDefined();
    expect(context((valid) => valid)).toBeDefined();
  });

  it('are taken by the Router integration', () => {
    for (const options of [
      {},
      { requiredScopes: [SHELL], progressiveScopes: { home: [SHELL] } },
      { documentMetadata: { home: {} }, outcomeDocuments: {} },
    ]) {
      expect(
        refusal(() => refuseOptionsOfAnotherKind(options)),
      ).toBeUndefined();
    }
  });
});
