/**
 * Reading the route declarations an application wrote, and reporting the ones nothing can read.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 1 makes the Angular route declarations
 * the authored source and one derived projection the only other copy. It also fixes what happens
 * at the limit of what this file can see: a route assembled at run time, spread in from
 * elsewhere, or returned by a helper is reported rather than fatal, because an application is
 * allowed to have that shape and refusing to generate would turn this analysis into a bar on
 * adoption.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 5 is the rest of the rule: the analysis
 * follows the project's real compilation graph, its symbols and its exact spans, and never
 * executes application code, calls a getter or a service, or resolves anything over a network.
 */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  ASTWithSource,
  ImplicitReceiver,
  LiteralArray,
  PropertyRead,
  RecursiveAstVisitor,
  LiteralPrimitive,
  TmplAstRecursiveVisitor,
  parseTemplate,
  tmplAstVisitAll,
  type AST,
  type TmplAstBoundAttribute,
  type TmplAstBoundEvent,
  type TmplAstBoundText,
  type TmplAstElement,
  type TmplAstLetDeclaration,
} from '@angular/compiler';
import ts from 'typescript';

import {
  toolkitDiagnostic,
  toolkitFailure,
  spanAt,
  toolkitSuccess,
  type ToolkitDiagnostic,
  type ToolkitDiagnosticSeverity,
  type ToolkitResult,
} from './diagnostics.js';
import { admitHostCompatibility } from './host-compatibility.js';
import { containedPath } from './output-host.js';
import { RESOURCE_LIMITS } from './resource-limits.js';
import { GENERATED_ABI_PROFILE } from './semantic-model.js';
import { compareCodeUnit } from './sorted-records.js';
import { portablePath } from './file-system.js';

/** A source file supplied directly rather than read from disk, for analysing something in memory. */
export interface AnalysisSource {
  /** The path it is to be treated as having, which is what diagnostics about it will name. */
  readonly path: string;
  /** Its text. */
  readonly contents: string;
}

export interface VirtualModule {
  readonly specifier: string;
  readonly contents: string;
}

export interface ApplicationAnalysisRequest {
  readonly projectRoot: string;
  readonly rootNames: readonly string[];
  readonly sources?: readonly AnalysisSource[];
  readonly virtualModules?: readonly VirtualModule[];
  readonly knownMessageIdentities?: readonly string[];
  readonly typeNames?: readonly string[];
  readonly maxDiagnostics?: number;
  /**
   * The consumer's own resolved compiler options. Analysis must observe the
   * program the consumer's compiler actually builds; imposing different
   * options produces findings about a program that does not exist. Omitted
   * when the owner has no selectable TypeScript configuration.
   */
  readonly compilerOptions?: ts.CompilerOptions;
}

/**
 * One place the application uses a message.
 *
 * Collected across the whole application, which is what answers both directions: which messages
 * nothing reaches, and where a message would have to be changed if it were renamed.
 */
export interface MessageUsage {
  /** Which message, by the identity its handle carries. */
  readonly identity: string;
  /** The file it is used in. */
  readonly sourcePath: string;
  /** Where the use begins, as characters from the start of the file. */
  readonly start: number;
  /** Where it ends. */
  readonly end: number;
  /** Whether the use is in code or in a component's template. */
  readonly surface: 'typescript' | 'template';
}

/**
 * One route the application declares, read out of its source.
 *
 * What localized routing is derived from: the translated spellings, the reciprocal alternates, the
 * sitemap entry, and which messages arrive with which lazily loaded route.
 */
export interface RouteProjection {
  /**
   * A stable name for this address.
   *
   * Derived from the route's full path, because the path is what the id has to survive: renaming
   * `:id` to `:orderId` leaves the URL, the page, and its indexed copy untouched, so it must leave
   * the key those messages are authored under untouched too. Every parameter therefore collapses
   * to one mark and only literal segments contribute names. A consumer that wants a different
   * name declares `data.equatorRouteId`.
   */
  readonly id: string;
  /** The route's full path as authored, with its parameters still in it. */
  readonly path: string;
  /** The parameters the path names, in the order they appear. */
  readonly parameterNames: readonly string[];
  /**
   * What this route claims about being indexed, resolved from the class its own data names.
   *
   * Absent when the owner declared no indexing policy, or when the route's class is not one the
   * policy lists.
   */
  readonly indexing?: 'indexable' | 'non-indexable' | 'private';
  /**
   * Who may keep this route's pages, resolved from the class its own data names.
   *
   * Absent when the route names none, which leaves the class routing gives the page.
   */
  readonly caching?: RouteCachingClass;
  /**
   * What this route claims in a sitemap, resolved from the class its own data names.
   *
   * Absent when the owner declared no sitemap policy, and absent when the route's class is one the
   * policy does not list. Both produce an entry carrying its address and its alternates, which is
   * a complete entry: the two optional elements are a claim, not a requirement.
   */
  readonly sitemap?: {
    readonly changefreq?: string;
    readonly priority?: number;
    readonly lastmod?: string;
  };
  /**
   * The files this route brings in that the first render does not.
   *
   * A route behind `loadComponent` or `loadChildren` downloads its code when it activates, and the
   * messages that code uses have to arrive with it. Deriving the set here is what lets Equator load
   * them without any application listing scopes per route: the same analysis already decided
   * which scopes are not startup scopes, and this says which route is responsible for each.
   */
  readonly deferredSourcePaths: readonly string[];
  /** The file the route is declared in. */
  readonly sourcePath: string;
  /** Where the declaration begins, as characters from the start of that file. */
  readonly start: number;
  /** Where it ends. */
  readonly end: number;
}

/**
 * A template saying something about a locale in its own words.
 *
 * Reported, not judged. This layer knows what the source says and not what the configuration says,
 * and deciding whether `"en-US"` in a template is a locale needs the locale set, which is the same
 * division `routePolicy` above is written under.
 *
 * Two shapes, because a hand-written locale option has two halves. The locale itself arrives as a
 * string in an expression (a click handler, an attribute binding, a comparison) and the option's
 * language and direction arrive as static attributes that repeat what the runtime already knows.
 */
export interface TemplateLocaleMention {
  readonly kind: 'literal' | 'attribute';
  /** `lang`, for a static attribute mention. */
  readonly attribute?: string;
  readonly text: string;
  /** A static `dir` on the same element, which is the other half of a hand-written option. */
  readonly siblingDirection?: string;
  readonly componentName: string;
  readonly sourcePath: string;
  readonly templatePath: string;
  readonly start: number;
  readonly end: number;
}

/**
 * An address a template hands to the Router, in the forms a build can read one.
 *
 * Reported, not judged, on the same division as `TemplateLocaleMention` above: this layer
 * knows that a template writes `routerLink="/ar-eg/articles"` and does not know that `ar-eg` is a
 * segment this owner's policy claims. The layer that holds the policy decides.
 *
 * `routerLink` alone, and that is the scope rather than an omission. It is the one attribute whose
 * value Equator resolves on the way out: the click hands the Router the address as written, and
 * `UrlHandlingStrategy.extract` rewrites it to its canonical form before anything matches it. An
 * `href` is a full-page address the browser supplies and `LocationStrategy.path()` delocalizes on
 * arrival, so a locale in one is a working link to that locale's page and legitimate content.
 *
 * Three forms, because a `routerLink` is written three ways and a check that read one of them would
 * be silent for the other two. The address is assembled here because assembling it is reading:
 * an array is a list of commands the Router joins, and joining them is not a judgement.
 */
export interface TemplateAddress {
  readonly attribute: string;
  /** `static` for `routerLink="..."`, `bound` for a string expression, `array` for the command list. */
  readonly form: 'static' | 'bound' | 'array';
  /** The address as written, joined for the array form. Absolute: it always begins with `/`. */
  readonly address: string;
  readonly componentName: string;
  readonly sourcePath: string;
  readonly templatePath: string;
  readonly start: number;
  readonly end: number;
}

/** A component whose template lives in its own file, and where both of them are. */
export interface ComponentTemplateAnalysis {
  /** The component class's name. */
  readonly componentName: string;
  /** The file the class is declared in. */
  readonly sourcePath: string;
  /** The template file it points at, which is where the template surface's usages were found. */
  readonly templatePath: string;
}

/**
 * What reading the application's own source found out about how it uses localization.
 *
 * Everything Equator knows that a catalog cannot say. Reported rather than judged: this layer knows
 * what the source says and not what the configuration says, and comparing the two belongs to the
 * layer holding both.
 */
export interface ApplicationAnalysis {
  /** Every place a message is used, in code and in templates. */
  readonly messageUsages: readonly MessageUsage[];
  /**
   * The messages selected for the failure path, found by resolving the symbol rather than by name.
   *
   * These are compiled separately, so they can be read when no catalog could be loaded.
   */
  readonly recoveryMessageIdentities: readonly string[];
  /**
   * Whether this owner composes the Angular application runtime.
   *
   * `specs/10-compiler-and-tooling.spec.md` section 10 makes a missing recovery root a
   * correctness error for an owner that selects an application runtime, and nothing could tell
   * that an owner had. So the error could
   * never fire: an owner authoring recovery copy and never selecting it passed generate and check
   * with no diagnostics at all. Detected the same way recovery selection itself
   * is: by resolving the symbol and requiring its declaration to come from the Equator package,
   * rather than by matching a name any consumer could shadow.
   */
  readonly selectsApplicationRuntime?: boolean;
  /** Every route the application declares, with what each one claims about itself. */
  readonly routes: readonly RouteProjection[];
  /**
   * The locale set this owner's route policy declares, when it declares one readably.
   *
   * Reported rather than judged here: this layer knows what the source says and not what the
   * configuration says, and comparing the two is the job of the layer that holds both. Absent when
   * the owner builds no policy, or builds one from something a build cannot read.
   */
  readonly routePolicy?: RoutePolicyDeclaration;
  /** Every component whose template is a separate file, so a usage in one can be traced back. */
  readonly components: readonly ComponentTemplateAnalysis[];
  /** Every locale-shaped thing a component template spells out for itself. */
  readonly localeMentions: readonly TemplateLocaleMention[];
  /** Every absolute address a component template hands to the Router. */
  readonly templateAddresses: readonly TemplateAddress[];
  /**
   * Files a route reaches only through a lazy boundary, and everything they pull in.
   *
   * Angular splits an application at `loadComponent` and `loadChildren`, and the code behind those
   * boundaries is not downloaded until the route activates. The messages used there should not be
   * either. Deriving the set is what lets Equator load only what the first render needs without any
   * application listing scopes by hand: the list was a workaround for analysis Equator can do.
   */
  readonly deferredSourcePaths: readonly string[];
}

function normalizePath(path: string): string {
  return resolve(path).replaceAll('\\', '/');
}

function sourceSpan(
  source: string,
  start: number,
  length: number,
  sourcePath: string,
) {
  return spanAt(source, start, length, sourcePath);
}

function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function typeScriptDiagnostic(
  projectRoot: string,
  diagnostic: ts.Diagnostic,
  severity: ToolkitDiagnosticSeverity = 'error',
): ToolkitDiagnostic {
  if (
    diagnostic.file === undefined ||
    diagnostic.start === undefined ||
    diagnostic.length === undefined
  ) {
    return toolkitDiagnostic(
      'EQ1401',
      `TypeScript: ${diagnosticMessage(diagnostic)}`,
      { severity },
    );
  }
  const path = portablePath(projectRoot, diagnostic.file.fileName);
  return toolkitDiagnostic(
    'EQ1401',
    `TypeScript: ${diagnosticMessage(diagnostic)}`,
    {
      severity,
      span: sourceSpan(
        diagnostic.file.text,
        diagnostic.start,
        diagnostic.length,
        path,
      ),
    },
  );
}

function propertyStringLiteral(
  checker: ts.TypeChecker,
  type: ts.Type,
  propertyName: string,
  location: ts.Node,
): string | undefined {
  const property = type.getProperty(propertyName);
  if (property === undefined) return undefined;
  const propertyType = checker.getTypeOfSymbolAtLocation(property, location);
  return propertyType.isStringLiteral() ? propertyType.value : undefined;
}

/**
 * Whether a node sits in a type rather than in a value.
 *
 * `typeof messages.issue.unknown`, or a cast to that type, names the handle's type and holds no
 * handle, so nothing it reaches can render the message. Only a value reference is a use.
 */
function inTypePosition(node: ts.Node): boolean {
  for (
    let current = node.parent;
    !ts.isSourceFile(current);
    current = current.parent
  ) {
    if (ts.isTypeNode(current)) return true;
  }
  return false;
}

/**
 * Whether a name stands for a type and for no value, such as the name a type alias declares for a
 * handle's type. Its type is the handle's, and it holds nothing that renders.
 */
function namesOnlyAType(checker: ts.TypeChecker, node: ts.Node): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return false;
  const target =
    (symbol.flags & ts.SymbolFlags.Alias) === 0
      ? symbol
      : checker.getAliasedSymbol(symbol);
  return (target.flags & ts.SymbolFlags.Value) === 0;
}

function resolvedMessageIdentity(
  checker: ts.TypeChecker,
  node: ts.Node,
): string | undefined {
  return typeMessageIdentity(checker, checker.getTypeAtLocation(node), node);
}

/**
 * A handle held in a named property of whatever an argument evaluates to.
 *
 * Read off the type rather than off an object literal's syntax, so an options object assembled in
 * a constant, spread together, or returned by a helper is seen the same way a literal at the call
 * site is. A recovery message the analysis cannot see is a message the payload does not carry, and
 * the failure is a blank region at the one moment the application has nothing else to show.
 */
function propertyMessageIdentity(
  checker: ts.TypeChecker,
  node: ts.Node,
  propertyName: string,
): string | undefined {
  const property = checker.getTypeAtLocation(node).getProperty(propertyName);
  if (property === undefined) return undefined;
  return typeMessageIdentity(
    checker,
    checker.getTypeOfSymbolAtLocation(property, node),
    node,
  );
}

function typeMessageIdentity(
  checker: ts.TypeChecker,
  type: ts.Type,
  node: ts.Node,
): string | undefined {
  if (
    propertyStringLiteral(checker, type, 'generatedAbi', node) !==
      GENERATED_ABI_PROFILE ||
    !['plain', 'structured'].includes(
      propertyStringLiteral(checker, type, 'resultKind', node) ?? '',
    )
  ) {
    return undefined;
  }
  return propertyStringLiteral(checker, type, 'identity', node);
}

/**
 * The symbol an expression names, with import aliases followed to what they alias.
 *
 * Every Equator call is recognized this way rather than by name: a consumer function called
 * `withRouting` configures nothing, and one called `provideLocalization` composes nothing.
 */
