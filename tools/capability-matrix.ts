/**
 * The capability matrix: every capability Equator ships as a row, every context the gate verifies
 * in as a column, and in each cell the claims that exercised it or the reason it cannot be.
 *
 * `specs/12-verification.spec.md` section 3 is what this answers to. Rows and columns are derived
 * from what the release publishes and what its gate declares, never listed beside them, so a
 * capability or a context added later is in the matrix on the day it lands. A cell is exercised by
 * a claim (`capability-claims.ts`) from a check that passed, in a context read while it ran, and by
 * nothing else. Every other cell carries a reason from `capability-matrix-reasons.json` or is red.
 *
 * Everything here is a function of its inputs, so the self-test can hand it planted ones and watch
 * it refuse them, and `verify-matrix.ts` is only the part that reads the real ones.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as playwright from 'playwright';
import type { BrowserType } from 'playwright';
import ts from 'typescript';

import type { Evidence, EvidenceClaim } from './capability-evidence.ts';
import { openSubpaths } from './exports-map.ts';
import { consumerProfiles } from './package-consumer-profiles.ts';
import {
  composableExports,
  publishedNames,
  returnTypeOf,
  runtimeDeclarations,
  toolkitDeclaration,
} from './published-surface.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A built declaration file, under the entry point it belongs to. */
export interface Declaration {
  readonly entryPoint: string;
  readonly text: string;
}

/** What the matrix reads of a package manifest. */
export interface Manifest {
  readonly name: string;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly engines: { readonly node: string };
}

/** A context the gate verifies in, and how a claim shows it ran there. */
export interface Column {
  readonly id: string;
  readonly group: string;
  readonly name: string;
  readonly matches: (claim: EvidenceClaim) => boolean;
}

/** A column before it is placed in a group. */
type UngroupedColumn = Omit<Column, 'group'>;

/** One token of a binding: a thing the claiming body may name. */
export interface BindingToken {
  readonly name?: string;
  readonly literal?: string;
  readonly declaredField?: string;
  readonly specifier?: string;
  readonly observes?: string;
}

/** Requirements that must all hold, each met by any one of its tokens. */
export type Binding = readonly (readonly BindingToken[])[];

/** A capability Equator ships. */
export interface Row {
  readonly id: string;
  readonly category: string;
  readonly name: string;
  readonly binding: Binding;
  readonly policyColumn?: string;
}

/** What the rows are derived from. */
export interface Published {
  readonly runtime: Declaration[];
  readonly toolkit: string;
  readonly runtimeManifest: Manifest;
  readonly toolkitManifest: Manifest;
  readonly commands: readonly string[];
}

/** What the columns are derived from. */
export interface Declared {
  readonly runtime: Declaration[];
  readonly runtimeManifest: Manifest;
  readonly developmentVersion: string;
  readonly engines: readonly string[];
  readonly profiles: ReadonlyMap<string, { readonly label: string }>;
  readonly renderModes: readonly string[];
}

/** A reason a set of cells cannot be exercised, as `capability-matrix-reasons.json` holds it. */
export interface Reason {
  readonly id: string;
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly reason: string;
  readonly exceptOwnColumn?: boolean;
}

/** What a claiming body names, read from its source. */
export interface SiteNames {
  readonly identifiers: ReadonlySet<string>;
  readonly strings: readonly string[];
  readonly specifiers: ReadonlySet<string>;
  readonly observes: ReadonlySet<string>;
  readonly declared: ReadonlyMap<string, ReadonlySet<string>>;
}

/** A place in a check's source where a claim is made. */
export interface ClaimSite {
  readonly path: string;
  readonly line: string;
  readonly capability: string;
  readonly names: SiteNames;
}

/** A claim site while its body is still being read. */
interface ScannedSite {
  readonly path: string;
  readonly line: string;
  readonly capability: string;
  body?: ts.Node;
  observes?: ReadonlySet<string>;
  names?: SiteNames;
}

/** One claiming stage's evidence, under the stage's id. */
export interface StageEvidence extends Evidence {
  readonly stage: string;
}

/** Something wrong with the matrix. */
export interface MatrixFinding {
  readonly kind: string;
  readonly message: string;
}

/** A cell, by its row and column ids. */
export interface Cell {
  readonly row: string;
  readonly column: string;
}

/** What `evaluateMatrix` is handed. */
export interface MatrixInput {
  readonly rows: readonly Row[];
  readonly columns: readonly Column[];
  readonly reasons: readonly Reason[];
  readonly evidence: readonly StageEvidence[];
  readonly sites: readonly ClaimSite[];
  readonly siteProblems?: readonly string[];
  readonly resolveFailures?: readonly string[];
}

/** The filled matrix. */
export interface MatrixResult {
  readonly cells: number;
  readonly exercised: Map<string, string[]>;
  readonly reasoned: Map<string, string>;
  readonly red: Cell[];
  readonly findings: MatrixFinding[];
}
// ---------------------------------------------------------------------------------------------
// Reading the declarations
// ---------------------------------------------------------------------------------------------

/** The names a declaration file exports as values, which leaves out `export type { ... }`. */
function valueNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const [, group] of text.matchAll(/export\s+\{([^}]*)\}/gu)) {
    for (const entry of (group as string).split(',')) {
      const name = entry
        .trim()
        .split(/\s+as\s+/u)
        .at(-1)
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/u.test(name)) names.add(name);
    }
  }
  // A packager writes an export either in a closing list, read above, or on the declaration
  // itself, and which one is its choice.
  for (const [, name] of text.matchAll(
    /^export declare (?:abstract class|class|const|enum|function|let|var) ([A-Za-z_$][\w$]*)/gmu,
  )) {
    names.add(name as string);
  }
  return names;
}

/**
 * The runtime's declarations with every string in one quote.
 *
 * The readers below match a literal type and an import specifier between single quotes, and which
 * quote a declaration file is written with is the packager's choice. No name or literal Equator
 * publishes contains a quote of either kind, so respelling them loses nothing a reader asks for.
 */
function runtimeDeclarationsInOneQuote(): Declaration[] {
  return runtimeDeclarations().map((entry) => ({
    ...entry,
    text: entry.text.replaceAll('"', "'"),
  }));
}

/** A declared function's parameter list, found by balancing parentheses as `returnTypeOf` does. */
function parametersOf(text: string, name: string): string | undefined {
  const declaration = new RegExp(
    `declare function ${name}\\b(?:<[^(]*>)?\\(`,
    'u',
  ).exec(text);
  if (declaration === null) return undefined;
  const start = declaration.index + declaration[0].length;
  let depth = 1;
  let index = start;
  while (index < text.length && depth > 0) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') depth -= 1;
    index += 1;
  }
  return text.slice(start, index - 1);
}

/** The body of a declared interface, from its brace to the matching one. */
function interfaceBody(text: string, name: string): string | undefined {
  const head = new RegExp(`\\binterface ${name}\\b[^{]*\\{`, 'u').exec(text);
  if (head === null) return undefined;
  let depth = 1;
  let index = head.index + head[0].length;
  const start = index;
  while (index < text.length && depth > 0) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') depth -= 1;
    index += 1;
  }
  return text.slice(start, index - 1);
}

