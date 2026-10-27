/**
 * Cost budget.
 *
 * Nothing else in the repository measures time or memory. A quadratic stall on a public entry
 * point returns the right answer, and so does a re-admission of a whole catalog on every request,
 * so every other check in this gate passes both. The cost is the only thing about either of them
 * that is wrong, and it is the one thing nothing here would see.
 *
 * Every check here asserts the *shape* of a cost, never a wall-clock number. These run on whatever
 * machine CI provides, which is never the production host, so an absolute millisecond limit
 * measures the runner and not Equator: flaky where the runner is slow, and once padded enough to
 * stop being flaky, unable to fail. Complexity transfers across machines; milliseconds do not.
 *
 * `specs/12-verification.spec.md` section 10 states that as a rule: assert the shape of a cost
 * rather than an absolute duration wherever the measurement runs on a machine Equator does not
 * control. Section 11 is the other half of it: no recorded timing figure is kept as a threshold a
 * later run is compared against, so a growth curve is judged by the shape its own measurements
 * take.
 *
 * What this deliberately does not do is size a consumer's server. How much concurrency one host
 * sustains depends on its cores, its memory and what else runs on it. That is consumer capacity
 * planning. Equator's job is to guarantee the curve is the right shape.
 *
 * `specs/12-verification.spec.md` section 12 keeps that boundary: capacity, budgets and traffic
 * objectives belong to the application, and Equator supplies the instrument rather than the
 * target.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { listenForBrowsers } from './browser-reachable-port.ts';
import { inputsRoot, repositoryRoot } from './stage-self-test.ts';
import { type SpawnedText, spawnedOutput } from './spawned-text.ts';

const require_ = createRequire(resolve(repositoryRoot, 'package.json'));

await import(pathToFileURL(require_.resolve('@angular/compiler')).href);
// The toolkit is read from the materialized consumer rather than from `dist/toolkit` directly.
// A staged package is a set of files, not an installed one: nothing resolves its dependencies in
// place, so importing it from the workspace root fails the moment it reaches its own imports. The
// consumer install is the same artifact a consumer receives, correctly resolved, which makes it
// both the working import and the more faithful one.
const consumerToolkit = resolve(
  repositoryRoot,
  'tmp/package-consumer-verification/package-consumer/node_modules/@neolorn/equator-toolkit/index.js',
);
if (!existsSync(consumerToolkit)) {
  process.stderr.write(
    'The cost budget measures the installed toolkit. Run "pnpm run verify:consumer" first.\n',
  );
  process.exit(1);
}
const tk = await import(pathToFileURL(consumerToolkit).href);
// The modules rather than the package entry. The compiler's own machinery is not published:
// nothing outside Equator calls it, so it is not part of the toolkit's surface, and a gate that
// exercises it reaches the module that declares it.
const { compileLocalArtifacts } = await import(
  pathToFileURL(resolve(dirname(consumerToolkit), 'compiled-artifacts.js')).href
);
const { analyzeCatalogSet } = await import(
  pathToFileURL(resolve(dirname(consumerToolkit), 'semantic-model.js')).href
);
// The runtime is read from the inputs, so the self-test can withdraw what a budget guards in a
// copy of the built package. The toolkit above stays the installed one: a copied installation
// resolves none of its dependencies.
const rt = await import(
  pathToFileURL(
    resolve(inputsRoot(), 'dist/runtime/fesm2022/neolorn-equator.mjs'),
  ).href
);

/**
 * Each check declares the state it is currently expected to be in, so a known defect does not sit
 * in the gate as a permanent red that hides the next regression.
 *
 * - `pass` that fails    -> gate failure. A cost changed shape.
 * - `known-fail` that fails -> reported, gate stays green. The defect is recorded, not forgotten.
 * - `known-fail` that passes -> gate failure. The defect was fixed and this file must be updated,
 *   otherwise the check silently stops guarding anything.
 */
type Expectation = 'pass' | 'known-fail';

interface CheckResult {
  readonly name: string;
  readonly expectation: Expectation;
  readonly passed: boolean;
  readonly surprising: boolean;
  readonly detail: string;
}

const results: CheckResult[] = [];
const record = (
  name: string,
  expectation: Expectation,
  passed: boolean,
  detail: string,
) => {
  const surprising =
    (expectation === 'pass' && !passed) ||
    (expectation === 'known-fail' && passed);
  results.push({ name, expectation, passed, surprising, detail });
  const label = surprising
    ? passed
      ? 'FIXED'
      : 'FAIL '
    : passed
      ? 'pass '
      : 'known';
  process.stdout.write(`${label}  ${name}\n      ${detail}\n`);
};

const elapsedMs = (run: () => unknown) => {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

/* ------------------------------------------------------------------ *
 * E1: decimal() normalisation must not be quadratic in input length. *
 * ------------------------------------------------------------------ */

// `1.<n zeros>1` forces the unanchored /0+$/u to retry from every start position. An all-zeros
// fraction matches immediately and measures nothing, which is the easy mistake here.
const pathological = (zeros: number) => `1.${'0'.repeat(zeros)}1`;

const decimalTimings = new Map<number, number>();
for (const zeros of [8000, 16000, 32000]) {
  const samples: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    samples.push(elapsedMs(() => rt.decimal(pathological(zeros))));
  }
  decimalTimings.set(zeros, median(samples));
}

const decimalGrowth =
  (decimalTimings.get(32000) as number) /
  Math.max(decimalTimings.get(8000) as number, 0.001);