function resolvedSymbol(
  checker: ts.TypeChecker,
  node: ts.Expression,
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return undefined;
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function declaredIn(symbol: ts.Symbol, fragment: string): boolean {
  return (
    symbol
      .getDeclarations()
      ?.some((item) =>
        item.getSourceFile().fileName.replaceAll('\\', '/').includes(fragment),
      ) ?? false
  );
}

/**
 * A call that composes this owner's Equator application runtime.
 *
 * Two spellings reach the same place. An application ordinarily calls the generated
 * `provideLocalization()`, whose declaration is in this owner's generated `#i18n`: that is the
 * whole point of generating it. An application that has a reason to assemble the setup itself
 * calls `provideLocalizationSetup()` from the package.
 *
 * Matching only the package spelling would recognize no real consumer, because they all call the
 * generated wrapper.
 */
function isLocalizationProviderCall(
  checker: ts.TypeChecker,
  node: ts.CallExpression,
  generatedRoot: string,
): boolean {
  const resolved = resolvedSymbol(checker, node.expression);
  if (resolved === undefined) return false;
  if (
    resolved.name === 'provideLocalizationSetup' &&
    declaredIn(resolved, '/@neolorn/equator/')
  ) {
    return true;
  }
  return (
    resolved.name === 'provideLocalization' &&
    declaredIn(resolved, generatedRoot)
  );
}

const MESSAGE_GROUP_DEPTH = 8;
const MESSAGE_GROUP_MEMBERS = 4096;

/**
 * Every message inside an expression that is a group of them.
 *
 * A message selected by a value only the running program has, a failure code from a service, cannot
 * be named in source, so the code that selects it hands Equator the group instead and Equator
 * counts every member as used. Anything less would report those messages unused and eventually drop
 * them, and the first sign of it would be a customer reading a generic apology in place of what
 * actually went wrong.
 *
 * Bounded on both depth and count: this walks a type a consumer wrote, and a type can be as deep
 * and as wide as a consumer likes.
 */
function groupMessageIdentities(
  checker: ts.TypeChecker,
  node: ts.Node,
): readonly string[] {
  const found: string[] = [];
  const seen = new Set<ts.Type>();
  const walk = (type: ts.Type, depth: number): void => {
    if (depth > MESSAGE_GROUP_DEPTH) return;
    if (found.length >= MESSAGE_GROUP_MEMBERS) return;
    if (seen.has(type)) return;
    seen.add(type);
    for (const property of checker.getPropertiesOfType(type)) {
      if (found.length >= MESSAGE_GROUP_MEMBERS) return;
      const propertyType = checker.getTypeOfSymbolAtLocation(property, node);
      const identity = typeMessageIdentity(checker, propertyType, node);
      if (identity !== undefined) {
        found.push(identity);
        continue;
      }
      if ((propertyType.flags & ts.TypeFlags.Object) !== 0) {
        walk(propertyType, depth + 1);
      }
    }
  };
  const type = checker.getTypeAtLocation(node);
  if ((type.flags & ts.TypeFlags.Object) === 0) return [];
  walk(type, 0);
  return found;
}

/**
 * How this owner's route data says which routes are indexable.
 *
 * Read out of the `withRouting()` call's source text rather than by running it: `field` and the
 * values beside it are string literals precisely so that they can be. A consumer that classifies
 * its routes already points Equator at the field it already has; one that does not gets
 * `equatorIndexing`.
 */
interface RouteIndexingPolicy {
  readonly field: string;
  readonly values: ReadonlyMap<
    string,
    'indexable' | 'non-indexable' | 'private'
  >;
  /**
   * False when the table itself cannot be read, and then every value under the field is answered as
   * private.
   */
  readonly readable: boolean;
}

const DEFAULT_ROUTE_INDEXING_FIELD = 'equatorIndexing';

/**
 * What a class of routes claims in a sitemap, read out of `withRouting()` the same way.
 *
 * The seven `changefreq` values are the protocol's own enumeration and `priority` is bounded at 0
 * and 1, so a declaration outside either is refused here rather than written into a document a
 * validator then rejects. Refused, not dropped: a value somebody typed and Equator silently ignored
 * is the failure this whole declaration exists to avoid.
 *
 * `lastmodField` names a second route-data field carrying a date. It is separate because a date
 * belongs to one page and a class does not have one, and it is read rather than computed, because
 * a build time is not a date the page changed on.
 */
interface RouteSitemapPolicy {
  readonly field: string;
  readonly values: ReadonlyMap<string, RouteSitemapClass>;
  readonly lastmodField?: string;
}

interface RouteSitemapClass {
  readonly changefreq?: string;
  readonly priority?: number;
}

const SITEMAP_CHANGE_FREQUENCIES = new Set([
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
]);

const SITEMAP_W3C_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/u;

const DEFAULT_ROUTE_INDEXING_VALUES = new Map<
  string,
  'indexable' | 'non-indexable' | 'private'
>([
  ['indexable', 'indexable'],
  ['non-indexable', 'non-indexable'],
  ['private', 'private'],
]);

/**
 * Who may keep a route's pages, as `RouteProjection.caching` reports it.
 *
 * `per-visitor` is a page that depends on something the request carries, such as a cookie: a
 * browser may keep it and asks the server again before reusing it, and no shared cache may keep it.
 * `not-stored` is a page nothing may keep, such as one behind a sign-in. There is no value for
 * shared, because a declaration can only raise what routing concluded.
 */
export type RouteCachingClass = 'per-visitor' | 'not-stored';

/**
 * How this owner's route data says which routes a shared cache may not keep.
 *
 * Read out of `withRouting()` the way the indexing policy is. A value this cannot use is answered
 * as `not-stored` rather than dropped: every class it could have named keeps the page out of a
 * shared cache, so the strictest is the one reading that cannot make a page more shareable than
 * its author wrote. `readable` is false when the table itself cannot be read, and then every value
 * under the field is such a value.
 */
interface RouteCachingPolicy {
  readonly field: string;
  readonly values: ReadonlyMap<string, RouteCachingClass>;
  readonly readable: boolean;
}

const DEFAULT_ROUTE_CACHING_FIELD = 'equatorCaching';

const DEFAULT_ROUTE_CACHING_VALUES = new Map<string, RouteCachingClass>([
  ['per-visitor', 'per-visitor'],
  ['not-stored', 'not-stored'],
]);

/**
 * One option of Equator's `withRouting()`, as far as its source says, or nothing where the call is
 * not that one.
 */
function routingOption(
  checker: ts.TypeChecker,
  node: ts.CallExpression,
  name: 'caching' | 'sitemap' | 'indexing',
): KeyReading | undefined {
  const resolved = resolvedSymbol(checker, node.expression);
  if (
    resolved === undefined ||
    resolved.name !== 'withRouting' ||
    !declaredIn(resolved, '/@neolorn/equator/')
  ) {
    return undefined;
  }
  const argument = node.arguments[0];
  return argument === undefined
    ? ABSENT_KEY
    : keyReading(checker, argument, name);
}

/** A key of an option that its source sets to a string, or nothing where it sets none it can read. */
function optionString(
  checker: ts.TypeChecker,
  option: WrittenValue,
  name: string,
): string | undefined {
  const item = keyReading(checker, option, name);
  return item.kind === 'set' && item.value !== undefined
    ? stringThrough(checker, item.value)
    : undefined;
}

/** A key of an option that its source sets to a table, or nothing where it sets none it can read. */
function optionEntries(
  checker: ts.TypeChecker,
  option: WrittenValue,
  name: string,
): ReadonlyMap<string, WrittenValue | undefined> | undefined {
  const item = keyReading(checker, option, name);
  return item.kind === 'set' && item.value !== undefined
    ? objectEntries(checker, item.value)
    : undefined;
}

/** A number written in place or through `const` bindings to one, or nothing. */
function numberThrough(
  checker: ts.TypeChecker,
  value: WrittenValue,
): number | undefined {
  const bound = throughBindings(checker, value, new Set());
  return ts.isNumericLiteral(bound) ? Number(bound.text) : undefined;
}

/**
 * The caching half of `withRouting()`, with what it refused beside it.
 *
 * A declaration whose field cannot be read has no policy, and the refusal says so: the build cannot
 * know which field its routes use, so they keep the default field.
 */
function routeCachingPolicy(
  checker: ts.TypeChecker,
  node: ts.CallExpression,
):
  | {
      readonly policy: RouteCachingPolicy | undefined;
      readonly refusals: readonly string[];
    }
  | undefined {
  const caching = routingOption(checker, node, 'caching');
  if (caching === undefined || caching.kind === 'absent') return undefined;
  const option = caching.kind === 'set' ? caching.value : undefined;
  const field =
    option === undefined ? undefined : optionString(checker, option, 'field');
  if (option === undefined || field === undefined) {
    return {
      policy: undefined,
      refusals: [
        'the build cannot read its `field` as a string literal or a `const` bound to one, so it cannot tell which field its routes use, and they are read from `equatorCaching`',
      ],
    };
  }
  const refusals: string[] = [];
  const values = new Map<string, RouteCachingClass>();
  const entries = optionEntries(checker, option, 'values');
  for (const [key, written] of entries ?? []) {
    const value =
      written === undefined ? undefined : stringThrough(checker, written);
    if (value === 'per-visitor' || value === 'not-stored') {
      values.set(key, value);
    } else {
      values.set(key, 'not-stored');
      refusals.push(
        `${JSON.stringify(key)} does not name \`per-visitor\` or \`not-stored\` as a string literal or a \`const\` bound to one, so its routes are answered as \`not-stored\``,
      );
    }
  }
  if (entries === undefined) {
    refusals.push(
      `the build cannot read its \`values\` as an object of plain entries, so it cannot tell what a value of ${JSON.stringify(field)} means, and every route that sets it is answered as \`not-stored\``,
    );
  }
  return {
    policy: Object.freeze({ field, values, readable: entries !== undefined }),
    refusals: Object.freeze(refusals),
  };
}

/**
 * The sitemap half of `withRouting()`, read from source text for the same reason the indexing half
 * is: the field name is the consumer's and the table is literals, so a build can see both without
 * running anything.
 *
 * A malformed entry is reported by the caller, which has the diagnostics list. This returns what it
 * could read and the refusals beside it, so one walk produces both. A declaration whose field cannot
 * be read has no policy, because no route's class can be found without it.
 */
function routeSitemapPolicy(
  checker: ts.TypeChecker,
  node: ts.CallExpression,
):
  | {
      readonly policy: RouteSitemapPolicy | undefined;
      readonly refusals: readonly string[];
    }
  | undefined {
  const sitemap = routingOption(checker, node, 'sitemap');
  if (sitemap === undefined || sitemap.kind === 'absent') return undefined;
  const option = sitemap.kind === 'set' ? sitemap.value : undefined;
  const field =
    option === undefined ? undefined : optionString(checker, option, 'field');
  if (option === undefined || field === undefined) {
    return {
      policy: undefined,
      refusals: [
        'the build cannot read its `field` as a string literal or a `const` bound to one, so no route claims anything in the sitemap',
      ],
    };
  }
  const refusals: string[] = [];
  const values = new Map<string, RouteSitemapClass>();
  const entries = optionEntries(checker, option, 'values');
  if (entries === undefined) {
    refusals.push(
      'the build cannot read its `values` as an object of plain entries, so no route claims anything in the sitemap',
    );
  }
  for (const [key, written] of entries ?? []) {
    const properties =
      written === undefined ? undefined : objectEntries(checker, written);
    if (properties === undefined) {
      refusals.push(
        `the build cannot read ${JSON.stringify(key)} as an object of plain entries. That class claims nothing until the value is corrected`,
      );
      continue;
    }
    const claim: { changefreq?: string; priority?: number } = {};
    if (properties.has('changefreq')) {
      const written = properties.get('changefreq');
      const changefreq =
        written === undefined ? undefined : stringThrough(checker, written);
      if (
        changefreq !== undefined &&
        SITEMAP_CHANGE_FREQUENCIES.has(changefreq)
      ) {
        claim.changefreq = changefreq;
      } else {
        refusals.push(
          changefreq === undefined
            ? `${JSON.stringify(key)} declares a changefreq that is not a string literal or a \`const\` bound to one. That class claims nothing until the value is corrected`
            : `${JSON.stringify(key)} declares a changefreq the sitemap protocol does not list; it admits ${[...SITEMAP_CHANGE_FREQUENCIES].join(', ')}. That class claims nothing until the value is corrected`,
        );
      }
    }
    if (properties.has('priority')) {
      const written = properties.get('priority');
      const priority =
        written === undefined ? undefined : numberThrough(checker, written);
      if (priority !== undefined && priority >= 0 && priority <= 1) {
        claim.priority = priority;
      } else {
        refusals.push(
          `${JSON.stringify(key)} declares a priority that is not a number literal, or a \`const\` bound to one, between 0 and 1. That class claims nothing until the value is corrected`,
        );
      }
    }
    if (claim.changefreq !== undefined || claim.priority !== undefined) {
      values.set(key, Object.freeze(claim));
    }
  }
  const dated = keyReading(checker, option, 'lastmodField');
  const lastmodField =
    dated.kind === 'set' && dated.value !== undefined
      ? stringThrough(checker, dated.value)
      : undefined;
  if (dated.kind !== 'absent' && lastmodField === undefined) {
    refusals.push(
      'the build cannot read its `lastmodField` as a string literal or a `const` bound to one, so no route carries a date in the sitemap',
    );
  }
  return {
    policy: Object.freeze({
      field,
      values,
      ...(lastmodField === undefined ? {} : { lastmodField }),
    }),
    refusals: Object.freeze(refusals),
  };
}

/**
 * The indexing half of `withRouting()`, with what it refused beside it.
 *
 * A declaration whose field cannot be read has no policy, as the caching half does, so its routes
 * keep the default field. An entry whose class cannot be read is answered as private, because a
 * route that sets it may be one its author meant to keep out.
 */
function routeIndexingPolicy(
  checker: ts.TypeChecker,
  node: ts.CallExpression,
):
  | {
      readonly policy: RouteIndexingPolicy | undefined;
      readonly refusals: readonly string[];
    }
  | undefined {
  const indexing = routingOption(checker, node, 'indexing');
  if (indexing === undefined || indexing.kind === 'absent') return undefined;
  const option = indexing.kind === 'set' ? indexing.value : undefined;
  const field =
    option === undefined ? undefined : optionString(checker, option, 'field');
  if (option === undefined || field === undefined) {
    return {
      policy: undefined,
      refusals: [
        'the build cannot read its `field` as a string literal or a `const` bound to one, so it cannot tell which field its routes use, and they are read from `equatorIndexing`',
      ],
    };
  }
  const refusals: string[] = [];
  const values = new Map<string, 'indexable' | 'non-indexable' | 'private'>();
  const entries = optionEntries(checker, option, 'values');
  for (const [key, written] of entries ?? []) {
    const value =
      written === undefined ? undefined : stringThrough(checker, written);
    if (
      value === 'indexable' ||
      value === 'non-indexable' ||
      value === 'private'
    ) {
      values.set(key, value);
    } else if (value === undefined) {
      values.set(key, 'private');
      refusals.push(
        `${JSON.stringify(key)} does not name its class as a string literal or a \`const\` bound to one, so its routes are answered as private`,
      );
    }
  }
  if (entries === undefined) {
    refusals.push(
      `the build cannot read its \`values\` as an object of plain entries, so it cannot tell what a value of ${JSON.stringify(field)} means, and every route that sets it is answered as private`,
    );
  }
  return {
    policy: Object.freeze({ field, values, readable: entries !== undefined }),
    refusals: Object.freeze(refusals),
  };
}

/**
 * What a route policy declares, read out of the call that builds it.
 *
 * An application states its locales twice and always has: once in `equator.config.json`, which is
 * what generates the catalogs, and once in the call that builds its locale URL policy, which is
 * what turns a locale into an address. The two have to agree, and reading the policy is what lets
 * the toolkit compare them. Adding a locale to one and not the other is silent in both directions:
 * a locale with catalogs and no address is unreachable, and an address with no catalogs renders in
 * the default language.
 *
 * It also declares the leading path segments it owns, and those are read here for a second
 * question the toolkit is the only place that can ask. A canonical route whose own first segment
 * spells one of them is an address the resolver reads as a locale rather than as a route, so the
 * route is unreachable at its own address. The policy is one file and the projection is another;
 * this is where a build first holds both.
 *
 * Read from source text rather than by running the call, for the same reason `withRouting`'s
 * indexing policy is: the keys are string literals precisely so that a build can see them. A policy
 * assembled from a computed object is not readable here, and is reported as unreadable rather than
 * as empty: an unreadable policy and a policy naming no locales must not look alike.
 *
 * All four factories are recognized, and by resolved symbol, so a consumer's own function of any of
 * those names declares nothing. Recognizing two of them was itself a hole: a policy built by
 * `createDefaultLocalePrefixPolicy` or `createLocaleNeutralPolicy` was invisible, so every check
 * that reads this was silent for it, and a check that is silent for half the ways of spelling the
 * thing it checks is not a check.
 */
/**
 * A leading path segment the policy has claimed, and what it claimed it as.
 *
 * The kind decides how it is compared, which is not a choice made here: the resolver corrects the
 * case of a prefix and of an alias, so those are matched case-insensitively, and it compares a
 * locale-neutral root exactly, so that one is matched exactly. The same rule is written in the
 * runtime, against the built policy object rather than against source text: the two packages
 * observe different things and neither can be derived from the other, so the rule is stated twice
 * and pinned together by a test rather than shared through a dependency the toolkit does not have.
 */
/**
 * A leading path segment the locale policy has taken, so an application route cannot also use it.
 *
 * What catches a route named `en` in a project whose addresses begin with a locale: the two would
 * collide, and which one wins would depend on the order they were registered in.
 */
export interface ClaimedRouteSegment {
  /** The segment itself, as it appears at the start of an address. */
  readonly segment: string;
  /** Why it is taken: a locale, a spelling that resolves to one, or a root kept out of the scheme. */
  readonly kind: 'locale prefix' | 'locale alias' | 'locale-neutral root';
}

/**
 * The locale policy the application's own source declares, as the source declares it.
 *
 * Absent from the analysis when the application builds no policy, or builds one out of something a
 * build cannot read. Compared against the configuration by the layer that holds both, which is what
 * catches a policy naming locales the project does not build.
 */
export interface RoutePolicyDeclaration {
  /** Where the policy puts the locale: in the path, in the host, or nowhere. */
  readonly kind: 'path-prefix' | 'locale-host' | 'locale-neutral';
  /** The locales it names. */
  readonly locales: readonly string[];
  /**
   * Every leading path segment the policy has claimed: its locale prefixes, its aliases, and its
   * locale-neutral roots. Empty for a policy that puts no locale in the path and declares no
   * neutral roots.
   */
  readonly claimedSegments: readonly ClaimedRouteSegment[];
  /** Whether the default locale's addresses carry no prefix, so a route's own segment leads. */
  readonly omitDefaultPrefix: boolean;
  /** The locale the policy treats as the default, when it names one. */
  readonly defaultLocale?: string;
  /**
   * The options of the call that were not read, by name: the locale table, `defaultLocale`,
   * `aliases` and `localeNeutralRoots`, each listed when it, or an entry in it, comes from a
   * constant, a function, a spread or a key that is not a literal. Empty for a policy written out
   * whole. What these hold was compared with nothing.
   */
  readonly unreadOptions: readonly string[];
  /** The file the policy is declared in. */
  readonly sourcePath: string;
  /** Where the declaration begins, as characters from the start of that file. */
  readonly start: number;
  /** Where it ends. */
  readonly end: number;
}

interface RoutePolicyFactory {
  readonly kind: RoutePolicyDeclaration['kind'];
  /** The option holding the locale table, and whether locales are its keys or its elements. */
  readonly localeOption: string;
  readonly localesAre: 'keys' | 'elements';
  /** Whether the option's values are the locale prefixes, rather than origins or nothing. */
  readonly valuesArePrefixes: boolean;
  readonly omitDefaultPrefix?: true;
}

const ROUTE_POLICY_FACTORIES = new Map<string, RoutePolicyFactory>([
  [
    'createPathPrefixLocalePolicy',
    {
      kind: 'path-prefix',
      localeOption: 'locales',
      localesAre: 'keys',
      valuesArePrefixes: true,
    },
  ],
  [
    // The same policy with `omitDefaultPrefix` fixed on, which is exactly the shape in which a
    // route's own leading segment becomes the first segment of an address.
    'createDefaultLocalePrefixPolicy',
    {
      kind: 'path-prefix',
      localeOption: 'locales',
      localesAre: 'keys',
      valuesArePrefixes: true,
      omitDefaultPrefix: true,
    },
  ],
  [
    'createHostLocalePolicy',
    {
      kind: 'locale-host',
      localeOption: 'origins',
      localesAre: 'keys',
      valuesArePrefixes: false,
    },
  ],
  [
    'createLocaleNeutralPolicy',
    {
      kind: 'locale-neutral',
      localeOption: 'locales',
      localesAre: 'elements',
      valuesArePrefixes: false,
    },
  ],
]);

/** The literal text of an object literal's property name, when it has one. */
function propertyName(item: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(item)) return undefined;
  return ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name)
    ? item.name.text
    : undefined;
}