/** The member names of a declared union of type names or of string literals. */
function unionMembers(text: string, name: string): string[] | undefined {
  const match = new RegExp(`\\btype ${name}\\s*=\\s*([^;]*);`, 'u').exec(text);
  if (match === null) return undefined;
  return (match[1] as string)
    .split('|')
    .map((member) => member.trim())
    .filter((member) => member.length > 0);
}

/** A union of literals, as the strings it admits. */
function literalUnion(text: string, name: string): string[] {
  const members = unionMembers(text, name);
  assert.ok(
    members !== undefined,
    `No union named ${name} in the built declarations. The rows it gives would silently be none.`,
  );
  return members.map((member) => {
    const literal = /^'([^']*)'$/u.exec(member);
    assert.ok(literal, `${name} has a member that is not a literal: ${member}`);
    return literal[1] as string;
  });
}

/** A union of interfaces, as each member's name and the literal its `kind` carries. */
function kindUnion(
  text: string,
  name: string,
): { member: string; kind: string; body: string }[] {
  const members = unionMembers(text, name);
  assert.ok(
    members !== undefined,
    `No union named ${name} in the built declarations. The rows it gives would silently be none.`,
  );
  return members.map((member) => {
    const body = interfaceBody(text, member);
    assert.ok(
      body !== undefined,
      `${name} names ${member}, which is not an interface here.`,
    );
    const kind = /\breadonly kind: '([^']+)';/u.exec(body);
    assert.ok(kind, `${member}, a member of ${name}, carries no literal kind.`);
    return { member, kind: kind[1] as string, body };
  });
}

/**
 * The optional members an interface body declares itself, leaving out those of an object type one
 * of its members has, which belong to that member.
 */
function optionalMembers(body: string): string[] {
  const members: string[] = [];
  let depth = 0;
  const pattern = /[{}]|\breadonly (\w+)\?:/gu;
  for (const [token, member] of body.matchAll(pattern)) {
    if (token === '{') depth += 1;
    else if (token === '}') depth -= 1;
    else if (depth === 0) members.push(member as string);
  }
  return members;
}