// Linear work grows 4x across a 4x input. Quadratic grows 16x. The midpoint is a wide gap, so this
// stays decisive without being sensitive to runner speed.
const DECIMAL_LIMIT = 9;
record(
  'decimal() is sub-quadratic in input length',
  // The trailing-zero strip is a single backward scan instead of an unanchored regex that
  // restarted at every position. This guards that.
  'pass',
  decimalGrowth < DECIMAL_LIMIT,
  `4x input grew cost ${decimalGrowth.toFixed(1)}x (linear ~4x, quadratic ~16x, limit ${DECIMAL_LIMIT}x); ` +
    [...decimalTimings]
      .map(([zeros, ms]) => `${zeros}:${ms.toFixed(1)}ms`)
      .join(' '),
);

/* ----------------------------------------------------------------------- *
 * B4: per-request snapshot construction must not scale with catalog size. *
 * ----------------------------------------------------------------------- */

/**
 * Parsed by the toolkit, not written out here.
 *
 * This was an object literal, and it drifted: `personNameLocales` became a required field of
 * the loaded configuration (optional in `equator.config.json`, defaulted by the loader) and
 * this literal never gained it. `analyzeCatalogSet` spreads that field unconditionally,
 * correctly, because every configuration it is meant to receive has been through the loader.
 * So the whole gate died on a value only this file could produce, while no consumer could hit
 * it at all.
 *
 * Going through the loader means the configuration this measures is built the way a consumer's
 * is, every default included, and a field added later arrives here with its default rather than
 * as a literal this file has to keep in step.
 */
function loadedConfiguration(locales: readonly string[]) {
  const parsed = tk.parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales,
    }),
  );
  if (!parsed.ok) {
    process.stderr.write(
      `The cost budget's own configuration did not load: ${(
        parsed.diagnostics ?? []
      )
        .map(
          ({
            code,
            summary,
          }: {
            readonly code: string;
            readonly summary: string;
          }) => `${code} ${summary}`,
        )
        .join('; ')}\n`,
    );
    process.exit(1);
  }
  return parsed.value;
}

// Enough distinct tags for the largest locale count a case asks for, the source first.
const LOCALES = [
  'en-US',
  ...['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv']
    .flatMap((language) =>
      ['US', 'GB', 'FR', 'DE', 'ES', 'IT', 'BR', 'NL'].map(
        (region) => `${language}-${region}`,
      ),
    )
    .filter((locale) => locale !== 'en-US'),
];

const oneMessage = '  m.k: "Hello."\n';

interface CatalogArtifact {
  readonly key: {
    readonly providerId: string;
    readonly scopeId: string;
    readonly catalogLocale: string;
  };
  readonly applicationContractFingerprint: string;
  readonly semanticRegistryFingerprint: string;
}

interface CatalogSet {
  readonly artifacts: {
    readonly catalogs: readonly CatalogArtifact[];
    readonly descriptor: {
      readonly applicationContractFingerprint: string;
      readonly semanticRegistryFingerprint: string;
    };
  };
  readonly locales: string[];
}

interface CatalogSetShape {
  readonly providers?: number;
  readonly scopes?: number;
  readonly locales?: number;
  readonly messages?: string;
}

type CatalogLoader = () => Promise<unknown>;

/**
 * A compiled set of `providers` x `scopes` x `locales` catalogs, each holding `messages`.
 *
 * Built through the toolkit's own analysis and compiler rather than written out here, for the
 * reason the configuration is: a hand-written artifact drifts from what a consumer's generation
 * produces, and a cost measured over it is a cost of something no consumer runs.
 */
function catalogSet({
  providers = 1,
  scopes = 1,
  locales = 1,
  messages = oneMessage,
}: CatalogSetShape = {}): Promise<CatalogSet> {
  const configured = LOCALES.slice(0, locales);
  const configuration = loadedConfiguration(configured);
  const catalogs: unknown[] = [];
  for (let provider = 0; provider < providers; provider += 1) {
    for (let scope = 0; scope < scopes; scope += 1) {
      for (const locale of configured) {
        const parsed = tk.parseCatalog(`messages:\n${messages}`, {
          role: locale === 'en-US' ? 'source' : 'target',
          providerId: `p${provider}`,
          scopeId: `s${scope}`,
          locale,
        });
        if (!parsed.ok) {
          throw new Error(
            `The cost budget's catalog did not parse: ${JSON.stringify(parsed.diagnostics?.[0])}`,
          );
        }
        catalogs.push(parsed.value);
      }
    }
  }
  const graph = analyzeCatalogSet({ configuration, catalogs });
  if (!graph.ok) {
    throw new Error(
      `The cost budget's catalogs did not analyze: ${JSON.stringify(graph.diagnostics?.[0])}`,
    );
  }
  const compiled = compileLocalArtifacts({
    owner: {
      providerId: '@neolorn/verify',
      generatedRootPath: 'src/generated/i18n',
    },
    graph: graph.value,
    catalogs,
    configuration,
  });
  if (!compiled.ok) {
    throw new Error(
      `The cost budget's catalogs did not compile: ${JSON.stringify(compiled.diagnostics?.[0])}`,
    );
  }
  return Promise.resolve({ artifacts: compiled.value, locales: configured });
}

/**
 * A context over `set`, counting every catalog its loaders hand out in `loads.count`.
 *
 * Each loader returns the same catalog object on every call, as a generated loader returns the same
 * module export, so admission is paid once per catalog the way it is in a consumer.
 */