/** The literal strings of an array literal, skipping anything not spelled out. */
function literalElements(node: ts.Expression | undefined): string[] {
  if (node === undefined || !ts.isArrayLiteralExpression(node)) return [];
  return node.elements
    .filter((element): element is ts.StringLiteralLike =>
      ts.isStringLiteralLike(element),
    )
    .map((element) => element.text);
}

function routePolicyDeclaration(
  projectRoot: string,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
): RoutePolicyDeclaration | undefined {
  const resolved = resolvedSymbol(checker, node.expression);
  if (resolved === undefined || !declaredIn(resolved, '/@neolorn/equator/')) {
    return undefined;
  }
  const factory = ROUTE_POLICY_FACTORIES.get(resolved.name);
  if (factory === undefined) return undefined;
  const argument = node.arguments[0];
  const common = {
    kind: factory.kind,
    sourcePath: portablePath(projectRoot, sourceFile.fileName),
    start: node.getStart(sourceFile),
    end: node.getEnd(),
  };
  // The options the comparisons read, in the order a report names them. `aliases` exists only
  // where the table's values are prefixes.
  const compared = [
    factory.localeOption,
    'defaultLocale',
    ...(factory.valuesArePrefixes ? ['aliases'] : []),
    'localeNeutralRoots',
  ];
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    return Object.freeze({
      locales: Object.freeze([]),
      claimedSegments: Object.freeze([]),
      omitDefaultPrefix: factory.omitDefaultPrefix ?? false,
      unreadOptions: Object.freeze(compared),
      ...common,
    });
  }
  const unread = new Set<string>();
  // A spread or a computed key can set an option the call never spells, so an option that is not
  // written is absent only where the call has neither.
  const canHideAnOption = argument.properties.some(
    (item) =>
      ts.isSpreadAssignment(item) || ts.isComputedPropertyName(item.name),
  );
  // A spread written after an option can replace it, since the later one wins, and what the
  // spread holds is not evaluated. An option with a spread after it is therefore one the running
  // application may not be using, and it is left unread rather than compared.
  const option = (name: string): ts.Expression | undefined => {
    let written = false;
    for (const item of argument.properties) {
      if (written && ts.isSpreadAssignment(item)) {
        unread.add(name);
        return undefined;
      }
      if (
        item.name !== undefined &&
        (ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name)) &&
        item.name.text === name
      ) {
        written = true;
      }
    }
    const value = objectProperty(argument, name);
    // Written in shorthand or as a method, or not written where something else may supply it.
    if (value === undefined && (written || canHideAnOption)) unread.add(name);
    return value;
  };
  const table = option(factory.localeOption);
  const defaultLocale = option('defaultLocale');
  if (defaultLocale !== undefined && !ts.isStringLiteralLike(defaultLocale)) {
    unread.add('defaultLocale');
  }
  const locales: string[] = [];
  const claimed = new Map<string, ClaimedRouteSegment>();
  const claim = (segment: string, kind: ClaimedRouteSegment['kind']): void => {
    if (!claimed.has(segment)) claimed.set(segment, { segment, kind });
  };
  // The locale table is read whole or not at all. An entry that is spread in, computed, or written
  // in shorthand names a locale this cannot see without evaluating something, and reading the
  // rest as the whole table reports the unseen locales as configured with no address, which is an
  // error raised against an application that addresses them.
  if (factory.localesAre === 'elements') {
    if (
      table !== undefined &&
      ts.isArrayLiteralExpression(table) &&
      table.elements.every((element) => ts.isStringLiteralLike(element))
    ) {
      locales.push(...literalElements(table));
    } else if (table !== undefined) {
      unread.add(factory.localeOption);
    }
  } else if (
    table !== undefined &&
    ts.isObjectLiteralExpression(table) &&
    table.properties.every((item) => propertyName(item) !== undefined)
  ) {
    for (const item of table.properties) {
      const name = propertyName(item);
      if (name === undefined) continue;
      locales.push(name);
      const value = (item as ts.PropertyAssignment).initializer;
      if (!factory.valuesArePrefixes) continue;
      if (ts.isStringLiteralLike(value)) claim(value.text, 'locale prefix');
      // The locale is read and its prefix is not, so no route was held against that prefix.
      else unread.add(factory.localeOption);
    }
  } else if (table !== undefined) {
    unread.add(factory.localeOption);
  }
  // Aliases are claimed by their key, the older spelling, and neutral roots by their own text.
  // Both are leading segments the resolver reads before it reads a route, which is the only thing
  // that puts them in this list.
  if (factory.valuesArePrefixes) {
    const aliases = option('aliases');
    if (aliases !== undefined && ts.isObjectLiteralExpression(aliases)) {
      for (const item of aliases.properties) {
        const name = propertyName(item);
        if (name !== undefined) claim(name, 'locale alias');
        else unread.add('aliases');
      }
    } else if (aliases !== undefined) {
      unread.add('aliases');
    }
  }
  const roots = option('localeNeutralRoots');
  if (
    roots !== undefined &&
    !(
      ts.isArrayLiteralExpression(roots) &&
      roots.elements.every((element) => ts.isStringLiteralLike(element))
    )
  ) {
    unread.add('localeNeutralRoots');
  }
  for (const root of literalElements(roots)) {
    claim(root, 'locale-neutral root');
  }
  const omitOption = option('omitDefaultPrefix');
  return Object.freeze({
    locales: Object.freeze(locales),
    claimedSegments: Object.freeze(
      [...claimed.values()].map((entry) => Object.freeze(entry)),
    ),
    omitDefaultPrefix:
      factory.omitDefaultPrefix ??
      (omitOption !== undefined &&
        omitOption.kind === ts.SyntaxKind.TrueKeyword),
    ...(defaultLocale !== undefined && ts.isStringLiteralLike(defaultLocale)
      ? { defaultLocale: defaultLocale.text }
      : {}),
    unreadOptions: Object.freeze(compared.filter((name) => unread.has(name))),
    ...common,
  });
}

/** The initializer of one property of an object literal, unwrapped of parentheses and assertions. */
function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const item of object.properties) {
    if (!ts.isPropertyAssignment(item)) continue;
    const matches =
      (ts.isIdentifier(item.name) && item.name.text === name) ||
      (ts.isStringLiteralLike(item.name) && item.name.text === name);
    if (!matches) continue;
    let current: ts.Expression = item.initializer;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  }
  return undefined;
}

// A spread or a computed key can set any key its type allows, so an object literal that has one may
// set a key without spelling it. Reading such a key as absent is how a route ends up at an address
// it does not serve.
function canHoldKey(
  checker: ts.TypeChecker,
  type: ts.Type,
  name: string,
): boolean {
  return (type.isUnion() ? type.types : [type]).some((member) => {
    if ((member.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      return true;
    }
    const apparent = checker.getApparentType(member);
    return (
      checker.getPropertyOfType(apparent, name) !== undefined ||
      checker.getIndexInfoOfType(apparent, ts.IndexKind.String) !== undefined
    );
  });
}

function canBeKey(type: ts.Type, name: string): boolean {
  return (type.isUnion() ? type.types : [type]).some((member) =>
    member.isStringLiteral()
      ? member.value === name
      : !member.isNumberLiteral() &&
        (member.flags & ts.TypeFlags.ESSymbolLike) === 0,
  );
}

// The last element that can set a key is the one that does, which is JavaScript's own order.
function keySetter(
  checker: ts.TypeChecker,
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | 'absent' | 'unreadable' {
  let found: ts.ObjectLiteralElementLike | 'absent' | 'unreadable' = 'absent';
  for (const item of object.properties) {
    if (ts.isSpreadAssignment(item)) {
      if (
        canHoldKey(checker, checker.getTypeAtLocation(item.expression), name)
      ) {
        found = 'unreadable';
      }
    } else if (
      ts.isComputedPropertyName(item.name) &&
      !ts.isStringLiteralLike(item.name.expression)
    ) {
      if (canBeKey(checker.getTypeAtLocation(item.name.expression), name)) {
        found = 'unreadable';
      }
    } else {
      const key = ts.isComputedPropertyName(item.name)
        ? (item.name.expression as ts.StringLiteralLike).text
        : ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name)
          ? item.name.text
          : undefined;
      if (key === name) found = item;
    }
  }
  return found;
}

// Parentheses and type assertions change nothing an expression evaluates to.
function withoutWrappers(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The initializer of the `const` a symbol names, or nothing where the name is bound any other way.
 *
 * A `const` cannot be reassigned, so its initializer is its value wherever it is read, which is how
 * `specs/10-compiler-and-tooling.spec.md` section 5 follows a constant alias. A `let`, a parameter,
 * a destructured name or a declaration without a body can hold anything by the time it is read.
 */
function constDeclaration(
  symbol: ts.Symbol | undefined,
): ts.VariableDeclaration | undefined {
  const declaration = symbol?.valueDeclaration;
  return declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.BlockScoped) ===
      ts.NodeFlags.Const
    ? declaration
    : undefined;
}

/**
 * How many spreads deep an object is followed.
 *
 * Every spread followed is a `const` of its own, so a chain ends, but a long enough one would end in
 * a stack overflow rather than a report. A spread past this depth is answered the way one the build
 * cannot follow is.
 */
const SPREAD_DEPTH = 8;

/** Where a value is written: an expression, or a shorthand property naming a binding. */
type WrittenValue = ts.Expression | ts.ShorthandPropertyAssignment;

/**
 * A value with every `const` it names followed to what that `const` holds, and nothing evaluated.
 *
 * `seen` holds the bindings already followed on this path, so one that reaches itself ends the walk.
 */
function throughBindings(
  checker: ts.TypeChecker,
  value: WrittenValue,
  seen: Set<ts.Node>,
): ts.Expression {
  let symbol: ts.Symbol | undefined;
  let current: ts.Expression;
  if (ts.isShorthandPropertyAssignment(value)) {
    const named = checker.getShorthandAssignmentValueSymbol(value);
    symbol =
      named !== undefined && (named.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(named)
        : named;
    current = value.name;
  } else {
    current = withoutWrappers(value);
    symbol = ts.isIdentifier(current)
      ? resolvedSymbol(checker, current)
      : undefined;
  }
  for (;;) {
    const declaration = constDeclaration(symbol);
    if (declaration === undefined || seen.has(declaration)) return current;
    seen.add(declaration);
    current = withoutWrappers(declaration.initializer as ts.Expression);
    symbol = ts.isIdentifier(current)
      ? resolvedSymbol(checker, current)
      : undefined;
  }
}

/** A string written in place or through `const` bindings to one, or nothing. */
function stringThrough(
  checker: ts.TypeChecker,
  value: WrittenValue,
): string | undefined {
  const bound = throughBindings(checker, value, new Set());
  return ts.isStringLiteralLike(bound) ? bound.text : undefined;
}

/** A property's key, where its source spells it or names a `const` that holds it. */
function propertyKey(
  checker: ts.TypeChecker,
  name: ts.PropertyName,
): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  if (!ts.isComputedPropertyName(name)) return undefined;
  const key = throughBindings(checker, name.expression, new Set());
  return ts.isStringLiteralLike(key) ? key.text : undefined;
}

/**
 * What sets one key of an object, as far as its source says.
 *
 * `hidden` is a key something may set without the source saying what: a spread the build cannot
 * follow, a computed key it cannot read, or an object that is not written out at all. Each can set
 * the key only where its type allows it.
 */
type KeyReading =
  | { readonly kind: 'absent' }
  | { readonly kind: 'set'; readonly value: WrittenValue | undefined }
  | {
      readonly kind: 'hidden';
      readonly by: 'spread' | 'computed key' | 'expression';
    };

const ABSENT_KEY: KeyReading = Object.freeze({ kind: 'absent' });

// The last element that can set a key is the one that does, which is JavaScript's own order. A
// spread of a `const` is read as the object it holds, so it overrides only the keys it writes.
function keyReading(
  checker: ts.TypeChecker,
  value: WrittenValue,
  name: string,
  seen: ReadonlySet<ts.Node> = new Set(),
  depth = 0,
): KeyReading {
  const followed = new Set(seen);
  const object = throughBindings(checker, value, followed);
  if (!ts.isObjectLiteralExpression(object)) {
    return canHoldKey(checker, checker.getTypeAtLocation(object), name)
      ? { kind: 'hidden', by: 'expression' }
      : ABSENT_KEY;
  }
  let found = ABSENT_KEY;
  for (const item of object.properties) {
    if (ts.isSpreadAssignment(item)) {
      const inner =
        depth < SPREAD_DEPTH
          ? keyReading(checker, item.expression, name, followed, depth + 1)
          : canHoldKey(
                checker,
                checker.getTypeAtLocation(item.expression),
                name,
              )
            ? ({ kind: 'hidden', by: 'spread' } as const)
            : ABSENT_KEY;
      if (inner.kind === 'absent') continue;
      found =
        inner.kind === 'hidden' && inner.by === 'expression'
          ? { kind: 'hidden', by: 'spread' }
          : inner;
      continue;
    }
    const key = propertyKey(checker, item.name);
    if (key === undefined) {
      if (
        ts.isComputedPropertyName(item.name) &&
        canBeKey(checker.getTypeAtLocation(item.name.expression), name)
      ) {
        found = { kind: 'hidden', by: 'computed key' };
      }
      continue;
    }
    if (key !== name) continue;
    found = {
      kind: 'set',
      value: ts.isPropertyAssignment(item)
        ? item.initializer
        : ts.isShorthandPropertyAssignment(item)
          ? item
          : undefined,
    };
  }
  return found;
}

/**
 * Every key an object sets and the value that wins it, or nothing where one of its keys cannot be
 * read, because a table with an unreadable key cannot say what any key means.
 */
function objectEntries(
  checker: ts.TypeChecker,
  value: WrittenValue,
  seen: ReadonlySet<ts.Node> = new Set(),
  depth = 0,
): ReadonlyMap<string, WrittenValue | undefined> | undefined {
  const followed = new Set(seen);
  const object = throughBindings(checker, value, followed);
  if (!ts.isObjectLiteralExpression(object)) return undefined;
  const entries = new Map<string, WrittenValue | undefined>();
  for (const item of object.properties) {
    if (ts.isSpreadAssignment(item)) {
      const inner =
        depth < SPREAD_DEPTH
          ? objectEntries(checker, item.expression, followed, depth + 1)
          : undefined;
      if (inner === undefined) return undefined;
      for (const [key, written] of inner) entries.set(key, written);
      continue;
    }
    const key = propertyKey(checker, item.name);
    if (key === undefined) return undefined;
    entries.set(
      key,
      ts.isPropertyAssignment(item)
        ? item.initializer
        : ts.isShorthandPropertyAssignment(item)
          ? item
          : undefined,
    );
  }
  return entries;
}

/** One route's own reading of a key of its data, before anything it inherits. */
type RouteDataReading =
  | { readonly kind: 'absent' }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'unreadable'; readonly cause: string };

const ABSENT_DATA: RouteDataReading = Object.freeze({ kind: 'absent' });

/** Why a hidden key cannot be read, as the clause a report puts after the route. */
function hiddenCause(
  by: 'spread' | 'computed key' | 'expression',
  holder: 'data' | 'resolve',
  field: string,
): string {
  const quoted = JSON.stringify(field);
  return {
    spread: `may set ${quoted} through a spread the build cannot follow`,
    'computed key': `may set ${quoted} through a computed key the build cannot read`,
    expression: `takes its \`${holder}\` from an expression the build cannot read, which may set ${quoted}`,
  }[by];
}

/**
 * What a route's own declarations give one key of its data.
 *
 * Angular writes a resolver's result over the route's own data (`runResolve`,
 * `@angular/router` 22.2.1), so a resolver that may supply the key
 * decides it, and it does so only when the page is visited.
 */
function routeDataReading(
  checker: ts.TypeChecker,
  route: ts.ObjectLiteralExpression,
  field: string,
): RouteDataReading {
  const quoted = JSON.stringify(field);
  const resolvers = keyReading(checker, route, 'resolve');
  const resolved =
    resolvers.kind !== 'set'
      ? resolvers
      : resolvers.value === undefined
        ? ({ kind: 'hidden', by: 'expression' } as const)
        : keyReading(checker, resolvers.value, field);
  if (resolved.kind === 'set') {
    return {
      kind: 'unreadable',
      cause: `supplies ${quoted} through a resolver, which runs only when the page is visited`,
    };
  }
  if (resolved.kind === 'hidden') {
    return {
      kind: 'unreadable',
      cause: hiddenCause(resolved.by, 'resolve', field),
    };
  }
  const data = keyReading(checker, route, 'data');
  const read =
    data.kind !== 'set'
      ? data
      : data.value === undefined
        ? ({ kind: 'hidden', by: 'expression' } as const)
        : keyReading(checker, data.value, field);
  if (read.kind === 'absent') return ABSENT_DATA;
  if (read.kind === 'hidden') {
    return { kind: 'unreadable', cause: hiddenCause(read.by, 'data', field) };
  }
  const value =
    read.value === undefined ? undefined : stringThrough(checker, read.value);
  return value === undefined
    ? {
        kind: 'unreadable',
        cause: `sets ${quoted} to something other than a string literal or a \`const\` bound to one`,
      }
    : { kind: 'string', value };
}