/** Whether a published interface declares a member, the resolution a registry entry is held to. */
function declaresMember(
  texts: readonly string[],
  owner: string,
  member: string,
): boolean {
  return texts.some((text) => {
    const body = interfaceBody(text, owner);
    return (
      body !== undefined &&
      new RegExp(`^\\s*readonly ${member}\\??:`, 'mu').test(body)
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

/**
 * How a claim shows each render mode the runtime relays from Angular. The modes are read from the
 * installed `RenderMode`, and a mode is a column only once it has a matcher here, so a mode Angular
 * adds fails the stage until someone says what observing it looks like.
 *
 * A client render is a page the browser rendered with no server render before it: a check that
 * rendered through an injector whose `PLATFORM_ID` is `browser`, over no document a server or a
 * build marked with `ng-server-context`. A hydrated page also runs on the browser platform, and
 * its marked document is what keeps it out. A document with no mark is not a client render on its
 * own: it is what a server answered without rendering, such as the application shell or a
 * redirect, and nothing in it shows a browser rendered anything.
 */
const RENDER_MODES: Readonly<Record<string, UngroupedColumn>> = Object.freeze({
  Server: {
    id: 'render:server',
    name: 'server render',
    matches: (claim: EvidenceClaim) =>
      claim.platform === 'server' || (claim.document ?? []).includes('ssr'),
  },
  Prerender: {
    id: 'render:prerender',
    name: 'prerender',
    matches: (claim: EvidenceClaim) => (claim.document ?? []).includes('ssg'),
  },
  Client: {
    id: 'render:client',
    name: 'client render',
    matches: (claim: EvidenceClaim) =>
      claim.platform === 'browser' &&
      !(claim.document ?? []).some((mark) => mark === 'ssr' || mark === 'ssg'),
  },
});

/**
 * What happens to a rendered page afterwards, which is not a render mode and so is not in
 * `RenderMode`: the page is hydrated or reached by a client navigation, and
 * `specs/07-routing-rendering-and-seo.spec.md` section 9 treats each as its own case.
 */
const AFTER_RENDER: readonly UngroupedColumn[] = Object.freeze([
  {
    id: 'render:client-navigation',
    name: 'client navigation',
    matches: (claim: EvidenceClaim) => (claim.clientNavigations ?? 0) > 0,
  },
  {
    id: 'render:hydration',
    name: 'hydration',
    matches: (claim: EvidenceClaim) => (claim.adoptedElements ?? 0) > 0,
  },
]);

/** The render columns, one per mode in `renderModes` and then the two that follow a render. */
function renderColumns(renderModes: readonly string[]): Column[] {
  const columns = renderModes.map((mode) => {
    const column = RENDER_MODES[mode];
    assert.ok(
      column !== undefined,
      `Angular's RenderMode has a member ${mode}, which the matrix has no column for. Name it in RENDER_MODES.`,
    );
    return column;
  });
  for (const mode of Object.keys(RENDER_MODES)) {
    assert.ok(
      renderModes.includes(mode),
      `RENDER_MODES names ${mode}, which Angular's RenderMode no longer has.`,
    );
  }
  return [...columns, ...AFTER_RENDER].map((column) => ({
    ...column,
    group: 'Render',
  }));
}

/**
 * The members of the `RenderMode` the runtime's server entry point imports, read from the Angular
 * that is installed, since the runtime relays Angular's modes rather than declaring its own.
 */
function relayedRenderModes(runtime: readonly Declaration[]): string[] {
  const ssr =
    runtime.find((entry) => entry.entryPoint === 'neolorn-equator-ssr')?.text ??
    '';
  assert.ok(
    /import \{[^}]*\bRenderMode\b[^}]*\} from '@angular\/ssr';/u.test(ssr),
    "The runtime's server entry point no longer imports RenderMode from @angular/ssr, so the modes read here are not the ones it relays.",
  );
  const require = createRequire(import.meta.url);
  const declarations = readFileSync(
    resolve(
      dirname(require.resolve('@angular/ssr/package.json')),
      'types/ssr.d.ts',
    ),
    'utf8',
  );
  const body = /\bdeclare enum RenderMode \{([^}]*)\}/u.exec(
    declarations.replaceAll(/\/\*[\s\S]*?\*\//gu, ''),
  );
  assert.ok(body, 'The installed @angular/ssr declares no RenderMode enum.');
  const modes = [...(body[1] as string).matchAll(/^\s*(\w+)\s*=/gmu)].map(
    ([, mode]) => mode as string,
  );
  assert.ok(
    modes.includes('Server'),
    `Reading RenderMode found ${modes.join(', ') || 'nothing'}, and not Server, so the reading has stopped matching.`,
  );
  return modes;
}

/**
 * A policy's variants are its booleans, and a boolean is a variant only once it has a name here.
 * The derivation below fails on a boolean it cannot place, so a policy that gains one gains a
 * column the day it lands, or fails the stage until someone names it.
 */
const POLICY_VARIANTS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = Object.freeze({
  'path-prefix': Object.freeze({ omitDefaultPrefix: 'default-locale-prefix' }),
});

/** A URL policy column, with the interface it is read from and the boolean that is its variant. */
interface PolicyColumn extends Column {
  readonly member: string;
  readonly flag: string | undefined;
}

function policyColumns(core: string): PolicyColumn[] {
  const members = kindUnion(core, 'LocaleUrlPolicy');
  const columns: {
    kind: string;
    variant: { flag: string; name: string } | undefined;
    member: string;
  }[] = [];
  for (const { member, kind, body } of members) {
    columns.push({ kind, variant: undefined, member });
    for (const [, flag] of body.matchAll(/^\s*readonly (\w+): boolean;/gmu)) {
      const variant = POLICY_VARIANTS[kind]?.[flag as string];
      assert.ok(
        variant !== undefined,
        `${member} carries the boolean ${flag}, which is a policy variant the matrix has no column for. Name it in POLICY_VARIANTS.`,
      );
      columns.push({
        kind,
        variant: { flag: flag as string, name: variant },
        member,
      });
    }
  }
  return columns.map(({ kind, variant, member }) => {
    const name = variant?.name ?? kind;
    const flags = Object.entries(POLICY_VARIANTS[kind] ?? {});
    return {
      id: `policy:${name}`,
      group: 'URL policy',
      name,
      member,
      flag: variant?.flag,
      matches: (claim: EvidenceClaim) =>
        claim.policy?.kind === kind &&
        // The kind compared above is read from the policy, so the policy is there.
        flags.every(([flag]) =>
          flag === variant?.flag
            ? (claim.policy as ClaimPolicy)[flag] === true
            : (claim.policy as ClaimPolicy)[flag] !== true,
        ),
    };
  });
}

/** The supported Node lines, from the ranges the packages declare. */
type ClaimPolicy = NonNullable<EvidenceClaim['policy']>;

/** A Node line as the major, minor and patch its caret range starts at. */
type NodeLine = readonly [number, number, number];

function nodeColumns(ranges: string, developmentVersion: string): Column[] {
  const lines = ranges.split('||').map((range) => {
    const caret = /^\s*\^(\d+)\.(\d+)\.(\d+)\s*$/u.exec(range);
    assert.ok(
      caret,
      `The engines range "${range.trim()}" is not a caret range, and the matrix reads a Node line from nothing else.`,
    );
    return caret.slice(1).map(Number) as unknown as NodeLine;
  });
  const satisfies = (
    version: string | null,
    [major, minor, patch]: NodeLine,
  ): boolean => {
    const parts = /^(\d+)\.(\d+)\.(\d+)/u.exec(version ?? '');
    if (parts === null) return false;
    const [a, b, c] = parts.slice(1).map(Number) as unknown as NodeLine;
    if (a !== major) return false;
    return b > minor || (b === minor && c >= patch);
  };
  assert.ok(
    lines.some((line) => satisfies(developmentVersion, line)),
    `.node-version is ${developmentVersion}, on no line the packages support, so the gate would run on a Node the matrix has no column for.`,
  );
  return lines.map((line) => ({
    id: `node:${line[0]}`,
    group: 'Node line',
    name: `Node ${line[0]}`,
    matches: (claim: EvidenceClaim) => satisfies(claim.node, line),
  }));
}

/** The engines are the browsers Playwright drives, asked of Playwright rather than listed. */
/** A value Playwright exports, as the scan for its browser types probes it. */
type ProbedExport =
  | {
      readonly name?: unknown;
      readonly executablePath?: unknown;
      readonly launch?: unknown;
    }
  | null
  | undefined;

function playwrightEngines(): string[] {
  const names = (Object.values(playwright) as ProbedExport[])
    .filter(
      (value): value is BrowserType =>
        typeof value?.name === 'function' &&
        typeof value.executablePath === 'function' &&
        typeof value.launch === 'function',
    )
    .map((browserType) => browserType.name())
    .sort();
  for (const anchor of ['chromium', 'webkit']) {
    assert.ok(
      names.includes(anchor),
      `Playwright reports no ${anchor}, so the scan for its browser types has stopped matching.`,
    );
  }
  return names;
}

function engineColumns(engines: readonly string[]): Column[] {
  return engines.map((name) => ({
    id: `engine:${name}`,
    group: 'Engine',
    name,
    matches: (claim: EvidenceClaim) => claim.engine?.name === name,
  }));
}

/** The Angular rows are the consumer profiles the gate materializes. */
function angularColumns(
  profiles: ReadonlyMap<string, { readonly label: string }>,
): Column[] {
  return [...profiles].map(([id, profile]) => ({
    id: `angular:${id}`,
    group: 'Angular row',
    name: profile.label,
    matches: (claim: EvidenceClaim) => claim.angularRow === id,
  }));
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

// A binding is what the claiming check's own body must name for the claim to count: a list of
// requirements, all of which must hold, each met by any one of its tokens.
const named = (...names: string[]): BindingToken[] =>
  names.map((name) => ({ name }));
const literal = (...values: string[]): BindingToken[] =>
  values.map((value) => ({ literal: value }));
// A field the body declares for `key` in the options `withRouting` takes, and names. An application
// that classifies its routes by a field of its own declares the class through that field, and the
// default name it replaces appears nowhere in what it wrote.
const declaredField = (key: string): BindingToken => ({ declaredField: key });

/** A capability that is not one published name, and what it resolves to. */
interface RegistryEntry {
  readonly id: string;
  readonly resolves:
    | { readonly export: string; readonly member?: undefined }
    | {
        readonly export?: undefined;
        readonly member: readonly [string, string];
      };
  readonly binding: Binding;
}

/**
 * The capabilities that are not one published name: a field a route declares, a contract an
 * application implements, a document the server answers. Each resolves to a published export or a
 * member of a published interface, and the stage fails on one that no longer does, so a capability
 * that is removed takes its row with it rather than leaving a row nothing can fill.
 */
const REGISTRY: readonly RegistryEntry[] = Object.freeze([
  {
    id: 'extension:locale-participant',
    resolves: { export: 'LocalizationParticipant' },
    binding: [named('LocalizationParticipant')],
  },
  {
    id: 'extension:overlay-adapter',
    resolves: { export: 'LocalizationOverlayAdapter' },
    binding: [named('LocalizationOverlayAdapter')],
  },
  {
    id: 'extension:persistence-store',
    resolves: { export: 'LocalizationPersistenceStore' },
    binding: [named('LocalizationPersistenceStore')],
  },
  {
    id: 'extension:observability-sink',
    resolves: { export: 'LocalizationObservabilitySink' },
    binding: [named('LocalizationObservabilitySink')],
  },
  {
    id: 'declaration:route-indexing-class',
    resolves: { export: 'DEFAULT_ROUTE_INDEXING_FIELD' },
    binding: [
      [
        ...named('equatorIndexing', 'DEFAULT_ROUTE_INDEXING_FIELD'),
        declaredField('indexing'),
      ],
    ],
  },
  {
    id: 'declaration:route-caching-class',
    resolves: { export: 'DEFAULT_ROUTE_CACHING_FIELD' },
    binding: [
      [
        ...named('equatorCaching', 'DEFAULT_ROUTE_CACHING_FIELD'),
        declaredField('caching'),
      ],
    ],
  },
  {
    id: 'declaration:host-page-floor',
    resolves: { member: ['RouteCacheDurations', 'pageCaching'] },
    binding: [named('pageCaching')],
  },
  {
    id: 'declaration:route-sitemap-entry',
    resolves: { member: ['GeneratedRouteProjectionEntry', 'sitemap'] },
    binding: [named('sitemap', 'changefreq', 'priority')],
  },
  {
    id: 'declaration:document-metadata',
    resolves: { member: ['RouteLocalizationOptions', 'documentMetadata'] },
    binding: [named('documentMetadata', 'documentMessage')],
  },
  {
    id: 'declaration:outcome-documents',
    resolves: { member: ['RouteLocalizationOptions', 'outcomeDocuments'] },
    binding: [named('outcomeDocuments')],
  },
  {
    id: 'declaration:localized-paths',
    resolves: { member: ['RouteRuntimeProjection', 'localizedPaths'] },
    binding: [named('localizedPaths')],
  },
  {
    id: 'declaration:route-parameter-codec',
    resolves: { member: ['RouteRuntimeProjection', 'parameters'] },
    binding: [
      named(
        'RouteParameterCodec',
        'parameters',
        'createIdentifierParameterCodec',
        'createIntegerParameterCodec',
      ),
    ],
  },
  {
    id: 'declaration:historical-route-outcome',
    resolves: { member: ['RouteRuntimeProjection', 'historical'] },
    binding: [named('historical', 'RouteHistoricalOutcome')],
  },
  {
    id: 'declaration:locale-neutral-roots',
    resolves: {
      member: ['PathPrefixLocalePolicyOptions', 'localeNeutralRoots'],
    },
    binding: [named('localeNeutralRoots')],
  },
  {
    id: 'declaration:locale-aliases',
    resolves: { member: ['PathPrefixLocalePolicyOptions', 'aliases'] },
    binding: [named('aliases')],
  },
  {
    id: 'declaration:x-default',
    resolves: { member: ['PathPrefixLocalePolicyOptions', 'xDefaultPath'] },
    binding: [named('xDefaultPath', 'xDefaultUrl')],
  },
  {
    id: 'declaration:locale-formatting',
    resolves: { member: ['GeneratedConfiguration', 'formatting'] },
    binding: [named('formatting', 'numberingSystem')],
  },
  {
    id: 'capability:sitemap',
    resolves: { member: ['RoutingOptions', 'sitemap'] },
    binding: [named('sitemap', 'projectSitemap', 'SitemapDocument')],
  },
  {
    id: 'capability:xliff',
    resolves: { export: 'exportXliff22' },
    binding: [named('exportXliff22', 'importXliff22')],
  },
  {
    id: 'capability:pseudo-locale',
    resolves: { export: 'createPseudoCatalog' },
    binding: [
      named(
        'createPseudoCatalog',
        'pseudoLocalizeMessage',
        'pseudoLocaleTags',
        'pseudoLocales',
        '--pseudo',
      ),
    ],
  },
  {
    id: 'capability:fallback-chain',
    resolves: { member: ['GeneratedConfiguration', 'localeFallbacks'] },
    binding: [
      named(
        'localeFallbacks',
        'parentLocales',
        'localeFallbackChain',
        'localeParent',
        'shippedFallbackChain',
      ),
    ],
  },
]);

/**
 * Optional members of a registry interface that are not a row of their own: a member another row
 * already stands for, or one that is not the application's to declare. The stage fails on a
 * placement whose member or row no longer exists.
 */
const MEMBER_PLACEMENTS: Readonly<
  Record<string, { readonly row?: string; readonly none?: string }>
> = Object.freeze({
  'PathPrefixLocalePolicyOptions.omitDefaultPrefix': {
    row: 'policy:default-locale-prefix',
  },
  'GeneratedConfiguration.pseudoLocales': { row: 'capability:pseudo-locale' },
  'GeneratedConfiguration.extensionDescriptors': { row: 'extension:*' },
  'GeneratedRouteProjectionEntry.indexing': {
    row: 'declaration:route-indexing-class',
  },
  'GeneratedRouteProjectionEntry.caching': {
    row: 'declaration:route-caching-class',
  },
  'RoutingOptions.indexing': { row: 'declaration:route-indexing-class' },
  'RoutingOptions.caching': { row: 'declaration:route-caching-class' },
  'GeneratedRouteProjectionEntry.sourcePath': {
    none: 'Where the build found the route, which its diagnostics cite; nothing reads it at run time.',
  },
});

/** The commands the built CLI lists in its own help, run where it acts on nothing. */
function cliCommands(): string[] {
  const elsewhere = mkdtempSync(join(tmpdir(), 'equator-matrix-help-'));
  try {
    const help = execFileSync(
      process.execPath,
      [resolve(workspaceRoot, 'dist/toolkit/cli.js'), '--help'],
      { cwd: elsewhere, encoding: 'utf8' },
    ).replaceAll('\r\n', '\n');
    const block = /\nCommands:\n((?: {2}\S+ +\S.*\n)+)/u.exec(help);
    assert.ok(block, 'The built CLI printed no Commands section in its help.');
    const commands = (block[1] as string)
      .trimEnd()
      .split('\n')
      .map((line) => line.trim().split(/\s+/u)[0] as string);
    for (const anchor of ['init', 'uninstall']) {
      assert.ok(
        commands.includes(anchor),
        `The built CLI's help lists no ${anchor}, so reading its commands has stopped matching.`,
      );
    }
    return commands;
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
}

const readManifest = (path: string): Manifest =>
  JSON.parse(readFileSync(resolve(workspaceRoot, path), 'utf8')) as Manifest;

/** What the rows are derived from, read from the built packages. */
export function readPublished(): Published {
  return {
    runtime: runtimeDeclarationsInOneQuote(),
    toolkit: toolkitDeclaration(),
    runtimeManifest: readManifest('dist/runtime/package.json'),
    toolkitManifest: readManifest('dist/toolkit/package.json'),
    commands: cliCommands(),
  };
}

/**
 * Every row, derived from what `readPublished` read, with the one registry above.
 *
 * Nothing here reads the disk, so the self-test can hand it a publication with one more export and
 * require one more row, which is the only way to show the rows follow what is published rather
 * than a list that happens to agree with it today.
 */
export function rowsFrom({
  runtime,
  toolkit,
  runtimeManifest,
  toolkitManifest,
  commands,
}: Published): { rows: Row[]; resolveFailures: string[] } {
  const text = (entryPoint: string) =>
    runtime.find((entry) => entry.entryPoint === entryPoint)?.text ?? '';
  const primary = text('neolorn-equator');
  const core = text('neolorn-equator-core');
  const testing = text('neolorn-equator-testing');
  const everything = [...runtime.map((entry) => entry.text), toolkit];
  const allValues = new Set(
    everything.flatMap((each) => [...valueNames(each)]),
  );
  const declaredIn = (name: string) =>
    everything.find((each) => returnTypeOf(each, name) !== undefined);

  const rows: Row[] = [];
  const add = (
    category: string,
    name: string,
    binding: Binding,
    extra: { readonly policyColumn?: string } = {},
  ) =>
    rows.push({ id: `${category}:${name}`, category, name, binding, ...extra });

  // Entry points, from the manifests' own export maps.
  for (const [manifest, keep] of [
    [runtimeManifest, (key: string) => key !== './package.json'],
    [toolkitManifest, (key: string) => key === '.'],
  ] as const) {
    for (const { subpath, specifier } of openSubpaths(manifest)) {
      if (keep(subpath)) add('entry', specifier, [[{ specifier }]]);
    }
  }

  // What a consumer composes, except the testing entry point's, which are testing helpers.
  const testingValues = valueNames(testing);
  for (const name of composableExports(runtime).keys()) {
    if (!testingValues.has(name)) add('feature', name, [named(name)]);
  }

  // URL policies, one row per column, each named by the factory that makes it. A factory makes a
  // policy from options; a function that is handed a policy and returns one narrows it instead.
  const policyTypes = [
    'LocaleUrlPolicy',
    ...kindUnion(core, 'LocaleUrlPolicy').map(({ member }) => member),
  ];
  for (const column of policyColumns(core)) {
    const factories = [...valueNames(core)].filter((name) => {
      if (returnTypeOf(core, name) !== column.member) return false;
      const parameters = parametersOf(core, name) ?? '';
      if (policyTypes.some((type) => word(type).test(parameters))) return false;
      const omitted = /Omit<\w+,\s*'(\w+)'>/u.exec(parameters);
      return column.flag === undefined
        ? omitted === null
        : omitted?.[1] === column.flag;
    });
    assert.equal(
      factories.length,
      1,
      `The ${column.name} policy has ${factories.length} factories (${factories.join(', ')}); a row is named by exactly one.`,
    );
    add(
      'policy',
      column.name,
      // The assertion above holds the list to exactly one factory.
      [[...named(factories[0] as string), { observes: 'policy' }]],
      {
        policyColumn: column.id,
      },
    );
  }

  for (const source of literalUnion(primary, 'LocalizationLocaleSource')) {
    add('source', source, [literal(source)]);
  }

  for (const name of valueNames(primary)) {
    if (returnTypeOf(primary, name) === 'LocalizationPersistenceStoreFactory') {
      add('store', name, [named(name)]);
    }
  }

  for (const { text: each } of runtime) {
    for (const [, className, pipe] of each.matchAll(
      /ɵɵPipeDeclaration<(\w+), '([^']+)'/gu,
    )) {
      add('pipe', pipe as string, [named(pipe as string, className as string)]);
    }
    for (const [, className, selector] of each.matchAll(
      /ɵɵ(?:Directive|Component)Declaration<(\w+)(?:<[^>]*>)?, '([^']+)'/gu,
    )) {
      const tokens = [
        ...new Set(
          [
            ...(selector as string).matchAll(
              /\[([\w-]+)\]|^([\w-]+)|, ([\w-]+)/gu,
            ),
          ].map(
            // Every alternative of the pattern is one group, so one of the three holds.
            (match) => (match[1] ?? match[2] ?? match[3]) as string,
          ),
        ),
      ];
      add('directive', className as string, [
        named(className as string, ...tokens),
      ]);
    }
  }

  const inputFunctions = [...allValues].filter((name) =>
    /localizedinput/iu.test(name),
  );
  for (const { kind } of kindUnion(core, 'LocalizedInputProfile')) {
    add('control', kind, [literal(kind), named(...inputFunctions)]);
  }

  for (const name of valueNames(primary)) {
    if (/:\s*FormattingContext\b/u.test(parametersOf(primary, name) ?? '')) {
      add('format', name, [named(name)]);
    }
  }

  for (const name of allValues) {
    const returned = returnTypeOf(declaredIn(name) ?? '', name) ?? '';
    if (/^(?:PageOutcome|Declared)\w+$/u.test(returned))
      add('outcome', name, [named(name)]);
  }

  for (const { kind } of kindUnion(core, 'RuntimeExtensionDescriptor')) {
    add('extension', kind, [literal(kind)]);
  }

  for (const name of testingValues) add('testing', name, [named(name)]);

  const toolkitValues = [...valueNames(toolkit)];
  for (const command of commands) {
    add('cli', command, [
      [
        ...literal(command),
        ...named(`equator ${command}`),
        ...named(...toolkitValues.filter((name) => name.startsWith(command))),
      ],
    ]);
  }

  const resolveFailures: string[] = [];
  for (const entry of REGISTRY) {
    // Every registry id is "category:name".
    const [category, name] = entry.id.split(/:(.*)/u) as [string, string];
    const resolved =
      entry.resolves.export !== undefined
        ? allValues.has(entry.resolves.export) ||
          everything.some((each) =>
            publishedNames(each).has(entry.resolves.export as string),
          )
        : declaresMember(everything, ...entry.resolves.member);
    // A declaration read under a key `withRouting` no longer takes would still match the checks
    // written before it went, and go on crediting a declaration nobody can make.
    const declarable = entry.binding
      .flat()
      .every(
        ({ declaredField: key }) =>
          key === undefined ||
          declaresMember(everything, 'RoutingOptions', key),
      );
    if (!resolved || !declarable) resolveFailures.push(entry.id);
    add(category, name, entry.binding);
  }

  // Every optional member of an interface the registry reads is something an application may
  // declare, so each is a row: the registry's own where it names the member, the one
  // MEMBER_PLACEMENTS gives it, or otherwise a row of its own, which a member added later gets on
  // the day it lands.
  const owners = [
    ...new Set(
      REGISTRY.flatMap(({ resolves }) =>
        resolves.member === undefined ? [] : [resolves.member[0]],
      ),
    ),
  ];
  const registered = new Set(
    REGISTRY.flatMap(({ resolves }) =>
      resolves.member === undefined ? [] : [resolves.member.join('.')],
    ),
  );
  const derived = new Set<string>();
  for (const owner of owners) {
    for (const each of everything) {
      const body = interfaceBody(each, owner);
      if (body === undefined) continue;
      for (const member of optionalMembers(body)) {
        const key = `${owner}.${member}`;
        derived.add(key);
        if (registered.has(key) || MEMBER_PLACEMENTS[key] !== undefined) {
          continue;
        }
        add('declaration', key, [named(member)]);
      }
    }
  }
  for (const [key, placement] of Object.entries(MEMBER_PLACEMENTS)) {
    // A placement for a member that is gone would hide the row a member of that name gets later.
    if (!derived.has(key)) resolveFailures.push(`placement:${key}`);
    if (
      placement.row !== undefined &&
      !rows.some(
        (row) =>
          row.id === placement.row ||
          ((placement.row as string).endsWith(':*') &&
            row.category === (placement.row as string).slice(0, -2)),
      )
    ) {
      resolveFailures.push(`placement:${key}`);
    }
  }

  // A capability exported from two entry points is one capability.
  const unique = new Map<string, Row>();
  for (const row of rows) if (!unique.has(row.id)) unique.set(row.id, row);

  for (const anchor of [
    'entry:@neolorn/equator/http',
    'feature:withRouting',
    'pipe:localizedMoney',
    'directive:LocalizedInput',
    'control:money',
    'format:formatMoney',
    'outcome:pageAbsent',
    'store:cookieStore',
    'testing:renderedText',
  ]) {
    assert.ok(
      unique.has(anchor),
      `No row ${anchor}. The derivation that gives it has stopped matching, and the rows it misses would be missing without anyone seeing it.`,
    );
  }
  return { rows: [...unique.values()], resolveFailures };
}