function contextOver(
  { artifacts, locales }: CatalogSet,
  {
    loads = { count: 0 },
    loader,
    bootstrapScopes,
    maximumCachedCatalogs,
  }: {
    readonly loads?: { count: number };
    readonly loader?: (catalog: CatalogArtifact) => CatalogLoader;
    readonly bootstrapScopes?: readonly {
      readonly providerId: string;
      readonly scopeId: string;
    }[];
    readonly maximumCachedCatalogs?: number;
  } = {},
) {
  const catalogLoaders: Record<string, CatalogLoader> = {};
  const scopes = new Map<string, CatalogArtifact>();
  for (const catalog of artifacts.catalogs) {
    const { providerId, scopeId, catalogLocale } = catalog.key;
    catalogLoaders[`${providerId}:${scopeId}:${catalogLocale}`] =
      loader?.(catalog) ??
      (() => {
        loads.count += 1;
        return Promise.resolve(catalog);
      });
    scopes.set(`${providerId}:${scopeId}`, catalog);
  }
  return rt.createLocalizationContext({
    setup: {
      configuration: Object.freeze({
        generatedAbi: 'equator-generated/1',
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: Object.freeze(locales),
        aliases: Object.freeze({}),
        applicationContractFingerprint:
          artifacts.descriptor.applicationContractFingerprint,
        semanticRegistryFingerprint:
          artifacts.descriptor.semanticRegistryFingerprint,
        extensionDescriptors: Object.freeze([]),
        scopes: Object.freeze(
          [...scopes.values()].map((catalog) =>
            Object.freeze({
              providerId: catalog.key.providerId,
              scopeId: catalog.key.scopeId,
              applicationContractFingerprint:
                catalog.applicationContractFingerprint,
              semanticRegistryFingerprint: catalog.semanticRegistryFingerprint,
              requiredExtensions: Object.freeze([]),
            }),
          ),
        ),
      }),
      catalogSet: artifacts.descriptor,
      catalogLoaders,
      ...(maximumCachedCatalogs === undefined ? {} : { maximumCachedCatalogs }),
    },
    bootstrapScopes: bootstrapScopes ?? [
      Object.freeze({ providerId: 'p0', scopeId: 's0' }),
    ],
  });
}

const manyMessages = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      `  m.k${index}: "Message number ${index} with a little body."\n`,
  ).join('');

async function perContextMs(messageCount: number, runs: number) {
  const set = await catalogSet({ messages: manyMessages(messageCount) });
  await contextOver(set).initialize(); // warm module init out of the measurement
  const start = process.hrtime.bigint();
  for (let run = 0; run < runs; run += 1) {
    await contextOver(set).initialize();
  }
  return Number(process.hrtime.bigint() - start) / 1e6 / runs;
}

const small = await perContextMs(500, 10);
const large = await perContextMs(5000, 10);
const snapshotGrowth = large / Math.max(small, 0.001);

// A request pays for the request, not for the catalog. Constructing a context over a catalog ten
// times larger should cost about the same; anything proportional means the catalog is being
// re-admitted per request instead of once per process.
const SNAPSHOT_LIMIT = 3;
record(
  'request-scoped context construction is flat in catalog size',
  // Admission is memoised by content identity, so the catalog is verified once per process
  // rather than once per request.
  'pass',
  snapshotGrowth < SNAPSHOT_LIMIT,
  `10x catalog grew per-context cost ${snapshotGrowth.toFixed(1)}x (flat ~1x, limit ${SNAPSHOT_LIMIT}x); ` +
    `500:${small.toFixed(1)}ms 5000:${large.toFixed(1)}ms`,
);

/* ------------------------------------------------------------------ *
 * The shared formatter store must be bounded by its ceiling, not by    *
 * how many distinct option shapes a caller happens to ask for.         *
 * ------------------------------------------------------------------ */

/**
 * The standalone formatting functions' `Intl` cache was hoisted to module scope, which moves the
 * memory line rather than the speed line. A per-call
 * cache cannot leak, because it dies with the call; a process-wide one holds what it is given until
 * something evicts it.
 *
 * So the shape asserted is that growth does not follow the *variety* of the input. The store is
 * driven to its ceiling first (that fill is the baseline, and it is a fixed cost the design
 * accepts) and then given ten times the ceiling in further distinct locale-and-option pairs, none
 * of them repeating. A bounded store evicts and stays flat; an unbounded one keeps every one.
 *
 * Distinct *pairs* rather than distinct options, because the leak this guards against is content
 * driven: a route parameter or a user-supplied value reaching a locale or a formatting option is
 * what makes the variety unbounded in the first place, and a caller with one locale and four
 * option shapes was never at risk.
 *
 * Measured against the built package, both sides of it: 0.07 MiB with the bound in place, three
 * runs agreeing to 0.01, and 20.04 MiB with the eviction loop removed from
 * `FormatterCache.remember` and the package rebuilt. The limit sits at 4 MiB, about fifty times
 * the bounded reading and a fifth of the unbounded one, so it is not a number the noise can reach
 * and not one a real regression can hide under.
 */
type FormatCall = [
  { readonly locale: string },
  {
    readonly useGrouping: boolean | 'always';
    readonly minimumIntegerDigits: number;
    readonly minimumFractionDigits: number;
    readonly maximumFractionDigits: number;
  },
];

