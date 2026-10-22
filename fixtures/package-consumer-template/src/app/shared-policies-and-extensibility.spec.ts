import { describe, expect, it } from 'vitest';

import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  buildLocalizedRoute,
  createLocalizationContext,
  createDefaultLocalePrefixPolicy,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  dynamicAssetParticipantReport,
  fixedLanguageAsset,
  injectLocalization,
  localizedAsset,
  neutralAsset,
  projectRouteSeo,
  resolveLocalizedAsset,
  resolveLocalizedRoute,
  withExtensions,
  withFormattingContext,
  type DynamicAssetParticipantReportInput,
  type RouteRuntimeProjection,
} from '@neolorn/equator';
import {
  provideLocalizationTesting,
  renderedText,
} from '@neolorn/equator/testing';
import {
  createMigrationPlan,
  PSEUDO_LOCALE_ACCENTED,
  createPseudoCatalog,
  diffCatalogSets,
  exportXliff22,
  formatCatalog,
  importXliff22,
  parseCatalog,
  parseConfiguration,
  planMessageRefactor,
  type Catalog,
  type CatalogParseOptions,
} from '@neolorn/equator-toolkit';
import { configuration, localizationSetup } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { families, messages, providerId, scopeId } from '#i18n/shell';

import {
  runtimeExtensions,
  skuFormatAdapter,
  skuParseAdapter,
} from './runtime-extensions';
import { appRouteProjection } from './localization.routes';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

const localizedProjection: RouteRuntimeProjection = Object.freeze({
  ...appRouteProjection,
  localizedPaths: Object.freeze({
    'route:second': Object.freeze({
      'ar-EG': 'الثاني',
    }),
    article: Object.freeze({
      'ar-EG': 'مقالات/:slug',
    }),
  }),
});

describe('shared URL policies', () => {
  const locales = Object.freeze({
    'en-US': 'en-us',
    'ar-EG': 'ar-eg',
  });

  it('omits only the default-locale prefix and canonicalizes its old prefixed form', () => {
    const policy = createDefaultLocalePrefixPolicy({
      defaultLocale: 'en-US',
      locales,
    });
    expect(
      resolveLocalizedRoute('/second', policy, localizedProjection),
    ).toMatchObject({
      status: 'success',
      locale: 'en-US',
      canonicalPath: '/second',
    });
    expect(
      resolveLocalizedRoute('/en-us/second', policy, localizedProjection),
    ).toMatchObject({
      status: 'redirect',
      httpStatus: 308,
      location: '/second',
    });
    expect(
      buildLocalizedRoute(policy, localizedProjection, 'route:second', 'ar-EG'),
    ).toBe('/ar-eg/%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A');
    claimCapability('policy:default-locale-prefix', { policy });
    claimCapability('entry:@neolorn/equator', { policy });
  });

  it('uses locale-neutral presentation paths with explicit locale context and truthful SEO', () => {
    const policy = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
      xDefaultPath: '/',
    });
    const arabicPath = buildLocalizedRoute(
      policy,
      localizedProjection,
      'route:second',
      'ar-EG',
    );
    const resolution = resolveLocalizedRoute(
      arabicPath,
      policy,
      localizedProjection,
      { locale: 'ar-EG' },
    );
    expect(resolution).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      routeId: 'route:second',
    });
    if (resolution.status !== 'success') return;
    const seo = projectRouteSeo(
      resolution,
      policy,
      localizedProjection,
      configuration,
      'https://site.example',
    );
    expect(seo.alternates).toHaveLength(2);
    expect(seo.xDefault).toBe('https://site.example/');
    claimCapability('policy:locale-neutral', { policy });
    claimCapability('declaration:x-default', { policy });
    claimCapability('entry:@neolorn/equator', { policy });
  });

  it('maps locale-specific trusted origins without accepting request-controlled hosts', () => {
    const policy = createHostLocalePolicy({
      defaultLocale: 'en-US',
      origins: {
        'en-US': 'https://www.site.example',
        'ar-EG': 'https://ar.site.example',
      },
      xDefaultUrl: 'https://site.example',
    });
    const arabicUrl = buildLocalizedRoute(
      policy,
      localizedProjection,
      'article',
      'ar-EG',
      { slug: 'handbook' },
    );
    expect(arabicUrl).toBe(
      'https://ar.site.example/%D9%85%D9%82%D8%A7%D9%84%D8%A7%D8%AA/%D8%AF%D9%84%D9%8A%D9%84',
    );
    const resolution = resolveLocalizedRoute(
      arabicUrl,
      policy,
      localizedProjection,
    );
    expect(resolution).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      canonicalUrl: arabicUrl,
    });
    expect(
      resolveLocalizedRoute(
        'https://attacker.invalid/second',
        policy,
        localizedProjection,
      ),
    ).toMatchObject({ status: 'malformed', httpStatus: 400 });
    if (resolution.status !== 'success') return;
    const seo = projectRouteSeo(
      resolution,
      policy,
      localizedProjection,
      configuration,
      'https://ar.site.example',
    );
    expect(seo.alternates.map(({ url }) => url)).toEqual([
      'https://www.site.example/articles/handbook',
      arabicUrl,
    ]);
    expect(seo.xDefault).toBe('https://site.example/');
    claimCapability('policy:locale-host', { policy });
    claimCapability('declaration:x-default', { policy });
    claimCapability('entry:@neolorn/equator', { policy });
  });
});