/** Every row, from the built packages. */
export function deriveRows(): { rows: Row[]; resolveFailures: string[] } {
  return rowsFrom(readPublished());
}

/** What the columns are derived from: the built packages and the gate's own declarations. */
export function readDeclared(): Declared {
  return {
    runtime: runtimeDeclarationsInOneQuote(),
    runtimeManifest: readManifest('dist/runtime/package.json'),
    developmentVersion: readFileSync(
      resolve(workspaceRoot, '.node-version'),
      'utf8',
    ).trim(),
    engines: playwrightEngines(),
    profiles: consumerProfiles,
    renderModes: relayedRenderModes(runtimeDeclarationsInOneQuote()),
  };
}

/**
 * Every column, derived from what `readDeclared` read. It reads nothing itself, for the reason
 * `rowsFrom` does not: a planted consumer profile has to be able to reach it.
 */
export function columnsFrom({
  runtime,
  runtimeManifest,
  developmentVersion,
  engines,
  profiles,
  renderModes,
}: Declared): Column[] {
  const core =
    runtime.find((entry) => entry.entryPoint === 'neolorn-equator-core')
      ?.text ?? '';
  return [
    ...renderColumns(renderModes),
    ...policyColumns(core).map(({ id, group, name, matches }) => ({
      id,
      group,
      name,
      matches,
    })),
    ...engineColumns(engines),
    ...nodeColumns(runtimeManifest.engines.node, developmentVersion),
    ...angularColumns(profiles),
  ];
}