if (typeof globalThis.gc === 'function') {
  const ceiling = rt.RUNTIME_LIMITS.formatterCacheEntries;
  const one = rt.decimal('1');
  const calls: FormatCall[] = [];
  build: for (const locale of ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'ar-EG']) {
    for (const useGrouping of [true, false, 'always'] satisfies (
      boolean | 'always'
    )[]) {
      for (let integers = 1; integers <= 21; integers += 1) {
        for (let least = 0; least <= 20; least += 1) {
          for (let most = least; most <= 20; most += 1) {
            calls.push([
              { locale },
              {
                useGrouping,
                minimumIntegerDigits: integers,
                minimumFractionDigits: least,
                maximumFractionDigits: most,
              },
            ]);
            if (calls.length >= ceiling * 11) break build;
          }
        }
      }
    }
  }

  for (let index = 0; index < ceiling; index += 1) {
    rt.formatNumber(
      one,
      (calls[index] as FormatCall)[0],
      (calls[index] as FormatCall)[1],
    );
  }
  globalThis.gc();
  globalThis.gc();
  const baseline = process.memoryUsage().heapUsed;
  for (let index = ceiling; index < calls.length; index += 1) {
    rt.formatNumber(
      one,
      (calls[index] as FormatCall)[0],
      (calls[index] as FormatCall)[1],
    );
  }
  globalThis.gc();
  globalThis.gc();
  const growth = process.memoryUsage().heapUsed - baseline;
  const STORE_LIMIT = 4 * 1024 * 1024;
  record(
    'the shared formatter store is bounded by its ceiling',
    'pass',
    growth < STORE_LIMIT,
    `${calls.length - ceiling} distinct locale/option pairs past a ceiling of ${ceiling} grew heap ` +
      `${(growth / 1024 / 1024).toFixed(2)} MiB (bounded ~0.07, unbounded ~20.0, limit ${STORE_LIMIT / 1024 / 1024} MiB)`,
  );
} else {
  record(
    'the shared formatter store is bounded by its ceiling',
    'pass',
    false,
    'not measured: node ran without --expose-gc, so heap growth cannot be read',
  );
}

/* ------------------------------------------------------------ *
 * Memory must not accumulate across repeated locale switching.  *
 * ------------------------------------------------------------ */

if (typeof globalThis.gc === 'function') {
  const set = await catalogSet({ locales: 2, messages: manyMessages(500) });
  const localization = contextOver(set);
  await localization.initialize();
  // Between two locales, because a switch to the locale already committed is answered without a
  // transition, and 500 of those measure nothing.
  // A commit is counted by the snapshot it produces, which is new for every switch that did work.
  let snapshotId = -1;
  const switchTo = async (run: number) => {
    const result = await localization.changeLocale(set.locales[run % 2]);
    if (
      result.status !== 'committed' ||
      result.snapshot.primaryLocale !== set.locales[run % 2] ||
      result.snapshot.id === snapshotId
    ) {
      return 0;
    }
    snapshotId = result.snapshot.id;
    return 1;
  };
  for (let run = 0; run < 50; run += 1) await switchTo(run);
  globalThis.gc();
  const baseline = process.memoryUsage().heapUsed;
  let committed = 0;
  for (let run = 0; run < 500; run += 1) committed += await switchTo(run);
  globalThis.gc();
  const growth = process.memoryUsage().heapUsed - baseline;
  const MEMORY_LIMIT = 8 * 1024 * 1024;
  record(
    'repeated locale switching does not accumulate heap',
    'pass',
    committed === 500 && growth < MEMORY_LIMIT,
    `500 switches between two locales, ${committed} committed, grew heap ${(growth / 1024 / 1024).toFixed(1)} MiB (limit ${MEMORY_LIMIT / 1024 / 1024} MiB)`,
  );
} else {
  record(
    'repeated locale switching does not accumulate heap',
    'pass',
    false,
    'not measured: node ran without --expose-gc, so heap growth cannot be read',
  );
}

/* ------------------------------------------------------------------ *
 * What a context loads must not follow provider, scope or locale      *
 * counts, and what constructing one costs must not follow the set.    *
 * ------------------------------------------------------------------ */

// Two scopes at least, so the last one is never the bootstrap scope and loading it is lazy.
const countedSets = [
  { providers: 1, scopes: 2, locales: 2 },
  { providers: 1, scopes: 2, locales: 32 },
  { providers: 1, scopes: 32, locales: 2 },
  { providers: 8, scopes: 4, locales: 2 },
];
const countedLoads: {
  readonly providers: number;
  readonly scopes: number;
  readonly locales: number;
  readonly initial: number;
  readonly switched: number;
  readonly lazy: number;
}[] = [];
for (const shape of countedSets) {
  const set = await catalogSet(shape);
  const loads = { count: 0 };
  const localization = contextOver(set, { loads });
  await localization.initialize();
  const initial = loads.count;
  await localization.changeLocale(set.locales[1]);
  const switched = loads.count - initial;
  await localization.ensureScope({
    providerId: `p${shape.providers - 1}`,
    scopeId: `s${shape.scopes - 1}`,
  });
  const lazy = loads.count - initial - switched;
  countedLoads.push({ ...shape, initial, switched, lazy });
}
const describeLoads = countedLoads
  .map(
    ({ providers, scopes, locales, initial, switched, lazy }) =>
      `${providers}x${scopes}x${locales}: ${initial}/${switched}/${lazy}`,
  )
  .join(' ');