/**
 * A line for each kind of extension, each reached the way a page reaches it: through the
 * localization the application's providers made, so what the page shows is whatever bindings those
 * providers installed.
 */
@Component({
  selector: 'extension-lines',
  template: `
    <p data-extension="message-function">{{ called() }}</p>
    <p data-extension="identifier-segment">{{ member() }}</p>
    <p data-extension="rich-slot-kind">{{ badge() }}</p>
    <p data-extension="formatting-adapter">{{ formatted() }}</p>
    <p data-extension="parsing-adapter">{{ parsed() }}</p>
  `,
})
class ExtensionLines {
  private readonly localization = injectLocalization();

  protected called(): string {
    return this.localization.text(messages.extension.uppercase, {
      name: 'Equator',
    });
  }

  protected member(): string {
    const ready = families.featureState.resolve({ state: 'ready' });
    return ready === undefined ? 'absent' : this.localization.text(ready);
  }

  protected badge(): string {
    return this.localization.parts(messages.extension.badge).text;
  }

  protected formatted(): string {
    const result = this.localization.formatWithAdapter(
      skuFormatAdapter,
      'item-42',
    );
    return result.ok ? result.value.text : result.diagnostic.code;
  }

  protected parsed(): string {
    return JSON.stringify(
      this.localization.parseWithAdapter(skuParseAdapter, 'sku-item-42'),
    );
  }
}

