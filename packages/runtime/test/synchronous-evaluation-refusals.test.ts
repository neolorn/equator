/**
 * What a synchronous read is refused for, and what a strict policy refuses on top of that.
 *
 * `specs/06-runtime-and-angular.spec.md` section 2: a handle is evaluated against the committed
 * snapshot and never starts a load, so a read with no snapshot, or for a scope the snapshot does
 * not hold, is refused with a diagnostic that names what is missing, and a handle is read as what
 * it was generated as: plain through `text`, structured through `parts`, under the ABI this
 * runtime was built for. `specs/03-locale-identity-and-resolution.spec.md` section 9: the default
 * policy answers a message the target locale lacks from the source locale, and a strict policy
 * refuses exactly that answer and no other.
 */
import { describe, expect, it } from 'vitest';

import { GENERATED_ABI, type MessageHandle } from '@neolorn/equator/core';

import { decimal } from '../src/formatting.js';

import {
  PROVIDER,
  compileSet,
  diagnosticOf,
  type CompiledSet,
} from './catalog-store-harness.js';
import {
  HEADING,
  TITLE,
  runtime,
  type Runtime,
} from './transaction-runtime-harness.js';

const GREETING: MessageHandle & { readonly resultKind: 'plain' } =
  Object.freeze({
    generatedAbi: GENERATED_ABI,
    providerId: PROVIDER,
    scopeId: 'shell',
    messageId: 'greeting',
    identity: `${PROVIDER}:shell:greeting`,
    resultKind: 'plain' as const,
    inputNames: Object.freeze(['name']),
    slotNames: Object.freeze([]),
  });

// Compiled on first use, so that importing this file runs none of the library.
let untranslated: CompiledSet | undefined;
/** The fixture with the greeting left out of the Arabic shell catalog. */
const withUntranslatedGreeting = (): CompiledSet =>
  (untranslated ??= compileSet((scopeId, locale, text) =>
    scopeId === 'shell' && locale === 'ar-EG'
      ? text
          .split('\n')
          .filter((line) => !line.includes('greeting'))
          .join('\n')
      : text,
  ));

const EMPHASIS: MessageHandle & { readonly resultKind: 'structured' } =
  Object.freeze({
    generatedAbi: GENERATED_ABI,
    providerId: PROVIDER,
    scopeId: 'shell',
    messageId: 'emphasis',
    identity: `${PROVIDER}:shell:emphasis`,
    resultKind: 'structured' as const,
    inputNames: Object.freeze([]),
    slotNames: Object.freeze(['strong']),
  });

let structured: CompiledSet | undefined;
/** The fixture with one message that carries markup, in the source locale's shell catalog. */
const withStructuredMessage = (): CompiledSet =>
  (structured ??= compileSet((scopeId, locale, text) =>
    scopeId === 'shell' && locale === 'en-US'
      ? `${text}  emphasis: "Read {#strong}this{/strong} first"\n`
      : text,
  ));

async function ready(fixture: Parameters<typeof runtime>[0] = {}) {
  const made = runtime(fixture);
  await made.localization.initialize();
  return made;
}

/** The text of the greeting, with the marks that isolate its input left out. */
const greeting = (localization: Runtime): string =>
  localization
    .text(GREETING, { name: 'Ada' })
    .replace(/\p{Bidi_Control}/gu, '');