// One bootstrap scope, so initialization loads its one catalog and a switch loads that scope in
// the new locale. Anything more is loading work proportional to the set rather than to the page.
record(
  'a switch loads the scopes in use, whatever the provider, scope and locale counts',
  'pass',
  countedLoads.every(
    ({ initial, switched }) => initial === 1 && switched === 1,
  ),
  `providers x scopes x locales: loads at initialization/switch/lazy scope ${describeLoads} (expected 1/1 throughout)`,
);
record(
  'initial loading takes the bootstrap scope only, and a lazy scope costs the same at every count',
  'pass',
  countedLoads.every(
    ({ initial, lazy }) =>
      initial === 1 &&
      lazy === (countedLoads[0] as { readonly lazy: number }).lazy,
  ),
  `providers x scopes x locales: loads at initialization/switch/lazy scope ${describeLoads}`,
);

/**
 * A context is constructed per server request, and nothing in the generated set it is built over
 * depends on the request. Constructing one over 64 times as many catalogs should cost about the
 * same, which is the same argument as the per-request catalog admission above.
 *
 * Known to fail: the constructor snapshots and re-validates the whole descriptor and configuration
 * for every context. Sharing the admitted result between contexts is what would flatten it, and
 * `specs/06-runtime-and-angular.spec.md` section 6 names only catalog artifacts as what contexts
 * may share, so the fix waits on that section.
 */
async function constructionMs(shape: CatalogSetShape) {
  const set = await catalogSet(shape);
  contextOver(set);
  const samples: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    samples.push(
      elapsedMs(() => {
        for (let index = 0; index < 10; index += 1) contextOver(set);
      }) / 10,
    );
  }
  return median(samples);
}
const fewCatalogs = await constructionMs({ scopes: 1, locales: 8 });
const manyCatalogs = await constructionMs({ scopes: 64, locales: 8 });
const constructionGrowth = manyCatalogs / Math.max(fewCatalogs, 0.001);
const CONSTRUCTION_LIMIT = 3;
record(
  'context construction is flat in the number of catalogs the set declares',
  'known-fail',
  constructionGrowth < CONSTRUCTION_LIMIT,
  `64x catalogs grew per-context construction ${constructionGrowth.toFixed(1)}x (flat ~1x, limit ${CONSTRUCTION_LIMIT}x); ` +
    `8:${fewCatalogs.toFixed(2)}ms 512:${manyCatalogs.toFixed(2)}ms`,
);

/* ------------------------------------------------------------------ *
 * Coordinated and progressive switching, and participant readiness.   *
 * ------------------------------------------------------------------ */

const participantSet = await catalogSet({ locales: 4 });
const settle = (milliseconds: number) =>
  new Promise((resolveSettle) => setTimeout(resolveSettle, milliseconds));

// Each prepare waits on a timer, so a switch that does not wait for it resolves before any has
// finished, and the count at resolution says which kind of switch it was.
async function preparedAtResolution(
  mode: 'coordinated' | 'progressive',
  count: number,
) {
  const localization = contextOver(participantSet);
  await localization.initialize();
  const prepared = { count: 0 };
  for (let index = 0; index < count; index += 1) {
    localization.registerParticipant(
      {
        id: `participant-${index}`,
        prepare: async (context: { readonly targetLocale: string }) => {
          await settle(5);
          prepared.count += 1;
          return {
            status: 'ready',
            representation: {
              kind: 'locale-bound',
              supplyingLocale: context.targetLocale,
              direction: 'ltr',
            },
          };
        },
      },
      { coordination: 'required' },
    );
  }
  await settle(50);
  const before = prepared.count;
  await localization.changeLocale(participantSet.locales[1], { mode });
  const atResolution = prepared.count - before;
  const deadline = Date.now() + 5_000;
  while (prepared.count - before < count && Date.now() < deadline) {
    await settle(5);
  }
  return { atResolution, eventually: prepared.count - before };
}
const switchModes = [];
for (const count of [1, 16, 128]) {
  switchModes.push({
    count,
    coordinated: await preparedAtResolution('coordinated', count),
    progressive: await preparedAtResolution('progressive', count),
  });
}
record(
  'a coordinated switch waits for every required participant, and a progressive one for none',
  'pass',
  switchModes.every(
    ({ count, coordinated, progressive }) =>
      coordinated.atResolution === count &&
      progressive.atResolution === 0 &&
      progressive.eventually === count,
  ),
  `participants: prepared when coordinated/progressive resolved ` +
    switchModes
      .map(
        ({ count, coordinated, progressive }) =>
          `${count}:${coordinated.atResolution}/${progressive.atResolution}`,
      )
      .join(' '),
);

// One participant cannot supply the target, so the switch fails and every participant that
// prepared for it has to be discarded; a switch to the locale already rendered prepares nothing.
async function unreadySwitch(count: number) {
  const localization = contextOver(participantSet);
  await localization.initialize();
  const counts = { prepared: 0, discarded: 0 };
  for (let index = 0; index < count; index += 1) {
    localization.registerParticipant(
      {
        id: `participant-${index}`,
        prepare: (context: { readonly targetLocale: string }) => {
          counts.prepared += 1;
          return index === 0 && context.targetLocale !== 'en-US'
            ? {
                status: 'unavailable',
                outcome: 'localized-representation-unavailable',
              }
            : {
                status: 'ready',
                representation: {
                  kind: 'locale-bound',
                  supplyingLocale: context.targetLocale,
                  direction: 'ltr',
                },
              };
        },
        discard: () => {
          counts.discarded += 1;
        },
      },
      { coordination: 'required' },
    );
  }
  await settle(20);
  const before = counts.prepared;
  const failed = await localization.changeLocale(participantSet.locales[1]);
  const prepared = counts.prepared - before;
  await localization.changeLocale('en-US');
  const beforeSame = counts.prepared;
  await localization.changeLocale('en-US');
  return {
    count,
    status: failed.status,
    prepared,
    discarded: counts.discarded,
    same: counts.prepared - beforeSame,
  };
}
const readiness = [];
for (const count of [2, 16, 128]) readiness.push(await unreadySwitch(count));
record(
  'a switch prepares each participant once and discards every one a refused switch prepared',
  'pass',
  readiness.every(
    ({ count, status, prepared, discarded, same }) =>
      status === 'failed' &&
      prepared === count &&
      discarded === count &&
      same === 0,
  ),
  `participants: status/prepared/discarded/prepared again for the same locale ` +
    readiness
      .map(
        ({ count, status, prepared, discarded, same }) =>
          `${count}:${status}/${prepared}/${discarded}/${same}`,
      )
      .join(' '),
);