describe('application-local extensibility', () => {
  it('admits exact bindings and evaluates custom functions, slots, families, and adapters', async () => {
    const localization = createLocalizationContext({
      setup: {
        configuration,
        catalogSet,
        catalogLoaders,
        extensions: runtimeExtensions,
      },
      bootstrapScopes: [{ providerId, scopeId }],
      formattingContext: { timeZone: 'UTC' },
    });
    await localization.initialize();

    expect(
      localization.text(messages.extension.uppercase, { name: 'Equator' }),
    ).toBe('Custom function: EQUATOR!');
    const badge = localization.parts(messages.extension.badge);
    expect(badge.text).toBe('Badge: New');
    expect(badge.value[0]).toMatchObject({
      kind: 'slot',
      slotKind: 'feature:badge',
      options: { tone: 'info' },
    });

    const ready = families.featureState.resolve({ state: 'ready' });
    if (ready === undefined)
      throw new Error('Generated family member is absent.');
    expect(localization.text(ready)).toBe('Feature state ready');
    expect(families.featureState.resolve({ state: 'future' })).toBeUndefined();
    expect(families.featureState.resolve({ state: 'READY' })).toBeUndefined();

    expect(
      localization.formatWithAdapter(skuFormatAdapter, 'item-42'),
    ).toMatchObject({
      ok: true,
      value: {
        semantic: 'extension',
        extensionId: 'feature:sku-format',
        text: 'SKU-ITEM-42',
      },
    });
    expect(
      localization.parseWithAdapter(skuParseAdapter, 'sku-item-42'),
    ).toEqual({
      status: 'valid',
      text: 'sku-item-42',
      value: { value: 'ITEM-42' },
    });
    localization.dispose();
    claimCapability('entry:@neolorn/equator');
  });

  it('fails runtime admission before evaluation when required bindings are absent', () => {
    expect(() =>
      createLocalizationContext({
        setup: {
          configuration,
          catalogSet,
          catalogLoaders,
        },
        bootstrapScopes: [{ providerId, scopeId }],
        formattingContext: { timeZone: 'UTC' },
      }),
    ).toThrow(/Required runtime extension/u);
    claimCapability('entry:@neolorn/equator');
  });

  it('renders what each binding withExtensions installed answers', async () => {
    // The generated setup carries no bindings, and admission refuses it without them, as the case
    // above shows, so every line below was answered by what the feature delivered.
    expect(localizationSetup).not.toHaveProperty('extensions');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ExtensionLines],
      providers: [
        provideLocalizationTesting(
          localizationSetup,
          withExtensions(runtimeExtensions),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    }).compileComponents();
    await TestBed.inject(Localization).initialize();
    const fixture = TestBed.createComponent(ExtensionLines);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const line = (kind: string): string =>
      renderedText(
        element.querySelector(`[data-extension="${kind}"]`) as Element,
      );

    // Each expectation is the application's own rule for its binding, in `runtime-extensions.ts`,
    // applied to the en-US catalog.
    expect(line('message-function')).toBe('Custom function: EQUATOR!');
    expect(line('identifier-segment')).toBe('Feature state ready');
    expect(line('rich-slot-kind')).toBe('Badge: New');
    expect(line('formatting-adapter')).toBe('SKU-ITEM-42');
    expect(JSON.parse(line('parsing-adapter'))).toEqual({
      status: 'valid',
      text: 'sku-item-42',
      value: { value: 'ITEM-42' },
    });
    const platform = TestBed.inject(PLATFORM_ID) as string;
    claimCapability('feature:withExtensions', { platform });
    claimCapability('extension:message-function', { platform });
    claimCapability('extension:identifier-segment', { platform });
    claimCapability('extension:rich-slot-kind', { platform });
    claimCapability('extension:formatting-adapter', { platform });
    claimCapability('extension:parsing-adapter', { platform });
    claimCapability('entry:@neolorn/equator', { platform });
  });
});

