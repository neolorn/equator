import { describe, expect, it } from 'vitest';

import { createLocalizationRuntime } from '../src/localization.js';
import type {
  GeneratedConfiguration,
  LocalizationSetup,
} from '@neolorn/equator/core';

/**
 * What a switcher option calls its locale comes from the build, not from the engine rendering it.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 7. The engines disagree about some locales'
 * own names, and the page is rendered on one engine and hydrated on another, so a name read from
 * `Intl.DisplayNames` can change under the visitor. The names below are ones no engine gives, so an
 * option carrying them can only have read the generated table.
 */

function runtimeFor(localeNames?: Readonly<Record<string, string>>) {
  const configuration: GeneratedConfiguration = {
    generatedAbi: 'equator-generated/1',
    sourceLocale: 'en-US',
    defaultLocale: 'en-US',
    locales: ['en-US', 'ar-EG'],
    aliases: {},
    ...(localeNames === undefined ? {} : { localeNames }),
    applicationContractFingerprint: 'sha256-application-contract-fixture',
    semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
    scopes: [
      {
        providerId: 'home',
        scopeId: 'shell',
        applicationContractFingerprint: 'sha256-application-contract-fixture',
        semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
        requiredExtensions: [],
      },
    ],
  };
  return createLocalizationRuntime({
    setup: {
      configuration,
      catalogSet: {
        profile: 'equator-catalog-set/1',
        generatedAbi: 'equator-generated/1',
        applicationContractFingerprint: 'sha256-application-contract-fixture',
        semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
        providers: [
          {
            providerId: 'home',
            catalogSetId: 'home',
            artifacts: [
              {
                address: {
                  key: {
                    providerId: 'home',
                    scopeId: 'shell',
                    catalogLocale: 'en-US',
                  },
                  compiledIrProfile: 'equator-compiled-ir/1',
                  schema: 'equator-compiled-catalog/1',
                  requiredFeatures: [],
                  standardsProfile: 'equator-1',
                  generatedAbi: 'equator-generated/1',
                  applicationContractFingerprint:
                    'sha256-application-contract-fixture',
                  semanticRegistryFingerprint:
                    'sha256-semantic-registry-fixture',
                  requiredExtensions: [],
                  contentDigest: `sha256-${'A'.repeat(43)}`,
                },
                modulePath: './home.shell.en-US.js',
                resources: {
                  profile: 'equator-resource-summary/1',
                  decodedBytes: 0,
                  messages: 0,
                  identifiers: 0,
                  literals: 0,
                  irNodes: 0,
                  depth: 0,
                  selectors: 0,
                  variants: 0,
                  inputs: 0,
                  slots: 0,
                  references: 0,
                  functions: 0,
                  outputParts: 0,
                  maximumMessage: {
                    irNodes: 0,
                    depth: 0,
                    selectors: 0,
                    variants: 0,
                    inputs: 0,
                    slots: 0,
                    outputParts: 0,
                  },
                },
              },
            ],
          },
        ],
      },
      // Never called: nothing here loads a catalog, and the names are read before any would be.
      catalogLoaders: { 'home:shell:en-US': () => Promise.resolve({}) },
    } as unknown as LocalizationSetup,
    bootstrapScopes: [{ providerId: 'home', scopeId: 'shell' }],
  });
}

const selfNames = (localeNames?: Readonly<Record<string, string>>) => {
  const localization = runtimeFor(localeNames);
  try {
    return Object.fromEntries(
      localization.state
        .localeChoices()
        .map(({ locale, selfName }) => [locale, selfName]),
    );
  } finally {
    localization.dispose();
  }
};

describe("a locale option's own name", () => {
  it('is the one the build generated, not the one the engine gives', () => {
    expect(
      selfNames({ 'en-US': 'English (build)', 'ar-EG': 'العربية (build)' }),
    ).toStrictEqual({
      'en-US': 'English (build)',
      'ar-EG': 'العربية (build)',
    });
  });

  it("is the engine's only for a locale the build has no name for", () => {
    const engine = new Intl.DisplayNames(['ar-EG'], { type: 'language' }).of(
      'ar-EG',
    );
    expect(selfNames({ 'en-US': 'English (build)' })).toStrictEqual({
      'en-US': 'English (build)',
      'ar-EG': engine,
    });
  });
});
