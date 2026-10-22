/**
 * The tags of the two pseudo-locales, and what a pseudo-locale's region says about it.
 *
 * The toolkit refuses a pseudo-locale whose region claims something the locale is not, and the
 * runtime refuses a generated list that names one. Neither package can import from the other, so
 * this file is duplicated byte for byte and `packages/runtime/test/message-function-options.test.ts`
 * compares the copies. The toolkit exports the two constants; the runtime's copy stays internal.
 *
 * UTS #35 Part 1, in LDML 48.2's table of `unicode_region_subtag` codes, defines two regions for
 * pseudo-locales: `XA`, Pseudo-Accents, a "derived testing locale with English + added accents and
 * lengthened", and `XB`, Pseudo-Bidi, a "derived testing locale with forced RTL English". Its table
 * of private use codes lists `XC` to `XJ` and `XL` to `XZ` as excluded: CLDR will never give them a
 * meaning, so an application can. Every pseudo-locale Equator derives is accented, so a region
 * states the rest: `XA` for English lengthened left to right, `XB` for English right to left, and an
 * excluded code for anything else.
 */

/**
 * The Pseudo-Accents locale: English with accents, lengthened, in Latin script, left to right.
 *
 * Named for what UTS #35 calls `XA`. It is also the established convention, since Chrome and
 * Android use `en-XA` for exactly this, so a developer who sees it in a locale switcher recognises
 * what it is. A configuration that declares it gives it a positive `lengthFactor`.
 *
 * The script subtag is written out rather than left to be inferred, because the script is what
 * carries direction and pseudo-localization rests on direction being a property of the tag.
 * `en-XA` maximizes to `en-Latn-XA` and resolves the same way; stating `Latn` means the reader does
 * not have to know that.
 */
export const PSEUDO_LOCALE_ACCENTED = 'en-Latn-XA';

/**
 * The Pseudo-Bidi locale: English forced right to left, in Arabic script.
 *
 * Named for what UTS #35 calls `XB`, which says nothing about length, so a configuration sets any
 * length change itself. A negative `lengthFactor` models a language shorter than English, which is
 * the case that finds containers sized to English copy.
 *
 * **The base language is `en`, deliberately, and this is the part worth not changing.** A developer
 * reading their own screens must still be able to read them; the point is to see *their* layout
 * mirrored and their own physical CSS become visible. `ar-XB` would be an Arabic-language
 * pseudo-locale, which tests translation coverage instead and leaves the developer unable to
 * evaluate what they are looking at.
 *
 * `Arab` is in the generated `RTL_SCRIPTS` table, so this tag resolves `direction: 'rtl'` through
 * the lookup every locale uses. The runtime renders it as it renders any locale, and there is
 * nothing to exclude from a production build beyond not generating the catalog.
 *
 * **Why not `en-x-psexpand` and `en-Arab-x-pscontr`, which say what they are?** Because
 * `canonicalizeLocale` refuses any single-character subtag, and `x` is one, so a private-use
 * tag is rejected as a catalog identity. This is recorded here because the private-use form looks
 * correct from outside: it passes `Intl.getCanonicalLocales`, it survives `Intl.Locale.maximize()`,
 * and the runtime's direction lookup returns `rtl` for it. Three external authorities accept it and
 * the one validator that belongs to Equator does not.
 * `specs/03-locale-identity-and-resolution.spec.md` section 3 is the reason the validator is right:
 * a private-use subtag carries no application semantics, so admitting one into a catalog identity
 * would let two catalogs differ only in a part that no lookup reads.
 */
export const PSEUDO_LOCALE_BIDI = 'en-Arab-XB';

/** What a pseudo-locale is, as far as its region can speak for it. */
export interface PseudoLocaleFacts {
  readonly language: string;
  readonly region: string | undefined;
  readonly direction: 'ltr' | 'rtl';
  /** Whether its text is lengthened, where the reader knows; the runtime does not. */
  readonly lengthened?: boolean;
}

/** The sentence every refusal ends with, naming what each region is for. */
const REGION_RULE =
  'A pseudo-locale takes XA when it is English lengthened left to right, as PSEUDO_LOCALE_ACCENTED is, XB when it is English right to left, as PSEUDO_LOCALE_BIDI is, and otherwise one of XC to XJ or XL to XZ, which UTS #35 leaves free.';

/** What the region claims that the locale is not, or nothing where the claim holds. */
export function pseudoLocaleRegionProblem(
  facts: PseudoLocaleFacts,
): string | undefined {
  const { language, region, direction, lengthened } = facts;
  if (region !== undefined && /^X[C-JL-Z]$/u.test(region)) return undefined;
  if (region !== 'XA' && region !== 'XB') {
    return `${region === undefined ? 'has no region' : `has the region ${region}`}. ${REGION_RULE}`;
  }
  const claims =
    region === 'XA'
      ? 'XA, which UTS #35 gives to English lengthened left to right'
      : 'XB, which UTS #35 gives to English right to left';
  if (language !== 'en') {
    return `carries ${claims}, and it is in ${language}. ${REGION_RULE}`;
  }
  if (region === 'XA' && direction !== 'ltr') {
    return `carries ${claims}, and its script is written right to left. ${REGION_RULE}`;
  }
  if (region === 'XB' && direction !== 'rtl') {
    return `carries ${claims}, and its script is written left to right. ${REGION_RULE}`;
  }
  if (region === 'XA' && lengthened === false) {
    return `carries ${claims}, and its lengthFactor does not lengthen it. ${REGION_RULE}`;
  }
  return undefined;
}