/** Every column, from the built packages and the gate's own declarations. */
export function deriveColumns(): Column[] {
  return columnsFrom(readDeclared());
}

// ---------------------------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------------------------

/** Rows or columns a selector names: an exact id, or a whole category or group as `name:*`. */
function select<Item extends { readonly id: string }>(
  selectors: readonly string[],
  items: readonly Item[],
  prefixOf: (item: Item) => string,
): { chosen: Set<string>; unknown: string[] } {
  const chosen = new Set<string>();
  const unknown: string[] = [];
  for (const selector of selectors) {
    const hits = selector.endsWith(':*')
      ? items.filter((item) => prefixOf(item) === selector.slice(0, -2))
      : items.filter((item) => item.id === selector);
    if (hits.length === 0) unknown.push(selector);
    for (const hit of hits) chosen.add(hit.id);
  }
  return { chosen, unknown };
}

export function loadReasons(
  path = resolve(workspaceRoot, 'tools/capability-matrix-reasons.json'),
): Reason[] {
  return (
    JSON.parse(readFileSync(path, 'utf8')) as { readonly reasons: Reason[] }
  ).reasons;
}

// ---------------------------------------------------------------------------------------------
// Claim sites: where each claim is made, read from the source of the check that makes it
// ---------------------------------------------------------------------------------------------

