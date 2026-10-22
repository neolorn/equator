import {
  createIdentifierParameterCodec,
  createIntegerParameterCodec,
  defineRouteProjection,
  type RouteParameterContext,
  type RouteParameterCodec,
} from '@neolorn/equator';
import { routeProjection } from '#i18n/routes';

export { routePolicy, SITE_ORIGIN } from './route-policy';

export const articleSlugCodec: RouteParameterCodec<string> = Object.freeze({
  parse: (slug: string) =>
    Object.freeze(
      slug === 'handbook' || slug === 'دليل'
        ? { ok: true, value: 'handbook' }
        : { ok: false },
    ),
  serialize: (entityId: string, context?: RouteParameterContext) => {
    if (entityId !== 'handbook') return undefined;
    return context?.locale === 'ar-EG' ? 'دليل' : 'handbook';
  },
});

/**
 * A codec for a slug no function can translate.
 *
 * Identity in both directions, and it takes no `RouteParameterContext` at all: the omission is the
 * statement. `articleSlugCodec` above knows both spellings because they are in its source; a
 * dossier's Arabic slug is in a database, so no synchronous pure function can produce it and this
 * one does not pretend to. Without a declaration Equator therefore advertises the English slug
 * under the Arabic prefix, which resolves and is not Arabic. `LocalizedRouteParameters` is what
 * supplies the fact this cannot.
 *
 * It still has to *read* every spelling, including the ones it could never have written: an
 * address Equator emits and cannot resolve is worse than one it never emitted, and
 * `buildLocalizedRoute` refuses a declared spelling this rejects.
 */
export const dossierSlugCodec: RouteParameterCodec<string> = Object.freeze({
  parse: (slug: string) =>
    Object.freeze(
      slug.length > 0 && slug.length <= 128 && !slug.startsWith('.')
        ? { ok: true, value: slug }
        : { ok: false },
    ),
  serialize: (slug: string) => slug,
});

/**
 * The exercise sheet's name, in the language of the page that shows it.
 *
 * Spelled apart in each locale so that every address names one locale under every policy, which is
 * what lets a build prerender a sheet under a locale-neutral policy too. A locale with no spelling
 * of its own takes the English one.
 */
const EXERCISE_SHEETS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = Object.freeze({
  live: Object.freeze({ 'en-US': 'live', 'ar-EG': 'مباشر' }),
  values: Object.freeze({ 'en-US': 'values', 'ar-EG': 'قيم' }),
});

export const exerciseSheetCodec: RouteParameterCodec<string> = Object.freeze({
  parse: (spelled: string) => {
    const sheet = Object.entries(EXERCISE_SHEETS).find(([, spellings]) =>
      Object.values(spellings).includes(spelled),
    )?.[0];
    return Object.freeze(
      sheet === undefined ? { ok: false } : { ok: true, value: sheet },
    );
  },
  serialize: (sheet: string, context?: RouteParameterContext) => {
    const spellings = EXERCISE_SHEETS[sheet];
    if (spellings === undefined) return undefined;
    return spellings[context?.locale ?? 'en-US'] ?? spellings['en-US'];
  },
});

/**
 * An application whose routes take no parameters at all.
 *
 * Declared here because every other projection in this fixture has a parameterised route, which
 * is what let the codec requirement claim, for a projection with none, that every route was
 * parameterised and demanded codecs no route could have. That is the ordinary shape for a
 * marketing or documentation application, and it must compile.
 */
export const parameterlessProjection = defineRouteProjection({
  generated: Object.freeze({
    profile: 'equator-route-projection/1',
    identity: 'sha256-parameterless-projection-fixture',
    routes: Object.freeze([
      Object.freeze({
        id: 'only',
        path: '',
        parameterNames: Object.freeze([]),
        indexing: 'indexable',
      }),
    ]),
  } as const),
});

export const appRouteProjection = defineRouteProjection({
  generated: routeProjection,
  parameters: Object.freeze({
    item: Object.freeze({
      id: createIntegerParameterCodec(1, 999_999),
    }),
    article: Object.freeze({ slug: articleSlugCodec }),
    // The same parameter name as `article`, and that is deliberate. It is the precondition for the
    // stale-parameter trap: a design that held declared spellings in one mutable record keyed by
    // parameter name would serve the dossier's Arabic slug on the article page after navigating
    // between them, and would tell a crawler the two are translations of each other.
    dossier: Object.freeze({ slug: dossierSlugCodec }),
    // The default pattern, deliberately. A codec that takes a pattern is only as good as the
    // pattern it is given, and the answer an application reaches for first is the one it gets
    // without arguments, so that is the one this fixture proves rejects `../etc`, `%2e%2e`, an
    // empty segment, a leading hyphen and a 129th character, and accepts an ordinary slug
    // unchanged in both locales.
    topic: Object.freeze({ topic: createIdentifierParameterCodec() }),
    exercise: Object.freeze({ sheet: exerciseSheetCodec }),
  }),
  // Paths whose words are translated, where every other route here shares its words across
  // locales. Two routes because they are drawn in different places: `item` is rendered in the
  // browser, and the exercise sheet is drawn by the server and written by the build, so the words
  // are shown reaching all three. Every check reads both addresses from the table rather than
  // spelling them.
  localizedPaths: Object.freeze({
    item: Object.freeze({ 'ar-EG': 'عناصر/:id' }),
    exercise: Object.freeze({ 'ar-EG': 'تمرين/:sheet' }),
  }),
  historical: Object.freeze({
    legacy: Object.freeze({
      kind: 'replacement',
      routeId: 'route:second',
    } as const),
    removed: Object.freeze({ kind: 'gone' } as const),
  }),
});
