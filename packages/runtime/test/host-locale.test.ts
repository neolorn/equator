import { describe, expect, it, vi } from 'vitest';

import { RUNTIME_LIMITS } from '../src/runtime-safety.js';

/**
 * `hostLocale` itself, from a module loaded afresh for each case.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4. The module keeps every answer it has
 * given for as long as it is loaded, so a case run after another that asked the same question reads
 * the stored answer, and nothing it asserts depends on the code that made that answer. Each case
 * here loads the module anew, so what it checks is computed while it runs.
 *
 * The locales are measured on the hosts the packages support: `bal` is a language the pinned
 * likely-script table holds and no number formatter has, though the host has `ba`; `nah` has plural
 * rules and is in no locale CLDR carries, so its script is unknown.
 */

const freshHostLocale = async (): Promise<
  typeof import('../src/host-locale.js')
> => {
  vi.resetModules();
  return import('../src/host-locale.js');
};

type Constructor = new (tag: string, options?: object) => unknown;

/** Replaces `Intl[name]` with a constructor that reports each call, until `restore`. */
const watching = (
  name: string,
  seen: (tag: string, options: unknown) => void,
): { restore: () => void } => {
  const intl = Intl as unknown as Record<string, Constructor>;
  const real = intl[name] as Constructor;
  const install = (value: Constructor): void => {
    Object.defineProperty(Intl, name, {
      value,
      configurable: true,
      writable: true,
    });
  };
  install(
    new Proxy(real, {
      construct(target, args, newTarget) {
        seen(args[0] as string, args[1]);
        return Reflect.construct(target, args, newTarget) as object;
      },
    }),
  );
  return { restore: () => install(real) };
};

const CONSTRUCTORS = {
  number: 'NumberFormat',
  'date-time': 'DateTimeFormat',
  plural: 'PluralRules',
  'relative-time': 'RelativeTimeFormat',
  list: 'ListFormat',
  'display-names': 'DisplayNames',
  collator: 'Collator',
  segmenter: 'Segmenter',
  duration: 'DurationFormat',
} as const;

describe('the host answer hostLocale reads', () => {
  it.each(Object.entries(CONSTRUCTORS))(
    'is asked of the %s constructor with the lookup matcher',
    async (service, constructor) => {
      // Best fit may answer a tag with a locale other than its longest prefix the host has, and the
      // answer is compared with the tag, so lookup is the matcher that answer means anything under.
      const asked: unknown[] = [];
      const watch = watching(constructor, (_, options) => asked.push(options));
      try {
        const { hostLocale } = await freshHostLocale();
        hostLocale(service as keyof typeof CONSTRUCTORS, 'de-AQ');
      } finally {
        watch.restore();
      }
      expect(asked.length).toBeGreaterThan(0);
      for (const options of asked) {
        expect(options).toMatchObject({ localeMatcher: 'lookup' });
      }
    },
  );
});

/** The keys of the `u` extension of a tag. */
const unicodeKeys = (tag: string): string[] =>
  (tag.split('-u-')[1] ?? '')
    .split('-')
    .filter((subtag) => /^[a-z0-9][a-z]$/u.test(subtag));

describe('a keyword of the tag an option of the operation takes the place of', () => {
  it.each([
    ['date-time', 'en-u-hc-h23', 'hc', { hourCycle: 'h12' }],
    ['date-time', 'en-u-hc-h23', 'hc', { hour12: true }],
    ['number', 'en-u-nu-arab', 'nu', { numberingSystem: 'latn' }],
    ['collator', 'de-u-co-phonebk', 'co', { collation: 'phonebk' }],
    ['collator', 'de-u-kf-upper', 'kf', { caseFirst: 'lower' }],
    ['collator', 'de-u-kn', 'kn', { numeric: false }],
  ] as const)(
    'is not carried: %s under %s keeps %s only without %o',
    async (service, tag, key, options) => {
      const { hostLocale } = await freshHostLocale();
      const alone = hostLocale(service, tag);
      const overridden = hostLocale(service, tag, options);
      expect(alone.ok && unicodeKeys(alone.tag)).toContain(key);
      expect(overridden.ok && unicodeKeys(overridden.tag)).not.toContain(key);
      expect(overridden.ok && new Intl.Locale(overridden.tag).baseName).toBe(
        tag.slice(0, 2),
      );
    },
  );
});