/**
 * The inheritance strategy one router configuration sets, as far as its source says.
 *
 * `absent` is a configuration that does not set it. It still counts, because Angular provides the
 * token non-multi, so a second configuration replaces the first whole, strategy included.
 */
type RouterStrategyReading = 'always' | 'emptyOnly' | 'absent' | 'unreadable';

/**
 * What `node` sets the router's inheritance strategy to, or nothing where it configures no router.
 *
 * Angular's router reads the strategy from `ROUTER_CONFIGURATION`
 * (`@angular/router` 22.2.1, `NavigationTransitions.paramsInheritanceStrategy`), and three public
 * calls provide that token: `withRouterConfig`, `RouterModule.forRoot`, and a provider of the
 * token itself. Each is recognized by what its symbol
 * resolves to, so a consumer's own function of the same name configures nothing.
 */
function routerInheritanceStrategy(
  checker: ts.TypeChecker,
  node: ts.Node,
): RouterStrategyReading | undefined {
  const unwrapped = (expression: ts.Expression): ts.Expression => {
    let current = expression;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  };
  const fromRouter = (expression: ts.Expression): ts.Symbol | undefined => {
    const symbol = resolvedSymbol(checker, unwrapped(expression));
    return symbol !== undefined && declaredIn(symbol, '/@angular/router/')
      ? symbol
      : undefined;
  };
  const read = (options: WrittenValue | undefined): RouterStrategyReading => {
    if (options === undefined) return 'unreadable';
    const item = keyReading(checker, options, 'paramsInheritanceStrategy');
    if (item.kind === 'absent') return 'absent';
    const value =
      item.kind === 'set' && item.value !== undefined
        ? stringThrough(checker, item.value)
        : undefined;
    return value === 'always' || value === 'emptyOnly' ? value : 'unreadable';
  };
  if (ts.isCallExpression(node)) {
    const symbol = fromRouter(node.expression);
    if (symbol?.name === 'withRouterConfig') return read(node.arguments[0]);
    if (
      symbol?.name === 'forRoot' &&
      symbol
        .getDeclarations()
        ?.some(
          (declaration) =>
            ts.isClassDeclaration(declaration.parent) &&
            declaration.parent.name?.text === 'RouterModule',
        )
    ) {
      // `forRoot` provides the token even without a configuration, as an empty one.
      return node.arguments[1] === undefined
        ? 'absent'
        : read(node.arguments[1]);
    }
    return undefined;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const provide = keySetter(checker, node, 'provide');
    if (
      typeof provide === 'string' ||
      !ts.isPropertyAssignment(provide) ||
      fromRouter(provide.initializer)?.name !== 'ROUTER_CONFIGURATION'
    ) {
      return undefined;
    }
    // A factory, a class or an alias produces its value when the application runs.
    const value = keyReading(checker, node, 'useValue');
    return value.kind === 'set' ? read(value.value) : 'unreadable';
  }
  return undefined;
}

/**
 * The module specifier of a dynamic import inside a route loader.
 *
 * Angular accepts `() => import('./x')`, `() => import('./x').then(m => m.C)`, and the same
 * wrapped in `async`. Only a literal specifier is recognized: a computed one cannot be resolved at
 * build time by anyone, including the bundler, so treating it as a boundary would be a guess.
 */
function dynamicImportSpecifier(node: ts.Node): string | undefined {
  let found: string | undefined;
  const visit = (current: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isCallExpression(current) &&
      current.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = current.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        found = argument.text;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/**
 * The files reachable from a set of entry modules by ordinary static imports.
 *
 * Used twice, for the two halves of the same question: what the first render pulls in, and what a
 * lazy route pulls in. A file in both is eager, because something outside the boundary already
 * needed it.
 */
function staticImportClosure(
  program: ts.Program,
  entries: readonly ts.SourceFile[],
): Set<string> {
  const reached = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop() as ts.SourceFile;
    const key = normalizePath(file.fileName);
    if (reached.has(key)) continue;
    reached.add(key);
    for (const statement of file.statements) {
      const specifier =
        (ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (specifier === undefined) continue;
      const resolved = resolveModule(program, file, specifier);
      if (resolved !== undefined && !resolved.isDeclarationFile) {
        pending.push(resolved);
      }
    }
  }
  return reached;
}

function resolveModule(
  program: ts.Program,
  from: ts.SourceFile,
  specifier: string,
): ts.SourceFile | undefined {
  const resolved = ts.resolveModuleName(
    specifier,
    from.fileName,
    program.getCompilerOptions(),
    ts.sys,
  ).resolvedModule;
  return resolved === undefined
    ? undefined
    : program.getSourceFile(resolved.resolvedFileName);
}

function componentDecorator(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration,
): ts.CallExpression | undefined {
  const decorators = ts.canHaveDecorators(declaration)
    ? (ts.getDecorators(declaration) ?? [])
    : [];
  for (const decorator of decorators) {
    if (!ts.isCallExpression(decorator.expression)) continue;
    const symbol = checker.getSymbolAtLocation(decorator.expression.expression);
    if (symbol === undefined) continue;
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    if (
      resolved.name === 'Component' &&
      resolved
        .getDeclarations()
        ?.some((item) =>
          item
            .getSourceFile()
            .fileName.replaceAll('\\', '/')
            .includes('/@angular/core/'),
        )
    ) {
      return decorator.expression;
    }
  }
  return undefined;
}

function metadataString(
  metadata: ts.ObjectLiteralExpression,
  name: string,
): ts.StringLiteralLike | undefined {
  for (const property of metadata.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteralLike(property.name) &&
          property.name.text === name)) &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer;
    }
  }
  return undefined;
}

/**
 * Does this string have the shape of a language tag?
 *
 * A cheap prefilter, and deliberately only that. It keeps every ordinary template string out of the
 * report (a CSS class, a route path, a message) without deciding anything: whether `"en-US"` is
 * one of this application's locales is a question for the layer holding the locale set, and a two
 * to eight letter primary subtag with optional script and region subtags is the smallest shape that
 * cannot exclude a real one. `ltr` and `rtl` match it and are meant to; the judging layer knows
 * which attribute they came from.
 */
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

/** The attribute whose value Equator resolves, and the only one this reports. */
const ROUTER_LINK = 'routerLink';

/**
 * The absolute address a `routerLink` value spells, or nothing.
 *
 * Nothing is the answer for three different situations and they are all the same answer here: a
 * relative address, which resolves under the route the reader is already on and can carry no
 * prefix; an address whose leading segments are computed, which is decided per value at runtime
 * exactly as a parameterised route path is; and an expression that is not an address at all.
 *
 * The array form is the Router's command list, and only its leading literal run is read. `['/', x]`
 * yields `/` and stops, which spells no segment and is declined: the same rule as a route path
 * whose first segment is `:slug`. Repeated separators collapse because the Router joins commands
 * with one, so `['/', 'ar-eg']` and `['/ar-eg']` are the same address written twice.
 */
function absoluteAddress(written: string): string | undefined {
  const collapsed = written.replaceAll(/\/{2,}/gu, '/');
  return collapsed.startsWith('/') ? collapsed : undefined;
}

function routerLinkAddress(
  value: AST,
): { readonly form: 'bound' | 'array'; readonly address: string } | undefined {
  const ast = value instanceof ASTWithSource ? value.ast : value;
  if (ast instanceof LiteralPrimitive) {
    if (typeof ast.value !== 'string') return undefined;
    const address = absoluteAddress(ast.value);
    return address === undefined ? undefined : { form: 'bound', address };
  }
  if (!(ast instanceof LiteralArray)) return undefined;
  const commands: string[] = [];
  for (const element of ast.expressions) {
    if (!(element instanceof LiteralPrimitive)) break;
    if (typeof element.value !== 'string') break;
    commands.push(element.value);
  }
  if (commands.length === 0) return undefined;
  const address = absoluteAddress(commands.join('/'));
  return address === undefined || address === '/'
    ? undefined
    : { form: 'array', address };
}

function templatePropertyPath(
  ast: PropertyRead,
): readonly string[] | undefined {
  const result: string[] = [];
  let current: AST = ast;
  while (current instanceof PropertyRead) {
    result.push(current.name);
    current = current.receiver;
  }
  return current instanceof ImplicitReceiver ? result.reverse() : undefined;
}

function templateMessageIdentity(
  checker: ts.TypeChecker,
  component: ts.ClassDeclaration,
  path: readonly string[],
): string | undefined {
  let type = checker.getTypeAtLocation(component);
  for (const part of path) {
    const property = type.getProperty(part);
    if (property === undefined) return undefined;
    type = checker.getTypeOfSymbolAtLocation(property, component);
  }
  return propertyStringLiteral(checker, type, 'identity', component);
}

class TemplateExpressionVisitor extends RecursiveAstVisitor {
  constructor(
    private readonly onPropertyRead: (property: PropertyRead) => void,
    private readonly onStringLiteral: (literal: LiteralPrimitive) => void,
  ) {
    super();
  }

  override visitPropertyRead(ast: PropertyRead, context: unknown): unknown {
    this.onPropertyRead(ast);
    return super.visitPropertyRead(ast, context);
  }

  override visitLiteralPrimitive(
    ast: LiteralPrimitive,
    context: unknown,
  ): unknown {
    if (typeof ast.value === 'string') this.onStringLiteral(ast);
    return super.visitLiteralPrimitive(ast, context);
  }
}

class TemplateNodeVisitor extends TmplAstRecursiveVisitor {
  constructor(
    private readonly expressions: TemplateExpressionVisitor,
    private readonly onElement: (element: TmplAstElement) => void,
  ) {
    super();
  }

  override visitElement(element: TmplAstElement): void {
    this.onElement(element);
    super.visitElement(element);
  }

  private visitExpression(expression: AST): void {
    expression.visit(this.expressions);
  }

  override visitBoundText(text: TmplAstBoundText): void {
    this.visitExpression(text.value);
    super.visitBoundText(text);
  }

  override visitBoundAttribute(attribute: TmplAstBoundAttribute): void {
    this.visitExpression(attribute.value);
    super.visitBoundAttribute(attribute);
  }

  override visitBoundEvent(event: TmplAstBoundEvent): void {
    this.visitExpression(event.handler);
    super.visitBoundEvent(event);
  }

  override visitLetDeclaration(declaration: TmplAstLetDeclaration): void {
    this.visitExpression(declaration.value);
    super.visitLetDeclaration(declaration);
  }
}

/**
 * The symbol a type carries, or nothing where it carries none.
 *
 * The compiler API declares `symbol` as always present. An anonymous object type, a union and an
 * intrinsic type each reach here without one, and the type under inspection is a consumer's.
 */
function typeSymbol(type: ts.Type): ts.Symbol | undefined {
  return type.symbol;
}

function isRoutesContract(
  checker: ts.TypeChecker,
  declaration: ts.VariableDeclaration,
): ts.Expression | undefined {
  const initializer = declaration.initializer;
  const typeNode =
    initializer !== undefined && ts.isSatisfiesExpression(initializer)
      ? initializer.type
      : declaration.type;
  const expression =
    initializer !== undefined && ts.isSatisfiesExpression(initializer)
      ? initializer.expression
      : initializer;
  if (typeNode === undefined || expression === undefined) return undefined;
  const type = checker.getTypeFromTypeNode(typeNode);
  const symbol = type.aliasSymbol ?? typeSymbol(type);
  if (
    symbol?.name !== 'Routes' ||
    !symbol
      .getDeclarations()
      ?.some((item) =>
        item
          .getSourceFile()
          .fileName.replaceAll('\\', '/')
          .includes('/@angular/router/'),
      )
  ) {
    return undefined;
  }
  return expression;
}

/**
 * The runtime's route-identity grammar, restated where ids are made.
 *
 * `angular.ts` rejects a `routeId` outside this shape when generated routing state is adopted.
 * Deriving an id here that fails there would move a build-time naming mistake into the browser,
 * so the two must agree; the constant is duplicated rather than imported because the toolkit does
 * not depend on the runtime package.
 */
const ROUTE_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const ROUTE_IDENTITY_PREFIX = 'route:';

/**
 * One mark for every parameter segment.
 *
 * `_` cannot come out of `routeSegmentSlug`, so a marked segment can never be confused with a
 * literal one: `/orders/:id` and a literal `/orders/_` are different ids, as they are different
 * URLs.
 */
const ROUTE_PARAMETER_MARK = '_';

/** The empty path. Unreachable from any literal, for the same reason as the parameter mark. */
const ROUTE_ROOT_MARK = '_index';

function routeSegments(fullPath: string): readonly string[] {
  return fullPath.split('/').filter((segment) => segment.length > 0);
}

/**
 * A literal path segment reduced to the identity alphabet.
 *
 * One pass: runs of unusable characters collapse to a single `-`, and none survives at either end.
 * A segment with nothing usable in it (punctuation only, or a non-Latin script the identity
 * grammar has no room for) yields the empty string, and the caller reports that rather than
 * inventing a name for it.
 */
function routeSegmentSlug(segment: string): string {
  let slug = '';
  let separated = false;
  for (const character of segment) {
    const usable =
      (character >= 'A' && character <= 'Z') ||
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9');
    if (!usable) {
      separated = true;
      continue;
    }
    if (separated && slug.length > 0) slug += '-';
    separated = false;
    slug += character;
  }
  return slug;
}

/** `undefined` when the path cannot be named within the identity grammar. */
function routeIdentity(fullPath: string): string | undefined {
  const segments = routeSegments(fullPath);
  const marks: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(':')) {
      marks.push(ROUTE_PARAMETER_MARK);
      continue;
    }
    const slug = routeSegmentSlug(segment);
    if (slug.length === 0) return undefined;
    marks.push(slug);
  }
  const identity = `${ROUTE_IDENTITY_PREFIX}${marks.length === 0 ? ROUTE_ROOT_MARK : marks.join('.')}`;
  return ROUTE_IDENTITY_PATTERN.test(identity) ? identity : undefined;
}

/**
 * One route object as written, linked to the route it is nested in.
 *
 * Kept because a page receives more than its own route writes: Angular gives a child its parent's
 * data under a rule that depends on the router's configuration, which is read in another file and
 * possibly after this one.
 */
interface RouteNode {
  readonly parent: RouteNode | undefined;
  /** The full path, or `undefined` where the address cannot be read. */
  readonly path: string | undefined;
  /** The route table whose declaration this route was read from. */
  readonly table: ts.VariableDeclaration;
  /**
   * What the route's own declarations give one key of its data.
   *
   * Read when asked rather than when the route is visited, because the field to read is named in
   * the provider file, which is a different file and may be read after this one.
   */
  readonly read: (field: string) => RouteDataReading;
  /**
   * Whether Angular gives the route its parent's data under either strategy: its own path is
   * empty, or its parent renders no component (`getInherited`, `@angular/router` 22.2.1).
   */
  readonly inheritsUnderEitherStrategy: boolean;
  /**
   * Whether the route certainly renders a component. Where that cannot be read it counts as not,
   * so its children inherit, because inheriting only ever gives a route that states no class its
   * parent's.
   */
  readonly rendersComponent: boolean;
  /** The outlet the route renders in, or `undefined` where the build cannot read it. */
  readonly outlet: string | undefined;
  /**
   * Whether the route and every route above it render in the primary outlet. A route in a named
   * outlet renders beside a page and is never one, and its addresses are the outlet's.
   */
  readonly inPrimaryOutlet: boolean;
  /**
   * The route's children in the order they are written, as Angular meets them at the route's own
   * address. Filled while the children are visited, after the route itself.
   */
  readonly children: RouteChild[];
}

/** Angular's name for the outlet a route renders in when it names none (`getOutlet`). */
const PRIMARY_OUTLET = 'primary';

/**
 * A child route as Angular meets it where its parent has consumed the last segment of an address:
 * whether it can render there, and what decides that (`Recognizer.processSegment`,
 * `@angular/router` 22.2.1).
 */