/** The two functions a check claims through, and the argument each takes the capability in. */
/** A function a check claims through, and the argument it takes the capability in. */
interface Claimer {
  readonly module: string;
  readonly name: string;
  readonly argument: number;
}

const CLAIMING: readonly Claimer[] = Object.freeze([
  {
    module: 'capability-claims-in-tests.ts',
    name: 'claimCapability',
    argument: 0,
  },
  {
    module: 'capability-evidence.ts',
    name: 'recordCapabilityClaim',
    argument: 1,
  },
]);

const functionLike = (node: ts.Node): boolean =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node);

const calleeRoot = (expression: ts.Expression): string | undefined => {
  let current: ts.Expression = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isCallExpression(current)
  ) {
    current = ts.isCallExpression(current)
      ? current.expression
      : current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
};

/** The body a claim is judged against: the test it is in, or the function a plain check runs. */
function claimingBody(call: ts.Node): ts.Node | undefined {
  let nearest: ts.Node | undefined;
  // The source file at the top has no parent, which the declared `parent: Node` does not allow for.
  for (
    let node = call.parent as ts.Node | undefined;
    node !== undefined;
    node = node.parent as ts.Node | undefined
  ) {
    if (!functionLike(node)) continue;
    nearest ??= node;
    const parent = node.parent as ts.Node | undefined;
    if (
      parent !== undefined &&
      ts.isCallExpression(parent) &&
      (parent.arguments as readonly ts.Node[]).includes(node) &&
      (['it', 'test'] as (string | undefined)[]).includes(
        calleeRoot(parent.expression),
      )
    ) {
      return node;
    }
  }
  return nearest;
}

// Every key a binding reads a declared field under.
const DECLARED_KEYS = Object.freeze([
  ...new Set(
    REGISTRY.flatMap(({ binding }) => binding.flat())
      .map(({ declaredField: key }) => key)
      .filter((key) => key !== undefined),
  ),
]);

const nameOf = (node: ts.Node | undefined): string | undefined =>
  node !== undefined && (ts.isIdentifier(node) || ts.isStringLiteralLike(node))
    ? node.text
    : undefined;

/**
 * The fields a body declares under each of `DECLARED_KEYS`, as `key: { field: '…' }`, written as
 * its own code or inside the source text it hands an analysis.
 *
 * Source text is read token by token rather than parsed: a check often writes a fragment of a file,
 * or a template whose substitutions leave no whole expression, and the declaration is the same
 * tokens in either. A field held in a binding is not read, so a check declaring one names nothing
 * through it.
 */
/** A token of source text, as the scanner read it. */
interface ScannedToken {
  readonly kind: ts.SyntaxKind;
  readonly value: string;
}