describe('the keywords hostLocale builds a tag with', () => {
  // `Intl.Locale` reads `numeric` as false where a tag has no `kn`, the same as for `kn-false`, so
  // only the tag's own extension tells the two apart.
  it.each([
    ['de-u-kf-upper', 'de-u-kf-upper'],
    ['de', 'de'],
    ['de-u-kn', 'de-u-kn'],
    ['de-u-kn-false', 'de-u-kn-false'],
    ['de-u-co-phonebk-kn', 'de-u-co-phonebk-kn'],
    ['de-t-en-u-kn', 'de-u-kn'],
    ['de-t-kn', 'de'],
    ['de-a-kn', 'de'],
    ['de-x-u-kn', 'de'],
  ] as const)(
    'are those of the tag asked for: %s builds %s',
    async (tag, built) => {
      const { hostLocale } = await freshHostLocale();
      expect(hostLocale('collator', tag)).toEqual({ ok: true, tag: built });
    },
  );
});

describe('the chain hostLocale walks', () => {
  it('refuses a tag that is not a language tag', async () => {
    const { hostLocale } = await freshHostLocale();
    expect(hostLocale('number', 'not a tag')).toEqual({
      ok: false,
      reason: 'native-capability-rejected',
    });
  });

  it('refuses bal, a language with no parent, rather than write it as ba', async () => {
    const { hostLocale } = await freshHostLocale();
    expect(hostLocale('number', 'bal')).toEqual({
      ok: false,
      reason: 'native-capability-rejected',
    });
  });

  it('takes zh-AU through zh-Hant, the language_script_region its likely script gives', async () => {
    const { hostLocale } = await freshHostLocale();
    expect(hostLocale('number', 'zh-AU')).toEqual({
      ok: true,
      tag: 'zh-Hant',
      used: 'zh-Hant',
    });
  });

  it('names nah for nah-Latn-AQ without a fallback, since the script of nah is unknown', async () => {
    // Where either script is unknown the language alone decides, and it is the same language.
    const { hostLocale } = await freshHostLocale();
    expect(hostLocale('plural', 'nah-Latn-AQ')).toEqual({
      ok: true,
      tag: 'nah',
      used: 'nah',
    });
  });
});

describe('the answers hostLocale keeps', () => {
  it('are at most the runtime ceiling, the oldest dropped first', async () => {
    // Tags already canonical, so no two name one locale: the host is then asked about every tag at
    // least once, and the store of host answers has dropped the oldest tag's answer by the time the
    // store of results drops its result. A region alias, such as DD for DE, would let two tags share
    // an answer.
    const ceiling = RUNTIME_LIMITS.formatterCacheEntries;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const tags: string[] = [];
    build: for (const second of 'abcdefghijklmnopqrst') {
      for (const third of 'abcdefghijklmnopqrstuvwxyz') {
        for (const first of letters) {
          for (const last of letters) {
            const tag = `q${second}${third}-${first}${last}`;
            if (new Intl.Locale(tag).toString() !== tag) continue;
            tags.push(tag);
            if (tags.length > ceiling) break build;
          }
        }
      }
    }
    expect(tags.length).toBe(ceiling + 1);
    const oldest = tags[0] as string;

    let probes = 0;
    const watch = watching('ListFormat', (tag) => {
      if (tag === oldest) probes += 1;
    });
    try {
      const { hostLocale } = await freshHostLocale();
      for (const tag of tags.slice(0, ceiling)) hostLocale('list', tag);
      probes = 0;

      // Full to the ceiling, and the oldest answer is still kept.
      hostLocale('list', oldest);
      expect(probes).toBe(0);

      // One past the ceiling: the oldest answer goes, so asking again asks the host again.
      hostLocale('list', tags[ceiling] as string);
      hostLocale('list', oldest);
      expect(probes).toBe(1);
    } finally {
      watch.restore();
    }
  });
});