interface RouteChild {
  readonly node: RouteNode;
  /**
   * What matches an address with nothing left in it. An empty path does, and so does a wildcard
   * (`defaultUrlMatcher`). A `matcher` is a function the build cannot run, and a `path`
   * that is not a string literal is one Equator does not name.
   */
  readonly matches:
    'empty' | 'wildcard' | 'nothing' | 'matcher' | 'computed' | 'unreadable';
  /** `undefined` where a spread or a computed key may set `redirectTo`. */
  readonly redirects: boolean | undefined;
  /**
   * Whether a `canMatch` guard may turn the route down when the page is visited, or `undefined`
   * where a spread or a computed key may set one.
   */
  readonly guarded: boolean | undefined;
  /** The lazy entry modules on the child's path from the root, innermost last. */
  readonly lazyEntries: readonly string[];
  readonly sourcePath: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A route as read, before its name is settled.
 *
 * Naming cannot happen while reading: a collision is a fact about two routes, and the second one
 * may be declared in another file.
 */
/**
 * One route table naming another.
 *
 * A table the pass visits on its own is projected at the root. That is right only where the
 * application also uses it there, so what names it, and where, decides whether its routes stay.
 */
interface RouteTableReference {
  readonly from: ts.VariableDeclaration;
  readonly to: ts.VariableDeclaration;
  /** Whether the reference sits among the routes of `from` itself rather than below one of them. */
  readonly atRoot: boolean;
}

interface RouteDraft {
  readonly node: RouteNode;
  readonly path: string;
  readonly parameterNames: readonly string[];
  /** The lazy entry modules on this route's path from the root, innermost last. */
  readonly lazyEntries: readonly string[];
  readonly sourcePath: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Settle every route's name, and say so when one cannot be settled.
 *
 * Two routes sharing an address are one route: a parent and its `{ path: '' }` child describe the
 * same URL, and the deeper declaration is the one that renders the page, so what it receives is
 * what the page is. Two *different* addresses sharing a name is the opposite, a defect, and neither
 * is indexed until the consumer separates them, because indexing one of them under a name that
 * also describes the other silently attaches a page's copy to the wrong page.
 *
 * Nothing here blocks a build. Route projection feeds an optional capability, and an application
 * that never enables it should not fail to compile over the name of a route it does not index.
 */
function resolveRouteIdentities(
  drafts: readonly RouteDraft[],
  rootRoutes: readonly RouteChild[],
  policy: RouteIndexingPolicy | undefined,
  sitemapPolicy: RouteSitemapPolicy | undefined,
  cachingPolicy: RouteCachingPolicy | undefined,
  strategy: 'always' | 'emptyOnly',
  deferredFor: (draft: RouteDraft) => readonly string[],
  diagnostics: ToolkitDiagnostic[],
): RouteProjection[] {
  const field = policy?.field ?? DEFAULT_ROUTE_INDEXING_FIELD;
  const values = policy?.values ?? DEFAULT_ROUTE_INDEXING_VALUES;
  const cachingField = cachingPolicy?.field ?? DEFAULT_ROUTE_CACHING_FIELD;
  /**
   * The route that decides what a page receives under one key, and what that route gives it.
   *
   * Angular spreads a parent's data under the route's own (`getInherited`), so the nearest route
   * that writes the key decides it, and a route that does not inherit ends the search.
   */
  const writer = (
    draft: RouteDraft,
    key: string,
  ):
    | {
        readonly node: RouteNode;
        readonly reading: Exclude<RouteDataReading, { kind: 'absent' }>;
      }
    | undefined => {
    let node: RouteNode | undefined = draft.node;
    while (node !== undefined) {
      const reading = node.read(key);
      if (reading.kind !== 'absent') return { node, reading };
      node =
        strategy === 'always' || node.inheritsUnderEitherStrategy
          ? node.parent
          : undefined;
    }
    return undefined;
  };
  // Reported once where the value is written, because every route that inherits it would otherwise
  // repeat the same finding.
  const reported = new Map<RouteNode, Set<string>>();
  const firstReport = (node: RouteNode, field: string): boolean => {
    const fields = reported.get(node) ?? new Set<string>();
    reported.set(node, fields);
    if (fields.has(field)) return false;
    fields.add(field);
    return true;
  };
  const address = (node: RouteNode, draft: RouteDraft): string =>
    JSON.stringify(`/${node.path ?? draft.path}`);
  /**
   * A route's caching class, or nothing, which leaves routing's own.
   *
   * Under Equator's own field every value is meant for Equator, so one that names no class is a
   * mistake and is refused. Under a consumer's field an unlisted value is not, for the reason the
   * indexing field gives. A value the build cannot read is refused under either.
   */
  const cachingOf = (draft: RouteDraft): RouteCachingClass | undefined => {
    const found = writer(draft, cachingField);
    if (found === undefined) return undefined;
    const refuse = (reason: string): RouteCachingClass => {
      if (firstReport(found.node, cachingField)) {
        diagnostics.push(
          toolkitDiagnostic(
            'EQ1413',
            `Route ${address(found.node, draft)} ${reason}. It and every route that inherits its data are answered as not-stored until the value is corrected.`,
            { path: ['routes', draft.sourcePath], severity: 'warning' },
          ),
        );
      }
      return 'not-stored';
    };
    if (found.reading.kind === 'unreadable') {
      return refuse(
        `${found.reading.cause}, so the build cannot read which class it names`,
      );
    }
    if (cachingPolicy !== undefined && !cachingPolicy.readable) {
      return 'not-stored';
    }
    const declared = (
      cachingPolicy?.values ?? DEFAULT_ROUTE_CACHING_VALUES
    ).get(found.reading.value);
    if (declared !== undefined || cachingPolicy !== undefined) return declared;
    return refuse(
      `sets ${JSON.stringify(cachingField)} to ${JSON.stringify(found.reading.value)}, which is neither per-visitor nor not-stored`,
    );
  };
  /**
   * A route's sitemap claim, or nothing.
   *
   * There is no Equator default field here, unlike indexing. A route with no claim is published
   * with its address and its alternates and says nothing more, which is a complete entry; a route
   * with no indexing class has to be sorted into one, because whether a crawler may see it is not a
   * question a document can decline to answer.
   */
  const claimOf = (draft: RouteDraft): RouteProjection['sitemap'] => {
    if (sitemapPolicy === undefined) return undefined;
    const classed = writer(draft, sitemapPolicy.field);
    if (
      classed?.reading.kind === 'unreadable' &&
      firstReport(classed.node, sitemapPolicy.field)
    ) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1412',
          `Route ${address(classed.node, draft)} ${classed.reading.cause}, so the build cannot read which sitemap class it names. It and every route that inherits its data claim nothing in the sitemap until the value is corrected.`,
          { path: ['routes', draft.sourcePath], severity: 'warning' },
        ),
      );
    }
    const declared =
      classed?.reading.kind === 'string'
        ? sitemapPolicy.values.get(classed.reading.value)
        : undefined;
    const lastmodField = sitemapPolicy.lastmodField;
    const dated =
      lastmodField === undefined ? undefined : writer(draft, lastmodField);
    const lastmod =
      dated?.reading.kind === 'string' ? dated.reading.value : undefined;
    if (
      dated !== undefined &&
      lastmodField !== undefined &&
      (lastmod === undefined || !SITEMAP_W3C_DATE.test(lastmod)) &&
      firstReport(dated.node, lastmodField)
    ) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1412',
          dated.reading.kind === 'unreadable'
            ? `Route ${address(dated.node, draft)} ${dated.reading.cause}, so the build cannot read the date it names. It is left out of the sitemap, for this route and every route that inherits its data, until the value is corrected.`
            : `Route ${address(dated.node, draft)} declares ${JSON.stringify(lastmodField)} as ${JSON.stringify(lastmod)}, which is not a W3C date such as 2026-09-08 or 2026-09-08T17:33:30+03:00. It is left out of the sitemap, for this route and every route that inherits its data, rather than written into a document a validator refuses.`,
          { path: ['routes', draft.sourcePath], severity: 'warning' },
        ),
      );
    }
    const claim = {
      ...(declared?.changefreq === undefined
        ? {}
        : { changefreq: declared.changefreq }),
      ...(declared?.priority === undefined
        ? {}
        : { priority: declared.priority }),
      ...(lastmod === undefined || !SITEMAP_W3C_DATE.test(lastmod)
        ? {}
        : { lastmod }),
    };
    return Object.keys(claim).length === 0 ? undefined : Object.freeze(claim);
  };
  // Routes default to indexable, so only the exceptions need naming. An unlisted value is not an
  // error: a consumer's field classifies routes for the consumer's own reasons, and most of those
  // reasons say nothing about indexing. A value the build cannot read is not an unlisted one, and
  // private is the one answer that cannot expose a page its author meant to keep out.
  const classify = (
    draft: RouteDraft,
  ): 'indexable' | 'non-indexable' | 'private' => {
    const found = writer(draft, field);
    if (found === undefined) return 'indexable';
    if (found.reading.kind === 'unreadable') {
      if (firstReport(found.node, field)) {
        diagnostics.push(
          toolkitDiagnostic(
            'EQ1414',
            `Route ${address(found.node, draft)} ${found.reading.cause}, so the build cannot read which indexing class it names. It and every route that inherits its data are answered as private until the value is corrected.`,
            { path: ['routes', draft.sourcePath], severity: 'warning' },
          ),
        );
      }
      return 'private';
    }
    if (policy !== undefined && !policy.readable) return 'private';
    return values.get(found.reading.value) ?? 'indexable';
  };
  // The first draft at an address is the route that consumed its last segment or one on its way
  // down, even where a path is written after its children, because a route's children are written
  // inside it. A route in a named outlet has no address of its own a page could be at.
  const atAddress = new Map<string, RouteDraft[]>();
  for (const draft of drafts) {
    if (!draft.node.inPrimaryOutlet) continue;
    const group = atAddress.get(draft.path);
    if (group === undefined) atAddress.set(draft.path, [draft]);
    else group.push(draft);
  }
  // The page is the route Angular renders at the address. Below the route that consumed the last
  // segment, Angular tries the children in the order they are written, in the primary outlet only,
  // and the first that matches nothing left renders: an empty path or a wildcard. A redirect sends
  // the visitor elsewhere, so nothing below it is the page. Where a `matcher` or a `canMatch`
  // guard decides when the page is visited, or a value the build cannot read decides, the build
  // cannot know which route renders, and answers the address as it answers a value it cannot read.
  const undecided = (child: RouteChild): string | undefined => {
    if (child.matches === 'matcher') {
      return "a child's `matcher`, which runs when the page is visited";
    }
    if (child.matches === 'computed') {
      return 'a child whose `path` is not a string literal';
    }
    if (child.matches === 'unreadable') {
      return 'a child whose `path` or `matcher` a spread or a computed key may set';
    }
    if (child.node.outlet === undefined) {
      return 'a child whose `outlet` the build cannot read';
    }
    if (child.redirects === undefined) {
      return 'a child whose `redirectTo` a spread or a computed key may set';
    }
    // Angular runs no `canMatch` guard on a redirect (`expandSegmentAgainstRouteUsingRedirect`).
    if (child.redirects) return undefined;
    if (child.guarded === undefined) {
      return 'a child whose `canMatch` a spread or a computed key may set';
    }
    return child.guarded
      ? "a child's `canMatch` guard, which runs when the page is visited"
      : undefined;
  };
  // What renders with a page is more than the page. At every level on the way down, Angular gives
  // each named outlet the first empty-path route written for it (`split`,
  // `addEmptyPathsToChildrenIfNeeded`, `createChildrenForEmptyPaths`, `sortByMatchingOutlets`),
  // and that route renders beside the page with whatever renders below it. Where the build cannot
  // tell which route renders, every one that may is counted: a scope loaded and not used costs a
  // download, and one used and not loaded renders text that never arrives.
  const renders = (child: RouteChild, into: Set<string>): void => {
    for (const entry of child.lazyEntries) into.add(entry);
    if (child.redirects === true) return;
    beside(child.node.children, into);
    for (const next of child.node.children) {
      const outlet = next.node.outlet;
      if (outlet !== undefined && outlet !== PRIMARY_OUTLET) continue;
      if (next.matches === 'nothing') continue;
      renders(next, into);
      if (undecided(next) === undefined) break;
    }
  };
  const beside = (children: readonly RouteChild[], into: Set<string>): void => {
    const settled = new Set<string>();
    for (const child of children) {
      const outlet = child.node.outlet;
      if (outlet === PRIMARY_OUTLET) continue;
      if (outlet !== undefined && settled.has(outlet)) continue;
      if (
        child.matches !== 'empty' &&
        child.matches !== 'computed' &&
        child.matches !== 'unreadable'
      ) {
        continue;
      }
      renders(child, into);
      if (
        outlet !== undefined &&
        child.matches === 'empty' &&
        undecided(child) === undefined
      ) {
        settled.add(outlet);
      }
    }
  };
  // The root routes of each table on their own, because the order of two tables spread into one
  // is not read, and counting a route that another table's route displaces only costs a download.
  const rootsByTable = new Map<ts.VariableDeclaration, RouteChild[]>();
  for (const child of rootRoutes) {
    const group = rootsByTable.get(child.node.table);
    if (group === undefined) rootsByTable.set(child.node.table, [child]);
    else group.push(child);
  }
  const besideEveryPage = new Set<string>();
  for (const group of rootsByTable.values()) beside(group, besideEveryPage);
  const pages: RouteDraft[] = [];
  const decided = new Set<RouteDraft>();
  for (const group of atAddress.values()) {
    const top = group[0] as RouteDraft;
    const address = JSON.stringify(`/${top.path}`);
    let page = top;
    let decidedBy: string | undefined;
    descend: for (;;) {
      let taken: RouteChild | undefined;
      for (const child of page.node.children) {
        const outlet = child.node.outlet;
        if (outlet !== undefined && outlet !== PRIMARY_OUTLET) continue;
        if (taken !== undefined) {
          if (
            taken.matches === 'wildcard' &&
            outlet === PRIMARY_OUTLET &&
            child.matches === 'empty'
          ) {
            diagnostics.push(
              toolkitDiagnostic(
                'EQ1405',
                `Route ${address} has a wildcard child written before an empty-path one, and Angular tries them in that order, so the wildcard renders at every address the empty-path child could and the empty-path child never renders. Write the empty-path child before the wildcard.`,
                { path: ['routes', child.sourcePath], severity: 'warning' },
              ),
            );
          }
          continue;
        }
        if (child.matches === 'nothing') continue;
        decidedBy = undecided(child);
        if (decidedBy !== undefined) break descend;
        taken = child;
      }
      if (taken === undefined || taken.redirects === true) break;
      page = Object.freeze({
        node: taken.node,
        path: top.path,
        parameterNames: top.parameterNames,
        lazyEntries: taken.lazyEntries,
        sourcePath: taken.sourcePath,
        start: taken.start,
        end: taken.end,
      });
    }
    const alongside = new Set([...page.lazyEntries, ...besideEveryPage]);
    for (
      let node: RouteNode | undefined = page.node;
      node !== undefined;
      node = node.parent
    ) {
      beside(node.children, alongside);
    }
    if (decidedBy !== undefined) {
      for (const child of page.node.children) {
        const outlet = child.node.outlet;
        if (outlet !== undefined && outlet !== PRIMARY_OUTLET) continue;
        if (child.matches === 'nothing') continue;
        renders(child, alongside);
        if (undecided(child) === undefined) break;
      }
    }
    if (alongside.size > page.lazyEntries.length) {
      page = Object.freeze({
        ...page,
        lazyEntries: Object.freeze([...alongside]),
      });
    }
    if (decidedBy !== undefined) {
      decided.add(page);
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1414',
          `Which route renders ${address} depends on ${decidedBy}, so the build cannot read which indexing class the page has. The address is answered as private.`,
          { path: ['routes', page.sourcePath], severity: 'warning' },
        ),
        toolkitDiagnostic(
          'EQ1413',
          `Which route renders ${address} depends on ${decidedBy}, so the build cannot read which caching class the page has. The address is answered as not-stored.`,
          { path: ['routes', page.sourcePath], severity: 'warning' },
        ),
      );
    }
    pages.push(page);
  }
  // An identity names an address, so the deepest route at the page's address that declares one
  // names it, and no route's identity reaches a child at another address. A wildcard renders at
  // the address without being at it, and an identity it declares would name every address it
  // takes, so it names none of them.
  const declaredIdOf = (draft: RouteDraft): RouteDataReading => {
    let node: RouteNode | undefined = draft.node;
    while (node !== undefined && node.path !== draft.path) node = node.parent;
    for (; node !== undefined && node.path === draft.path; node = node.parent) {
      const reading = node.read('equatorRouteId');
      if (reading.kind !== 'absent') return reading;
    }
    return ABSENT_DATA;
  };

  const named: { readonly id: string; readonly draft: RouteDraft }[] = [];
  for (const draft of pages) {
    const declared = declaredIdOf(draft);
    if (declared.kind === 'unreadable') {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1404',
          `Route ${JSON.stringify(`/${draft.path}`)} ${declared.cause}, so the build cannot read the identity it declares, and it is not indexed until the value is corrected.`,
          { path: ['routes', draft.sourcePath], severity: 'warning' },
        ),
      );
      continue;
    }
    if (declared.kind === 'string') {
      const declaredId = declared.value;
      if (!ROUTE_IDENTITY_PATTERN.test(declaredId)) {
        diagnostics.push(
          toolkitDiagnostic(
            'EQ1404',
            `Route ${JSON.stringify(`/${draft.path}`)} declares the identity ${JSON.stringify(declaredId)}, which the localization runtime will refuse. An identity begins with a letter or digit and continues with letters, digits, and ".", "_", ":", or "-", up to 128 characters.`,
            { path: ['routes', draft.sourcePath], severity: 'warning' },
          ),
        );
        continue;
      }
      named.push({ id: declaredId, draft });
      continue;
    }
    const identity = routeIdentity(draft.path);
    if (identity === undefined) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1404',
          `Equator could not derive a stable identity for route ${JSON.stringify(`/${draft.path}`)}. Declare one as \`data.equatorRouteId\` to index it.`,
          { path: ['routes', draft.sourcePath], severity: 'warning' },
        ),
      );
      continue;
    }
    named.push({ id: identity, draft });
  }

  const byIdentity = new Map<string, RouteDraft[]>();
  for (const entry of named) {
    const group = byIdentity.get(entry.id);
    if (group === undefined) byIdentity.set(entry.id, [entry.draft]);
    else group.push(entry.draft);
  }

  const projections: RouteProjection[] = [];
  for (const entry of named) {
    const group = byIdentity.get(entry.id) as RouteDraft[];
    if (group.length > 1) {
      if (group[0] === entry.draft) {
        diagnostics.push(
          toolkitDiagnostic(
            'EQ1404',
            `Routes ${group.map(({ path }) => JSON.stringify(`/${path}`)).join(', ')} all resolve to the identity ${JSON.stringify(entry.id)}. Declare \`data.equatorRouteId\` on each to separate them; none is indexed until they differ.`,
            { path: ['routes', entry.draft.sourcePath], severity: 'warning' },
          ),
        );
      }
      continue;
    }
    const {
      node: _node,
      lazyEntries: _lazyEntries,
      ...projected
    } = entry.draft;
    // Asked once. It reports a malformed date, so a second call would report it twice.
    const claim = claimOf(entry.draft);
    // Asked once for the same reason: it reports a value it cannot use.
    const caching = cachingOf(entry.draft);
    const indexing = classify(entry.draft);
    // Still read above, so a value the route writes that cannot be used is reported either way.
    const certain = !decided.has(entry.draft);
    projections.push(
      Object.freeze({
        id: entry.id,
        ...projected,
        indexing: certain ? indexing : 'private',
        ...(!certain
          ? { caching: 'not-stored' as const }
          : caching === undefined
            ? {}
            : { caching }),
        ...(claim === undefined || !certain ? {} : { sitemap: claim }),
        deferredSourcePaths: deferredFor(entry.draft),
      }),
    );
  }
  return projections;
}