/* ------------------------------------------------------------------ *
 * Repeated failure and cache pressure.                                *
 * ------------------------------------------------------------------ */

if (typeof globalThis.gc === 'function') {
  const failing = participantSet.locales[1];
  const attempts = { count: 0 };
  const localization = contextOver(participantSet, {
    loader: (catalog: CatalogArtifact) =>
      catalog.key.catalogLocale === failing
        ? () => {
            attempts.count += 1;
            return Promise.reject(new Error('The catalog is unavailable.'));
          }
        : () => Promise.resolve(catalog),
  });
  await localization.initialize();
  const fail = async (times: number) => {
    let failed = 0;
    for (let attempt = 0; attempt < times; attempt += 1) {
      const result = await localization.changeLocale(failing);
      if (result.status === 'failed') failed += 1;
    }
    return failed;
  };
  await fail(10);
  globalThis.gc();
  const baseline = process.memoryUsage().heapUsed;
  const beforeAttempts = attempts.count;
  const failed = await fail(1000);
  globalThis.gc();
  const growth = process.memoryUsage().heapUsed - baseline;
  const loads = attempts.count - beforeAttempts;
  const FAILURE_LIMIT = 2 * 1024 * 1024;
  // A failed load must be tried again on the next request, once, and leave nothing behind: a
  // remembered failure would never recover, and a retained attempt grows with every one.
  record(
    'each repeated failure costs one load and keeps nothing',
    'pass',
    failed === 1000 && loads === 1000 && growth < FAILURE_LIMIT,
    `1000 failing switches: ${failed} failed, ${loads} loads, heap grew ${(growth / 1024 / 1024).toFixed(2)} MiB (limit ${FAILURE_LIMIT / 1024 / 1024} MiB)`,
  );
} else {
  record(
    'each repeated failure costs one load and keeps nothing',
    'pass',
    false,
    'not measured: node ran without --expose-gc, so heap growth cannot be read',
  );
}

const pressureSet = await catalogSet({ locales: 8 });
async function loadsPerSwitch(
  maximumCachedCatalogs: number,
  workingSet: number,
) {
  const loads = { count: 0 };
  const localization = contextOver(pressureSet, {
    loads,
    maximumCachedCatalogs,
  });
  await localization.initialize();
  const cycle = async () => {
    for (let index = 0; index < workingSet; index += 1) {
      await localization.changeLocale(pressureSet.locales[index]);
    }
  };
  await cycle();
  await cycle();
  const before = loads.count;
  for (let round = 0; round < 4; round += 1) await cycle();
  return (loads.count - before) / (4 * workingSet);
}
const pressure = [];
for (const [maximum, workingSet] of [
  [2, 2],
  [2, 3],
  [2, 6],
  [4, 4],
  [4, 6],
] satisfies [number, number][]) {
  pressure.push({
    maximum,
    workingSet,
    perSwitch: await loadsPerSwitch(maximum, workingSet),
  });
}
record(
  'the catalog cache reloads only past maximumCachedCatalogs, and then at most once per switch',
  'pass',
  pressure.every(({ maximum, workingSet, perSwitch }) =>
    workingSet <= maximum ? perSwitch === 0 : perSwitch > 0 && perSwitch <= 1,
  ),
  `maximum/working set: loads per switch ` +
    pressure
      .map(
        ({ maximum, workingSet, perSwitch }) =>
          `${maximum}/${workingSet}:${perSwitch.toFixed(2)}`,
      )
      .join(' '),
);

/* ------------------------------------------------------------------ *
 * Adversarial input at and beyond the allowed bounds, and message     *
 * complexity.                                                         *
 * ------------------------------------------------------------------ */

const numberBound = rt.RUNTIME_LIMITS.canonicalNumberCodeUnits;
const decimalOfLength = (length: number) => `1.${'0'.repeat(length - 3)}1`;
const refusalMs = (value: string) => {
  let refused = true;
  const cost = median(
    Array.from({ length: 5 }, () =>
      elapsedMs(() => {
        for (let call = 0; call < 50; call += 1) {
          try {
            rt.decimal(value);
            refused = false;
          } catch {
            // The refusal is the expected answer; what is measured is what it cost.
          }
        }
      }),
    ),
  );
  return { refused, cost: cost / 50 };
};
let acceptedAtBound = true;
try {
  rt.decimal(decimalOfLength(numberBound));
} catch {
  acceptedAtBound = false;
}
const justBeyond = refusalMs(decimalOfLength(numberBound + 1));
const farBeyond = refusalMs(decimalOfLength(numberBound * 100));
const refusalGrowth = farBeyond.cost / Math.max(justBeyond.cost, 0.0001);
// Refusing an oversized value has to cost the same however far past the bound it is; a refusal
// that reads the value first is paid by whoever sends the largest one.
const REFUSAL_LIMIT = 3;
record(
  'a number at the bound is accepted, and one beyond it is refused at a cost that does not grow',
  'pass',
  acceptedAtBound &&
    justBeyond.refused &&
    farBeyond.refused &&
    refusalGrowth < REFUSAL_LIMIT,
  `${numberBound} code units accepted: ${acceptedAtBound}; refused at 1x+1/100x: ${justBeyond.refused}/${farBeyond.refused}; ` +
    `100x the bound cost ${refusalGrowth.toFixed(1)}x the refusal just past it (limit ${REFUSAL_LIMIT}x)`,
);