describe('a message read synchronously', () => {
  it('is refused as not ready before the first snapshot', () => {
    const { localization } = runtime();

    expect(diagnosticOf(() => localization.text(TITLE))).toMatchObject({
      code: 'scope-unavailable',
      outcome: 'operational-failure',
    });
    localization.dispose();
  });

  it('is refused as disposed once the context is disposed', async () => {
    const { localization } = await ready();
    localization.dispose();

    expect(diagnosticOf(() => localization.text(TITLE))).toMatchObject({
      code: 'disposed',
    });
  });

  it('is refused when its handle was generated under another ABI', async () => {
    const { localization } = await ready();
    const foreign = { ...TITLE, generatedAbi: 'equator-generated/0' };

    expect(localization.text(TITLE)).toBe('Catalog store');
    expect(
      diagnosticOf(() => localization.text(foreign as unknown as typeof TITLE)),
    ).toMatchObject({ code: 'invalid-configuration' });
    localization.dispose();
  });

  it('is refused, with its scope named, when the snapshot does not hold the scope', async () => {
    const { localization } = await ready();

    expect(diagnosticOf(() => localization.text(HEADING))).toMatchObject({
      code: 'scope-unavailable',
      providerId: PROVIDER,
      scopeId: 'lazy',
    });
    localization.dispose();
  });

  it('is refused through `text` when it is a structured message', async () => {
    const { localization } = await ready({ set: withStructuredMessage() });

    expect(
      diagnosticOf(() =>
        localization.text(EMPHASIS as unknown as typeof TITLE),
      ),
    ).toMatchObject({ code: 'invalid-rich-message' });
    localization.dispose();
  });

  it('is refused through `parts` when it is a plain message', async () => {
    const { localization } = await ready({ set: withStructuredMessage() });

    expect(
      diagnosticOf(() =>
        localization.parts(TITLE as unknown as typeof EMPHASIS),
      ),
    ).toMatchObject({ code: 'invalid-rich-message' });
    localization.dispose();
  });

  it('is answered as parts through `parts` when it is a structured message', async () => {
    const { localization } = await ready({ set: withStructuredMessage() });

    expect(localization.parts(EMPHASIS)).toMatchObject({
      kind: 'parts',
      text: 'Read this first',
    });
    localization.dispose();
  });
});

describe('a message the target locale has no translation of', () => {
  it('is answered from the source locale under the default policy', async () => {
    const { localization } = await ready({ set: withUntranslatedGreeting() });
    await localization.changeLocale('ar-EG');

    expect(localization.text(TITLE)).toBe('مخزن الفهارس');
    expect(greeting(localization)).toBe('Hello Ada');
    localization.dispose();
  });

  it('is refused under a strict policy, with both locales and the scope named', async () => {
    const { localization } = await ready({
      set: withUntranslatedGreeting(),
      setup: { fallbackPolicy: 'strict' },
    });
    await localization.changeLocale('ar-EG');

    const refused = diagnosticOf(() => greeting(localization));

    expect(refused).toMatchObject({
      code: 'message-unavailable',
      outcome: 'localized-representation-unavailable',
      targetLocale: 'ar-EG',
      supplyingLocale: 'en-US',
      providerId: PROVIDER,
      scopeId: 'shell',
    });
    expect(Object.isFrozen(refused)).toBe(true);
    localization.dispose();
  });

  it('leaves a translated message of the same catalog readable under a strict policy', async () => {
    const { localization } = await ready({
      set: withUntranslatedGreeting(),
      setup: { fallbackPolicy: 'strict' },
    });
    await localization.changeLocale('ar-EG');

    expect(localization.text(TITLE)).toBe('مخزن الفهارس');
    localization.dispose();
  });

  it('is not what a strict policy sees in the source locale itself', async () => {
    const { localization } = await ready({
      set: withUntranslatedGreeting(),
      setup: { fallbackPolicy: 'strict' },
    });

    expect(greeting(localization)).toBe('Hello Ada');
    localization.dispose();
  });
});

describe('a value formatted synchronously', () => {
  it('is refused as not ready before the first snapshot', () => {
    const { localization } = runtime();

    expect(
      diagnosticOf(() => localization.formatNumber(decimal('1'))),
    ).toMatchObject({
      code: 'scope-unavailable',
    });
    localization.dispose();
  });

  it('is refused as disposed once the context is disposed', async () => {
    const { localization } = await ready();
    localization.dispose();

    expect(
      diagnosticOf(() => localization.formatNumber(decimal('1'))),
    ).toMatchObject({
      code: 'disposed',
    });
  });
});