/** What decides a route's address, as far as its source says. */
type RouteAddress =
  | { readonly kind: 'literal'; readonly path: ts.StringLiteralLike }
  | {
      readonly kind: 'hidden';
      readonly reason: 'computed' | 'matcher' | 'unreadable';
    }
  | { readonly kind: 'refused'; readonly reason: 'neither' }
  | {
      readonly kind: 'refused';
      readonly reason: 'both';
      readonly path: ts.StringLiteralLike;
    };

function analyzeRoutes(
  projectRoot: string,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  routes: RouteDraft[],
  rootRoutes: RouteChild[],
  program: ts.Program,
  lazyEntryFiles: Set<ts.SourceFile>,
  diagnostics: ToolkitDiagnostic[],
  childRouteFiles: Set<string>,
  tables: Set<ts.VariableDeclaration>,
  references: RouteTableReference[],
): void {
  const unwrap = (expression: ts.Expression): ts.Expression => {
    let current = expression;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  };
  const property = (
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.PropertyAssignment | undefined =>
    object.properties.find(
      (item): item is ts.PropertyAssignment =>
        ts.isPropertyAssignment(item) &&
        ((ts.isIdentifier(item.name) && item.name.text === name) ||
          (ts.isStringLiteralLike(item.name) && item.name.text === name)),
    );
  const setter = (
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.ObjectLiteralElementLike | 'absent' | 'unreadable' =>
    keySetter(checker, object, name);
  // Angular asks whether `component` or `loadComponent` holds something (`getInherited`), so a
  // value whose type allows `undefined` or `null` is not certain, and neither is one a spread or a
  // computed key may set.
  const rendersComponent = (object: ts.ObjectLiteralExpression): boolean =>
    ['component', 'loadComponent'].some((name) => {
      const item = setter(object, name);
      if (typeof item === 'string') return false;
      if (ts.isMethodDeclaration(item)) return true;
      const symbol = ts.isPropertyAssignment(item)
        ? undefined
        : ts.isShorthandPropertyAssignment(item)
          ? checker.getShorthandAssignmentValueSymbol(item)
          : undefined;
      const type = ts.isPropertyAssignment(item)
        ? checker.getTypeAtLocation(item.initializer)
        : symbol === undefined
          ? undefined
          : checker.getTypeOfSymbolAtLocation(symbol, item);
      return (
        type !== undefined &&
        !(type.isUnion() ? type.types : [type]).some(
          (member) =>
            (member.flags &
              (ts.TypeFlags.Undefined |
                ts.TypeFlags.Null |
                ts.TypeFlags.Void |
                ts.TypeFlags.Any |
                ts.TypeFlags.Unknown)) !==
            0,
        )
      );
    });
  // Angular's rule for what decides a route's address. `match` (`@angular/router` 22.2.1) matches
  // an empty `path` without
  // consuming a segment whatever else the route carries, and any other route by its `matcher` when
  // it has one and by its `path` otherwise. `validateNode` refuses a route with neither, and one
  // with a `matcher` beside a non-empty `path`, in a development build only.
  const routeAddress = (object: ts.ObjectLiteralExpression): RouteAddress => {
    const path = setter(object, 'path');
    const matcher = setter(object, 'matcher');
    const value =
      typeof path !== 'string' && ts.isPropertyAssignment(path)
        ? unwrap(path.initializer)
        : undefined;
    const literalPath =
      value !== undefined && ts.isStringLiteralLike(value) ? value : undefined;
    if (literalPath?.text === '') return { kind: 'literal', path: literalPath };
    if (matcher === 'unreadable') {
      return { kind: 'hidden', reason: 'unreadable' };
    }
    if (matcher !== 'absent') {
      return literalPath === undefined
        ? { kind: 'hidden', reason: 'matcher' }
        : { kind: 'refused', reason: 'both', path: literalPath };
    }
    if (path === 'absent') return { kind: 'refused', reason: 'neither' };
    if (path === 'unreadable') return { kind: 'hidden', reason: 'unreadable' };
    return literalPath === undefined
      ? { kind: 'hidden', reason: 'computed' }
      : { kind: 'literal', path: literalPath };
  };
  // Only an empty path and a bare wildcard match an address with nothing left in it
  // (`defaultUrlMatcher`, `@angular/router` 22.2.1), so a `path` Equator
  // does not name is still known to match nothing there when the `const` it names says so.
  const matchesNothingLeft = (
    object: ts.ObjectLiteralExpression,
    declared: RouteAddress,
  ): RouteChild['matches'] => {
    if (declared.kind === 'literal') {
      const path = declared.path.text;
      return path === '' ? 'empty' : path === '**' ? 'wildcard' : 'nothing';
    }
    if (declared.kind === 'refused') {
      return declared.reason === 'both' ? 'matcher' : 'nothing';
    }
    if (declared.reason !== 'computed') return declared.reason;
    const written = setter(object, 'path');
    const path =
      typeof written === 'string'
        ? undefined
        : ts.isPropertyAssignment(written)
          ? stringThrough(checker, written.initializer)
          : ts.isShorthandPropertyAssignment(written)
            ? stringThrough(checker, written)
            : undefined;
    return path === undefined || path === '' || path === '**'
      ? 'computed'
      : 'nothing';
  };
  // Angular's own reading (`getOutlet`): a route that names no outlet, or names an empty one,
  // renders in the primary outlet.
  const outletOf = (object: ts.ObjectLiteralExpression): string | undefined => {
    const written = setter(object, 'outlet');
    if (written === 'absent') return PRIMARY_OUTLET;
    const outlet =
      typeof written === 'string'
        ? undefined
        : ts.isPropertyAssignment(written)
          ? stringThrough(checker, written.initializer)
          : ts.isShorthandPropertyAssignment(written)
            ? stringThrough(checker, written)
            : undefined;
    return outlet === '' ? PRIMARY_OUTLET : outlet;
  };
  // An empty list guards nothing (`runCanMatchGuards`, `@angular/router` 22.2.1).
  const guardedOf = (
    object: ts.ObjectLiteralExpression,
  ): boolean | undefined => {
    const written = setter(object, 'canMatch');
    if (written === 'absent') return false;
    if (written === 'unreadable') return undefined;
    const guards = ts.isPropertyAssignment(written)
      ? throughBindings(checker, written.initializer, new Set())
      : ts.isShorthandPropertyAssignment(written)
        ? throughBindings(checker, written, new Set())
        : undefined;
    return !(
      guards !== undefined &&
      ts.isArrayLiteralExpression(guards) &&
      guards.elements.length === 0
    );
  };
  // Reported once for the whole of a subtree Equator does not name because of its outlet.
  const outletReported = new Set<RouteNode>();
  const join = (parent: string, child: string): string =>
    [parent, child].filter((segment) => segment.length > 0).join('/');
  const portableSourcePath = portablePath(projectRoot, sourceFile.fileName);
  // Only a table the pass below visits on its own has routes of its own in the projection.
  const routeTableOf = (
    symbol: ts.Symbol | undefined,
  ): ts.VariableDeclaration | undefined => {
    const declaration = symbol?.valueDeclaration;
    return declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableStatement(declaration.parent.parent) &&
      ts.isSourceFile(declaration.parent.parent.parent) &&
      !declaration.parent.parent.parent.isDeclarationFile &&
      isRoutesContract(checker, declaration) !== undefined
      ? declaration
      : undefined;
  };
  const routeTable = (
    expression: ts.Expression,
  ): ts.VariableDeclaration | undefined => {
    const target = unwrap(expression);
    return ts.isIdentifier(target) || ts.isPropertyAccessExpression(target)
      ? routeTableOf(resolvedSymbol(checker, target))
      : undefined;
  };
  const named = (expression: ts.Expression): string => {
    const target = unwrap(expression);
    if (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target)) {
      return `\`${target.getText(sourceFile)}\``;
    }
    return ts.isCallExpression(target) &&
      (ts.isIdentifier(target.expression) ||
        ts.isPropertyAccessExpression(target.expression))
      ? `a call to \`${target.expression.getText(sourceFile)}\``
      : 'an expression';
  };
  const outside = (message: string): void => {
    diagnostics.push(
      toolkitDiagnostic('EQ1406', message, {
        path: ['routes', portableSourcePath],
        severity: 'warning',
      }),
    );
  };
  // `parentPath` has no default on purpose: `undefined` means "an address Equator cannot know", and
  // a default would quietly turn that into the root, naming a whole subtree as if it sat at the
  // top of the application.
  //
  // A route the table names through something else, a spread, a binding or a call, is reported
  // rather than followed, because `specs/07-routing-rendering-and-seo.spec.md` section 1 leaves
  // such a route to the application. Where the array's own address is unknown the report above it
  // already covers everything below.
  const visitArray = (
    array: ts.ArrayLiteralExpression,
    parentPath: string | undefined,
    parentLazyEntries: readonly string[],
    parent: RouteNode | undefined,
    where: string,
    table: ts.VariableDeclaration,
  ): void => {
    for (const element of array.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isSpreadElement(element)) {
        const target = routeTable(element.expression);
        if (target !== undefined) {
          references.push({
            from: table,
            to: target,
            atRoot: parent === undefined,
          });
        }
        // A table spread in among the root routes of another is visited on its own, at the root,
        // which is where the spread puts it.
        if (
          parentPath !== undefined &&
          (target === undefined || parent !== undefined)
        ) {
          outside(
            `A spread of ${named(element.expression)} in ${where} brings in routes Equator does not follow, so their addresses stay outside the localized route table and are served at their canonical spelling, in the default locale. Declare those routes inline to localize them.`,
          );
        }
        continue;
      }
      const unwrapped = unwrap(element);
      if (!ts.isObjectLiteralExpression(unwrapped)) {
        if (parentPath !== undefined) {
          outside(
            `An entry of ${where} is written as ${named(element)}, which Equator does not follow, so its address stays outside the localized route table and is served at its canonical spelling, in the default locale. Declare the route inline to localize it.`,
          );
        }
        continue;
      }
      const declared = routeAddress(unwrapped);
      // An empty `path` renders without contributing a URL segment, so the route has its parent's
      // address rather than none. An address Equator cannot read leaves the subtree below it
      // unnameable rather than invisible. Ending the visit at either hides every route beneath
      // it, and with them every lazy boundary beneath it: those messages then load eagerly,
      // forever, with nothing to say so.
      const ownPath =
        declared.kind === 'literal' ? declared.path.text : undefined;
      const fullPath =
        parentPath === undefined || ownPath === undefined
          ? undefined
          : join(parentPath, ownPath);
      // Where Angular splits the bundle. A dynamic import in either position means the code,
      // and therefore the messages, behind this route are not part of the first render. Read
      // before the route is recorded, because which boundary a route sits behind is part of what
      // is recorded about it.
      const ownEntries: string[] = [];
      let defersChildRoutes = false;
      for (const name of ['loadComponent', 'loadChildren']) {
        const loader = property(unwrapped, name)?.initializer;
        if (loader === undefined) continue;
        if (name === 'loadChildren') defersChildRoutes = true;
        const specifier = dynamicImportSpecifier(unwrap(loader));
        const target =
          specifier === undefined
            ? undefined
            : resolveModule(program, sourceFile, specifier);
        if (target !== undefined && !target.isDeclarationFile) {
          lazyEntryFiles.add(target);
          ownEntries.push(normalizePath(target.fileName));
          // A file reached through `loadChildren` holds child routes, and it declares them as a
          // `Routes` constant like any other route file. The pass over every source file would
          // therefore visit it as a route table of its own, with no parent, and project `detail`
          // where the application serves `section/detail`. Recorded here and dropped after the
          // walk, because that file may be visited before the route that references it.
          if (name === 'loadChildren') {
            childRouteFiles.add(portablePath(projectRoot, target.fileName));
          }
        }
      }
      const lazyEntries =
        ownEntries.length === 0
          ? parentLazyEntries
          : Object.freeze([...parentLazyEntries, ...ownEntries]);

      const redirect = property(unwrapped, 'redirectTo');
      const children = setter(unwrapped, 'children');
      const outlet = outletOf(unwrapped);
      const node: RouteNode = Object.freeze({
        parent,
        path: fullPath,
        table,
        read: (field: string) => routeDataReading(checker, unwrapped, field),
        inheritsUnderEitherStrategy:
          ownPath === '' || parent?.rendersComponent === false,
        rendersComponent: rendersComponent(unwrapped),
        outlet,
        inPrimaryOutlet:
          (parent?.inPrimaryOutlet ?? true) && outlet === PRIMARY_OUTLET,
        children: [],
      });
      const redirects = setter(unwrapped, 'redirectTo');
      (parent?.children ?? rootRoutes).push(
        Object.freeze({
          node,
          matches: matchesNothingLeft(unwrapped, declared),
          redirects:
            redirects === 'absent'
              ? false
              : redirects === 'unreadable'
                ? undefined
                : true,
          guarded: guardedOf(unwrapped),
          lazyEntries,
          sourcePath: portableSourcePath,
          start:
            declared.kind === 'literal'
              ? declared.path.getStart(sourceFile)
              : unwrapped.getStart(sourceFile),
          end:
            declared.kind === 'literal'
              ? declared.path.getEnd()
              : unwrapped.getEnd(),
        }),
      );
      const spelled = 'path' in declared ? declared.path.text : undefined;
      const address =
        fullPath !== undefined
          ? JSON.stringify(`/${fullPath}`)
          : spelled !== undefined
            ? JSON.stringify(
                parentPath === undefined
                  ? `\u2026/${spelled}`
                  : `/${join(parentPath, spelled)}`,
              )
            : parentPath !== undefined
              ? `A route under ${JSON.stringify(`/${parentPath}`)}`
              : 'A route below an address Equator cannot read';

      // Angular's own rule, restated where it runs.
      //
      // `validateNode` throws on a route carrying none of these (`@angular/router` 22.2.1), and
      // every throw in it sits inside `if (typeof ngDevMode === 'undefined' || ngDevMode)`, the
      // condition both calls of `validateConfig` carry too. A production build validates no route
      // config at all: a route nothing can render ships, and surfaces only for whoever next runs a
      // development build. Equator reads the same table at generate time, before either build, and
      // is the only thing standing between such a route and the projection, which would otherwise
      // give it an identity, a localized spelling per locale, and a place in the catalog.
      //
      // Read through `setter`, because a key a spread supplies is still a key Angular sees.
      if (
        [
          'component',
          'loadComponent',
          'redirectTo',
          'children',
          'loadChildren',
        ].every((name) => setter(unwrapped, name) === 'absent')
      ) {
        diagnostics.push(
          toolkitDiagnostic(
            'EQ1405',
            `${address} carries none of \`component\`, \`loadComponent\`, \`redirectTo\`, \`children\` or \`loadChildren\`, so nothing renders it. Angular refuses this route too, but only in a development build.`,
            { path: ['routes', portableSourcePath] },
          ),
        );
      }
      // The same reasoning for what matches the route: a production build would otherwise ship a
      // route no address reaches, or one the projection places where the application does not
      // serve it.
      if (declared.kind === 'refused') {
        diagnostics.push(
          toolkitDiagnostic(
            'EQ1415',
            declared.reason === 'neither'
              ? `${address} has neither a \`path\` nor a \`matcher\`, so no address matches it. Angular refuses this route too, but only in a development build.`
              : `${address} has both a non-empty \`path\` and a \`matcher\`. Angular refuses that in a development build, and a production build matches the route with the \`matcher\`, so the \`path\` names an address the route does not serve.`,
            { path: ['routes', portableSourcePath] },
          ),
        );
      }

      // What the projection cannot reach, said out loud.
      //
      // Equator localizes the routes its analysis can name, and a route it was never shown is not
      // one of them. Two kinds of construct hide addresses and neither is exotic. A route whose
      // source does not spell its address, through a `path` that is not a string literal, a
      // `matcher`, or a spread or computed key that may set either, makes the route and everything
      // beneath it unnameable. `loadChildren` puts the child table in a file this one only
      // references. The consequence is not a missing page, the Router serves it either way, but a
      // prerendered file at a localized address rendered in the default locale, which is worse than
      // no file, because it looks right.
      //
      // Diagnosed rather than covered, deliberately. Following the `loadChildren` target would
      // close this instance and none of the class: a table assembled at runtime, spread in from a
      // helper, or returned by a function hides routes in exactly the same way and would each need
      // their own reader. What Equator owes is to know which routes it covers and to be loud about
      // the rest.
      //
      // A warning rather than a refusal, and the deciding reason is what a check can be made to
      // fail on rather than any argument about `loadChildren`.
      //
      // `analyzeApplication` returns `toolkitFailure` on any error-severity diagnostic, and it
      // returns there **before** the lazy closure is computed and before any value reaches a caller.
      // So at error severity two behaviours below this line stop being observable: the boundary
      // reading under an unnameable address, which decides whether those messages defer, and the
      // drop that stops a child route table from being projected at an address the application does
      // not serve. Both still run in the sense that the code is there. Neither can be tested, because
      // every test of them reaches the same early return this diagnostic causes.
      //
      // The check and the thing it checks share a source here, in a shape that is not a test:
      // this function's own failure path, so the check agrees by construction and stays green
      // either way. With `EQ1406` at error severity, disabling the drop entirely changes no test
      // in the suite. At warning severity the same mutation fails, reporting `route:detail` beside
      // `route:section`. A severity that makes its own neighbours unfalsifiable is the wrong
      // severity whatever else recommends it.
      //
      // The rest of the case, which would not have been enough on its own: `loadChildren` is
      // ordinary, supported Angular, and refusing to generate on it would mean no application
      // containing one anywhere can adopt Equator at all, with "restructure your routing" as the
      // only remedy. That is a wall rather than a limit, and Equator is meant to sit in
      // applications it did not design. What is required is that this not be silent, and a named
      // warning carrying the route, the consequence and the remedy is not silence.
      if (parentPath !== undefined && declared.kind === 'hidden') {
        const [cause, remedy] = {
          computed: [
            'computes its `path`',
            'Give the route a string-literal `path`',
          ],
          matcher: [
            'matches its addresses with a `matcher`',
            'Give the route a string-literal `path` where one can express its addresses',
          ],
          unreadable: [
            'may take its `path` or `matcher` from a spread or a computed key',
            'Write the route its own string-literal `path`',
          ],
        }[declared.reason];
        diagnostics.push(
          toolkitDiagnostic(
            'EQ1406',
            `${address} ${cause}, so Equator can name neither it nor anything below it. Those addresses stay outside the localized route table and are served at their canonical spelling, in the default locale. ${remedy}, or keep the subtree out of the localized table on purpose.`,
            { path: ['routes', portableSourcePath], severity: 'warning' },
          ),
        );
      }
      // A route in a named outlet renders beside a page rather than as one, and the part of a URL
      // that addresses an outlet is not a page address, so none of it is in the localized route
      // table. Said once, at the subtree's first route with an address of its own, because a
      // named empty-path route with nothing below it is how a layout renders beside every page.
      let covered = false;
      for (
        let above = parent;
        above !== undefined && !above.inPrimaryOutlet;
        above = above.parent
      ) {
        covered ||= outletReported.has(above);
      }
      if (parentPath !== undefined && declared.kind === 'literal' && !covered) {
        if (outlet === undefined) {
          outletReported.add(node);
          outside(
            `${address} may take its \`outlet\` from a spread, a computed key or a value the build cannot read, so Equator cannot tell whether it renders as a page or beside one, and names neither it nor anything below it. Write its \`outlet\` as a string literal, or leave it out for the primary outlet.`,
          );
        } else if (!node.inPrimaryOutlet && ownPath !== '') {
          let named: RouteNode = node;
          while (
            named.outlet === PRIMARY_OUTLET &&
            named.parent !== undefined
          ) {
            named = named.parent;
          }
          outletReported.add(node);
          outside(
            `The route ${JSON.stringify(ownPath)} under ${JSON.stringify(`/${parentPath}`)} renders in the named outlet ${JSON.stringify(named.outlet)}, beside a page rather than as one, so Equator names neither it nor anything below it, and the addresses it takes in that outlet stay outside the localized route table.`,
          );
        }
      }
      if (defersChildRoutes) {
        diagnostics.push(
          toolkitDiagnostic(
            'EQ1406',
            `${address} loads its children through \`loadChildren\`, so their addresses live in a file this route only references and stay outside the localized route table. They are served at their canonical spelling, in the default locale, including under a locale prefix, where the address looks localized and the page is not. Declare those children inline to localize them.`,
            { path: ['routes', portableSourcePath], severity: 'warning' },
          ),
        );
      }

      if (
        redirect === undefined &&
        fullPath !== undefined &&
        declared.kind === 'literal' &&
        // A wildcard matches every address, at any depth, so it names none of them.
        !routeSegments(fullPath).includes('**')
      ) {
        routes.push(
          Object.freeze({
            node,
            path: fullPath,
            parameterNames: Object.freeze(
              fullPath
                .split('/')
                .filter((segment) => segment.startsWith(':'))
                .map((segment) => segment.slice(1)),
            ),
            lazyEntries,
            sourcePath: portableSourcePath,
            start: declared.path.getStart(sourceFile),
            end: declared.path.getEnd(),
          }),
        );
      }
      if (children === 'unreadable') {
        if (fullPath !== undefined) {
          outside(
            `${address} may take its \`children\` from a spread or a computed key, which Equator does not follow, so the addresses below it stay outside the localized route table and are served at their canonical spelling, in the default locale. Write the route its own \`children\` array to localize them.`,
          );
        }
      } else if (children !== 'absent') {
        const list = ts.isPropertyAssignment(children)
          ? unwrap(children.initializer)
          : undefined;
        if (list !== undefined && ts.isArrayLiteralExpression(list)) {
          visitArray(
            list,
            fullPath,
            lazyEntries,
            node,
            fullPath === undefined
              ? 'the children of a route'
              : `the children of ${JSON.stringify(`/${fullPath}`)}`,
            table,
          );
        } else {
          const target =
            list !== undefined
              ? routeTable(list)
              : ts.isShorthandPropertyAssignment(children)
                ? routeTableOf(
                    checker.getShorthandAssignmentValueSymbol(children),
                  )
                : undefined;
          if (target !== undefined) {
            references.push({ from: table, to: target, atRoot: false });
          }
          if (fullPath !== undefined) {
            outside(
              `${address} takes its children from ${list !== undefined ? named(list) : ts.isShorthandPropertyAssignment(children) ? named(children.name) : 'an expression'}, which Equator does not follow, so their addresses stay outside the localized route table and are served at their canonical spelling, in the default locale. Declare those children inline to localize them.`,
            );
          }
        }
      }
    }
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const expression = isRoutesContract(checker, declaration);
      if (expression === undefined) continue;
      tables.add(declaration);
      const list = unwrap(expression);
      const name = `\`${declaration.name.getText(sourceFile)}\``;
      if (ts.isArrayLiteralExpression(list)) {
        visitArray(
          list,
          '',
          [],
          undefined,
          `the route table ${name}`,
          declaration,
        );
        continue;
      }
      const target = routeTable(list);
      if (target !== undefined) {
        references.push({ from: declaration, to: target, atRoot: true });
        continue;
      }
      outside(
        `The route table ${name} is written as ${named(list)}, which Equator does not follow, so its addresses stay outside the localized route table and are served at their canonical spelling, in the default locale. Declare its routes as an array literal to localize them.`,
      );
    }
  }
}