describe('localized assets', () => {
  it('keeps neutral, localized, and authentic fixed-language representations explicit', async () => {
    const localization = createLocalizationContext({
      setup: {
        configuration,
        catalogSet,
        catalogLoaders,
        extensions: runtimeExtensions,
      },
      bootstrapScopes: [{ providerId, scopeId }],
      formattingContext: { timeZone: 'UTC' },
    });
    await localization.initialize();
    await localization.changeLocale('ar-EG');
    const arabicAlt = localization.evaluateText(messages.asset.alt);

    const neutral = resolveLocalizedAsset(
      neutralAsset('asset.logo', { url: '/assets/logo.svg' }),
      { targetLocale: 'ar-EG', metadata: { alt: arabicAlt } },
    );
    expect(neutral).toMatchObject({
      status: 'ready',
      fallback: false,
      representation: {
        kind: 'language-independent',
        source: { url: '/assets/logo.svg' },
      },
      metadata: { alt: { supplyingLocale: 'ar-EG' } },
    });

    const cover = localizedAsset('asset.cover', [
      { locale: 'en-US', source: { url: '/assets/cover-en.webp' } },
      { locale: 'ar-EG', source: { url: '/assets/cover-ar.webp' } },
    ]);
    expect(
      resolveLocalizedAsset(cover, { targetLocale: 'ar-EG' }),
    ).toMatchObject({
      status: 'ready',
      fallback: false,
      representation: {
        kind: 'locale-bound',
        supplyingLocale: 'ar-EG',
        language: 'ar',
        direction: 'rtl',
      },
    });
    expect(
      resolveLocalizedAsset(cover, {
        targetLocale: 'fr-FR',
        fallbackLocales: ['en-US'],
      }),
    ).toMatchObject({
      status: 'ready',
      fallback: true,
      representation: { supplyingLocale: 'en-US' },
    });
    expect(
      resolveLocalizedAsset(cover, { targetLocale: 'fr-FR' }),
    ).toMatchObject({
      status: 'unavailable',
      outcome: 'localized-representation-unavailable',
    });

    const certificate = resolveLocalizedAsset(
      fixedLanguageAsset(
        'asset.certificate',
        { url: '/assets/certificate-en.pdf' },
        'en',
        'ltr',
      ),
      { targetLocale: 'ar-EG', metadata: { description: arabicAlt } },
    );
    expect(certificate).toMatchObject({
      status: 'ready',
      fallback: false,
      representation: { kind: 'fixed-language', language: 'en' },
      metadata: { description: { supplyingLocale: 'ar-EG' } },
    });
    localization.dispose();
    claimCapability('entry:@neolorn/equator');
  });

  it('exposes only safe dynamic participant metadata, never payload or URL state', () => {
    const input = {
      status: 'ready',
      assetId: 'asset.dynamic-cover',
      representationId: 'cover-ar',
      revision: 'r7',
      representation: {
        kind: 'locale-bound',
        supplyingLocale: 'ar-EG',
      },
      url: 'https://private.invalid/asset',
      payload: { secret: true },
    } satisfies DynamicAssetParticipantReportInput & {
      readonly url: string;
      readonly payload: unknown;
    };
    const report = dynamicAssetParticipantReport(input);
    expect(report).toMatchObject({
      status: 'ready',
      identity: {
        resourceId: 'asset.dynamic-cover',
        representationId: 'cover-ar',
        revision: 'r7',
      },
      representation: {
        kind: 'locale-bound',
        supplyingLocale: 'ar-EG',
        direction: 'rtl',
      },
    });
    expect(report).not.toHaveProperty('url');
    expect(report).not.toHaveProperty('payload');
    expect(JSON.stringify(report)).not.toContain('private.invalid');
    claimCapability('entry:@neolorn/equator');
  });
});

const configurationResult = parseConfiguration(
  JSON.stringify({
    schemaVersion: 1,
    sourceLocale: 'en-US',
    defaultLocale: 'en-US',
    locales: ['en-US', 'ar-EG'],
  }),
);
if (!configurationResult.ok)
  throw new Error('The fixture configuration is invalid.');
const phase5Configuration = configurationResult.value;