async function evaluationMs(variants: number) {
  const lines = ['.input {$n :number}', '.match $n'];
  for (let index = 0; index < variants - 1; index += 1) {
    // Short, so 4096 of them stay inside the MessageFormat source ceiling.
    lines.push(`${index} {{v}}`);
  }
  lines.push('* {{other}}');
  const set = await catalogSet({
    messages: `  m.k: |\n    ${lines.join('\n    ')}\n`,
  });
  const localization = contextOver(set);
  await localization.initialize();
  const handle = Object.freeze({
    generatedAbi: 'equator-generated/1',
    providerId: 'p0',
    scopeId: 's0',
    messageId: 'm.k',
    identity: 'p0:s0:m.k',
    resultKind: 'plain',
    inputNames: Object.freeze(['n']),
    slotNames: Object.freeze([]),
  });
  // A value no key names, so selection reads every variant before it settles on the catch-all.
  const evaluate = () => localization.evaluateText(handle, { n: variants + 5 });
  evaluate();
  return median(
    Array.from({ length: 5 }, () =>
      elapsedMs(() => {
        for (let call = 0; call < 50; call += 1) evaluate();
      }),
    ),
  );
}
const fewVariants = await evaluationMs(1024);
const manyVariants = await evaluationMs(4096);
const evaluationGrowth = manyVariants / Math.max(fewVariants, 0.001);
const EVALUATION_LIMIT = 9;
record(
  'evaluating a message is linear in its variants',
  'pass',
  evaluationGrowth < EVALUATION_LIMIT,
  `4x variants grew evaluation ${evaluationGrowth.toFixed(1)}x (linear ~4x, quadratic ~16x, limit ${EVALUATION_LIMIT}x); ` +
    `1024:${(fewVariants / 50).toFixed(3)}ms 4096:${(manyVariants / 50).toFixed(3)}ms`,
);

/* ------------------------------------------------------------------ *
 * Cold and warm generation.                                           *
 * ------------------------------------------------------------------ */

/**
 * Run through the installed command line in a project of its own, because generation is what a
 * consumer runs and its cost is what the output transaction writes. Nested under `tmp`, so it is
 * not an artefact any other stage can see.
 */