function sourceMap(
  sources: readonly AnalysisSource[],
): ReadonlyMap<string, string> {
  return new Map(
    sources.map((source) => [normalizePath(source.path), source.contents]),
  );
}

export function analyzeApplication(
  request: ApplicationAnalysisRequest,
): ToolkitResult<ApplicationAnalysis> {
  const hostCompatibility = admitHostCompatibility();
  if (!hostCompatibility.ok) return hostCompatibility;
  const projectRoot = resolve(request.projectRoot);
  const diagnostics: ToolkitDiagnostic[] = [];
  const suppliedSources = sourceMap(request.sources ?? []);
  const virtualRoot = resolve(projectRoot, '.equator-virtual');
  const virtualPaths = new Map<string, string>();
  const virtualSources = new Map<string, string>();
  for (const module of request.virtualModules ?? []) {
    if (!module.specifier.startsWith('#i18n')) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1403',
          `Virtual analysis module ${JSON.stringify(module.specifier)} is outside the generated #i18n namespace.`,
        ),
      );
      continue;
    }
    // Sliced by the prefix's own length, so the path spells the module a finding is located in.
    const suffix =
      module.specifier === '#i18n'
        ? 'index'
        : module.specifier.slice('#i18n/'.length);
    const path = resolve(virtualRoot, `${suffix}.ts`);
    virtualPaths.set(module.specifier, path);
    virtualSources.set(normalizePath(path), module.contents);
  }
  if (diagnostics.length > 0) return toolkitFailure(diagnostics);

  // Used only when the owner exposes no selectable TypeScript configuration.
  // A consumer that has one governs its own program.
  const fallbackOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    experimentalDecorators: true,
    strict: true,
    baseUrl: projectRoot,
  };
  const virtualPathEntries = [...virtualPaths.entries()].map(
    ([specifier, path]): [string, string[]] => [specifier, [path]],
  );
  // Generated #i18n specifiers overlay the consumer's own aliases rather than
  // replacing them; discarding the consumer's paths would leave real imports
  // unresolved and degrade every type the analysis depends on.
  const compilerOptions: ts.CompilerOptions = {
    ...(request.compilerOptions ?? fallbackOptions),
    noEmit: true,
    ignoreDeprecations: '6.0',
    paths: {
      ...(request.compilerOptions?.paths ?? {}),
      ...Object.fromEntries(virtualPathEntries),
    },
    ...(request.typeNames === undefined
      ? {}
      : { types: [...request.typeNames] }),
  };
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const suppliedDirectories = new Set(
    [...suppliedSources.keys(), ...virtualSources.keys()].map((path) =>
      normalizePath(dirname(path)),
    ),
  );
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (path) => {
      const normalized = normalizePath(path);
      return (
        suppliedSources.has(normalized) ||
        virtualSources.has(normalized) ||
        defaultHost.fileExists(path)
      );
    },
    readFile: (path) => {
      const normalized = normalizePath(path);
      return (
        suppliedSources.get(normalized) ??
        virtualSources.get(normalized) ??
        defaultHost.readFile(path)
      );
    },
    directoryExists: (path) =>
      suppliedDirectories.has(normalizePath(path)) ||
      (defaultHost.directoryExists?.(path) ?? false),
    getSourceFile: (
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      const normalized = normalizePath(fileName);
      const contents =
        suppliedSources.get(normalized) ?? virtualSources.get(normalized);
      return contents === undefined
        ? defaultHost.getSourceFile(
            fileName,
            languageVersion,
            onError,
            shouldCreateNewSourceFile,
          )
        : ts.createSourceFile(fileName, contents, languageVersion, true);
    },
  };
  const program = ts.createProgram({
    rootNames: request.rootNames.map((path) =>
      isAbsolute(path) ? path : resolve(projectRoot, path),
    ),
    options: compilerOptions,
    host,
  });
  const maximum = Math.max(1, Math.min(request.maxDiagnostics ?? 100, 1000));
  // A defect inside a generated #i18n module is Equator's own and must block.
  // A finding in consumer source is reported for visibility but never blocks:
  // the consumer's build is the authority on whether their application
  // compiles, and generation must stay reachable so a missing #i18n contract
  // can always be restored.
  const virtualModulePaths = new Set(virtualSources.keys());
  const isOwned = (diagnostic: ts.Diagnostic): boolean =>
    diagnostic.file !== undefined &&
    virtualModulePaths.has(normalizePath(diagnostic.file.fileName));

  // The cap is a bound on reporting volume, and volume comes from consumer source. Partitioning
  // before truncating keeps it from doing two things it was never meant to do: discarding Equator's
  // own errors because enough consumer findings sorted ahead of them, and turning a pile of
  // individually non-blocking findings into one blocking result.
  const preEmit = ts.getPreEmitDiagnostics(program);
  const owned = preEmit.filter(isOwned);
  const consumerOwned = preEmit.filter((diagnostic) => !isOwned(diagnostic));

  diagnostics.push(
    ...owned.map((diagnostic) =>
      typeScriptDiagnostic(projectRoot, diagnostic, 'error'),
    ),
    ...consumerOwned
      .slice(0, maximum)
      .map((diagnostic) =>
        typeScriptDiagnostic(projectRoot, diagnostic, 'warning'),
      ),
  );

  if (consumerOwned.length > maximum) {
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1401',
        `TypeScript analysis reported the first ${maximum} of ${consumerOwned.length} findings in consumer source.`,
        // A truncation notice inherits the severity of what it truncated. These are the consumer's
        // own findings, which do not block, so neither does the notice that there were more of
        // them. Reporting it as an error is what made a large refactor unable to generate.
        { severity: 'warning' },
      ),
    );
  }

  const checker = program.getTypeChecker();
  const knownIdentities = new Set(request.knownMessageIdentities ?? []);
  const usages: MessageUsage[] = [];
  const recoveryMessageIdentities = new Set<string>();
  let selectsApplicationRuntime = false;
  let declaredRouteIndexing: RouteIndexingPolicy | undefined;
  let declaredRouteSitemap: RouteSitemapPolicy | undefined;
  let declaredRouteCaching: RouteCachingPolicy | undefined;
  let declaredRoutePolicy: RoutePolicyDeclaration | undefined;
  const routerConfigurations: {
    readonly strategy: RouterStrategyReading;
    readonly sourcePath: string;
  }[] = [];
  const routes: RouteDraft[] = [];
  const rootRoutes: RouteChild[] = [];
  const lazyEntryFiles = new Set<ts.SourceFile>();
  const childRouteFiles = new Set<string>();
  const routeTables = new Set<ts.VariableDeclaration>();
  const routeTableReferences: RouteTableReference[] = [];
  const components: ComponentTemplateAnalysis[] = [];
  const localeMentions: TemplateLocaleMention[] = [];
  const templateAddresses: TemplateAddress[] = [];
  const seenUsage = new Set<string>();
  const addUsage = (
    identity: string,
    sourcePath: string,
    start: number,
    end: number,
    surface: MessageUsage['surface'],
  ): void => {
    const key = `${surface}\u0000${sourcePath}\u0000${start}\u0000${identity}`;
    if (seenUsage.has(key)) return;
    seenUsage.add(key);
    if (knownIdentities.size > 0 && !knownIdentities.has(identity)) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1403',
          `Static analysis resolved unknown generated message identity ${JSON.stringify(identity)}.`,
          { path: ['message', identity] },
        ),
      );
      return;
    }
    usages.push(Object.freeze({ identity, sourcePath, start, end, surface }));
  };

  for (const sourceFile of program.getSourceFiles()) {
    const normalized = normalizePath(sourceFile.fileName);
    if (
      sourceFile.isDeclarationFile ||
      normalized.startsWith(`${normalizePath(virtualRoot)}/`)
    ) {
      continue;
    }
    const portableSourcePath = portablePath(projectRoot, sourceFile.fileName);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        propertyStringLiteral(
          checker,
          checker.getTypeAtLocation(node),
          'ɵkind',
          node,
        ) === 'recovery-message'
      ) {
        const argument = node.arguments[0];
        // Both, because both are compiled into the payload and a retry label the analysis missed
        // would leave the control unnamed in every locale but the source one.
        for (const property of ['message', 'retryLabel']) {
          const identity =
            argument === undefined
              ? undefined
              : propertyMessageIdentity(checker, argument, property);
          if (identity !== undefined) recoveryMessageIdentities.add(identity);
        }
      }
      if (ts.isCallExpression(node)) {
        if (
          isLocalizationProviderCall(checker, node, normalizePath(virtualRoot))
        ) {
          selectsApplicationRuntime = true;
        }
        const policy = routePolicyDeclaration(
          projectRoot,
          checker,
          sourceFile,
          node,
        );
        if (policy !== undefined) {
          if (declaredRoutePolicy === undefined) {
            declaredRoutePolicy = policy;
          } else {
            // Two policies in one owner is not automatically wrong, a test fixture builds extra
            // ones, but only one can be the application's, and Equator cannot tell which. Reported
            // rather than guessed at, and the first is the one carried forward, matching what the
            // indexing field above does when it meets the same situation.
            diagnostics.push(
              toolkitDiagnostic(
                'EQ1408',
                `This owner builds more than one locale URL policy, so Equator cannot tell which one states the application's locales. The first is the one it checked. Build the application's policy once and pass that object where it is needed.`,
                { path: ['routes', portableSourcePath], severity: 'warning' },
              ),
            );
          }
        }
        const declaredSitemap = routeSitemapPolicy(checker, node);
        if (declaredSitemap !== undefined) {
          for (const refusal of declaredSitemap.refusals) {
            diagnostics.push(
              toolkitDiagnostic(
                'EQ1412',
                `This owner's sitemap declaration cannot be used as written: ${refusal}.`,
                { path: ['routes', portableSourcePath], severity: 'warning' },
              ),
            );
          }
          const policy = declaredSitemap.policy;
          if (policy !== undefined) {
            if (declaredRouteSitemap === undefined) {
              declaredRouteSitemap = policy;
            } else if (declaredRouteSitemap.field !== policy.field) {
              diagnostics.push(
                toolkitDiagnostic(
                  'EQ1412',
                  `This owner declares two route sitemap fields, ${JSON.stringify(declaredRouteSitemap.field)} and ${JSON.stringify(policy.field)}. One owner classifies its routes one way; the first declaration is the one Equator used.`,
                  { path: ['routes', portableSourcePath], severity: 'warning' },
                ),
              );
            }
          }
        }
        const declaredCaching = routeCachingPolicy(checker, node);
        if (declaredCaching !== undefined) {
          for (const refusal of declaredCaching.refusals) {
            diagnostics.push(
              toolkitDiagnostic(
                'EQ1413',
                `This owner's caching declaration cannot be used as written: ${refusal}.`,
                { path: ['routes', portableSourcePath], severity: 'warning' },
              ),
            );
          }
          const policy = declaredCaching.policy;
          if (policy !== undefined) {
            if (declaredRouteCaching === undefined) {
              declaredRouteCaching = policy;
            } else if (declaredRouteCaching.field !== policy.field) {
              diagnostics.push(
                toolkitDiagnostic(
                  'EQ1413',
                  `This owner declares two route caching fields, ${JSON.stringify(declaredRouteCaching.field)} and ${JSON.stringify(policy.field)}. One owner classifies its routes one way; the first declaration is the one Equator used.`,
                  { path: ['routes', portableSourcePath], severity: 'warning' },
                ),
              );
            }
          }
        }
        const declaredIndexing = routeIndexingPolicy(checker, node);
        if (declaredIndexing !== undefined) {
          for (const refusal of declaredIndexing.refusals) {
            diagnostics.push(
              toolkitDiagnostic(
                'EQ1414',
                `This owner's indexing declaration cannot be used as written: ${refusal}.`,
                { path: ['routes', portableSourcePath], severity: 'warning' },
              ),
            );
          }
          const policy = declaredIndexing.policy;
          if (policy !== undefined) {
            if (declaredRouteIndexing === undefined) {
              declaredRouteIndexing = policy;
            } else if (declaredRouteIndexing.field !== policy.field) {
              diagnostics.push(
                toolkitDiagnostic(
                  'EQ1404',
                  `This owner declares two route indexing fields, ${JSON.stringify(declaredRouteIndexing.field)} and ${JSON.stringify(policy.field)}. One owner classifies its routes one way; the first declaration is the one Equator used.`,
                  { path: ['routes', portableSourcePath], severity: 'warning' },
                ),
              );
            }
          }
        }
      }
      if (
        (ts.isIdentifier(node) ||
          ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        !inTypePosition(node) &&
        !namesOnlyAType(checker, node)
      ) {
        const identity = resolvedMessageIdentity(checker, node);
        const isPropertyName =
          ts.isIdentifier(node) &&
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node;
        const parentContinuesHandlePath =
          (ts.isPropertyAccessExpression(node.parent) &&
            node.parent.expression === node &&
            resolvedMessageIdentity(checker, node.parent) !== undefined) ||
          (ts.isElementAccessExpression(node.parent) &&
            node.parent.expression === node &&
            resolvedMessageIdentity(checker, node.parent) !== undefined);
        // A group counts where it is handed to something, not merely where it is named. Walking
        // through `messages` to reach `messages.appTitle` says nothing about the rest of the
        // scope, and neither does importing it: treating either as a use of everything under it
        // would make the unused-message advisory permanently silent.
        const handedOff =
          (ts.isCallExpression(node.parent) &&
            node.parent.arguments.some((argument) => argument === node)) ||
          (ts.isPropertyAssignment(node.parent) &&
            node.parent.initializer === node) ||
          ts.isShorthandPropertyAssignment(node.parent) ||
          ts.isArrayLiteralExpression(node.parent);
        if (
          identity !== undefined &&
          !isPropertyName &&
          !parentContinuesHandlePath
        ) {
          addUsage(
            identity,
            portableSourcePath,
            node.getStart(sourceFile),
            node.getEnd(),
            'typescript',
          );
        } else if (identity === undefined && !isPropertyName && handedOff) {
          // A group handed to something, rather than walked through on the way to one member.
          // `messages` in `messages.appTitle` is a receiver and means nothing on its own; the same
          // expression passed as an argument means every message under it is in play.
          for (const member of groupMessageIdentities(checker, node)) {
            addUsage(
              member,
              portableSourcePath,
              node.getStart(sourceFile),
              node.getEnd(),
              'typescript',
            );
          }
        }
      }
      const strategy = routerInheritanceStrategy(checker, node);
      if (strategy !== undefined) {
        routerConfigurations.push({ strategy, sourcePath: portableSourcePath });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    analyzeRoutes(
      projectRoot,
      checker,
      sourceFile,
      routes,
      rootRoutes,
      program,
      lazyEntryFiles,
      diagnostics,
      childRouteFiles,
      routeTables,
      routeTableReferences,
    );

    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      const decorator = componentDecorator(checker, statement);
      const metadataNode = decorator?.arguments[0];
      if (
        metadataNode === undefined ||
        !ts.isObjectLiteralExpression(metadataNode)
      ) {
        continue;
      }
      const inline = metadataString(metadataNode, 'template');
      const templateUrl = metadataString(metadataNode, 'templateUrl');
      if (inline === undefined && templateUrl === undefined) continue;
      const templatePath =
        templateUrl === undefined
          ? portableSourcePath
          : portablePath(
              projectRoot,
              resolve(dirname(sourceFile.fileName), templateUrl.text),
            );
      let templateSource: string;
      if (inline !== undefined) {
        templateSource = inline.text;
      } else {
        const absoluteTemplatePath = resolve(projectRoot, templatePath);
        const supplied = suppliedSources.get(
          normalizePath(absoluteTemplatePath),
        );
        if (supplied !== undefined) {
          templateSource = supplied;
        } else if (!containedPath(absoluteTemplatePath, projectRoot)) {
          // B2. The project host already filtered escaping paths out of suppliedSources by
          // containment, and this fallback then read them from disk anyway, so a templateUrl of
          // '../../secret/leak.html' was opened and parsed. Equator analyses the selected owner and
          // nothing else; a path outside it is refused rather than read.
          diagnostics.push(
            toolkitDiagnostic(
              'EQ1402',
              `Angular component template ${JSON.stringify(templatePath)} resolves outside the selected Equator owner and was not read.`,
              { path: ['components', portableSourcePath] },
            ),
          );
          continue;
        } else {
          try {
            templateSource = readFileSync(absoluteTemplatePath, 'utf8');
          } catch {
            diagnostics.push(
              toolkitDiagnostic(
                'EQ1402',
                `Angular component template ${JSON.stringify(templatePath)} could not be read.`,
                {
                  span: sourceSpan(
                    sourceFile.text,
                    templateUrl?.getStart(sourceFile) ??
                      statement.getStart(sourceFile),
                    templateUrl?.getWidth(sourceFile) ??
                      statement.getWidth(sourceFile),
                    portableSourcePath,
                  ),
                },
              ),
            );
            continue;
          }
        }
      }
      const parsed = parseTemplate(templateSource, templatePath, {
        preserveWhitespaces: false,
      });
      for (const error of parsed.errors ?? []) {
        const start = error.span.start.offset;
        const end = error.span.end.offset;
        diagnostics.push(
          toolkitDiagnostic('EQ1402', `Angular template: ${error.msg}`, {
            span: sourceSpan(
              templateSource,
              start,
              Math.max(1, end - start),
              templatePath,
            ),
          }),
        );
      }
      const componentName = statement.name?.text ?? '<anonymous>';
      const noteMention = (
        mention: Omit<
          TemplateLocaleMention,
          'componentName' | 'sourcePath' | 'templatePath'
        >,
      ): void => {
        if (localeMentions.length >= RESOURCE_LIMITS.diagnostics) return;
        localeMentions.push(
          Object.freeze({
            ...mention,
            componentName,
            sourcePath: portableSourcePath,
            templatePath,
          }),
        );
      };
      const noteAddress = (
        address: Omit<
          TemplateAddress,
          'componentName' | 'sourcePath' | 'templatePath'
        >,
      ): void => {
        if (templateAddresses.length >= RESOURCE_LIMITS.diagnostics) return;
        templateAddresses.push(
          Object.freeze({
            ...address,
            componentName,
            sourcePath: portableSourcePath,
            templatePath,
          }),
        );
      };
      const expressionVisitor = new TemplateExpressionVisitor(
        (property) => {
          const path = templatePropertyPath(property);
          if (path === undefined) return;
          const identity = templateMessageIdentity(checker, statement, path);
          if (identity === undefined) return;
          addUsage(
            identity,
            templatePath,
            property.sourceSpan.start,
            property.sourceSpan.end,
            'template',
          );
        },
        (literal) => {
          const text = String(literal.value);
          if (!LANGUAGE_TAG_SHAPE.test(text)) return;
          noteMention({
            kind: 'literal',
            text,
            start: literal.sourceSpan.start,
            end: literal.sourceSpan.end,
          });
        },
      );
      tmplAstVisitAll(
        new TemplateNodeVisitor(expressionVisitor, (element) => {
          // Both spellings, from the one place that sees both. A static `routerLink` is a text
          // attribute the expression visitor never receives, and a bound one is an expression whose
          // literals it receives with nothing saying which attribute they came from.
          const written = element.attributes.find(
            (attribute) => attribute.name === ROUTER_LINK,
          );
          const address =
            written === undefined ? undefined : absoluteAddress(written.value);
          if (written !== undefined && address !== undefined) {
            noteAddress({
              attribute: ROUTER_LINK,
              form: 'static',
              address,
              start: written.sourceSpan.start.offset,
              end: written.sourceSpan.end.offset,
            });
          }
          for (const input of element.inputs) {
            if (input.name !== ROUTER_LINK) continue;
            const bound = routerLinkAddress(input.value);
            if (bound === undefined) continue;
            noteAddress({
              attribute: ROUTER_LINK,
              ...bound,
              start: input.sourceSpan.start.offset,
              end: input.sourceSpan.end.offset,
            });
          }
          // Keyed on the static `lang`, with the static `dir` reported beside it. A lone `dir` is
          // not a claim about a locale, a page laid out right-to-left says so on its root and
          // means it, and reporting the pair as one mention is what lets the judging layer decide
          // without inferring which attribute belonged to which element.
          const language = element.attributes.find(
            (attribute) => attribute.name === 'lang',
          );
          if (language === undefined) return;
          const direction = element.attributes.find(
            (attribute) => attribute.name === 'dir',
          );
          noteMention({
            kind: 'attribute',
            attribute: 'lang',
            text: language.value,
            ...(direction === undefined
              ? {}
              : { siblingDirection: direction.value }),
            start: language.sourceSpan.start.offset,
            end: language.sourceSpan.end.offset,
          });
        }),
        parsed.nodes,
      );
      components.push(
        Object.freeze({
          componentName,
          sourcePath: portableSourcePath,
          templatePath,
        }),
      );
    }
  }

  if (diagnostics.some(({ severity }) => severity === 'error')) {
    return toolkitFailure(diagnostics);
  }
  usages.sort((left, right) =>
    compareCodeUnit(
      `${left.sourcePath}\u0000${left.start.toString().padStart(12, '0')}\u0000${left.identity}`,
      `${right.sourcePath}\u0000${right.start.toString().padStart(12, '0')}\u0000${right.identity}`,
    ),
  );
  // Drop what a table used below the root contributed at the root.
  //
  // The pass above visits every `Routes` constant on its own, and a `loadChildren` target or a
  // table another route takes its children from is one of those. Visited on its own it has no
  // parent, so `detail` enters the projection at `detail` while the application serves it at
  // `section/detail`. That is not a route Equator failed to cover; it is a route Equator invented,
  // and a localized branch built from it addresses nothing. The diagnostic above has already said
  // the subtree is uncovered: this stops the projection from simultaneously claiming otherwise.
  //
  // What stays is what the root reaches: a table nothing names, and a table spread in among the
  // root routes of one that stays. A table named both there and below the root is served at both,
  // and the root is the one the projection can spell.
  const referencedTables = new Set(
    routeTableReferences.map((reference) => reference.to),
  );
  const placedTables = new Set<ts.VariableDeclaration>();
  const reached = [...routeTables].filter(
    (table) =>
      !referencedTables.has(table) &&
      !childRouteFiles.has(
        portablePath(projectRoot, table.getSourceFile().fileName),
      ),
  );
  for (let table = reached.pop(); table !== undefined; table = reached.pop()) {
    if (placedTables.has(table)) continue;
    placedTables.add(table);
    for (const reference of routeTableReferences) {
      if (reference.atRoot && reference.from === table) {
        reached.push(reference.to);
      }
    }
  }
  routes.splice(
    0,
    routes.length,
    ...routes.filter((draft) => placedTables.has(draft.node.table)),
  );

  routes.sort((left, right) =>
    compareCodeUnit(
      `${left.sourcePath}\u0000${left.start.toString().padStart(12, '0')}`,
      `${right.sourcePath}\u0000${right.start.toString().padStart(12, '0')}`,
    ),
  );
  components.sort((left, right) =>
    compareCodeUnit(left.sourcePath, right.sourcePath),
  );

  // What only a lazy route reaches. A file behind a boundary that something eager also imports is
  // eager: the first render already pays for it, so deferring its messages would defer nothing and
  // risk rendering a component whose text has not arrived.
  const lazyClosure = staticImportClosure(program, [...lazyEntryFiles]);
  const eagerEntries = program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile &&
        !lazyClosure.has(normalizePath(file.fileName)) &&
        containedPath(normalizePath(file.fileName), normalizePath(projectRoot)),
    );
  const eagerClosure = staticImportClosure(program, eagerEntries);

  // A loader that defers nothing.
  //
  // Writing `loadComponent: () => import('./page')` while anything in the initial bundle also
  // imports `./page` puts the component in that bundle and leaves every other signal intact: chunk
  // names, prerendered output and the route table all read exactly as they do when the split works.
  // Equator notices because it has to, it decides which messages ship with the first render out of
  // this same closure, so the route's messages are correctly marked eager while whoever wrote the
  // loader believes they are deferred.
  //
  // Keyed on the loader's *target file* sitting in the eager closure, never on the route table
  // mentioning it. `staticImportClosure` follows `import` and `export` declarations only, so the
  // dynamic import inside the loader never puts its own target in the eager set; a check keyed on
  // mentions reports every lazy route in the application, because a route table always names its
  // own loaders.
  //
  // A warning rather than an error. A component can legitimately be both routed lazily and
  // rendered by an eager shell, and the application is correct either way. What is wrong is the
  // belief that the boundary is doing something.
  const reportedEagerEntries = new Set<string>();
  for (const draft of routes) {
    for (const entry of draft.lazyEntries) {
      if (!eagerClosure.has(entry) || reportedEagerEntries.has(entry)) continue;
      reportedEagerEntries.add(entry);
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1407',
          `Route ${JSON.stringify(`/${draft.path}`)} loads ${JSON.stringify(portablePath(projectRoot, entry))} through a lazy boundary, but something in the initial bundle imports it statically, so it ships with the first render and the boundary defers nothing.`,
          { path: ['routes', draft.sourcePath], severity: 'warning' },
        ),
      );
    }
  }
  // Which route is responsible for which of those files. A file is attributed to a route when
  // that route's own boundary reaches it, so the route that downloads the code is the route that
  // has to bring its messages with it.
  const deferredFor = (draft: RouteDraft): readonly string[] => {
    if (draft.lazyEntries.length === 0) return Object.freeze([]);
    const entries = draft.lazyEntries
      .map((path) => program.getSourceFile(path))
      .filter((file): file is ts.SourceFile => file !== undefined);
    return Object.freeze(
      [...staticImportClosure(program, entries)]
        .filter((path) => !eagerClosure.has(path))
        .map((path) => portablePath(projectRoot, path))
        .sort(compareCodeUnit),
    );
  };

  // The strategy the application's router runs with, or Angular's default where that cannot be
  // told. Inheriting only ever gives a route that states no class its parent's, so the default is
  // the reading that cannot make a page more shareable or more indexable than its routes say.
  const [firstConfiguration] = routerConfigurations;
  const strategyDeclared = routerConfigurations.some(
    ({ strategy }) => strategy !== 'absent',
  );
  let strategy: 'always' | 'emptyOnly' = 'always';
  if (firstConfiguration !== undefined && routerConfigurations.length > 1) {
    if (strategyDeclared) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1416',
          `This owner configures the router in ${routerConfigurations.length} places, in ${[...new Set(routerConfigurations.map(({ sourcePath }) => JSON.stringify(sourcePath)))].join(', ')}, and at least one sets \`paramsInheritanceStrategy\`. Angular uses one configuration whole, so Equator cannot tell which strategy the application runs with. It reads every child route as inheriting its parent's data, which is Angular's default. Configure the router once.`,
          {
            path: ['routes', firstConfiguration.sourcePath],
            severity: 'warning',
          },
        ),
      );
    }
  } else if (firstConfiguration?.strategy === 'unreadable') {
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1416',
        `The router configuration in ${JSON.stringify(firstConfiguration.sourcePath)} sets \`paramsInheritanceStrategy\` in a way the build cannot read, so Equator cannot tell which child routes inherit their parent's data. It reads every child route as inheriting, which is Angular's default. Write the strategy as the string literal 'always' or 'emptyOnly' in the object passed to the call.`,
        {
          path: ['routes', firstConfiguration.sourcePath],
          severity: 'warning',
        },
      ),
    );
  } else if (firstConfiguration?.strategy === 'emptyOnly') {
    strategy = 'emptyOnly';
  }

  const deferredSourcePaths = [...lazyClosure]
    .filter((path) => !eagerClosure.has(path))
    .map((path) => portablePath(projectRoot, path))
    .sort(compareCodeUnit);
  // Non-blocking findings must still reach the caller; a successful analysis
  // that silently drops its advisories hides consumer-source problems.
  return toolkitSuccess(
    Object.freeze({
      messageUsages: Object.freeze(usages),
      deferredSourcePaths: Object.freeze(deferredSourcePaths),
      selectsApplicationRuntime,
      recoveryMessageIdentities: Object.freeze(
        [...recoveryMessageIdentities].sort(compareCodeUnit),
      ),
      ...(declaredRoutePolicy === undefined
        ? {}
        : { routePolicy: declaredRoutePolicy }),
      routes: Object.freeze(
        resolveRouteIdentities(
          routes,
          rootRoutes.filter(({ node }) => placedTables.has(node.table)),
          declaredRouteIndexing,
          declaredRouteSitemap,
          declaredRouteCaching,
          strategy,
          deferredFor,
          diagnostics,
        ),
      ),
      components: Object.freeze(components),
      localeMentions: Object.freeze(localeMentions),
      templateAddresses: Object.freeze(templateAddresses),
    }),
    diagnostics,
  );
}
