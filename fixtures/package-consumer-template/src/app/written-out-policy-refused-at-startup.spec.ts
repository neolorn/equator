import { describe, expect, it } from 'vitest';

import { TestBed } from '@angular/core/testing';
import {
  Localization,
  LocalizationError,
  createPathPrefixLocalePolicy,
  withFormattingContext,
  withRouting,
  type LocaleUrlPolicy,
  type PathPrefixLocalePolicy,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { routes } from './app.routes';
import { appRouteProjection } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * A locale URL policy written out as an object, handed to an application that starts.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` holds such a policy to the tables a
 * constructor writes and refuses one that departs from them as a configuration error. Each case
 * here is one an application can write by hand, and each reads the error its bootstrap is handed,
 * before any address is resolved: a `LocalizationError` carrying `invalid-configuration`, whose
 * message says to build the policy with its constructor.
 */

const ORIGIN = 'https://site.example';

/** The policy the constructor writes for this application, written out member by member. */
const WRITTEN: PathPrefixLocalePolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG', 'en-arab-xb': 'en-Arab-XB' },
  aliases: {},
  localeNeutralRoots: ['assets'],
  omitDefaultPrefix: false,
  xDefaultPath: '/',
};

/** A copy with some members replaced, typed as the policy it stands in for. */
const departing = (replaced: Readonly<Record<string, unknown>>) =>
  ({ ...WRITTEN, ...replaced }) as unknown as LocaleUrlPolicy;

/** A copy with some members left out. */
const without = (...members: readonly string[]) =>
  Object.fromEntries(
    Object.entries(WRITTEN).filter(([name]) => !members.includes(name)),
  ) as unknown as LocaleUrlPolicy;

/** Starts the environment the way a bootstrap does, and hands back what that threw. */
async function started(policy: LocaleUrlPolicy): Promise<unknown> {
  TestBed.resetTestingModule();
  let error: unknown;
  try {
    TestBed.configureTestingModule({
      providers: [
        provideLocalizedRouter(routes, { origin: ORIGIN }),
        provideLocalizationTesting(
          {
            configuration,
            catalogSet,
            catalogLoaders,
            recoveryPayload,
            extensions: runtimeExtensions,
            routeProjection,
          },
          withRouting({ policy, projection: appRouteProjection }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    // Claiming anything from the environment injector runs its initializers, which is where an
    // application that starts first reads its policy.
    TestBed.inject(Localization);
  } catch (thrown: unknown) {
    error = thrown;
  }
  // A context that was built is started before it is torn down, as an application starts it.
  if (error === undefined) await TestBed.inject(Localization).initialize();
  TestBed.resetTestingModule();
  return error;
}

function expectPolicyRefusal(error: unknown): void {
  expect(error).toBeInstanceOf(LocalizationError);
  const { diagnostic } = error as LocalizationError;
  expect(diagnostic).toMatchObject({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
  });
  expect(diagnostic.message).toContain('which no policy constructor writes');
  expect(diagnostic.message).toContain('Build the policy with its constructor');
}

describe('an application started on a written-out locale URL policy', () => {
  it('starts where the policy is the one the constructor writes', async () => {
    expect(WRITTEN).toStrictEqual(
      createPathPrefixLocalePolicy({
        defaultLocale: 'en-US',
        locales: {
          'en-US': 'en-us',
          'ar-EG': 'ar-eg',
          'en-Arab-XB': 'en-arab-xb',
        },
        localeNeutralRoots: ['assets'],
        xDefaultPath: '/',
      }),
    );
    expect(await started(WRITTEN)).toBeUndefined();
  });

  it('is refused where the tables a constructor derives are left out', async () => {
    expectPolicyRefusal(
      await started(
        without(
          'prefixes',
          'aliases',
          'localeNeutralRoots',
          'omitDefaultPrefix',
        ),
      ),
    );
  });

  it('is refused where the prefix table does not read every locale back', async () => {
    expectPolicyRefusal(
      await started(
        departing({
          prefixes: { 'en-us': 'en-US', 'en-arab-xb': 'en-Arab-XB' },
        }),
      ),
    );
  });

  it('is refused where a prefix is not a lowercase path segment', async () => {
    expectPolicyRefusal(
      await started(
        departing({
          locales: {
            'en-US': 'EN-US',
            'ar-EG': 'ar-eg',
            'en-Arab-XB': 'en-arab-xb',
          },
          prefixes: {
            'EN-US': 'en-US',
            'ar-eg': 'ar-EG',
            'en-arab-xb': 'en-Arab-XB',
          },
        }),
      ),
    );
  });

  it('is refused where a locale is named in a spelling that is not canonical', async () => {
    expectPolicyRefusal(
      await started(
        departing({
          defaultLocale: 'en-us',
          locales: {
            'en-us': 'en-us',
            'ar-EG': 'ar-eg',
            'en-Arab-XB': 'en-arab-xb',
          },
          prefixes: {
            'en-us': 'en-us',
            'ar-eg': 'ar-EG',
            'en-arab-xb': 'en-Arab-XB',
          },
        }),
      ),
    );
  });

  it('is refused where it carries a member of another kind of policy', async () => {
    expectPolicyRefusal(
      await started(departing({ origins: { [ORIGIN]: 'en-US' } })),
    );
  });
});