function declaredFieldsIn(
  body: ts.Node,
  strings: readonly string[],
): Map<string, Set<string>> {
  const declared = new Map<string, Set<string>>(
    DECLARED_KEYS.map((key) => [key, new Set<string>()]),
  );
  const visit = (node: ts.Node): void => {
    const key = ts.isPropertyAssignment(node) ? nameOf(node.name) : undefined;
    // A key is read only from a property assignment, so the node is one.
    if (
      declared.has(key as string) &&
      ts.isObjectLiteralExpression((node as ts.PropertyAssignment).initializer)
    ) {
      for (const property of (
        (node as ts.PropertyAssignment)
          .initializer as ts.ObjectLiteralExpression
      ).properties) {
        if (
          ts.isPropertyAssignment(property) &&
          nameOf(property.name) === 'field' &&
          ts.isStringLiteralLike(property.initializer)
        ) {
          (declared.get(key as string) as Set<string>).add(
            property.initializer.text,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);

  const name = (token: ScannedToken | undefined) =>
    token !== undefined &&
    (
      [
        ts.SyntaxKind.Identifier,
        ts.SyntaxKind.StringLiteral,
        ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      ] as ts.SyntaxKind[]
    ).includes(token.kind)
      ? token.value
      : undefined;
  for (const text of strings) {
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      true,
      ts.LanguageVariant.Standard,
      text,
    );
    const tokens: ScannedToken[] = [];
    for (
      let kind = scanner.scan();
      kind !== ts.SyntaxKind.EndOfFileToken;
      kind = scanner.scan()
    ) {
      tokens.push({ kind, value: scanner.getTokenValue() });
    }
    const is = (index: number, kind: ts.SyntaxKind) =>
      tokens[index]?.kind === kind;
    for (let start = 0; start < tokens.length; start += 1) {
      const key = name(tokens[start]);
      if (
        !declared.has(key as string) ||
        !is(start + 1, ts.SyntaxKind.ColonToken) ||
        !is(start + 2, ts.SyntaxKind.OpenBraceToken)
      ) {
        continue;
      }
      // Only `field` in the declaration's own object: a value table may hold a key of that name.
      let depth = 1;
      for (let at = start + 3; at < tokens.length && depth > 0; at += 1) {
        if (is(at, ts.SyntaxKind.OpenBraceToken)) depth += 1;
        else if (is(at, ts.SyntaxKind.CloseBraceToken)) depth -= 1;
        else if (
          depth === 1 &&
          name(tokens[at]) === 'field' &&
          is(at + 1, ts.SyntaxKind.ColonToken) &&
          (is(at + 2, ts.SyntaxKind.StringLiteral) ||
            is(at + 2, ts.SyntaxKind.NoSubstitutionTemplateLiteral))
        ) {
          // The tests above found both the key and the token two places on.
          (declared.get(key as string) as Set<string>).add(
            (tokens[at + 2] as ScannedToken).value,
          );
        }
      }
    }
  }
  return declared;
}

/**
 * Every claim a source file makes, with what the body around it names.
 *
 * The body's own words are its identifiers and the text of its strings and templates, the claim
 * calls' own arguments left out: a claim for `pipe:localizedMoney` names the pipe in its own
 * argument, and counting that would let every claim bind itself.
 */
export function claimSitesIn(
  path: string,
  text: string,
): { sites: ClaimSite[]; problems: string[] } {
  const claimers = CLAIMING.filter(({ module }) => text.includes(module));
  if (claimers.length === 0) return { sites: [], problems: [] };
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.ts') || path.endsWith('.mts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS,
  );
  const problems: string[] = [];
  const where = (node: ts.Node) =>
    `${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const locals = new Map<string, Claimer>();
  // Only names that exist at run time. A type is erased before the check runs, so a body that names
  // one has loaded nothing from its module, and an entry point claimed on that is claimed on nothing.
  const imported = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    // An import's module specifier is a string literal by the grammar.
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const clause = statement.importClause;
    const typeOnly = clause?.isTypeOnly === true;
    const claimer = claimers.find(({ module }) =>
      specifier.endsWith(`/${module}`),
    );
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      if (!typeOnly) imported.set(clause.namedBindings.name.text, specifier);
      if (claimer !== undefined) {
        problems.push(
          `${where(statement)} imports the claim module whole; import ${claimer.name} by name so every claim can be found.`,
        );
      }
      continue;
    }
    if (clause?.name && !typeOnly) imported.set(clause.name.text, specifier);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!typeOnly && !element.isTypeOnly)
          imported.set(element.name.text, specifier);
        const original = (element.propertyName ?? element.name).text;
        if (claimer !== undefined && original === claimer.name) {
          locals.set(element.name.text, claimer);
        }
      }
    }
  }

  const sites: ScannedSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && locals.has(node.text)) {
      const parent = node.parent;
      const isImport = ts.isImportSpecifier(parent);
      const isCall = ts.isCallExpression(parent) && parent.expression === node;
      if (!isImport && !isCall) {
        problems.push(
          `${where(node)} uses ${node.text} other than by calling it, so a claim made through it cannot be read.`,
        );
      }
      if (isCall) {
        const claimer = locals.get(node.text) as Claimer;
        const argument = parent.arguments[claimer.argument];
        if (
          argument === undefined ||
          !(
            ts.isStringLiteral(argument) ||
            ts.isNoSubstitutionTemplateLiteral(argument)
          )
        ) {
          problems.push(
            `${where(parent)} claims a capability that is not written as a literal, so the claim cannot be read without running the check.`,
          );
        } else {
          const body = claimingBody(parent);
          // What the claim observes, read from the object it is handed, so a claim that observes
          // the policy it runs is held to that rather than to naming a factory.
          const observation = parent.arguments[claimer.argument + 1];
          const observes = new Set(
            observation !== undefined &&
              ts.isObjectLiteralExpression(observation)
              ? observation.properties
                  .map((property) => property.name)
                  .filter((name) => name !== undefined && ts.isIdentifier(name))
                  .map((name) => name.text)
              : [],
          );
          if (body === undefined) {
            problems.push(
              `${where(parent)} claims ${argument.text} outside any test or function, so there is no body to hold it to.`,
            );
          } else {
            sites.push({
              path,
              line: where(parent),
              capability: argument.text,
              body,
              observes,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const site of sites) {
    const identifiers = new Set<string>();
    const strings: string[] = [];
    const specifiers = new Set<string>();
    const collect = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        locals.has(node.expression.text)
      ) {
        return;
      }
      if (ts.isIdentifier(node)) {
        identifiers.add(node.text);
        if (imported.has(node.text))
          specifiers.add(imported.get(node.text) as string);
      } else if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        strings.push(node.text);
      }
      ts.forEachChild(node, collect);
    };
    // Every site is pushed with its body and what it observes, and both are read here once.
    ts.forEachChild(site.body as ts.Node, collect);
    site.names = {
      identifiers,
      strings,
      specifiers,
      observes: site.observes as ReadonlySet<string>,
      declared: declaredFieldsIn(site.body as ts.Node, strings),
    };
    delete site.body;
    delete site.observes;
  }
  return { sites: sites as ClaimSite[], problems };
}

/** Every file a claim could be made in: the workspace suites, the fixtures, and the gate's tools. */
export function claimSites(root: string = workspaceRoot): {
  sites: ClaimSite[];
  problems: string[];
} {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'tmp', '.git'].includes(entry.name))
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        /\.(?:ts|mts|cts|mjs|cjs|js)$/u.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.endsWith('.d.mts')
      )
        files.push(path);
    }
  };
  for (const top of ['packages', 'fixtures', 'tools']) walk(resolve(root, top));
  const sites: ClaimSite[] = [];
  const problems: string[] = [];
  for (const path of files) {
    const found = claimSitesIn(
      relative(root, path).split(sep).join('/'),
      readFileSync(path, 'utf8'),
    );
    sites.push(...found.sites);
    problems.push(...found.problems);
  }
  return { sites, problems };
}

const word = (name: string): RegExp =>
  new RegExp(
    `(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\w$])`,
    'u',
  );

/** Whether one token of a binding is named by a body. */
function names(
  token: BindingToken,
  { identifiers, strings, specifiers, observes, declared }: SiteNames,
): boolean {
  if (token.observes !== undefined) return observes.has(token.observes);
  const named = (name: string) =>
    identifiers.has(name) || strings.some((text) => word(name).test(text));
  if (token.name !== undefined) return named(token.name);
  if (token.declaredField !== undefined) {
    // Every key a binding declares a field under is a key of `declared`.
    return [...(declared.get(token.declaredField) as ReadonlySet<string>)].some(
      named,
    );
  }
  if (token.literal !== undefined) return strings.includes(token.literal);
  if (token.specifier !== undefined) {
    return (
      specifiers.has(token.specifier) ||
      strings.some((text) => text.includes(token.specifier as string))
    );
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

/**
 * Fills the matrix and says everything wrong with it.
 *
 * `evidence` is one entry per claiming stage: `{ stage, missing, writers, claims, unreadable }`.
 * Every finding fails the stage; the red cells are one of them, and are also returned whole so the
 * report can list them.
 */
export function evaluateMatrix({
  rows,
  columns,
  reasons,
  evidence,
  sites,
  siteProblems = [],
  resolveFailures = [],
}: MatrixInput): MatrixResult {
  const findings: MatrixFinding[] = [];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const cellKey = (row: string, column: string) => `${row} @ ${column}`;
  const exercised = new Map<string, string[]>();

  for (const id of resolveFailures) {
    findings.push({
      kind: 'dead-row',
      message: `${id} names a capability the built packages no longer publish.`,
    });
  }
  for (const problem of siteProblems)
    findings.push({ kind: 'unreadable-claim', message: problem });

  // Claim sites, held to their bodies.
  const sitesByCapability = new Map<string, ClaimSite[]>();
  for (const site of sites) {
    const row = rowById.get(site.capability);
    if (row === undefined) {
      findings.push({
        kind: 'unknown-row',
        message: `${site.line} claims ${site.capability}, which is not a row.`,
      });
      continue;
    }
    const held = row.binding.every((requirement) =>
      requirement.some((token) => names(token, site.names)),
    );
    if (!held) {
      findings.push({
        kind: 'mislabel',
        message: `${site.line} claims ${site.capability}, and its body never names it.`,
      });
      continue;
    }
    if (!sitesByCapability.has(site.capability))
      sitesByCapability.set(site.capability, []);
    (sitesByCapability.get(site.capability) as ClaimSite[]).push(site);
  }

  // Evidence, stage by stage.
  for (const stage of evidence) {
    if (stage.missing) {
      findings.push({
        kind: 'missing-evidence',
        message: `${stage.stage} records claims and left no evidence. Its writer never ran, so nothing it asserted can be counted.`,
      });
      continue;
    }
    if (stage.writers.length === 0) {
      findings.push({
        kind: 'missing-evidence',
        message: `${stage.stage} left evidence with no writer in it, so it cannot be told from a file something else wrote.`,
      });
    }
    for (const line of stage.unreadable) {
      findings.push({
        kind: 'unreadable-evidence',
        message: `${stage.stage} evidence line ${line} is not a record.`,
      });
    }
    for (const claim of stage.claims) {
      const row = rowById.get(claim.capability);
      if (row === undefined) {
        findings.push({
          kind: 'unknown-row',
          message: `${stage.stage}: ${claim.check} claimed ${claim.capability}, which is not a row.`,
        });
        continue;
      }
      if (!sitesByCapability.has(claim.capability)) {
        findings.push({
          kind: 'unsited-claim',
          message: `${stage.stage}: ${claim.check} claimed ${claim.capability}, and no check's source makes that claim. The scan for claims is not seeing it.`,
        });
        continue;
      }
      // A policy row claimed while the check observed a different policy running is the one
      // mislabel the evidence itself can show, so it is refused here as well as at the source.
      if (row.policyColumn !== undefined && claim.policy !== undefined) {
        const column = columns.find((each) => each.id === row.policyColumn);
        if (!(column as Column).matches(claim)) {
          findings.push({
            kind: 'mislabel',
            message: `${stage.stage}: ${claim.check} claimed ${claim.capability} while observing the ${claim.policy.kind} policy.`,
          });
          continue;
        }
      }
      if (
        claim.node !== null &&
        !columns.some(
          (column) => column.group === 'Node line' && column.matches(claim),
        )
      ) {
        findings.push({
          kind: 'unsupported-context',
          message: `${stage.stage}: ${claim.check} ran on Node ${claim.node}, on no line the packages support.`,
        });
      }
      for (const column of columns) {
        if (!column.matches(claim)) continue;
        const key = cellKey(row.id, column.id);
        if (!exercised.has(key)) exercised.set(key, []);
        (exercised.get(key) as string[]).push(`${stage.stage}: ${claim.check}`);
      }
    }
  }

  // Reasons.
  const reasoned = new Map<string, string>();
  for (const rule of reasons) {
    const selectedRows = select(rule.rows, rows, (row) => row.category);
    const selectedColumns = select(
      rule.columns,
      columns,
      (column) => column.id.split(':')[0] as string,
    );
    for (const unknown of [
      ...selectedRows.unknown,
      ...selectedColumns.unknown,
    ]) {
      findings.push({
        kind: 'unknown-selector',
        message: `Reason ${rule.id} names ${unknown}, which selects nothing.`,
      });
    }
    let covered = 0;
    for (const row of selectedRows.chosen) {
      for (const column of selectedColumns.chosen) {
        if (rule.exceptOwnColumn === true && row === column) continue;
        covered += 1;
        const key = cellKey(row, column);
        if (exercised.has(key)) {
          findings.push({
            kind: 'stale-reason',
            message: `Reason ${rule.id} covers ${key}, which ${(exercised.get(key) as string[])[0]} exercised. The reason has outlived its cause.`,
          });
          continue;
        }
        if (reasoned.has(key)) {
          findings.push({
            kind: 'duplicate-reason',
            message: `Reasons ${reasoned.get(key)} and ${rule.id} both cover ${key}.`,
          });
          continue;
        }
        reasoned.set(key, rule.id);
      }
    }
    if (covered === 0)
      findings.push({
        kind: 'idle-reason',
        message: `Reason ${rule.id} covers no cell.`,
      });
  }

  const red: Cell[] = [];
  for (const row of rows) {
    for (const column of columns) {
      const key = cellKey(row.id, column.id);
      if (!exercised.has(key) && !reasoned.has(key))
        red.push({ row: row.id, column: column.id });
    }
  }
  if (red.length > 0) {
    findings.push({
      kind: 'unreasoned',
      message: `${red.length} cells are neither exercised by a claim nor reasoned.`,
    });
  }
  return {
    cells: rows.length * columns.length,
    exercised,
    reasoned,
    red,
    findings,
  };
}
