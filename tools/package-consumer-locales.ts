/**
 * The locales the main package consumer is configured with, read by the gate that builds it and by
 * the classification that requires every locale kind specification 12 section 5 names.
 */

// One statement of what init is asked for, used both to invoke it and to say what it must produce.
// Comparing Equator's file against a literal copied from the fixture's own equator.config.json
// detects drift and locks no contract; the template ships no such file, so what is asserted is what
// init authored from these flags.
export const INIT_REQUEST = Object.freeze({
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

// The two pseudo-locales the toolkit generates. Declaring them changes no build, because
// `pnpm run build` still runs a plain `equator generate` and produces neither, and the fixture's
// `test` script runs `equator generate --pseudo`, so the page spec has a real generated catalog to
// render.
export const PSEUDO_LOCALES = Object.freeze({
  'en-Latn-XA': { lengthFactor: 0.4, markers: true },
  'en-Arab-XB': { lengthFactor: -0.4, markers: true },
});

// How one locale is written: declared for a pseudo-locale, and that is the case worth
// gating. `pseudoLocales` is part of the configuration whether or not `--pseudo` asked for one, so
// a production build's generated locale table does not list them; a formatting entry that survived
// into that table would name a locale the runtime does not have and would be refused on arrival.
// The fixture builds both ways, and the gate proves both.
//
// Not `en-US` or `ar-EG`: nine specs in the lab assert digits in those two, and a declaration here
// would have made every one of them pass or fail for a reason it was not written for. What the
// runtime does with the table is asserted in `locale-formatting.spec.ts`, which builds its own.
export const LOCALE_FORMATTING = Object.freeze({
  'en-Arab-XB': { numberingSystem: 'arab' },
});
