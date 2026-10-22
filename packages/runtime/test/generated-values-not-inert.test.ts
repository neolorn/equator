/**
 * A generated configuration or catalog set that is not inert data.
 *
 * Both are copied into plain data before anything reads them, and the copy refuses a function, an
 * accessor, a cycle and a value that is no record at all. That refusal is a configuration failure
 * like every other fault in what a runtime is constructed from, with the copy's own error as its
 * cause.
 */
import { describe, expect, it } from 'vitest';

import { LocalCatalogStore } from '../src/catalog-runtime.js';
import { createLocalizationRuntime } from '../src/localization.js';
import {
  LocalizationError,
  type LocalizationSetup,
} from '@neolorn/equator/core';

import {
  compileSet,
  loadersFor,
  type CompiledSet,
} from './catalog-store-harness.js';

let fixture: CompiledSet | undefined;
const compiled = (): CompiledSet => (fixture ??= compileSet());

const cyclic = (): Record<string, unknown> => {
  const value: Record<string, unknown> = {};
  value['self'] = value;
  return value;
};

const NOT_INERT: readonly (readonly [string, (value: object) => unknown])[] = [
  ['a function among its members', (value) => ({ ...value, extra: () => 1 })],
  [
    'an accessor among its members',
    (value) =>
      Object.defineProperty({ ...value }, 'extra', {
        enumerable: true,
        get: () => 1,
      }),
  ],
  ['a cycle', (value) => ({ ...value, extra: cyclic() })],
  ['an instance of a class', (value) => ({ ...value, extra: new Date(0) })],
  ['nothing at all', () => undefined],
];

/** The error a call throws, or `undefined` where it returned. */
const thrownBy = (call: () => unknown): unknown => {
  try {
    call();
    return undefined;
  } catch (error) {
    return error;
  }
};

const expectConfigurationFailure = (error: unknown): void => {
  expect(error).toBeInstanceOf(LocalizationError);
  expect((error as LocalizationError).diagnostic.code).toBe(
    'invalid-configuration',
  );
};

describe.each(NOT_INERT)('a generated value with %s', (_, spoil) => {
  const runtimeWith = (setup: Readonly<Record<string, unknown>>) =>
    thrownBy(() =>
      createLocalizationRuntime({
        setup: {
          configuration: compiled().configuration,
          catalogSet: compiled().descriptor,
          catalogLoaders: loadersFor(compiled()),
          ...setup,
        } as unknown as LocalizationSetup,
        bootstrapScopes: [],
      }),
    );

  it('is refused as the configuration of a runtime', () => {
    expectConfigurationFailure(
      runtimeWith({ configuration: spoil(compiled().configuration) }),
    );
  });

  it('is refused as the catalog set of a runtime', () => {
    expectConfigurationFailure(
      runtimeWith({ catalogSet: spoil(compiled().descriptor) }),
    );
  });

  it('is refused as the configuration and as the set of a catalog store', () => {
    const set = compiled();
    const refused = thrownBy(
      () =>
        new LocalCatalogStore(
          spoil(set.configuration) as never,
          set.descriptor,
          loadersFor(set),
        ),
    );
    expectConfigurationFailure(refused);
    // The copy's own refusal travels with it, for whoever has to find the member.
    expect((refused as LocalizationError).cause).toBeInstanceOf(TypeError);
    expectConfigurationFailure(
      thrownBy(
        () =>
          new LocalCatalogStore(
            set.configuration,
            spoil(set.descriptor) as never,
            loadersFor(set),
          ),
      ),
    );
  });
});