const generationRoot = resolve(repositoryRoot, 'tmp/cost-budget-generation');
const equatorCli = resolve(dirname(consumerToolkit), 'cli.js');
function generated(cwd: string): number {
  const finished: SpawnedText = spawnSync(
    process.execPath,
    [equatorCli, 'generate', '--json'],
    { cwd, encoding: 'utf8' },
  );
  const result = JSON.parse(
    (finished.stdout ?? '').trim().split('\n').at(-1) ?? '{}',
  ) as {
    readonly status?: unknown;
    readonly result: { readonly written: readonly unknown[] };
  };
  if (result.status !== 'success') {
    throw new Error(
      `equator generate did not succeed in ${cwd}: ${spawnedOutput(finished)}`,
    );
  }
  return result.result.written.length;
}
async function generationWrites(scopes: number) {
  const cwd = resolve(generationRoot, `scopes-${scopes}`);
  await mkdir(resolve(cwd, 'src'), { recursive: true });
  await writeFile(
    resolve(cwd, 'package.json'),
    `${JSON.stringify({ name: `cost-budget-${scopes}`, private: true })}\n`,
  );
  await writeFile(
    resolve(cwd, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'preserve', strict: true },
      include: ['src/**/*.ts'],
    })}\n`,
  );
  await writeFile(
    resolve(cwd, 'src/main.ts'),
    'export const started = true;\n',
  );
  spawnSync(
    process.execPath,
    [
      equatorCli,
      'init',
      '--source-locale',
      'en-US',
      '--default-locale',
      'en-US',
      '--locale',
      'en-US',
      '--locale',
      'fr-FR',
      '--json',
    ],
    { cwd, encoding: 'utf8' },
  );
  for (let scope = 0; scope < scopes; scope += 1) {
    await mkdir(resolve(cwd, `i18n/s${scope}`), { recursive: true });
    await writeFile(
      resolve(cwd, `i18n/s${scope}/en-US.yaml`),
      `messages:\n  greeting: "Hello ${scope}"\n`,
    );
    await writeFile(
      resolve(cwd, `i18n/s${scope}/fr-FR.yaml`),
      `messages:\n  greeting: "Bonjour ${scope}"\n`,
    );
  }
  const cold = generated(cwd);
  const warm = generated(cwd);
  await writeFile(
    resolve(cwd, 'i18n/s0/fr-FR.yaml'),
    'messages:\n  greeting: "Salut"\n',
  );
  const edited = generated(cwd);
  return { scopes, cold, warm, edited };
}
await rm(generationRoot, { recursive: true, force: true });
const generations: {
  readonly scopes: number;
  readonly cold: number;
  readonly warm: number;
  readonly edited: number;
}[] = [];
for (const scopes of [1, 10, 40])
  generations.push(await generationWrites(scopes));
await rm(generationRoot, { recursive: true, force: true });
record(
  'regenerating rewrites nothing when nothing changed, and the same files after a one-message edit at every scope count',
  'pass',
  generations.every(
    ({ warm, edited }) =>
      warm === 0 &&
      edited === (generations[0] as { readonly edited: number }).edited,
  ) && (generations[0] as { readonly edited: number }).edited > 0,
  `scopes: files written cold/warm/after one edit ` +
    generations
      .map(
        ({ scopes, cold, warm, edited }) =>
          `${scopes}:${cold}/${warm}/${edited}`,
      )
      .join(' '),
);

/* ------------------------------------------------------------------ *
 * Server rendering concurrency and hydration transfer.                *
 * ------------------------------------------------------------------ */

/**
 * The full consumer's own server, answering on a loopback port, because what a response transfers
 * is decided by the rendered application and nothing smaller has one.
 *
 * Every request is for the same two pages, so every response for a locale has to carry the same
 * transfer bytes as one rendered alone: state from another request in flight is the first thing
 * concurrency would add to it.
 */
const TRANSFER_KEY = '@neolorn/equator:localization-state/1';
const consumerServer = await import(
  pathToFileURL(
    resolve(
      repositoryRoot,
      'tmp/package-consumer-verification/package-consumer/dist/feature-lab/server/server.mjs',
    ),
  ).href
);
// The consumer logs every runtime event on the console, which is its own diagnostics and would
// bury this budget's lines; everything else still reaches the console.
const consoleInfo = console.info;
console.info = (...lines) => {
  if (typeof lines[0] === 'string' && lines[0].startsWith('equator-event '))
    return;
  consoleInfo(...lines);
};
const listening = createServer(consumerServer.reqHandler);
const serverOrigin = `http://127.0.0.1:${await listenForBrowsers(listening, '127.0.0.1')}`;
async function transferAt(path: string): Promise<string | undefined> {
  const response = await fetch(`${serverOrigin}${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const html = await response.text();
  const state = html.match(
    /<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/u,
  );
  const transfer =
    state === null
      ? undefined
      : (JSON.parse(state[1] as string) as Record<string, unknown>)[
          TRANSFER_KEY
        ];
  return response.status === 200 && transfer !== undefined
    ? JSON.stringify(transfer)
    : undefined;
}
const renderedPages = ['/en-us', '/ar-eg'];
const alone: (string | undefined)[] = [];
for (const path of renderedPages) alone.push(await transferAt(path));
const concurrency = [];
for (const concurrent of [1, 8, 32]) {
  const paths = Array.from(
    { length: concurrent },
    (_, index) => renderedPages[index % 2] as string,
  );
  const start = process.hrtime.bigint();
  const transfers = await Promise.all(paths.map(transferAt));
  concurrency.push({
    concurrent,
    ms: Number(process.hrtime.bigint() - start) / 1e6,
    differing: transfers.filter(
      (transfer, index) =>
        transfer === undefined || transfer !== alone[index % 2],
    ).length,
  });
}
await new Promise((resolveClosed) => listening.close(resolveClosed));
console.info = consoleInfo;
record(
  'the hydration transfer of a response does not depend on how many are rendered at once',
  'pass',
  alone.every((transfer) => transfer !== undefined) &&
    concurrency.every(({ differing }) => differing === 0),
  `transfer bytes rendered alone ${alone.map((transfer) => transfer?.length).join('/')}; ` +
    `responses differing at concurrency ` +
    concurrency
      .map(({ concurrent, differing }) => `${concurrent}:${differing}`)
      .join(' '),
);
const eight = concurrency.find(({ concurrent }) => concurrent === 8);
const thirtyTwo = concurrency.find(({ concurrent }) => concurrent === 32);
const renderingGrowth =
  (thirtyTwo as { readonly ms: number }).ms /
  Math.max((eight as { readonly ms: number }).ms, 0.001);
const RENDERING_LIMIT = 9;
record(
  'server rendering cost is linear in concurrent requests',
  'pass',
  renderingGrowth < RENDERING_LIMIT,
  `4x concurrent requests grew the batch ${renderingGrowth.toFixed(1)}x (linear ~4x, quadratic ~16x, limit ${RENDERING_LIMIT}x); ` +
    `8:${(eight as { readonly ms: number }).ms.toFixed(0)}ms 32:${(thirtyTwo as { readonly ms: number }).ms.toFixed(0)}ms`,
);

/* --------------- */

const surprising = results.filter((result) => result.surprising);
const known = results.filter(
  (result) => result.expectation === 'known-fail' && !result.passed,
);

process.stdout.write(
  `\nCost budget: ${results.length - known.length - surprising.length}/${results.length} within budget` +
    `${known.length > 0 ? `, ${known.length} known defect(s) recorded` : ''}.\n`,
);

for (const result of surprising) {
  process.stdout.write(
    result.passed
      ? `\n${result.name}\n  now passes but is recorded as a known defect. It was fixed. Change its ` +
          `expectation to 'pass' in tools/verify-cost-budget.ts so it guards the fix.\n`
      : result.detail.startsWith('not measured')
        ? `\n${result.name}\n  was not measured, so nothing is known about it; ${result.detail.slice('not measured: '.length)}.\n`
        : `\n${result.name}\n  regressed. A cost changed shape; this is not a slow machine.\n`,
  );
}

if (surprising.length > 0) process.exitCode = 1;