function phase5Catalog(source: string, options: CatalogParseOptions): Catalog {
  const parsed = parseCatalog(source, options);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

const sourceOptions: CatalogParseOptions = {
  role: 'source',
  providerId: '@feature/phase-five',
  scopeId: 'shell',
  locale: 'en-US',
  sourcePath: 'i18n/shell/en-US.yaml',
};
const targetOptions: CatalogParseOptions = {
  ...sourceOptions,
  role: 'target',
  locale: 'ar-EG',
  sourcePath: 'i18n/shell/ar-EG.yaml',
};

describe('built-toolkit lifecycle', () => {
  it('round-trips XLIFF 2.2 and pseudo-localizes only human-language text', () => {
    const source = phase5Catalog(
      'messages:\n  greeting: "Hello {#strong}{$name}{/strong}."\n',
      sourceOptions,
    );
    const target = phase5Catalog(
      'messages:\n  greeting: "مرحبًا {#strong}{$name}{/strong}."\n',
      targetOptions,
    );
    const exported = exportXliff22({ source, target });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value).toContain('version="2.2"');
    const imported = importXliff22({
      document: exported.value,
      source,
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(formatCatalog(imported.value)).toEqual(formatCatalog(target));

    const pseudo = createPseudoCatalog(source, {
      locale: PSEUDO_LOCALE_ACCENTED,
      lengthFactor: 0.35,
      markers: true,
    });
    expect(pseudo.ok).toBe(true);
    if (!pseudo.ok) return;
    expect(
      (pseudo.value.messages['greeting'] as { message?: string }).message,
    ).toContain('{$name}');
    expect(
      (pseudo.value.messages['greeting'] as { message?: string }).message,
    ).toContain('⟦');
    claimCapability('capability:xliff');
    claimCapability('capability:pseudo-locale');
    claimCapability('entry:@neolorn/equator-toolkit');
  });

  it('classifies semantic changes and previews checked refactor/migration transactions', () => {
    const beforeSource = phase5Catalog(
      'messages:\n  title: "Hello"\n  keep: "Keep"\n',
      sourceOptions,
    );
    const beforeTarget = phase5Catalog(
      'messages:\n  title: "مرحبًا"\n  keep: "أبقِ"\n',
      targetOptions,
    );
    const afterSource = phase5Catalog(
      'messages:\n  heading: "Welcome"\n  keep: "Changed"\n',
      sourceOptions,
    );
    const afterTarget = phase5Catalog(
      'messages:\n  heading: "مرحبًا"\n  keep: "أبقِ"\n',
      targetOptions,
    );
    const diff = diffCatalogSets({
      before: {
        configuration: phase5Configuration,
        catalogs: [beforeSource, beforeTarget],
      },
      after: {
        configuration: phase5Configuration,
        catalogs: [afterSource, afterTarget],
      },
      identityMoves: [
        {
          from: '@feature/phase-five:shell:title',
          to: '@feature/phase-five:shell:heading',
        },
      ],
    });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.value.entries.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        'identity-contract-changed',
        'source-changed',
        'stale-source',
      ]),
    );

    const code = 'const title = messages.title;\n';
    const refactor = planMessageRefactor({
      from: {
        providerId: '@feature/phase-five',
        scopeId: 'shell',
        messageId: 'title',
      },
      to: {
        providerId: '@feature/phase-five',
        scopeId: 'shell',
        messageId: 'heading',
      },
      catalogs: [beforeSource, beforeTarget],
      analysis: {
        messageUsages: [
          {
            identity: '@feature/phase-five:shell:title',
            sourcePath: 'src/probe.ts',
            start: code.indexOf('messages'),
            end: code.indexOf('messages') + 'messages.title'.length,
            surface: 'typescript',
          },
        ],
      },
      sources: [{ path: 'src/probe.ts', contents: code }],
    });
    expect(refactor.ok).toBe(true);
    if (!refactor.ok) return;
    expect(refactor.value.affectedUsages).toBe(1);
    expect(
      refactor.value.changes.find(({ path }) => path === 'src/probe.ts')?.after,
    ).toBe('const title = messages.heading;\n');

    const migration = createMigrationPlan({
      id: 'phase-five-profile',
      domain: 'configuration',
      fromVersion: '1',
      toVersion: '1.1',
      changes: [
        {
          path: 'equator.config.json',
          before: '{"schemaVersion":1}\n',
          after: '{"schemaVersion":1,"profile":"equator-1"}\n',
        },
      ],
    });
    expect(migration.ok).toBe(true);
    if (!migration.ok) return;
    expect(migration.value).toMatchObject({
      kind: 'migration',
      id: 'configuration/1-to-1.1/phase-five-profile',
    });
    expect(migration.value.digest).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/u);
    claimCapability('entry:@neolorn/equator-toolkit');
  });
});
