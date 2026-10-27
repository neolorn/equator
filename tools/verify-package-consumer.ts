/**
 * A real application, built from the published packages and run in a browser and on a server.
 *
 * `specs/02-packages-and-platform.spec.md` section 11 lists what a distributable has to establish,
 * and most of it is only visible from outside: whether the export map resolves, whether one Angular
 * instance ends up in the graph, whether server rendering and the browser agree. The consumer is
 * materialized from a fixture and installs Equator the way anyone else would, because a consumer
 * wired to the workspace would resolve the sources instead of the published files.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  watch as watchFileSystem,
} from 'node:fs';
import {
  cp,
  lstat,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';

import { JSDOM } from 'jsdom';

import type { CapabilityObservation } from './capability-claims.ts';
import {
  openCapabilityEvidence,
  recordCapabilityClaim,
} from './capability-evidence.ts';
import {
  readConsumerAddresses,
  readConsumerBuilds,
  SITE_ORIGIN_DECLARATION,
} from './consumer-addresses.ts';
import { claimLoggedHandOver, loggedEvents } from './consumer-events.ts';
import type { ServerAnswer, ServerRequest } from './consumer-server-answers.ts';
import {
  claimExercisedContext,
  claimExercisedControls,
  claimExercisedDirectives,
  claimExercisedExtensions,
  claimExercisedFormats,
  claimExercisedPipes,
  claimInstalledRelativeTime,
  claimOverlayLocale,
  claimSheetParameter,
  exerciseSheetNames,
  exerciseAuthority,
  readCatalogMessage,
  readExerciseSources,
  readExerciseInputs,
  sheetInDocument,
} from './exercise-sheet.ts';
import { expectations, unmetExpectations } from './negative-expectations.ts';
import { readBuildStats } from './build-stats.ts';
import { consumerSpecsEnvironment } from './consumer-specs-environment.ts';
import { locateNode, withNodeFirst } from './node-runtimes.ts';
import {
  INIT_REQUEST,
  LOCALE_FORMATTING,
  PSEUDO_LOCALES,
} from './package-consumer-locales.ts';
import { compareVersions } from './supported-versions.ts';
import { OFFLINE_INSTALL, withOfflineStoreRemedy } from './offline-store.ts';

import {
  resolveAngularVersion,
  resolveConsumerProfile,
} from './package-consumer-profiles.ts';

/** One diagnostic as the command line writes it under `--json`, as far as this reads it. */
interface MachineDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly summary: string;
  readonly span?: { readonly sourcePath?: string };
}

/** What a command reports under `--json`, each field read only from the commands that report it. */
interface MachineResultBody {
  readonly changed: boolean;
  readonly fresh: boolean;
  readonly written: readonly string[];
  readonly removed: readonly string[];
  readonly retained: readonly string[];
  readonly files: readonly string[];
  readonly fixedFiles: readonly string[];
  // `generate` counts its catalogs, and `uninstall` lists the ones it left in place.
  readonly catalogs: number | readonly string[];
  readonly messages: number;
  readonly routes: number;
  readonly invalidation: { readonly kind: string };
}

/** The result the command line writes under `--json`. */
interface MachineResult {
  readonly profile: string;
  readonly status: string;
  readonly diagnostics: readonly MachineDiagnostic[];
  readonly result: MachineResultBody;
}

/** One import a stats file records, of an input or of an output. */
interface StatsImport {
  readonly path: string;
  readonly external?: boolean;
}

/** The module graph `--stats-json` writes, as far as this reads it. */
interface BuildStats {
  readonly inputs: Readonly<
    Record<string, { readonly imports?: readonly StatsImport[] }>
  >;
  readonly outputs: Readonly<
    Record<
      string,
      {
        readonly entryPoint?: string;
        readonly inputs?: Readonly<Record<string, unknown>>;
        readonly imports?: readonly StatsImport[];
      }
    >
  >;
}

/** One event `equator watch --json` prints, as far as this reads it. */
interface WatchEvent {
  readonly status: string;
}

/** A route listed for prerender that the build has to refuse, and how the refusal shows. */
interface RefusedPrerender {
  readonly routeId: string;
  readonly listed: string;
  readonly listing: string;
  readonly written: RegExp;
  readonly refused: readonly RegExp[];
  readonly status?: number;
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerName = process.argv[2] ?? 'package-consumer';
const consumerProfile = resolveConsumerProfile(consumerName);
const consumerRoot = resolve(
  workspaceRoot,
  'tmp/package-consumer-verification',
  consumerName,
);

// A row on another Node line runs every step on that Node: this script, the package manager, and
// each tool the consumer's scripts start. Started again here rather than by the caller, so every
// caller gets the row's Node: the gate, the runtime assurance stage, and a person running the row.
if (
  consumerProfile.node !== undefined &&
  process.versions.node !== consumerProfile.node
) {
  const { executable, failure } = await locateNode(
    consumerProfile.node,
    consumerName,
  );
  if (failure !== undefined) throw new Error(failure);
  const rerun = spawnSync(
    executable,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: withNodeFirst(process.env, executable) },
  );
  process.exit(rerun.status ?? 1);
}

// The package manager this process was started by, rather than whichever one a search of the path
// finds. pnpm is a native executable and starts every script on the first Node the search path
// holds, which on a row for another Node line is the row's: the rerun above put it there. A pnpm
// reached through a script entry is a Node program, and runs on this process's Node.
const pnpmEntry = process.env['npm_execpath'];
assert.ok(
  pnpmEntry !== undefined && pnpmEntry !== '',
  'npm_execpath is not set, so there is no package manager to run the consumer with. Start this through "pnpm run", as the gate does.',
);
const pnpmCommand: [string, string[]] = /\.[cm]?js$/u.test(pnpmEntry)
  ? [process.execPath, [pnpmEntry]]
  : [pnpmEntry, []];

const spawnPnpm = (
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
) =>
  spawnSync(pnpmCommand[0], [...pnpmCommand[1], ...args], {
    cwd: consumerRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', ...env },
  });

const run = (
  args: readonly string[],
  expectedStatus = 0,
  env: Readonly<Record<string, string>> = {},
) => {
  const result = spawnPnpm(args, env);

  assert.equal(
    result.status,
    expectedStatus,
    withOfflineStoreRemedy(
      [result.error?.message, result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n'),
    ),
  );
  return result;
};

const readJson = async (path: string) =>
  JSON.parse(await readFile(path, 'utf8'));

const verifyWatchCommand = async () => {
  const cliPath = resolve(
    consumerRoot,
    'node_modules/@neolorn/equator-toolkit/cli.js',
  );
  const sourcePath = resolve(consumerRoot, 'src/app/app.ts');
  const originalSource = await readFile(sourcePath, 'utf8');
  const child = spawn(process.execPath, [cliPath, 'watch'], {
    cwd: consumerRoot,
    env: { ...process.env, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let changed = false;
  let restored = false;
  // A second watcher on the same file, so a failure can say whether the platform reported the edit
  // or the watch command had it and did nothing.
  let editWritten = false;
  let editsReported = 0;
  const witness = watchFileSystem(dirname(sourcePath), (_event, fileName) => {
    if (editWritten && fileName === basename(sourcePath)) editsReported += 1;
  });
  const restore = async () => {
    if (restored) return;
    restored = true;
    await writeFile(sourcePath, originalSource, 'utf8');
  };
  const completed = new Promise((resolvePromise, rejectPromise) => {
    // One bound, on the whole probe. A watch cycle prints nothing while it runs, so a bound on
    // silence is a bound on how long one cycle may take, and that measures how busy the machine is:
    // a cycle is about two seconds on an idle machine and has been seen forty times slower beside
    // another build. What the probe claims is that the watcher reacts to a change, and nothing it
    // claims is about speed.
    const CEILING_MILLISECONDS = 300_000;
    const ceilingTimer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectPromise(
        new Error(
          `Equator watch probe ran past its ${CEILING_MILLISECONDS / 1000}s ceiling. ${
            editWritten
              ? `The platform reported the edit to a second watcher ${editsReported} time(s).`
              : 'The edit had not been written.'
          }\n${stdout}\n${stderr}`,
        ),
      );
    }, CEILING_MILLISECONDS);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (!changed && /Equator watch cycle 1:/u.test(stdout)) {
        changed = true;
        setTimeout(() => {
          editWritten = true;
          void writeFile(sourcePath, `${originalSource}\n`, 'utf8');
        }, 100);
      }
      if (/Equator watch cycle 2:/u.test(stdout)) {
        void restore().then(() => child.kill('SIGTERM'));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', rejectPromise);
    child.once('close', () => {
      clearTimeout(ceilingTimer);
      resolvePromise(undefined);
    });
  });
  try {
    await completed;
  } finally {
    witness.close();
    await restore();
  }
  assert.match(stdout, /Equator watch cycle 1:/u, stderr);
  assert.match(stdout, /Equator watch cycle 2:/u, stderr);
};

// The consumer names the package manager it is installed with, and it is the one this process was
// started by, so the install is the one the lock was written for.
assert.equal(
  `pnpm@${run(['--version']).stdout.trim()}`,
  (await readJson(resolve(consumerRoot, 'package.json'))).packageManager,
  'The consumer is installed with a package manager other than the one it names.',
);

run([...OFFLINE_INSTALL]);

// The Node the consumer's own tools start on, asked of the consumer. A row whose tools ran on
// another Node would otherwise pass and leave only its claims to say so.
assert.equal(
  run(['exec', 'node', '--eval', 'process.stdout.write(process.versions.node)'])
    .stdout,
  consumerProfile.node ?? process.versions.node,
  "The consumer's tools start on a Node other than the one this row runs on.",
);

const help = run(['run', 'equator:help']);
assert.match(
  help.stdout,
  /Compile and safely publish generated #i18n artifacts/,
);
assert.match(help.stdout, /Reconcile changes in one foreground process/);

const parseMachineResult = (result: SpawnSyncReturns<string>) => {
  const value = JSON.parse(result.stdout.trim()) as MachineResult;
  assert.equal(value.profile, 'equator-cli-result/1');
  return value;
};

const invalidInvocation = parseMachineResult(
  run(['exec', 'equator', 'check', '--unknown-option', '--json'], 2),
);
assert.equal(invalidInvocation.status, 'invocation-or-configuration-failure');
assert.equal(invalidInvocation.diagnostics[0]?.code, 'EQ1701');

// Invoked directly rather than through a consumer script. Running `pnpm run equator:init` would
// prove that a human had typed that script into the fixture manifest, because Equator writes no
// such entry.
const initArguments = [
  'exec',
  'equator',
  'init',
  '--source-locale',
  INIT_REQUEST.sourceLocale,
  '--default-locale',
  INIT_REQUEST.defaultLocale,
  ...INIT_REQUEST.locales.flatMap((locale) => ['--locale', locale]),
];
const initialized = run(initArguments);
// The template ships none of the Equator-owned scripts, so the first init has real work to do. That
// is the point: a fixture that pre-types them answers the question this gate is asking. Both files,
// because the template ships neither: init is what authors them.
assert.match(
  initialized.stdout,
  /Equator init updated: equator\.config\.json, package\.json/u,
);
const reinitialized = run(initArguments);
assert.match(reinitialized.stdout, /Equator init is already complete/u);

// The minimal declaration `specs/10-compiler-and-tooling.spec.md` section 10 specifies: exactly
// these keys, no more, and every value traceable to what init was asked for. The run around it
// is section 14 of `specs/10-compiler-and-tooling.spec.md`, an ordinary first run through the
// built packages and their public exports. An extra key Equator started writing would fail here,
// which comparing against a fixture's own file could never do.
//
// Asserted here rather than after the build. What it states is what *init* authored, and after
// the build the file also carries the consumer's own declarations, so asserting it there would
// mean either weakening it to tolerate them or forbidding a consumer from adding a key Equator
// supports.
assert.deepEqual(await readJson(resolve(consumerRoot, 'equator.config.json')), {
  schemaVersion: 1,
  sourceLocale: INIT_REQUEST.sourceLocale,
  defaultLocale: INIT_REQUEST.defaultLocale,
  locales: [...INIT_REQUEST.locales],
});

// Two consumer edits to the configuration, and the only ones this gate makes: the pseudo-locales
// and how one locale is written, both from `package-consumer-locales.ts`.
await writeFile(
  resolve(consumerRoot, 'equator.config.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      sourceLocale: INIT_REQUEST.sourceLocale,
      defaultLocale: INIT_REQUEST.defaultLocale,
      locales: [...INIT_REQUEST.locales],
      pseudoLocales: PSEUDO_LOCALES,
      formatting: LOCALE_FORMATTING,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
// And the script entries Equator claims to own are asserted against Equator's own declaration, so
// this fails if Equator stops writing one rather than if a fixture stops listing one.
const { PACKAGE_SCRIPTS } = await import(
  pathToFileURL(
    resolve(
      consumerRoot,
      'node_modules/@neolorn/equator-toolkit/project-host.js',
    ),
  ).href
);
const consumerScripts = (await readJson(resolve(consumerRoot, 'package.json')))
  .scripts;
for (const [name, command] of Object.entries(PACKAGE_SCRIPTS)) {
  assert.equal(
    consumerScripts?.[name],
    command,
    `equator init did not write the ${name} script it declares`,
  );
}
run(['exec', 'equator', 'format']);
const canonicalFormat = parseMachineResult(
  run(['exec', 'equator', 'format', '--dry-run', '--json']),
);
assert.equal(canonicalFormat.status, 'success');
assert.equal(canonicalFormat.result.changed, false);

const firstGeneration = parseMachineResult(
  run(['exec', 'equator', 'generate', '--json']),
);
assert.equal(firstGeneration.status, 'success');
assert.equal(firstGeneration.result.changed, true);
assert.ok(firstGeneration.result.written.length > 0);
assert.ok((firstGeneration.result.catalogs as number) >= 2);
assert.ok(firstGeneration.result.messages >= 4);
assert.ok(firstGeneration.result.routes >= 2);

// EQ1401 forwards a TypeScript finding from the consumer's own program, so one raised here is a
// report against the application's own lines. The fixture compiles under its own build, which
// leaves the generated modules the analysis reads in place of them as the thing that does not.
const forwardedTypeFindings = firstGeneration.diagnostics.filter(
  ({ code }) => code === 'EQ1401',
);
assert.deepEqual(
  forwardedTypeFindings,
  [],
  `Generation forwarded TypeScript findings against the consumer's own source:\n${JSON.stringify(forwardedTypeFindings, null, 2)}`,
);

const generatedManifestPath = resolve(
  consumerRoot,
  'src/generated/i18n/.equator-manifest.json',
);
const firstManifestTimestamp = (await lstat(generatedManifestPath)).mtimeMs;
const unchangedGeneration = parseMachineResult(
  run(['exec', 'equator', 'generate', '--json']),
);
assert.equal(unchangedGeneration.result.changed, false);
assert.equal(unchangedGeneration.result.invalidation.kind, 'none');
assert.equal(
  (await lstat(generatedManifestPath)).mtimeMs,
  firstManifestTimestamp,
);

const checked = parseMachineResult(run(['exec', 'equator', 'check', '--json']));
assert.equal(checked.status, 'success');
assert.equal(checked.result.fresh, true);

const dryClean = parseMachineResult(
  run(['exec', 'equator', 'clean', '--dry-run', '--json']),
);
assert.equal(dryClean.result.changed, true);
assert.ok(dryClean.result.removed.length > 0);
const cleaned = parseMachineResult(run(['exec', 'equator', 'clean', '--json']));
assert.equal(cleaned.result.changed, true);
await assert.rejects(lstat(resolve(consumerRoot, 'src/generated/i18n')), {
  code: 'ENOENT',
});
await assert.rejects(lstat(resolve(consumerRoot, '.equator')), {
  code: 'ENOENT',
});
const regenerated = parseMachineResult(
  run(['exec', 'equator', 'generate', '--json']),
);
assert.equal(regenerated.result.changed, true);

const generatedManifest = await readJson(generatedManifestPath);
assert.equal(generatedManifest.profile, 'equator-completion-manifest/1');
for (const required of [
  'index.ts',
  'shell.ts',
  'routes.ts',
  'recovery.ts',
  'catalog-set.json',
  'catalog-set.ts',
  'catalog-loaders.ts',
  'recovery-payload.ts',
  'resource-summary.json',
]) {
  assert.ok(
    generatedManifest.files.some(
      ({ path }: { path: string }) => path === required,
    ),
    `Generated Equator output is missing ${required}`,
  );
}
const generatedShell = await readFile(
  resolve(consumerRoot, 'src/generated/i18n/shell.ts'),
  'utf8',
);
assert.match(generatedShell, /GeneratedMessageHandle/);
assert.match(generatedShell, /defineMessageFamily/);
assert.match(generatedShell, /feature:uppercase/);
assert.match(generatedShell, /feature:badge/);
const generatedIndex = await readFile(
  resolve(consumerRoot, 'src/generated/i18n/index.ts'),
  'utf8',
);
assert.match(generatedIndex, /extensionDescriptors/);
assert.match(generatedIndex, /feature:sku-format/);
assert.match(generatedIndex, /feature:sku-parse/);

// The names the switcher renders come from the build, not from whatever CLDR the visitor's engine
// carries. Asserted on the emitted module rather than on the table it was read from: what a
// consumer ships is this line, and a lookup that silently stopped emitting would leave every
// engine free to disagree again with nothing failing.
assert.ok(
  generatedIndex.includes(
    `localeNames: Object.freeze({"en-US":"American English","ar-EG":"العربية (مصر)"} as const)`,
  ),
  'The generated configuration does not carry an endonym for each configured locale.',
);
assert.match(
  await readFile(resolve(consumerRoot, 'src/generated/i18n/routes.ts'), 'utf8'),
  /profile: 'equator-route-projection\/1'/,
);
const generatedRoutes = await readFile(
  resolve(consumerRoot, 'src/generated/i18n/routes.ts'),
  'utf8',
);
// Derived, because this route declares no identity. Only the three parameterised routes pin one.
assert.match(generatedRoutes, /id: "route:second", path: "second"/);
assert.match(generatedRoutes, /id: "item", path: "items\/:id"/);
// A const tuple, not `readonly string[]`. A route's parameter names are part of its contract:
// erased to an array, the type that requires codecs cannot tell a parameterised route from a
// parameterless one.
assert.match(
  generatedRoutes,
  /parameterNames: Object\.freeze\(\["id"\] as const\)/,
);
assert.match(generatedRoutes, /identity: "sha256-[A-Za-z0-9_-]{43}"/);
assert.match(
  await readFile(
    resolve(consumerRoot, '.equator/cache/compiler-state.json'),
    'utf8',
  ),
  /equator-compiler-cache\/1/,
);

const negativeCatalogPath = resolve(consumerRoot, 'i18n/shell/ar-EG.yaml');
const validNegativeCatalog = await readFile(negativeCatalogPath, 'utf8');
await writeFile(negativeCatalogPath, 'messages:\n  app-title: [\n', 'utf8');
const invalidCheck = parseMachineResult(
  run(['exec', 'equator', 'check', '--json'], 1),
);
assert.equal(invalidCheck.status, 'diagnostic-failure');
assert.ok(
  invalidCheck.diagnostics.some(
    ({ code, span }) =>
      code === 'EQ1101' && span?.sourcePath === 'i18n/shell/ar-EG.yaml',
  ),
  'Machine-readable catalog diagnostics are not source-located',
);
await writeFile(negativeCatalogPath, validNegativeCatalog, 'utf8');
assert.equal(
  parseMachineResult(run(['exec', 'equator', 'check', '--json'])).status,
  'success',
);

// Stale-translation detection, end to end, through the sequence that produces it rather than
// through a state file written here.
//
// The unit tests cover the reconciliation and the mutation gate covers its branches, but nothing
// exercised the whole chain: a real run writes the record, an English message moves afterwards,
// and the next run reports the translation that no longer describes it. A checked-in fixture state
// file would not have tested this: it would have tested a file authored alongside the assertion,
// which is the failure this gate exists to avoid.
const translationStatePath = resolve(
  consumerRoot,
  '.equator-translation-state.json',
);
const recordedState = JSON.parse(await readFile(translationStatePath, 'utf8'));
assert.equal(
  recordedState.profile,
  'equator-translation-state/1',
  'No translation state was recorded by the runs above',
);
// Keyed by provider, scope, message and target locale, so the assertion names the parts it
// depends on rather than a whole key it would have to be rewritten to match.
assert.ok(
  Object.keys(recordedState.entries).some((key) =>
    key.endsWith(':shell:app-title:ar-EG'),
  ),
  'The translation state records no entry for a translated message',
);

const sourceCatalogPath = resolve(consumerRoot, 'i18n/shell/en-US.yaml');
const originalSourceCatalog = await readFile(sourceCatalogPath, 'utf8');
await writeFile(
  sourceCatalogPath,
  originalSourceCatalog.replace(
    'app-title: Equator feature lab',
    'app-title: Equator feature laboratory',
  ),
  'utf8',
);
assert.notEqual(
  await readFile(sourceCatalogPath, 'utf8'),
  originalSourceCatalog,
  'The stale-translation probe did not change the source message',
);

// The release gate, end to end, on the artifact a pipeline actually runs.
//
// Two runs of the same command, one configuration line apart, asserted on the **exit status**
// because that is the only part of this a pipeline reads. The lab ships a `source-only` message
// that `ar-EG` deliberately does not translate, and the source catalog is edited above, so this
// consumer is incomplete in two of the family's four ways at once: a message is missing, and a
// translation now answers a superseded English message.
//
// The first run has no declaration and must fail, reporting both members at `error`. The second
// declares `ar-EG` still in progress and must pass, with both findings still reported, at
// `warning`, carrying the declared reason. That is the whole contract: an exemption is not a
// silence, and neither is an escalation.
//
// `check` is used rather than `generate` on purpose. `check` reports what it sees and leaves the
// translation record alone; `generate` publishes and re-stamps it, which retires the staleness.
// Running these after the `generate` below would assert against a condition it had consumed.
const gatedRun = parseMachineResult(
  run(['exec', 'equator', 'check', '--require-complete', '--json'], 1),
);
// Both members, and not only the first one found. A run that returns as soon as an escalated
// `EQ1307` fails the catalog analysis inspects neither output freshness nor the translation
// record, so the missing translation and the superseded one arrive as one finding rather than two,
// and turning the gate on gives the pipeline that asked for more information less. A run reports
// every member it can observe.
for (const code of ['EQ1307', 'EQ1309']) {
  assert.ok(
    gatedRun.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === code && diagnostic.severity === 'error',
    ),
    `The release gate did not report ${code} against a locale that is both incomplete and stale: ${JSON.stringify(
      gatedRun.diagnostics,
    )}`,
  );
}

const consumerConfigurationPath = resolve(consumerRoot, 'equator.config.json');
const consumerConfiguration = await readFile(consumerConfigurationPath, 'utf8');
await writeFile(
  consumerConfigurationPath,
  `${JSON.stringify(
    {
      ...JSON.parse(consumerConfiguration),
      inProgress: {
        'ar-EG': { note: 'Arabic copy lands with the Q4 launch.' },
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);
const exemptRun = parseMachineResult(
  run(['exec', 'equator', 'check', '--require-complete', '--json'], 0),
);
for (const code of ['EQ1307', 'EQ1309']) {
  assert.ok(
    exemptRun.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === code &&
        diagnostic.severity === 'warning' &&
        diagnostic.summary.includes('ar-EG is declared still in progress') &&
        diagnostic.summary.includes('Q4 launch'),
    ),
    `${code} did not survive the in-progress declaration as a warning carrying its reason: ${JSON.stringify(
      exemptRun.diagnostics,
    )}`,
  );
}
// The fourth member is in the family because the declaration reached it. `EQ1309` is raised from
// the project host rather than the catalog analysis, so nothing but this says the two halves read
// the same rule.
await writeFile(consumerConfigurationPath, consumerConfiguration, 'utf8');

const staleRun = parseMachineResult(
  run(['exec', 'equator', 'generate', '--json']),
);
const staleReport = staleRun.diagnostics.filter(
  ({ code }) => code === 'EQ1309',
);
assert.ok(
  staleReport.some(
    ({ summary, severity }) =>
      severity === 'warning' &&
      summary.includes('"app-title"') &&
      summary.includes('ar-EG'),
  ),
  `A translation whose source moved was not reported as stale: ${JSON.stringify(staleReport)}`,
);

await writeFile(sourceCatalogPath, originalSourceCatalog, 'utf8');
assert.equal(
  parseMachineResult(
    run(['exec', 'equator', 'generate', '--json']),
  ).diagnostics.filter(({ code }) => code === 'EQ1309').length,
  0,
  'A translation was still reported stale after its source was restored',
);

/**
 * A person-name locale an application declares but is not translated into.
 *
 * Without this key the failure is quiet in the worst way: a Japanese name inside an English
 * interface is ordered correctly, English's own data says Japanese names are surname-first,
 * and spaced wrongly, because the spacing belongs to `ja` and `ja` was never generated. Nothing
 * errors, nothing is reported, and only a reader of the language sees it. So the check is that
 * declaring the locale actually changes the artifact, run through `equator generate` rather than
 * through the library.
 */
async function verifyDeclaredPersonNameLocales() {
  const configurationPath = resolve(consumerRoot, 'equator.config.json');
  const original = await readFile(configurationPath, 'utf8');
  const personNamesPath = resolve(
    consumerRoot,
    'src/generated/i18n/person-names.ts',
  );

  const rowTags = async () => {
    const module = await readFile(personNamesPath, 'utf8');
    const rows = /"rows":\[(.*)\]\}/su.exec(module)?.[1] ?? '';
    return [...rows.matchAll(/\["([a-zA-Z0-9-]+)",\[/gu)].map(([, tag]) => tag);
  };

  // The configured locales and nothing else, which is the default this key exists to widen.
  assert.deepEqual(
    await rowTags(),
    ['ar', 'en'],
    'The generated person-name artifact did not carry exactly the configured locales',
  );

  const declared = JSON.parse(original);
  await writeFile(
    configurationPath,
    `${JSON.stringify({ ...declared, personNameLocales: ['ja'] }, null, 2)}\n`,
    'utf8',
  );
  run(['exec', 'equator', 'generate', '--json']);
  assert.deepEqual(
    await rowTags(),
    ['ar', 'en', 'ja'],
    'Declaring a person-name locale did not add its profile to the generated artifact',
  );

  // A locale the pinned release does not cover has to say so. Silence here would be the same
  // silence the key exists to break, one level up.
  await writeFile(
    configurationPath,
    `${JSON.stringify({ ...declared, personNameLocales: ['zxx'] }, null, 2)}\n`,
    'utf8',
  );
  const uncovered = parseMachineResult(
    run(['exec', 'equator', 'generate', '--json']),
  ).diagnostics.filter(({ code }) => code === 'EQ1004');
  assert.ok(
    uncovered.some(
      ({ severity, summary }) =>
        severity === 'warning' && summary.includes('"zxx"'),
    ),
    `A declared person-name locale with no CLDR patterns was not reported: ${JSON.stringify(uncovered)}`,
  );

  await writeFile(configurationPath, original, 'utf8');
  run(['exec', 'equator', 'generate', '--json']);
  assert.deepEqual(
    await rowTags(),
    ['ar', 'en'],
    'The person-name artifact did not return to the configured locales',
  );
}

await verifyDeclaredPersonNameLocales();

await verifyWatchCommand();

// Code that must not compile. The only way to prove a type error is reported is to compile
// something that should produce it and check that it did; a passing test cannot express the
// absence of a rejection. The whole fixture tree once had three @ts-expect-error lines, every
// one on the direct API and none in a template, so the contract LocalizePipe, LocalizedMessage
// and the route builder carry was unverified in the places it exists for.
//
// One file at a time, because the Angular compiler reports template diagnostics only when the
// program it is checking has no ordinary TypeScript errors: a file carrying both kinds would
// silently prove only half of what it claims.
const negativeFiles = (await readdir(resolve(consumerRoot, 'src')))
  .filter((name) => name.endsWith('.negative.ts'))
  .sort();
assert.ok(
  negativeFiles.length > 0,
  'The consumer fixture declares no negative compilation files',
);
for (const negativeFile of negativeFiles) {
  const negativeSource = await readFile(
    resolve(consumerRoot, 'src', negativeFile),
    'utf8',
  );
  assert.ok(
    expectations(negativeSource).length > 0,
    `${negativeFile} declares no expected diagnostics`,
  );
  await writeFile(
    resolve(consumerRoot, 'tsconfig.negative.json'),
    `${JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: { noEmit: true, types: ['node'] },
        include: [`src/${negativeFile}`],
      },
      null,
      2,
    )}
`,
    'utf8',
  );
  const negative = run(['exec', 'ngc', '-p', 'tsconfig.negative.json'], 1);
  const negativeOutput = `${negative.stdout}
${negative.stderr}`;
  for (const { line, text } of unmetExpectations(
    negativeSource,
    negativeOutput,
    `src/${negativeFile}`,
  )) {
    assert.fail(
      `${negativeFile} did not report ${JSON.stringify(text)} under line ${line}:
${negativeOutput}`,
    );
  }
}

// A spec file that stops being collected passes silently. The runner reports success for the files
// it did collect and exits zero, so the status this call already asserts cannot tell forty-three
// specs from forty-two: the defect `verify-document-blocks.ts` fixed for the README block,
// left standing here over the lab's whole suite.
//
// The number to check against is counted from the consumer's sources rather than written down, so
// adding a spec needs no edit here and deleting one is the same failure as failing to collect it.
// Vitest colours its summary, so the counts are read off the plain text rather than off whatever
// the terminal was told to draw. Both lines are matched loosely because a skipped file or case puts
// `| n skipped` between the count and the total: a spec written for an address only some URL
// policies have is skipped under the others, and is still collected.
const tested = run(['test'], 0, consumerSpecsEnvironment());
const testedOutput = `${tested.stdout}\n${tested.stderr}`.replaceAll(
  /\u001B\[[0-9;]*m/gu,
  '',
);
const specFiles = (
  await readdir(resolve(consumerRoot, 'src'), { recursive: true })
).filter((entry) => entry.endsWith('.spec.ts'));
assert.ok(
  specFiles.length > 0,
  'The consumer carries no spec files, so the count below would assert nothing',
);
const collectedFiles =
  /Test Files\s+(?:(\d+) failed\s+\|\s+)?(\d+) passed(?:\s+\|\s+(\d+) skipped)?\s+\((\d+)\)/u.exec(
    testedOutput,
  );
assert.ok(
  collectedFiles !== null,
  `The consumer's test run reported no file count:\n${testedOutput}`,
);
assert.equal(
  Number(collectedFiles[4]),
  specFiles.length,
  `The consumer has ${specFiles.length} spec file(s) and the run collected ${collectedFiles[4]}:\n${testedOutput}`,
);
assert.equal(
  Number(collectedFiles[2]) + Number(collectedFiles[3] ?? 0),
  Number(collectedFiles[4]),
  `The consumer's test run did not pass every spec file:\n${testedOutput}`,
);
// A policy that has no address for a case skips that case, and a file whose every case needs such
// an address is skipped whole. That is right only when the file says so: each skip in it is a
// condition (`runIf`, `skipIf`), and none is a bare `skip` or `todo`, which skips the file under
// every policy and reads as passed under each.
const skippedWhole = [
  ...testedOutput.matchAll(/^\s*\u2193\s+(?:\S+\s+)?(\S+\.spec\.ts)\s+\(/gmu),
].map(([, file]) => file!);
assert.equal(
  skippedWhole.length,
  Number(collectedFiles[3] ?? 0),
  `The consumer's test run skipped ${collectedFiles[3] ?? 0} spec file(s) whole and ${skippedWhole.length} could be named:\n${testedOutput}`,
);
const UNCONDITIONAL_SKIP =
  /\b(?:(?:describe|it|test)\.(?:skip|todo)|x(?:describe|it))\(/u;
const CONDITIONAL_SKIP = /\.(?:runIf|skipIf)\(/u;
for (const file of skippedWhole) {
  const source = await readFile(resolve(consumerRoot, file), 'utf8');
  assert.ok(
    CONDITIONAL_SKIP.test(source) && !UNCONDITIONAL_SKIP.test(source),
    `${consumerName} skipped ${file} whole, and its skips are not all conditions on the policy, so nothing in it was asserted under any policy.`,
  );
}
const collectedCases = /Tests\s+(\d+) passed[^\n(]*\((\d+)\)/u.exec(
  testedOutput,
);
assert.ok(
  collectedCases !== null && Number(collectedCases[1]) > 0,
  `The consumer's test run reported no passing cases:\n${testedOutput}`,
);

// The test script generated the pseudo-locales; the build must not carry them. Regenerating
// without the flag is what returns the generated output to production shape, and doing it here
// rather than trusting the build to is the difference between asserting the switch works and
// assuming it does: every check below reads what this produced.
run(['exec', 'equator', 'generate']);
const siteBuild = run(['exec', 'ng', 'build', '--stats-json']);

const configuration = await readJson(
  resolve(consumerRoot, 'equator.config.json'),
);
// What init wrote is asserted above, at init. What is asserted here is that nothing since has
// changed it except the two declarations this gate made, so a key appearing from anywhere else
// still fails. `equator format` rewrote the file between those two points and both survived it.
assert.deepEqual(configuration, {
  schemaVersion: 1,
  sourceLocale: INIT_REQUEST.sourceLocale,
  defaultLocale: INIT_REQUEST.defaultLocale,
  locales: [...INIT_REQUEST.locales],
  pseudoLocales: PSEUDO_LOCALES,
  formatting: LOCALE_FORMATTING,
});

// The production build ran a plain `equator generate`, so neither pseudo-locale is in what it
// produced: declared and not generated, which is the whole separation. The control is `ar-EG`
// in the same text: without it these two absences would pass for a file that was never read.
//
// The formatting declaration above names one of those pseudo-locales, so this now proves the
// emission filter too: a table that carried an entry for a locale the production build's own
// locale list does not have would name it here, and the runtime would refuse the configuration on
// arrival rather than at build time.
const generatedRoot = resolve(consumerRoot, 'src/generated/i18n');
const generatedLocaleTable = await readFile(
  resolve(generatedRoot, 'index.ts'),
  'utf8',
);
for (const tag of Object.keys(PSEUDO_LOCALES)) {
  assert.ok(
    !generatedLocaleTable.includes(tag),
    `The production build's locale table contains the pseudo-locale ${tag}`,
  );
}
assert.ok(
  generatedLocaleTable.includes('ar-EG'),
  'The generated locale table was not read, so the absences above mean nothing',
);

const consumerPackage = await readJson(resolve(consumerRoot, 'package.json'));
assert.deepEqual(consumerPackage.imports, {
  '#i18n': './src/generated/i18n/index.ts',
  '#i18n/*': './src/generated/i18n/*.ts',
});
// Checked against Equator's own declaration above, not against a list copied here. This block used
// to hardcode an `equator:init` entry with the fixture's exact locale flags: a value Equator never
// writes and a human had typed.
for (const [name, command] of Object.entries(PACKAGE_SCRIPTS)) {
  assert.equal(
    consumerPackage.scripts[name],
    command,
    `The generated manifest lost the ${name} script Equator declares`,
  );
}
for (const locale of configuration.locales) {
  assert.match(
    await readFile(resolve(consumerRoot, `i18n/shell/${locale}.yaml`), 'utf8'),
    /^messages:\s*$/mu,
    `${locale} golden catalog is not wired`,
  );
}

assert.equal(
  (
    await readJson(
      resolve(consumerRoot, 'node_modules/@angular/core/package.json'),
    )
  ).version,
  consumerProfile.angular,
);
// Angular's tooling train can sit ahead of the framework train, so the row is only pinned if both
// halves are asserted. Reading only `@angular/core` would let the tooling drift unnoticed.
assert.equal(
  (
    await readJson(
      resolve(consumerRoot, 'node_modules/@angular/ssr/package.json'),
    )
  ).version,
  resolveAngularVersion(consumerProfile, '@angular/ssr'),
);
assert.equal(
  (
    await readJson(
      resolve(consumerRoot, 'node_modules/typescript/package.json'),
    )
  ).version,
  consumerProfile.typescript,
);
assert.equal(
  (await readJson(resolve(consumerRoot, 'node_modules/rxjs/package.json')))
    .version,
  consumerProfile.rxjs,
);
assert.equal(
  (
    await readJson(
      resolve(consumerRoot, 'node_modules/@neolorn/equator/package.json'),
    )
  ).name,
  '@neolorn/equator',
);
assert.equal(
  (
    await readJson(
      resolve(
        consumerRoot,
        'node_modules/@neolorn/equator-toolkit/package.json',
      ),
    )
  ).name,
  '@neolorn/equator-toolkit',
);

const stats = readBuildStats(resolve(consumerRoot, 'dist/feature-lab')) as
  BuildStats | undefined;
assert.ok(stats !== undefined, 'The build wrote no stats file.');
assert.equal(typeof stats.inputs, 'object', 'Angular stats inputs are absent');
assert.equal(
  typeof stats.outputs,
  'object',
  'Angular stats outputs are absent',
);

const installedRuntimeRoot = await realpath(
  resolve(consumerRoot, 'node_modules/@neolorn/equator'),
);
const installedToolkitRoot = await realpath(
  resolve(consumerRoot, 'node_modules/@neolorn/equator-toolkit'),
);
const installedRuntimePackage = await readJson(
  resolve(installedRuntimeRoot, 'package.json'),
);
const testingEntry = await realpath(
  resolve(
    installedRuntimeRoot,
    installedRuntimePackage.exports['./testing'].default,
  ),
);
const formsEntry = await realpath(
  resolve(
    installedRuntimeRoot,
    installedRuntimePackage.exports['./forms'].default,
  ),
);
const routerEntry = await realpath(
  resolve(
    installedRuntimeRoot,
    installedRuntimePackage.exports['./router'].default,
  ),
);
const isWithin = (candidate: string, owner: string) => {
  const path = relative(owner, candidate);
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  );
};
const resolveStatsInput = async (input: string) => {
  try {
    return await realpath(resolve(consumerRoot, input));
  } catch (error) {
    // The builder names modules it generates itself, such as angular:styles/global, in a namespace
    // of its own, and those are the only inputs with no file behind them. Anything else that does
    // not resolve is an input the checks below would otherwise pass over without having read it.
    if (/^[a-z][a-z-]+:/u.test(input)) return undefined;
    throw new Error(`The build names an input that is not on disk: ${input}`, {
      cause: error,
    });
  }
};

const productionInputs = new Set<string>();
for (const output of Object.values(stats.outputs)) {
  for (const input of Object.keys(output.inputs ?? {})) {
    productionInputs.add(input);
  }
}
const canonicalProductionInputs = new Set(
  (
    await Promise.all(
      [...productionInputs].map((input) => resolveStatsInput(input)),
    )
  ).filter((input) => input !== undefined),
);
assert.equal(
  canonicalProductionInputs.has(formsEntry),
  true,
  'Production feature lab did not consume the Equator Forms entrypoint',
);
assert.equal(
  canonicalProductionInputs.has(routerEntry),
  true,
  'Production feature lab did not consume the Equator Router entrypoint',
);
for (const input of productionInputs) {
  const canonicalInput = await resolveStatsInput(input);
  if (canonicalInput === undefined) {
    continue;
  }

  assert.equal(
    isWithin(canonicalInput, installedToolkitRoot),
    false,
    `Production output contains toolkit input: ${input}`,
  );
  assert.notEqual(
    canonicalInput,
    testingEntry,
    `Production output contains the Equator testing entrypoint: ${input}`,
  );
}

const browserEntry = Object.entries(stats.outputs).find(
  ([, output]) => output.entryPoint === 'src/main.ts',
);
assert.notEqual(browserEntry, undefined, 'Browser entry metadata is absent');
const pendingBrowserOutputs = [browserEntry![0]];
const visitedBrowserOutputs = new Set<string>();
while (pendingBrowserOutputs.length > 0) {
  const outputName = pendingBrowserOutputs.pop()!;
  if (visitedBrowserOutputs.has(outputName)) {
    continue;
  }
  visitedBrowserOutputs.add(outputName);
  const output: BuildStats['outputs'][string] | undefined =
    stats.outputs[outputName];
  assert.notEqual(output, undefined, `Browser output ${outputName} is absent`);

  for (const input of Object.keys(output!.inputs ?? {})) {
    for (const imported of stats.inputs[input]?.imports ?? []) {
      assert.equal(
        isBuiltin(imported.path),
        false,
        `Browser graph imports Node built-in ${imported.path} from ${input}`,
      );
    }
  }
  for (const imported of output!.imports ?? []) {
    assert.equal(
      isBuiltin(imported.path),
      false,
      `Browser output imports Node built-in ${imported.path}`,
    );
    const importedOutput = imported.path.replace(/^\.\//u, '');
    if (!imported.external && stats.outputs[importedOutput] !== undefined) {
      pendingBrowserOutputs.push(importedOutput);
    }
  }
}

const browserRoot = resolve(consumerRoot, 'dist/feature-lab/browser');
const serverRoot = resolve(consumerRoot, 'dist/feature-lab/server');
const collectJavaScript = async (root: string): Promise<string[]> => {
  const files: string[] = [];

  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScript(path)));
    } else if (['.js', '.mjs'].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
};

const browserFiles = await collectJavaScript(browserRoot);
assert.ok(browserFiles.length > 0, 'Browser build emitted no JavaScript');
assert.ok(
  (await collectJavaScript(serverRoot)).length > 0,
  'SSR build is absent',
);
/**
 * Every prerendered address, as a set.
 *
 * A set rather than a count, and read from disk rather than from the build's own report. A
 * prerendered route whose component throws is dropped and still counted: the build exits 0, writes
 * no file at that address, and reports the route anyway. On 22.0.6, 22.1.3 and 22.1.5, one
 * component throwing gives 2 files on disk against `Prerendered 4 static routes.` and 4 entries in
 * `prerendered-routes.json`. Under the two-layer table every address a visitor reaches is a
 * locale-branch address, so a branch that fails to render leaves a hole at the only address anyone
 * uses while the canonical branch, which nobody uses, looks fine.
 *
 * **Angular 22.1.7 fails the build** (`f1fd823`, angular/angular-cli#33965). With the same injected
 * throw it exits 1, `Application bundle generation failed.`, naming `/en-us/second` and
 * `/ar-eg/second` and reporting `Prerendered 2 static routes.`. The two that rendered, not the four
 * declared. No `dist` is written at all.
 *
 * The set comparison stays, and the reason it stays is not that Angular might regress. It is that
 * a missing prerendered file has causes that are not Angular's (a route the projection did not
 * emit, a canonical suppression that stopped suppressing, a locale branch that resolved to
 * nothing) and the set is what catches every one of them. A count or an exit code reads only one of
 * the causes.
 *
 * It is also what holds the canonical suppression. `localizedServerRoutes` declares the canonical
 * spelling of every route `RenderMode.Server`, so `/index.html`, `/second/index.html` and
 * `/articles/handbook/index.html` are never written. Asserting only that the four expected
 * files exist would pass with all seven present, which is how this was passing before: nothing
 * suppressed the canonical branch and the consumer's `**` fallback happened to catch it.
 *
 * `second` is spelled `second` in both locales because this fixture declares no `localizedPaths`.
 * Only the article slug is translated, through its codec, which is the harder half anyway, since
 * the two article addresses share no path segment.
 */
const collectPrerendered = async (
  root: string,
  prefix = '',
): Promise<string[]> => {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      paths.push(
        ...(await collectPrerendered(
          resolve(root, entry.name),
          `${prefix}${entry.name}/`,
        )),
      );
    } else if (entry.name === 'index.html') {
      paths.push(`${prefix}index.html`);
    }
  }
  return paths;
};

// Where each page lives, read from the address table the consumer's own specs read, and where each
// build answers.
const addresses = await readConsumerAddresses(consumerRoot);
const builds = await readConsumerBuilds(consumerRoot);
const policySource = await readFile(builds.policyPath, 'utf8');
// What each origin's build wrote while it prerendered, which is where the application's event log
// goes during a build.
const buildLogs = new Map([[builds.siteOrigin, siteBuild.stdout]]);

/**
 * The file prerendering writes a page to, or nothing where the page is not prerendered or has no
 * address. In a build that generates pseudo-locales, an address one of them also spells is rendered
 * on request instead, which the table says where it happens.
 */
const prerenderedFile = (
  page: string,
  locale: string,
  { pseudo = false }: { pseudo?: boolean } = {},
) =>
  addresses.prerendered.includes(page) &&
  addresses.has(page, locale) &&
  !(pseudo && addresses.sharedWithPseudoLocales(page, locale))
    ? addresses.file(page, locale)
    : undefined;

/** Every file the prerender writes for these locales. */
const prerenderedFiles = (
  locales: readonly string[],
  options?: { pseudo?: boolean },
) =>
  locales.flatMap((locale) =>
    addresses.prerendered
      .map((page) => prerenderedFile(page, locale, options))
      .filter((file) => file !== undefined),
  );

/** The origins these locales are served at, each once. A locale with no address has none. */
const originsOf = (locales: readonly string[]) => [
  ...new Set(
    locales
      .map((locale) => addresses.origin(locale))
      .filter((origin) => origin !== undefined),
  ),
];

/** The locales among these that the build answering at `origin` serves. */
const servedAt = (origin: string, locales: readonly string[]) =>
  locales.filter((locale) => addresses.origin(locale) === origin);

/**
 * Builds the consumer as its deployment at `origin` is built, into `output`, and returns what the
 * build wrote.
 *
 * At the declared origin that is the source as it stands. At any other it is the same source with
 * `SITE_ORIGIN` changed, which is how a deployment that puts each locale on its own origin builds
 * for the rest, put back even when the build fails, because every later step reads the declared
 * build and its source.
 */
async function buildAt(origin: string, output: string) {
  if (origin === builds.siteOrigin) {
    return run(['exec', 'ng', 'build', '--output-path', output]).stdout;
  }
  await writeFile(
    builds.policyPath,
    policySource.replace(
      SITE_ORIGIN_DECLARATION,
      () => `export const SITE_ORIGIN = '${origin}';`,
    ),
    'utf8',
  );
  try {
    return run(['exec', 'ng', 'build', '--output-path', output]).stdout;
  } finally {
    await writeFile(builds.policyPath, policySource, 'utf8');
  }
}

/**
 * What the build at `root`, answering at `origin`, prerendered: exactly the files of the pages its
 * own locales have addresses for, each rendering its page in its locale.
 */
async function verifyPrerendered(
  root: string,
  origin: string,
  locales: readonly string[],
) {
  const served = servedAt(origin, locales);
  const emitted = (await collectPrerendered(root)).sort();
  const expected = prerenderedFiles(served).sort();
  assert.deepEqual(
    emitted,
    expected,
    `The prerendered address set at ${origin} is wrong.\nEmitted:\n  ${emitted.join('\n  ')}\nExpected:\n  ${expected.join('\n  ')}`,
  );

  for (const locale of served) {
    const file = prerenderedFile('second', locale);
    // No address in that locale is no file, which the set above has already held the build to.
    if (file === undefined) continue;
    assert.match(
      await readFile(resolve(root, file), 'utf8'),
      /data-route-view="second"/u,
      `${locale} prerendered route is absent`,
    );
  }

  // One declaration per route, expanded to every locale by the policy Equator already has. The
  // article route is the one that is hard by hand: its slug is spelled differently per locale, so
  // its two prerendered addresses share no path segment. A hand-written table that missed one
  // would not fail anywhere: it would ship a page that exists in English and 404s in Arabic.
  for (const language of served) {
    const file = prerenderedFile('article', language);
    if (file === undefined) continue;
    const prerendered = await readFile(resolve(root, file), 'utf8');
    assert.match(
      prerendered,
      /data-route-view="article"/u,
      `${language} prerendered article route is absent`,
    );
    assert.match(
      prerendered,
      new RegExp(`lang="${language}"`, 'u'),
      `${language} prerendered article was rendered in the wrong locale`,
    );
    // The measurement the server-side locale source rests on.
    //
    // Equator reads the address being rendered from `PlatformLocation`, because `@angular/ssr`
    // provides `REQUEST` and `REQUEST_CONTEXT` only when the render mode is `Server`: a
    // prerendered page has neither. Two things have to be true for that to work: that
    // `PlatformLocation` is injectable from an application-config-level factory, and that under
    // prerendering it carries the address being rendered rather than `/`. This is a prerendered
    // page, so its own address here is that second fact, observed.
    const probe = /"feature-lab-ssr-probe":(\{.*?\})/su.exec(prerendered);
    assert.ok(
      probe,
      `${language} prerendered article carried no SSR probe state`,
    );
    const platformPath = (JSON.parse(probe[1]!) as { platformPath: string })
      .platformPath;
    assert.notEqual(
      platformPath,
      'unavailable',
      'PlatformLocation did not resolve during prerendering, so the server locale source has no address to read',
    );
    // Decoded on both sides, because which of the two spellings `pathname` holds is Angular's.
    assert.equal(
      decodeURIComponent(platformPath),
      decodeURIComponent(addresses.path('article', language)),
      `PlatformLocation reported ${JSON.stringify(platformPath)} while prerendering the ${language} article, so it does not carry the rendered address`,
    );
  }
}

// One build for each origin the locales are served at. Under a path policy that is the one build
// above; under a host policy each origin prerenders its own locale's pages and no other's.
for (const origin of originsOf(INIT_REQUEST.locales)) {
  const output = builds.output(origin);
  if (origin !== builds.siteOrigin) {
    buildLogs.set(origin, await buildAt(origin, output));
  }
  await verifyPrerendered(
    resolve(consumerRoot, output, 'browser'),
    origin,
    INIT_REQUEST.locales,
  );
}

// What these builds' servers answer, asked on this row's Node. The browser stage asks the same
// servers, on the gate's own Node only, so without this a row for another Node line would build a
// server and never start it.
openCapabilityEvidence('consumer-stage', { consumer: consumerRoot });

/**
 * The answers of the builds above to these requests, in order: `[{ origin, path, headers }]`. With
 * `{ root }`, the answers of that one build instead, and with `{ output }`, of this application's
 * builds written under that name, one for each origin as above.
 */
function serverAnswers(
  requests: readonly ServerRequest[],
  build?: { root?: string; output?: string },
) {
  return loggedServerAnswers(requests, build).answers;
}

/** The answers, as above, and what the servers wrote while they answered. */
function loggedServerAnswers(
  requests: readonly ServerRequest[],
  { root, output }: { root?: string; output?: string } = {},
) {
  const answersFile = resolve(consumerRoot, 'tmp/server-answers.json');
  mkdirSync(dirname(answersFile), { recursive: true });
  const asked = spawnSync(
    process.execPath,
    [
      resolve(workspaceRoot, 'tools/consumer-server-answers.ts'),
      consumerRoot,
      answersFile,
      ...(root === undefined ? [] : [root]),
      ...(output === undefined ? [] : ['--output', output]),
    ],
    {
      input: JSON.stringify(requests),
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  assert.equal(
    asked.status,
    0,
    `The consumer's server did not answer.\n${asked.error ?? ''}${asked.stdout}${asked.stderr}`,
  );
  return {
    answers: JSON.parse(readFileSync(answersFile, 'utf8')) as ServerAnswer[],
    log: asked.stdout,
  };
}

function verifyServerAnswers() {
  const locales = INIT_REQUEST.locales.filter((locale) =>
    addresses.has('home', locale),
  );
  const asked = [
    ...locales.map((locale) => ({ page: 'home', locale })),
    { page: 'missing', locale: INIT_REQUEST.sourceLocale },
  ];
  const answers = serverAnswers(
    asked.map(({ page, locale }) => ({
      origin: addresses.origin(locale),
      path: addresses.path(page, locale),
    })),
  );
  asked.forEach(({ page, locale }, index) => {
    const { status, headers, body } = answers[index]!;
    const where = `${page} in ${locale} at ${addresses.path(page, locale)}`;
    assert.equal(status, page === 'missing' ? 404 : 200, where);
    assert.equal(
      headers['content-language'],
      locale,
      `${where}: the language the @neolorn/equator/http request handler resolved`,
    );
    assert.match(body, new RegExp(`<html[^>]* lang="${locale}"`, 'u'), where);
    assert.match(
      body,
      /\bng-server-context="ssr"/u,
      `${where} was not rendered for the request`,
    );
    recordCapabilityClaim(
      `${consumerName}: server answers`,
      'entry:@neolorn/equator/http',
      { document: body },
    );
  });

  // A Host the application's engine does not allow. The engine answers it with an error page of
  // its own, which the request handler composes like any render, and section 5 of
  // `specs/07-routing-rendering-and-seo.spec.md` keeps that error's status: an error answered as
  // the address's 200 is a page a shared cache would keep for the address.
  const home = {
    origin: addresses.origin(INIT_REQUEST.sourceLocale),
    path: addresses.path('home', INIT_REQUEST.sourceLocale),
  };
  const [refused] = serverAnswers([{ ...home, host: 'refused.invalid' }]) as [
    ServerAnswer,
  ];
  const where = `home at ${home.path} asked with a Host the engine refuses`;
  assert.ok(
    refused.status >= 400 && refused.status < 500,
    `${where}: answered ${refused.status}`,
  );
  assert.equal(refused.headers['cache-control'], 'private, no-store', where);
  assert.equal(refused.headers['x-robots-tag'], 'noindex', where);
}
verifyServerAnswers();

/**
 * Which source decides a visit, in the order `specs/03-locale-identity-and-resolution.spec.md`
 * section 7 gives them when none is declared: the address, the stored locale, the visitor's
 * languages, the default. Each visit is arranged so the locale it lands in can have come from one
 * source only: every source ahead of it declines, and every source after it names another locale.
 *
 * The address decides at the exercise sheet's Arabic address, which states its locale under every
 * policy. The other three can decide only where an address names no locale, which is the root under
 * a policy that sends it on to a locale and under one that renders it in any locale. Every other
 * policy states a locale in every address, so no visit reaches them there.
 */
function verifyLocaleSources() {
  const { defaultLocale, locales } = INIT_REQUEST;
  const other = locales.find((locale) => locale !== defaultLocale)!;
  // The cookie src/app/locale-cookie.ts declares, which the server reads as the stored locale.
  const stored = (locale: string) => ({ cookie: `equator-locale=${locale}` });
  const unsupported = 'ja';
  assert.ok(
    !locales.some((locale) => new Intl.Locale(locale).language === unsupported),
    `The visit that leaves the default to decide asks for ${unsupported}, which this consumer supports.`,
  );
  const entry =
    addresses.entryRedirects || !addresses.localeInAddress ? '/' : undefined;
  const visits = [
    {
      source: 'url',
      origin: addresses.origin(other),
      path: addresses.path('exercise', other),
      headers: { ...stored(defaultLocale), 'accept-language': defaultLocale },
      lands: other,
    },
    ...(entry === undefined
      ? []
      : [
          {
            source: 'stored',
            headers: { ...stored(other), 'accept-language': defaultLocale },
            lands: other,
          },
          {
            source: 'browser',
            headers: { 'accept-language': other },
            lands: other,
          },
          {
            source: 'default',
            headers: { 'accept-language': unsupported },
            lands: defaultLocale,
          },
        ].map((visit) => ({
          ...visit,
          origin: addresses.origin(defaultLocale),
          path: entry,
        }))),
  ];
  const answers = serverAnswers(
    visits.map(({ origin, path, headers }) => ({ origin, path, headers })),
  );
  visits.forEach(({ source, path, headers, lands }, index) => {
    const answer = answers[index]!;
    const where = `The ${source} source, at ${path} with ${JSON.stringify(headers)},`;
    if (path === entry && addresses.entryRedirects) {
      assert.equal(answer.status, 307, `${where} was not sent on`);
      assert.equal(
        answer.headers['location'],
        addresses.path('home', lands),
        `${where} did not send the visitor to ${lands}`,
      );
    } else {
      assert.equal(answer.status, 200, `${where} was not answered`);
      assert.equal(
        answer.headers['content-language'],
        lands,
        `${where} did not decide ${lands}`,
      );
    }
  });
  // The sheet names the policy the server runs. The root has no sheet, and is answered by the same
  // server in the same run.
  const { policy } = sheetInDocument(answers[0]!.body);
  const observed = new Map(
    visits.map(({ source }, index) => [
      source,
      { document: answers[index]!.body, policy },
    ]),
  );
  const check = `${consumerName}: locale sources`;
  recordCapabilityClaim(check, 'source:url', observed.get('url'));
  if (entry === undefined) return;
  recordCapabilityClaim(check, 'source:stored', observed.get('stored'));
  recordCapabilityClaim(check, 'source:browser', observed.get('browser'));
  recordCapabilityClaim(check, 'source:default', observed.get('default'));
}
verifyLocaleSources();

// The installed core, which the request handler composes a declaring page's response with.
const installedCore = await import(
  pathToFileURL(
    resolve(
      consumerRoot,
      'node_modules/@neolorn/equator/fesm2022/neolorn-equator-core.mjs',
    ),
  ).href
);

/**
 * What the routes declare, read off the server's answers in the default locale: the indexing and
 * caching classes a route's data names, the floor a deployment puts under every page, what became
 * of a retired address, and the outcome a page declares once it has looked up what it was asked
 * for. The policy is the one the exercise sheet reports from the same server in the same run.
 */
function verifyRouteDeclarations() {
  const locale = INIT_REQUEST.defaultLocale;
  const asked: [string, string][] = [
    ['exercise', ''],
    ['topic', ''],
    ['home', ''],
    ['second', ''],
    ['item', ''],
    ['lazy', ''],
    ['legacy', '?tab=one'],
    ['removed', ''],
    ['unfiled topic', ''],
    ['retired topic', ''],
    ['unavailable topic', ''],
    ['withdrawn dossier', ''],
    ['unreachable dossier', ''],
    ['withdrawn item', ''],
    ['unreachable item', ''],
  ];
  const answers = serverAnswers(
    asked.map(([page, query]) => ({
      origin: addresses.origin(locale),
      path: `${addresses.path(page, locale)}${query}`,
    })),
  );
  // One answer for each page asked, so every page below has one.
  const answered = new Map(
    asked.map(([page], index) => [page, answers[index]!]),
  );
  const { policy } = sheetInDocument(answered.get('exercise')!.body);
  const check = `${consumerName}: route declarations`;
  const observed = (page: string) => ({
    document: answered.get(page)!.body,
    policy,
  });
  const header = (page: string, name: string) =>
    answered.get(page)!.headers[name];
  const status = (page: string) => answered.get(page)!.status;

  assert.equal(status('home'), 200, 'home was not answered');
  assert.equal(
    header('home', 'x-robots-tag'),
    undefined,
    'home declares equatorIndexing indexable and was answered noindex',
  );
  assert.equal(status('item'), 200, 'item was not answered');
  assert.equal(
    header('item', 'x-robots-tag'),
    'noindex',
    'item declares equatorIndexing non-indexable and was answered without noindex',
  );
  recordCapabilityClaim(
    check,
    'declaration:route-indexing-class',
    observed('item'),
  );

  assert.equal(status('lazy'), 200, 'lazy was not answered');
  assert.equal(
    header('lazy', 'cache-control'),
    'private, no-cache',
    'lazy declares equatorCaching per-visitor and a shared cache may keep it',
  );
  recordCapabilityClaim(
    check,
    'declaration:route-caching-class',
    observed('lazy'),
  );

  // Only a deployment whose table says it declares a floor has one to hold. Home is drawn by the
  // server on request and second is written by the build, and neither declares a class.
  if (addresses.pageCaching !== undefined) {
    const floorHeader =
      addresses.pageCaching === 'not-stored'
        ? 'private, no-store'
        : 'private, no-cache';
    assert.equal(
      header('home', 'cache-control'),
      floorHeader,
      `home declares no caching class and was not raised to the ${addresses.pageCaching} pageCaching floor`,
    );
    recordCapabilityClaim(
      check,
      'declaration:host-page-floor',
      observed('home'),
    );
    assert.equal(
      header('second', 'cache-control'),
      addresses.pageCaching === 'not-stored'
        ? 'private, no-store'
        : 'private, no-cache',
      `second declares no caching class and was not raised to the ${addresses.pageCaching} floor`,
    );
    recordCapabilityClaim(
      check,
      'declaration:host-page-floor',
      observed('second'),
    );
  }

  assert.equal(
    status('legacy'),
    308,
    'legacy is declared historical, replaced by second, and was not sent on',
  );
  assert.equal(
    header('legacy', 'location'),
    `${addresses.address('second', locale)}?tab=one`,
    'legacy was not sent to second with its query kept',
  );
  assert.equal(
    status('removed'),
    410,
    'removed is declared historical and gone, and was not answered 410',
  );
  assert.equal(header('removed', 'content-language'), locale);
  assert.equal(header('removed', 'x-robots-tag'), 'noindex');
  recordCapabilityClaim(
    check,
    'declaration:historical-route-outcome',
    observed('removed'),
  );

  // The topic page resolves as a page, and declares its outcome once it has looked the topic up.
  const declared = (page: string, expected: number, declaration: string) => {
    assert.equal(
      status(page),
      expected,
      `The topic page declared ${declaration} for ${page} and was answered ${status(page)}`,
    );
    assert.equal(header(page, 'content-language'), locale);
    assert.equal(header(page, 'cache-control'), 'private, no-store');
  };
  declared('unfiled topic', 404, 'pageAbsent()');
  assert.equal(header('unfiled topic', 'x-robots-tag'), 'noindex');
  recordCapabilityClaim(check, 'outcome:pageAbsent', observed('unfiled topic'));
  declared('retired topic', 410, 'pageGone()');
  assert.equal(header('retired topic', 'x-robots-tag'), 'noindex');
  recordCapabilityClaim(check, 'outcome:pageGone', observed('retired topic'));
  declared('unavailable topic', 503, 'pageOperationalFailure(503)');
  recordCapabilityClaim(
    check,
    'outcome:pageOperationalFailure',
    observed('unavailable topic'),
  );
  // What the installed function says each declaration makes of the address's own response, which
  // is the filed topic's, is what the server answered: the handler composes the response with it.
  const {
    pageAbsent,
    pageGone,
    pageOperationalFailure,
    pageOutcomeHttpDescriptor,
  } = installedCore;
  assert.equal(status('topic'), 200, 'the filed topic was not answered');
  for (const [page, declaration] of [
    ['unfiled topic', pageAbsent()],
    ['retired topic', pageGone()],
    ['unavailable topic', pageOperationalFailure(503)],
  ]) {
    const described = pageOutcomeHttpDescriptor(declaration, {
      status: status('topic'),
      contentLanguage: header('topic', 'content-language'),
    });
    assert.deepEqual(
      {
        status: status(page),
        contentLanguage: header(page, 'content-language'),
        robots: header(page, 'x-robots-tag'),
      },
      {
        status: described.status,
        contentLanguage: described.contentLanguage,
        robots: described.robots,
      },
      `The server's answer for the ${page} is not the response pageOutcomeHttpDescriptor describes for what the page declared`,
    );
    recordCapabilityClaim(
      check,
      'outcome:pageOutcomeHttpDescriptor',
      observed(page),
    );
  }

  // The server settles a dossier before it renders, and declares what it found.
  assert.equal(
    status('withdrawn dossier'),
    410,
    `server.ts declared declarePageOutcome(pageGone()) for the withdrawn dossier and was answered ${status('withdrawn dossier')}`,
  );
  assert.equal(header('withdrawn dossier', 'content-language'), locale);
  assert.equal(header('withdrawn dossier', 'x-robots-tag'), 'noindex');
  assert.equal(
    header('withdrawn dossier', 'cache-control'),
    'private, no-store',
  );
  recordCapabilityClaim(
    check,
    'outcome:declarePageOutcome',
    observed('withdrawn dossier'),
  );
  assert.equal(
    status('unreachable dossier'),
    503,
    `server.ts declared declareOperationalFailure with a 503 for the unreachable dossier and was answered ${status('unreachable dossier')}`,
  );
  assert.equal(header('unreachable dossier', 'content-language'), locale);
  assert.equal(
    header('unreachable dossier', 'cache-control'),
    'private, no-store',
  );
  assert.equal(
    header('unreachable dossier', 'retry-after'),
    '120',
    'the Retry-After the declared failure carried did not reach the response',
  );
  // An operational failure says nothing about the address, so the dossier's own indexing stands.
  assert.equal(header('unreachable dossier', 'x-robots-tag'), undefined);
  recordCapabilityClaim(
    check,
    'outcome:declareOperationalFailure',
    observed('unreachable dossier'),
  );

  // The item page is drawn in the browser, so what the server has for it is the application shell,
  // and server.ts declares what became of an item with that shell as the document. The response
  // carries the declared outcome, and the shell arrives as the one item is answered with, which
  // section 5 of `specs/07-routing-rendering-and-seo.spec.md` requires: nothing is written into it.
  // No claim is made here, because nothing in these answers shows a browser drawing the page; the
  // browser row claims it.
  const shell = answered.get('item')!.body;
  assert.doesNotMatch(
    shell,
    /\bng-server-context=/u,
    'item is RenderMode.Client, and the server rendered it',
  );
  assert.equal(
    status('withdrawn item'),
    410,
    `server.ts declared declarePageOutcome(pageGone()) with the application shell for the withdrawn item and was answered ${status('withdrawn item')}`,
  );
  assert.equal(header('withdrawn item', 'content-language'), locale);
  assert.equal(header('withdrawn item', 'x-robots-tag'), 'noindex');
  assert.equal(header('withdrawn item', 'cache-control'), 'private, no-store');
  assert.equal(
    answered.get('withdrawn item')!.body,
    shell,
    'the shell sent with the removal declared for the withdrawn item is not the shell item is answered with',
  );
  assert.equal(
    status('unreachable item'),
    503,
    `server.ts declared declareOperationalFailure with the application shell and a 503 for the unreachable item and was answered ${status('unreachable item')}`,
  );
  assert.equal(header('unreachable item', 'content-language'), locale);
  assert.equal(
    header('unreachable item', 'cache-control'),
    'private, no-store',
  );
  assert.equal(header('unreachable item', 'retry-after'), '120');
  // An operational failure says nothing about the address, so the item's own indexing stands.
  assert.equal(header('unreachable item', 'x-robots-tag'), 'noindex');
  assert.equal(
    answered.get('unreachable item')!.body,
    shell,
    'the shell sent with the failure declared for the unreachable item is not the shell item is answered with',
  );
}
verifyRouteDeclarations();

/**
 * The scopes a route is shown with beyond the startup ones, read off documents no browser has
 * touched: what the server drew on request and what the build wrote.
 *
 * The root component shows on every page whether the lazy page's scope is ready, so each document
 * says for itself whether that scope had loaded before the render that produced it completed.
 * `app.config.ts` names the scope in `requiredScopes` for the exercise sheet and in
 * `progressiveScopes` for the dossier and the article, and the generated route table lists it in
 * the deferred page's `scopes`. Home names it nowhere and is the control: a scope loaded there
 * would be loaded everywhere, and no page could then show an option loading it.
 */
function verifyRouteScopes() {
  const locale = INIT_REQUEST.defaultLocale;
  const asked = ['exercise', 'dossier', 'home'];
  const answers = serverAnswers(
    asked.map((page) => ({
      origin: addresses.origin(locale),
      path: addresses.path(page, locale),
    })),
  );
  const drawn = new Map(asked.map((page, index) => [page, answers[index]]));
  for (const page of asked) {
    assert.equal(drawn.get(page)!.status, 200, `${page} was not answered`);
    assert.match(
      drawn.get(page)!.body,
      /\bng-server-context="ssr"/u,
      `${page} was not rendered for the request`,
    );
  }
  const { policy } = sheetInDocument(drawn.get('exercise')!.body);
  // What the page says of the lazy scope, or nothing where the page does not say.
  const readiness = (html: string) =>
    new JSDOM(html).window.document
      .querySelector('[data-lazy-readiness]')
      ?.textContent.trim();
  // What the build wrote for a page in a locale, where it prerenders the page there.
  const written = (page: string, each: string) => {
    const file = prerenderedFile(page, each);
    if (file === undefined) return undefined;
    const path = resolve(
      consumerRoot,
      builds.output(addresses.origin(each)!),
      'browser',
      file,
    );
    assert.ok(existsSync(path), `The build wrote no ${page} in ${each}`);
    const document = readFileSync(path, 'utf8');
    assert.match(
      document,
      /\bng-server-context="ssg"/u,
      `${page} in ${each} was not written by the build`,
    );
    return document;
  };

  assert.equal(
    readiness(drawn.get('home')!.body),
    'idle',
    'home names the lazy scope in no option and its route table entry lists none, and the page the server drew does not show it idle',
  );

  assert.equal(
    readiness(drawn.get('exercise')!.body),
    'ready',
    'requiredScopes names the lazy scope for the exercise route, and the server completed the render before it had loaded',
  );
  recordCapabilityClaim(
    `${consumerName}: a required scope, rendered on request`,
    'declaration:RouteLocalizationOptions.requiredScopes',
    { document: drawn.get('exercise')!.body, policy },
  );
  assert.equal(
    readiness(drawn.get('dossier')!.body),
    'ready',
    'progressiveScopes names the lazy scope for the dossier route, a server render has no earlier view to keep on screen, and the server completed the render before the scope had loaded',
  );
  recordCapabilityClaim(
    `${consumerName}: a progressive scope, rendered on request`,
    'declaration:RouteLocalizationOptions.progressiveScopes',
    { document: drawn.get('dossier')!.body, policy },
  );

  // The mode the page's own navigation ran its locale transaction in, which the root component
  // shows. `route-transitions.ts` declares it, and the address table names it where a row declares
  // one other than the default, so only there does the page show the option rather than what a
  // navigation does without it, and only there is the option claimed.
  const changeMode = (html: string) =>
    new JSDOM(html).window.document
      .querySelector('[data-change-mode]')
      ?.textContent.trim();
  const declaredMode = addresses.navigationMode ?? 'coordinated';
  assert.equal(
    changeMode(drawn.get('exercise')!.body),
    declaredMode,
    `route-transitions.ts declares mode ${declaredMode}, and the navigation the server made for the exercise sheet did not run in it`,
  );
  if (addresses.navigationMode !== undefined) {
    recordCapabilityClaim(
      `${consumerName}: the declared mode, rendered on request`,
      'declaration:RouteLocalizationOptions.mode',
      { document: drawn.get('exercise')!.body, policy },
    );
  }

  // What the lazy page says once its scope is there, in the locales whose wording is held here.
  const lazyStatus = new Map([
    ['en-US', 'Lazy scope ready.'],
    ['ar-EG', 'النطاق الكسول جاهز.'],
  ]);
  for (const each of INIT_REQUEST.locales) {
    const sheet = written('exercise values', each);
    if (sheet !== undefined) {
      assert.equal(
        readiness(sheet),
        'ready',
        `requiredScopes names the lazy scope for the exercise route, and the build wrote the sheet in ${each} before it had loaded`,
      );
      recordCapabilityClaim(
        `${consumerName}: a required scope in ${each}, prerendered`,
        'declaration:RouteLocalizationOptions.requiredScopes',
        { document: sheet, policy },
      );
      assert.equal(
        changeMode(sheet),
        declaredMode,
        `route-transitions.ts declares mode ${declaredMode}, and the navigation the build made for the exercise sheet in ${each} did not run in it`,
      );
      if (addresses.navigationMode !== undefined) {
        recordCapabilityClaim(
          `${consumerName}: the declared mode in ${each}, prerendered`,
          'declaration:RouteLocalizationOptions.mode',
          { document: sheet, policy },
        );
      }
    }
    const article = written('article', each);
    if (article !== undefined) {
      assert.equal(
        readiness(article),
        'ready',
        `progressiveScopes names the lazy scope for the article route, a prerender has no earlier view to keep on screen, and the build wrote the article in ${each} before the scope had loaded`,
      );
      recordCapabilityClaim(
        `${consumerName}: a progressive scope in ${each}, prerendered`,
        'declaration:RouteLocalizationOptions.progressiveScopes',
        { document: article, policy },
      );
    }
    const deferred = written('deferred', each);
    if (deferred !== undefined && lazyStatus.has(each)) {
      assert.equal(
        new JSDOM(deferred).window.document
          .querySelector('[data-route-view="lazy"]')
          ?.textContent.trim(),
        lazyStatus.get(each),
        `the generated route table's scopes name the lazy scope for the deferred route, and the page the build wrote in ${each} does not show the message that scope holds`,
      );
      recordCapabilityClaim(
        `${consumerName}: a route's own scope in ${each}, prerendered`,
        'declaration:GeneratedRouteProjectionEntry.scopes',
        { document: deferred, policy },
      );
    }
  }
}
verifyRouteScopes();

/**
 * What each page's head says, declared once per route in `documentMetadata` and once per outcome
 * in `outcomeDocuments`, held to the catalog messages each declaration names. Read from what the
 * server answered in every locale the page is served in, and from what the build wrote for the
 * pages it prerenders.
 */
async function verifyDocumentDeclarations() {
  // The key the title and description of each page's head are declared under. `item` is declared
  // too and is not here: it is published client-rendered, so the server sends the shell and the
  // head is written in the browser, where the browser row reads it.
  const declared = {
    home: 'document',
    second: 'document.second',
    lazy: 'document.lazy',
  };
  const outcomes = {
    missing: 'document.not-found',
    removed: 'document.gone',
    'an unsupported locale': 'document.unsupported-locale',
  };
  const served = [
    ...[...Object.keys(declared), ...Object.keys(outcomes)].flatMap((page) =>
      INIT_REQUEST.locales
        .filter((locale) => addresses.has(page, locale))
        .map((locale) => ({
          page,
          locale,
          path: addresses.path(page, locale),
        })),
    ),
    // A locale-shaped first segment names a locale only where every locale is one, and it is
    // answered in the default locale.
    ...(addresses.entryRedirects
      ? [
          {
            page: 'an unsupported locale',
            locale: INIT_REQUEST.defaultLocale,
            path: '/fr/second',
          },
        ]
      : []),
  ];
  const asked = [
    {
      locale: INIT_REQUEST.defaultLocale,
      path: addresses.path('exercise', INIT_REQUEST.defaultLocale),
    },
    ...served,
  ];
  const answers = serverAnswers(
    asked.map(({ locale, path }) => ({
      origin: addresses.origin(locale),
      path,
    })),
  );
  // The sheet names the policy the server runs, answered by the same server in the same run.
  const { policy } = sheetInDocument(answers[0]!.body);
  const head = async (
    check: string,
    page: string,
    locale: string,
    html: string,
  ) => {
    const { document } = new JSDOM(html).window;
    const key =
      (declared as Readonly<Record<string, string>>)[page] ??
      (outcomes as Readonly<Record<string, string>>)[page];
    assert.deepEqual(
      {
        title: document.title,
        description: document
          .querySelector('meta[name="description"]')
          ?.getAttribute('content'),
      },
      {
        title: await readCatalogMessage(consumerRoot, locale, `${key}.title`),
        description: await readCatalogMessage(
          consumerRoot,
          locale,
          `${key}.description`,
        ),
      },
      `${check}: the head of ${page} in ${locale} is not what ${page in outcomes ? 'outcomeDocuments' : 'documentMetadata'} declares for it`,
    );
    if (page in outcomes) {
      recordCapabilityClaim(check, 'declaration:outcome-documents', {
        document: html,
        policy,
      });
    } else {
      recordCapabilityClaim(check, 'declaration:document-metadata', {
        document: html,
        policy,
      });
    }
  };
  for (const [index, { page, locale }] of served.entries()) {
    await head(
      `${consumerName}: the head of ${page} in ${locale}, rendered on request`,
      page,
      locale,
      answers[index + 1]!.body,
    );
  }
  for (const page of addresses.prerendered.filter((each) => each in declared)) {
    for (const locale of INIT_REQUEST.locales) {
      if (!addresses.has(page, locale)) continue;
      await head(
        `${consumerName}: the head of ${page} in ${locale}, prerendered`,
        page,
        locale,
        await readFile(
          resolve(
            consumerRoot,
            builds.output(addresses.origin(locale)!),
            'browser',
            addresses.file(page, locale),
          ),
          'utf8',
        ),
      );
    }
  }
}
await verifyDocumentDeclarations();

/**
 * What the policy declares about addresses beyond its pages, read off the server's answers: where
 * `x-default` points, which spellings stand for a locale, and which first segments are left to
 * whatever serves them. Each value is the address table's, which the table spec holds to
 * `route-policy.ts`.
 */
function verifyAddressDeclarations() {
  const locale = INIT_REQUEST.defaultLocale;
  const homes = INIT_REQUEST.locales.filter((each) =>
    addresses.has('home', each),
  );
  const items = INIT_REQUEST.locales.filter((each) =>
    addresses.has('item', each),
  );
  const sheets = INIT_REQUEST.locales.filter((each) =>
    addresses.has('exercise', each),
  );
  const aliased = addresses.locales('second under an alias');
  const asked = [
    {
      origin: addresses.origin(locale),
      path: addresses.path('exercise', locale),
    },
    ...homes.map((each) => ({
      origin: addresses.origin(each),
      path: addresses.path('home', each),
    })),
    ...items.map((each) => ({
      origin: addresses.origin(each),
      path: addresses.path('item', each),
    })),
    ...sheets.map((each) => ({
      origin: addresses.origin(each),
      path: addresses.path('exercise', each),
    })),
    ...aliased.map((each) => ({
      origin: addresses.origin(each),
      path: `${addresses.path('second under an alias', each)}?tab=one`,
    })),
    // Each root beside a segment one word longer, which the policy does take, so a root that
    // stopped being declared answers differently from one that is.
    ...addresses.localeNeutralRoots.flatMap((segment) => [
      { origin: addresses.origin(locale), path: `/${segment}/logo` },
      { origin: addresses.origin(locale), path: `/${segment}-elsewhere/logo` },
    ]),
  ];
  const answers = serverAnswers(asked);
  const { policy } = sheetInDocument(answers[0]!.body);
  let next = 1;

  // The build writes the head of every page it prerenders with the same policy, so the pages it
  // offers to an index carry the same x-default. The exercise sheet and the deferred page are
  // declared non-indexable, so neither is one of them.
  for (const page of addresses.prerendered.filter(
    (each) => each !== 'exercise values' && each !== 'deferred',
  )) {
    for (const each of INIT_REQUEST.locales) {
      if (!addresses.has(page, each)) continue;
      const check = `${consumerName}: x-default on ${page} in ${each}, prerendered`;
      const written = readFileSync(
        resolve(
          consumerRoot,
          builds.output(addresses.origin(each)!),
          'browser',
          addresses.file(page, each),
        ),
        'utf8',
      );
      assert.equal(
        new JSDOM(written).window.document
          .querySelector('link[rel="alternate"][hreflang="x-default"]')
          ?.getAttribute('href'),
        addresses.xDefault,
        `${check}: not where xDefaultPath or xDefaultUrl declares it`,
      );
      recordCapabilityClaim(check, 'declaration:x-default', {
        document: written,
        policy,
      });
    }
  }

  for (const each of homes) {
    const answer = answers[next++]!;
    const check = `${consumerName}: x-default on home in ${each}`;
    const { document } = new JSDOM(answer.body).window;
    assert.equal(
      document
        .querySelector('link[rel="alternate"][hreflang="x-default"]')
        ?.getAttribute('href'),
      addresses.xDefault,
      `${check}: not where xDefaultPath or xDefaultUrl declares it`,
    );
    recordCapabilityClaim(check, 'declaration:x-default', {
      document: answer.body,
      policy,
    });
  }

  // `item` is spelled with the words localizedPaths gives it in each locale.
  for (const each of items) {
    const answer = answers[next++]!;
    const check = `${consumerName}: item in ${each}`;
    assert.equal(
      answer.status,
      200,
      `${check}: the path localizedPaths spells it with was not served`,
    );
    assert.equal(answer.headers['content-language'], each);
    recordCapabilityClaim(check, 'declaration:localized-paths', {
      document: answer.body,
      policy,
    });
  }

  // So is the exercise sheet, which the server draws on request and the build writes.
  for (const each of sheets) {
    const answer = answers[next++]!;
    const check = `${consumerName}: the exercise sheet in ${each}`;
    assert.equal(
      answer.status,
      200,
      `${check}: the path localizedPaths spells it with was not served`,
    );
    assert.equal(answer.headers['content-language'], each);
    assert.equal(
      sheetInDocument(answer.body).locale,
      each,
      `${check}: the server did not draw the sheet in the locale its address spells`,
    );
    recordCapabilityClaim(check, 'declaration:localized-paths', {
      document: answer.body,
      policy,
    });
  }
  for (const each of INIT_REQUEST.locales) {
    if (!addresses.has('exercise values', each)) continue;
    const check = `${consumerName}: the exercise sheet in ${each}, prerendered`;
    const written = resolve(
      consumerRoot,
      builds.output(addresses.origin(each)!),
      'browser',
      addresses.file('exercise values', each),
    );
    assert.ok(
      existsSync(written),
      `${check}: the build did not write it at the path localizedPaths spells it with`,
    );
    const document = readFileSync(written, 'utf8');
    assert.equal(
      sheetInDocument(document).locale,
      each,
      `${check}: the build did not write the sheet in the locale its address spells`,
    );
    recordCapabilityClaim(check, 'declaration:localized-paths', {
      document,
      policy,
    });
  }

  for (const each of aliased) {
    const answer = answers[next++]!;
    const check = `${consumerName}: the ${each} alias`;
    assert.equal(
      answer.status,
      308,
      `${check}: an address under one of the aliases the policy declares was not sent on`,
    );
    assert.equal(
      answer.headers.location,
      `${addresses.address('second', each)}?tab=one`,
      `${check}: not sent to the address of the locale it stands for, with its query kept`,
    );
    // An alias is answered before anything renders, so there is no document to observe.
    recordCapabilityClaim(check, 'declaration:locale-aliases', { policy });
  }

  for (const segment of addresses.localeNeutralRoots) {
    const declined = answers[next++]!;
    const taken = answers[next++]!;
    const check = `${consumerName}: the ${segment} root`;
    assert.deepEqual(
      {
        status: declined.status,
        contentLanguage: declined.headers['content-language'],
        location: declined.headers.location,
        robots: declined.headers['x-robots-tag'],
      },
      {
        status: 404,
        contentLanguage: undefined,
        location: undefined,
        robots: undefined,
      },
      `${check}: an address under a segment localeNeutralRoots declares was answered by Equator rather than left to the server that owns it`,
    );
    assert.ok(
      taken.headers['content-language'] !== undefined ||
        taken.headers.location !== undefined,
      `${check}: an address under ${segment}-elsewhere, which is no root, was not answered by Equator, so the root's answer shows nothing`,
    );
    recordCapabilityClaim(check, 'declaration:locale-neutral-roots', {
      policy,
    });
  }
}
verifyAddressDeclarations();

/**
 * The sitemap each deployment serves, read off its server: the pages it publishes, the alternates
 * each entry carries, and what each route's sitemap declaration says about it.
 *
 * `app.config.ts` maps the route data field `section` to a changefreq and a priority, and names
 * `updated` as the lastmod field. `home` is `landing`, daily at 1.0; `second` is `reference`,
 * monthly at 0.5, and declares its own date; the article's class is not in the map, so its entry
 * claims none of the three. `item` is non-indexable and `lazy` is not published, so neither is
 * listed.
 */
function verifySitemap() {
  const locale = INIT_REQUEST.defaultLocale;
  // A sitemap lists the addresses of the origin serving it, so each origin is asked for its own.
  const deployments = [
    ...new Set(INIT_REQUEST.locales.map((each) => addresses.origin(each))),
  ].map((origin) => ({
    origin,
    locales: INIT_REQUEST.locales.filter(
      (each) => addresses.origin(each) === origin,
    ),
  }));
  const answers = serverAnswers([
    {
      origin: addresses.origin(locale),
      path: addresses.path('exercise', locale),
    },
    ...deployments.map(({ origin }) => ({ origin, path: '/sitemap.xml' })),
  ]);
  const { policy } = sheetInDocument(answers[0]!.body);
  const published = ['second', 'article', 'home'];
  const declared: Readonly<
    Record<
      string,
      {
        lastmod: string | undefined;
        changefreq: string | undefined;
        priority: string | undefined;
      }
    >
  > = {
    second: { lastmod: '2026-09-01', changefreq: 'monthly', priority: '0.5' },
    article: { lastmod: undefined, changefreq: undefined, priority: undefined },
    home: { lastmod: undefined, changefreq: 'daily', priority: '1.0' },
  };
  for (const [index, { origin, locales }] of deployments.entries()) {
    const answer = answers[index + 1]!;
    const check = `${consumerName}: the sitemap at ${origin}`;
    assert.equal(answer.status, 200, `${check}: not served`);
    assert.match(
      answer.headers['content-type'] ?? '',
      /^application\/xml/u,
      `${check}: not served as XML`,
    );
    const { document } = new JSDOM(answer.body, { contentType: 'text/xml' })
      .window;
    const entries = [...document.querySelectorAll('url')].map((entry) => ({
      loc: entry.querySelector('loc')?.textContent,
      lastmod: entry.querySelector('lastmod')?.textContent,
      changefreq: entry.querySelector('changefreq')?.textContent,
      priority: entry.querySelector('priority')?.textContent,
      alternates: [...entry.getElementsByTagName('xhtml:link')].map((link) => [
        link.getAttribute('hreflang'),
        link.getAttribute('href'),
      ]),
    }));
    const expected = published.flatMap((page) =>
      locales
        .filter((each) => addresses.has(page, each))
        .map((each) => ({
          loc: addresses.url(page, each),
          ...declared[page],
          // Every locale the page is in, wherever it is served from, and where x-default points.
          alternates: [
            ...INIT_REQUEST.locales
              .filter((other) => addresses.has(page, other))
              .map((other) => [other, addresses.url(page, other)]),
            ...(addresses.xDefault === undefined
              ? []
              : [['x-default', addresses.xDefault]]),
          ],
        })),
    );
    assert.deepEqual(
      entries,
      expected,
      `${check}: its entries are not the published pages, with their alternates and what each route's sitemap declaration gives changefreq, priority and lastmod`,
    );
    recordCapabilityClaim(check, 'capability:sitemap', { policy });
    recordCapabilityClaim(check, 'declaration:route-sitemap-entry', {
      policy,
    });
  }
}
verifySitemap();

/**
 * The command line as an application's author meets it, on every row this stage runs: each
 * command against this seat, held to what `specs/10-compiler-and-tooling.spec.md` section 11 says
 * it does. Here rather than beside the first generation because a claim for the three commands that
 * analyze the application carries the URL policy it runs, and the policy is read from a page the
 * server drew, which needs the builds above.
 */
async function verifyCommandLine() {
  const [answer] = serverAnswers([
    {
      origin: addresses.origin(INIT_REQUEST.defaultLocale),
      path: addresses.path('exercise', INIT_REQUEST.defaultLocale),
    },
  ]) as [ServerAnswer];
  const { policy } = sheetInDocument(answer.body);
  const cliPath = resolve(
    consumerRoot,
    'node_modules/@neolorn/equator-toolkit/cli.js',
  );
  const equator = (
    cwd: string,
    args: readonly string[],
    expectedStatus = 0,
  ) => {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    });
    assert.equal(
      result.status,
      expectedStatus,
      [
        `equator ${args.join(' ')}`,
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return result;
  };
  const machine = (cwd: string, args: readonly string[], expectedStatus = 0) =>
    parseMachineResult(equator(cwd, [...args, '--json'], expectedStatus));
  const catalogPath = 'i18n/shell/en-US.yaml';
  const catalogFile = resolve(consumerRoot, catalogPath);
  const catalog = await readFile(catalogFile, 'utf8');
  const plainLine = '  source-only: Source fallback remains truthful.\n';
  assert.ok(
    catalog.includes(plainLine),
    `${catalogPath} no longer holds the line these steps edit`,
  );
  const withCatalog = async (
    text: string,
    step: () => void | Promise<void>,
  ) => {
    await writeFile(catalogFile, text, 'utf8');
    try {
      await step();
    } finally {
      await writeFile(catalogFile, catalog, 'utf8');
    }
  };

  const toolkitVersion = (
    await readJson(
      resolve(
        consumerRoot,
        'node_modules/@neolorn/equator-toolkit/package.json',
      ),
    )
  ).version;
  assert.equal(
    equator(consumerRoot, ['--version']).stdout.trim(),
    toolkitVersion,
    'equator --version does not print the installed toolkit version',
  );

  await verifyUninstall(equator, machine);

  // A comment, because it changes no message and so leaves every later check reading what it read
  // before, while still being a change the migration has to carry, preview and apply.
  const planPath = resolve(consumerRoot, 'tmp/migration.json');
  const tamperedPath = resolve(consumerRoot, 'tmp/migration-tampered.json');
  const { createMigrationPlan } = await import(
    pathToFileURL(
      resolve(consumerRoot, 'node_modules/@neolorn/equator-toolkit/index.js'),
    ).href
  );
  const migratedCatalog = `# The source messages of the application shell.\n${catalog}`;
  const planned = createMigrationPlan({
    id: 'annotate-shell',
    domain: 'catalog',
    fromVersion: '1',
    toVersion: '2',
    changes: [{ path: catalogPath, before: catalog, after: migratedCatalog }],
  });
  assert.equal(planned.ok, true, JSON.stringify(planned.diagnostics));
  await writeFile(planPath, JSON.stringify(planned.value), 'utf8');
  await writeFile(
    tamperedPath,
    JSON.stringify({
      ...planned.value,
      changes: [
        { ...planned.value.changes[0], after: `# Edited.\n${catalog}` },
      ],
    }),
    'utf8',
  );
  const migrate = (
    plan: string,
    extra: readonly string[] = [],
    expectedStatus = 0,
  ) =>
    machine(
      consumerRoot,
      ['migrate', '--plan', plan, '--project', '.', ...extra],
      expectedStatus,
    );
  const beforeMigration = await treeDigest(consumerRoot);
  const tampered = migrate(tamperedPath, [], 2);
  assert.equal(tampered.diagnostics[0]?.code, 'EQ1805');
  assert.deepEqual(
    await treeDigest(consumerRoot),
    beforeMigration,
    'equator migrate wrote to the project under a plan whose content does not match its digest',
  );
  const previewed = migrate(planPath, ['--dry-run']);
  assert.equal(previewed.result.changed, true);
  assert.deepEqual(previewed.result.files, [catalogPath]);
  assert.deepEqual(
    await treeDigest(consumerRoot),
    beforeMigration,
    'equator migrate --dry-run wrote to the project',
  );
  const migrated = migrate(planPath);
  assert.deepEqual(migrated.result.files, [catalogPath]);
  assert.equal(await readFile(catalogFile, 'utf8'), migratedCatalog);
  assert.deepEqual(
    await treeDigest(consumerRoot),
    { ...beforeMigration, [catalogPath]: digestOf(migratedCatalog) },
    'equator migrate changed a file its plan does not name',
  );
  const reapplied = migrate(planPath);
  assert.equal(reapplied.result.changed, false, 'the migration applied twice');
  assert.deepEqual(reapplied.result.files, []);
  const afterMigration = machine(consumerRoot, ['generate']);
  assert.equal(afterMigration.status, 'success');
  recordCapabilityClaim(
    `${consumerName}: equator generate after a migration`,
    'cli:generate',
    { policy },
  );
  assert.equal(machine(consumerRoot, ['check']).result.fresh, true);
  recordCapabilityClaim(
    `${consumerName}: equator migrate over the seat's catalog`,
    'cli:migrate',
    {},
  );
  await writeFile(catalogFile, catalog, 'utf8');
  machine(consumerRoot, ['generate']);

  // The compile verb of the programmatic API, over the same project. It writes nothing, and the
  // route policy its analysis read is the one the application runs, which the page above reports.
  const { compileProjectFromDisk } = await import(
    pathToFileURL(
      resolve(consumerRoot, 'node_modules/@neolorn/equator-toolkit/index.js'),
    ).href
  );
  const beforeCompile = await treeDigest(consumerRoot);
  const compiled = await compileProjectFromDisk({ cwd: consumerRoot });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(
    await treeDigest(consumerRoot),
    beforeCompile,
    'compileProjectFromDisk wrote to the project',
  );
  const analyzedPolicy = compiled.value.compilation.analysis?.routePolicy;
  assert.deepEqual(
    {
      kind: analyzedPolicy?.kind,
      omitDefaultPrefix: analyzedPolicy?.omitDefaultPrefix,
    },
    { kind: policy.kind, omitDefaultPrefix: policy.omitDefaultPrefix === true },
    'compileProjectFromDisk read another route policy than the one the application runs',
  );
  // Every row's policy takes its default locale and its locales from the generated configuration,
  // which is code the analysis does not run, so it reports neither rather than a guess.
  assert.deepEqual(
    {
      locales: analyzedPolicy.locales,
      defaultLocale: analyzedPolicy.defaultLocale,
    },
    { locales: [], defaultLocale: undefined },
    'compileProjectFromDisk read locales from a policy that states none in its source',
  );
  recordCapabilityClaim(
    `${consumerName}: compileProjectFromDisk over the seat`,
    'entry:@neolorn/equator-toolkit',
    { policy },
  );

  // Written the way a person might: a comment of their own, and quotes the value does not need.
  const quotedLine = '  source-only: "Source fallback remains truthful."\n';
  const handWritten = `# Kept by hand.\n${catalog.replace(plainLine, quotedLine)}`;
  await withCatalog(handWritten, async () => {
    const preview = machine(consumerRoot, ['format', '--dry-run']);
    assert.equal(preview.result.changed, true);
    assert.deepEqual(preview.result.files, [catalogPath]);
    assert.equal(await readFile(catalogFile, 'utf8'), handWritten);
    const formatted = machine(consumerRoot, ['format']);
    assert.deepEqual(formatted.result.files, [catalogPath]);
    assert.equal(
      await readFile(catalogFile, 'utf8'),
      `# Kept by hand.\n${catalog}`,
      'equator format did not keep the comment and the order and drop only the quotes',
    );
    assert.equal(machine(consumerRoot, ['format']).result.changed, false);
    recordCapabilityClaim(
      `${consumerName}: equator format over a catalog written by hand`,
      'cli:format',
      {},
    );
  });

  await withCatalog(catalog.replace(plainLine, quotedLine), async () => {
    const fixed = machine(consumerRoot, ['check', '--fix']);
    assert.equal(fixed.status, 'success');
    assert.deepEqual(
      fixed.result.fixedFiles,
      [catalogPath],
      'equator check --fix did not report the catalog it rewrote',
    );
    assert.equal(
      await readFile(catalogFile, 'utf8'),
      catalog,
      'equator check --fix did not rewrite the catalog to its canonical form',
    );
    recordCapabilityClaim(`${consumerName}: equator check --fix`, 'cli:check', {
      policy,
    });
  });

  const editedLine = '  source-only: Source fallback remains current.\n';
  await withCatalog(catalog.replace(plainLine, editedLine), () => {
    const stale = machine(consumerRoot, ['check', '--require-fresh'], 1);
    assert.equal(stale.result.fresh, false);
    machine(consumerRoot, ['generate']);
    const fresh = machine(consumerRoot, ['check', '--require-fresh']);
    assert.equal(fresh.result.fresh, true);
    recordCapabilityClaim(
      `${consumerName}: equator check --require-fresh`,
      'cli:check',
      { policy },
    );
  });
  machine(consumerRoot, ['generate']);
  assert.equal(
    machine(consumerRoot, ['check', '--require-fresh']).result.fresh,
    true,
  );

  await verifyWatchEvents(cliPath, catalogFile, catalog, policy);
}

/** A file's content as `treeDigest` records it. */
function digestOf(contents: string | Buffer) {
  return createHash('sha256').update(contents).digest('base64');
}

/**
 * Every file under a seat and its content, so a command that was to write nothing, or one file,
 * can be held to exactly that. What installs, builds and the stage's own scratch write is left out.
 */
async function treeDigest(root: string) {
  const skipped = new Set([
    'node_modules',
    'dist',
    'tmp',
    '.angular',
    'embedded',
  ]);
  const digests: [string, string][] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === root && skipped.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        digests.push([
          relative(root, path).split(sep).join('/'),
          digestOf(await readFile(path)),
        ]);
      }
    }
  };
  await walk(root);
  return Object.fromEntries(digests.sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * `equator clean` and `equator uninstall` on a copy of this seat, because every step after this one
 * reads the seat. The copy reaches the seat's packages through a junction, so `init` and
 * `generate` can put it back.
 */
async function verifyUninstall(
  equator: (
    cwd: string,
    args: readonly string[],
    expectedStatus?: number,
  ) => SpawnSyncReturns<string>,
  machine: (
    cwd: string,
    args: readonly string[],
    expectedStatus?: number,
  ) => MachineResult,
) {
  // Beside the seat rather than inside it: an owner inside another finds the outer configuration
  // once its own is gone, and answers for that one.
  const copy = resolve(consumerRoot, '..', `${consumerName}-uninstall`);
  const packages = resolve(copy, 'node_modules');
  const removeCopy = async () => {
    // The link first and by itself, so removing the copy cannot reach the seat's packages.
    if ((await lstat(packages).catch(() => undefined))?.isSymbolicLink()) {
      await unlink(packages);
    }
    await rm(copy, { recursive: true, force: true });
  };
  await removeCopy();
  for (const entry of await readdir(consumerRoot)) {
    if (['node_modules', 'dist', 'tmp', '.angular', 'embedded'].includes(entry))
      continue;
    await cp(resolve(consumerRoot, entry), resolve(copy, entry), {
      recursive: true,
    });
  }
  await symlink(resolve(consumerRoot, 'node_modules'), packages, 'junction');
  try {
    const dryClean = machine(copy, ['clean', '--dry-run']);
    assert.ok(dryClean.result.removed.length > 0);
    assert.deepEqual(
      machine(copy, ['clean']).result.removed,
      dryClean.result.removed,
    );
    await assert.rejects(
      lstat(resolve(copy, 'src/generated/i18n')),
      { code: 'ENOENT' },
      'equator clean left the generated files',
    );
    machine(copy, ['generate']);

    const editedScript = `${PACKAGE_SCRIPTS['equator:check']} --json`;
    const manifestPath = resolve(copy, 'package.json');
    const manifest = await readJson(manifestPath);
    manifest.scripts['equator:check'] = editedScript;
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    const catalogs = Object.entries(await treeDigest(copy)).filter(([path]) =>
      path.startsWith('i18n/'),
    );
    assert.ok(catalogs.length > 0);

    const configuration = await readJson(resolve(copy, 'equator.config.json'));
    const before = await treeDigest(copy);
    const preview = machine(copy, ['uninstall', '--dry-run']);
    assert.equal(preview.result.changed, true);
    assert.deepEqual(
      await treeDigest(copy),
      before,
      'equator uninstall --dry-run wrote to the project',
    );
    const uninstalled = machine(copy, ['uninstall']);
    assert.deepEqual(uninstalled.result.removed, preview.result.removed);
    assert.deepEqual(uninstalled.result.retained, ['scripts.equator:check']);
    assert.deepEqual(uninstalled.result.catalogs, []);
    for (const gone of [
      'equator.config.json',
      'src/generated/i18n',
      '.equator',
    ]) {
      await assert.rejects(
        lstat(resolve(copy, gone)),
        { code: 'ENOENT' },
        `equator uninstall left ${gone}`,
      );
    }
    const left = await readJson(manifestPath);
    assert.deepEqual(
      Object.keys(left.imports ?? {}).filter((specifier) =>
        specifier.startsWith('#i18n'),
      ),
      [],
      'equator uninstall left a #i18n import mapping',
    );
    for (const name of Object.keys(PACKAGE_SCRIPTS)) {
      assert.equal(
        left.scripts?.[name],
        name === 'equator:check' ? editedScript : undefined,
        `equator uninstall did not take back ${name}, or did not keep it once edited`,
      );
    }
    const after = await treeDigest(copy);
    for (const [path, digest] of catalogs) {
      assert.equal(after[path], digest, `equator uninstall changed ${path}`);
    }
    // With its configuration gone the owner is no longer an Equator project, so a second run is
    // refused as one, and writes nothing.
    const again = machine(copy, ['uninstall'], 2);
    assert.equal(again.diagnostics[0]?.code, 'EQ1702');
    assert.deepEqual(
      await treeDigest(copy),
      after,
      'a second equator uninstall wrote to the project',
    );

    // The edited script is its author's to settle before Equator is set up again.
    delete left.scripts['equator:check'];
    await writeFile(manifestPath, `${JSON.stringify(left, null, 2)}\n`, 'utf8');
    // Every field the configuration held, as flags, which is how a person sets each one.
    const optionFlags = (
      flag: string,
      table: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
    ) =>
      Object.entries(table).flatMap(([locale, options]) =>
        Object.entries(options).flatMap(([option, value]) => [
          flag,
          `${locale}.${option}=${value}`,
        ]),
      );
    equator(copy, [
      'init',
      ...initArguments.slice(3),
      ...optionFlags('--pseudo-locale', PSEUDO_LOCALES),
      ...optionFlags('--formatting', LOCALE_FORMATTING),
    ]);
    assert.deepEqual(
      await readJson(resolve(copy, 'equator.config.json')),
      configuration,
      'equator init did not write back the configuration equator uninstall removed',
    );
    assert.equal(machine(copy, ['generate']).status, 'success');
    await lstat(resolve(copy, 'src/generated/i18n/index.ts'));
    recordCapabilityClaim(
      `${consumerName}: equator clean on a copy of the seat`,
      'cli:clean',
      {},
    );
    recordCapabilityClaim(
      `${consumerName}: equator uninstall on a copy of the seat`,
      'cli:uninstall',
      {},
    );
    recordCapabilityClaim(
      `${consumerName}: equator init after equator uninstall`,
      'cli:init',
      {},
    );
  } finally {
    await removeCopy();
  }
}

/**
 * `equator watch --json`: every event it prints is one the published schema accepts, a catalog
 * that stops parsing is reported as an event rather than ending the watch, and the next good
 * version is generated.
 */
async function verifyWatchEvents(
  cliPath: string,
  catalogFile: string,
  catalog: string,
  policy: NonNullable<CapabilityObservation['policy']>,
) {
  const toolkitRoot = resolve(
    consumerRoot,
    'node_modules/@neolorn/equator-toolkit',
  );
  // From the package's real location, which pnpm links into `node_modules`: its own dependencies
  // sit beside the target, not beside the link.
  const { default: Ajv2020 } = createRequire(
    resolve(await realpath(toolkitRoot), 'package.json'),
  )('ajv/dist/2020.js');
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    await readJson(
      resolve(toolkitRoot, 'schemas', 'cli-watch-event.v1.schema.json'),
    ),
  );
  const child = spawn(process.execPath, [cliPath, 'watch', '--json'], {
    cwd: consumerRoot,
    env: { ...process.env, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const events: WatchEvent[] = [];
  let pending = '';
  let stderr = '';
  let aliveAfterFailure = false;
  // Each edit waits for the outcome of the one before it rather than for a count of events, so an
  // event nobody expected is left for the assertion below to name with the whole list beside it,
  // and does not move the edits out of step first.
  let step = 'start';
  const completed = new Promise((resolvePromise, rejectPromise) => {
    // One bound on the whole, as `verifyWatchCommand` has, for its reason.
    const CEILING_MILLISECONDS = 300_000;
    const ceilingTimer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectPromise(
        new Error(
          `equator watch --json ran past its ${CEILING_MILLISECONDS / 1000}s ceiling at step ${step}.\n${JSON.stringify(events)}\n${pending}\n${stderr}`,
        ),
      );
    }, CEILING_MILLISECONDS);
    child.stdout.on('data', (chunk) => {
      const lines = `${pending}${chunk.toString()}`.split('\n');
      pending = lines.pop()!;
      for (const line of lines.filter((each) => each.trim() !== '')) {
        const event = JSON.parse(line) as WatchEvent;
        events.push(event);
        if (step === 'start') {
          step = 'break';
          setTimeout(() => {
            void writeFile(
              catalogFile,
              `${catalog}  broken: "unterminated\n`,
              'utf8',
            );
          }, 100);
        } else if (step === 'break' && event.status !== 'success') {
          step = 'restore';
          aliveAfterFailure = child.exitCode === null;
          setTimeout(() => {
            void writeFile(catalogFile, catalog, 'utf8');
          }, 100);
        } else if (step === 'restore' && event.status === 'success') {
          step = 'done';
          child.kill('SIGTERM');
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', rejectPromise);
    child.once('close', () => {
      clearTimeout(ceilingTimer);
      resolvePromise(undefined);
    });
  });
  try {
    await completed;
  } finally {
    await writeFile(catalogFile, catalog, 'utf8');
  }
  for (const event of events) {
    assert.equal(
      validate(event),
      true,
      `equator watch --json printed an event its schema refuses: ${JSON.stringify(validate.errors)}\n${JSON.stringify(event)}`,
    );
  }
  // One event for startup and one for each of the two edits. A read can itself raise a filesystem
  // event where the platform records access times, and
  // `specs/10-compiler-and-tooling.spec.md` section 13 has a cycle over unchanged inputs report
  // nothing, so an event beyond these three is a cycle no edit caused.
  assert.deepEqual(
    events.map(({ status }) => status),
    ['success', 'diagnostic-failure', 'success'],
    `${JSON.stringify(events)}\n${stderr}`,
  );
  assert.ok(
    aliveAfterFailure,
    'equator watch stopped when a catalog stopped parsing',
  );
  recordCapabilityClaim(`${consumerName}: equator watch --json`, 'cli:watch', {
    policy,
  });
}

await verifyCommandLine();

/**
 * The exercise sheet, as these servers answer it and as these builds wrote it, in every locale
 * they serve. Each line is held to what this Node's own formatters write for the same input, on
 * the Node the server and the build ran on.
 */
async function verifyExerciseSheets() {
  const inputs = await readExerciseInputs(consumerRoot);
  const verifySheet = async (
    check: string,
    locale: string,
    document: string,
    rendered: 'ssr' | 'ssg',
    page: keyof typeof exerciseSheetNames,
    log: string,
  ) => {
    const sheet = sheetInDocument(document);
    assert.equal(sheet.locale, locale, `${check} shows ${sheet.locale}`);
    assert.ok(
      document.includes(`ng-server-context="${rendered}"`),
      `${check} was not written by the ${rendered === 'ssr' ? 'server' : 'build'} that provideLocalizedServerRendering from @neolorn/equator/ssr sets up`,
    );
    const sources = await readExerciseSources(consumerRoot, locale, inputs);
    const expected = exerciseAuthority({ inputs, locale, ...sources });
    const observed = { document, policy: sheet.policy };
    recordCapabilityClaim(
      check,
      'feature:provideLocalizedServerRendering',
      observed,
    );
    recordCapabilityClaim(check, 'entry:@neolorn/equator/ssr', observed);
    assert.equal(
      new JSDOM(document).window.document
        .querySelector('meta[name="robots"]')
        ?.getAttribute('content'),
      'noindex',
      `${check}: the exercise route declares equatorIndexing non-indexable, and its head does not keep it out of an index`,
    );
    recordCapabilityClaim(check, 'declaration:route-indexing-class', observed);
    // A build has no request, so no stored choice and no language to read, and the default would
    // have written the sheet in the default locale. A sheet the build wrote in another locale was
    // written in the one its address states.
    if (rendered === 'ssg' && locale !== INIT_REQUEST.defaultLocale) {
      const source = 'url';
      const address = (at: string) =>
        `${addresses.origin(at)}${addresses.path(page, at)}`;
      assert.notEqual(
        address(locale),
        address(INIT_REQUEST.defaultLocale),
        `${check}: the ${source} source can name the locale of a prerendered sheet only where its address differs from the default locale's`,
      );
      recordCapabilityClaim(check, 'source:url', observed);
    }
    claimSheetParameter(
      check,
      sheet,
      exerciseSheetNames[page],
      locale,
      observed,
    );
    claimExercisedContext(check, sheet, expected, observed);
    claimInstalledRelativeTime(check, sheet, expected, observed);
    claimExercisedPipes(check, sheet, expected, observed);
    claimExercisedDirectives(check, sheet, expected, observed);
    claimExercisedFormats(check, sheet, expected, observed);
    claimExercisedControls(check, sheet, expected, inputs.controls, observed);
    claimExercisedExtensions(check, sheet, expected, observed);
    claimOverlayLocale(check, sheet, locale, sources.direction, observed);
    claimLoggedHandOver(check, loggedEvents(log), locale, observed);
  };

  const served = INIT_REQUEST.locales.filter((locale) =>
    addresses.has('exercise', locale),
  );
  const { answers, log } = loggedServerAnswers(
    served.map((locale) => ({
      origin: addresses.origin(locale),
      path: addresses.path('exercise', locale),
    })),
  );
  for (const [index, locale] of served.entries()) {
    assert.equal(answers[index]!.status, 200, `exercise in ${locale}`);
    await verifySheet(
      `${consumerName}: exercise sheet in ${locale}, rendered on request`,
      locale,
      answers[index]!.body,
      'ssr',
      'exercise',
      log,
    );
  }
  for (const locale of INIT_REQUEST.locales) {
    if (!addresses.has('exercise values', locale)) continue;
    const document = await readFile(
      resolve(
        consumerRoot,
        builds.output(addresses.origin(locale)!),
        'browser',
        addresses.file('exercise values', locale),
      ),
      'utf8',
    );
    await verifySheet(
      `${consumerName}: exercise sheet in ${locale}, prerendered`,
      locale,
      document,
      'ssg',
      'exercise values',
      buildLogs.get(addresses.origin(locale)!)!,
    );
  }
}
await verifyExerciseSheets();

const browserText = (
  await Promise.all(browserFiles.map((path) => readFile(path, 'utf8')))
).join('\n');
for (const forbidden of [
  '@neolorn/equator-toolkit',
  'supported testing entry point remains intentionally empty',
  'equator-cli-result/1',
  'node:fs',
]) {
  assert.equal(
    browserText.includes(forbidden),
    false,
    `Browser output contains forbidden toolkit/Node text: ${forbidden}`,
  );
}

/*
 * The pseudo-locale outside the browser.
 *
 * Everything above ran against a production build. This rebuilds the same consumer, unchanged
 * except for the flag on `equator generate`, and asks whether a pseudo-locale renders where there
 * is no browser to switch in: prerendering, which has no request and therefore no negotiation, so
 * every locale's copy has to be a separate address that exists in the build.
 *
 * It builds to its own output path and puts the generated source back afterwards, so what this
 * step hands on is the production build every later step expects. Building over
 * `dist/feature-lab` and leaving it there has `verify:browser-assurance` read a six-address
 * prerender manifest where it expects four, and report `PASS` in one second, because importing the
 * consumer's server bundle installs Angular's `attachNodeGlobalErrorHandlers` and a log-only
 * `uncaughtException` handler stops Node exiting non-zero.
 */
run(['exec', 'equator', 'generate', '--pseudo']);

// One pseudo build for each origin the two pages read below are served at, which is one under a
// path policy. The address set is exact for the same reason as above: a prerendered route whose
// component throws is dropped silently, and the pseudo-locale's pages appearing is only half the
// claim. The other half is that there are no others: `en-Latn-XA` is declared and generated too,
// and the policy gives it no address, so it must produce no file at all.
const pseudoLocales = [...INIT_REQUEST.locales, ...Object.keys(PSEUDO_LOCALES)];
const pseudoRoots = new Map<string, string>();
for (const origin of originsOf([INIT_REQUEST.sourceLocale, 'en-Arab-XB'])) {
  const output = builds.output(origin, 'dist/feature-lab-pseudo');
  await buildAt(origin, output);
  const root = resolve(consumerRoot, output, 'browser');
  const emitted = (await collectPrerendered(root)).sort();
  const expected = prerenderedFiles(servedAt(origin, pseudoLocales), {
    pseudo: true,
  }).sort();
  assert.deepEqual(
    emitted,
    expected,
    `The pseudo build's prerendered address set at ${origin} is wrong.\nEmitted:\n  ${emitted.join('\n  ')}\nExpected:\n  ${expected.join('\n  ')}`,
  );
  pseudoRoots.set(origin, root);
}
/** The pseudo build that prerendered the locale's pages. */
const pseudoRootOf = (locale: string) =>
  pseudoRoots.get(addresses.origin(locale)!)!;

/**
 * The pseudo build answering on request, which is how a development server shows the pseudo-locale:
 * its sheet drawn by the server, every message on it transformed, and its number written in the
 * digits the formatting declaration gives it.
 */
async function verifyPseudoServed() {
  const locale = 'en-Arab-XB';
  const { decimal } = await readExerciseInputs(consumerRoot);
  const check = `${consumerName}: the pseudo build's ${locale} sheet, rendered on request`;
  const [answer] = serverAnswers(
    [
      {
        origin: addresses.origin(locale),
        path: addresses.path('exercise', locale),
      },
    ],
    { output: 'dist/feature-lab-pseudo' },
  ) as [ServerAnswer];
  assert.equal(answer.status, 200, `${check} was not answered`);
  assert.ok(
    answer.body.includes('ng-server-context="ssr"'),
    `${check} was not drawn by the server`,
  );
  const sheet = sheetInDocument(answer.body);
  assert.equal(sheet.locale, locale, `${check} shows ${sheet.locale}`);
  assert.ok(
    answer.body.includes('⟦'),
    `${check} carries no message that equator generate --pseudo transformed`,
  );
  const { numberingSystem } = LOCALE_FORMATTING[locale];
  assert.equal(
    sheet.lines.get('formatNumber'),
    new Intl.NumberFormat(locale, {
      ...decimal.options,
      numberingSystem,
    }).format(Number(decimal.value)),
    `${check}: its number is not written in the digits the formatting declaration gives it`,
  );
  const observed = { document: answer.body, policy: sheet.policy };
  recordCapabilityClaim(check, 'capability:pseudo-locale', observed);
  recordCapabilityClaim(check, 'declaration:locale-formatting', observed);
}
if (addresses.has('exercise', 'en-Arab-XB')) {
  await verifyPseudoServed();
}

/**
 * The pseudo-locale's prerendered pages, where the policy gives it addresses of its own. Under a
 * locale-neutral policy it has none, because it spells every address the way English does, and the
 * set above has already held its builds to writing no page for it.
 */
async function verifyPseudoPages() {
  const routeViewText = (html: string, view: string) => {
    const match = new RegExp(
      `<p[^>]*data-route-view="${view}"[^>]*>(.*?)</p>`,
      'su',
    ).exec(html);
    assert.ok(match, `No ${view} route view in the prerendered page`);
    return match[1]!.replace(/<!--.*?-->/gsu, '').trim();
  };

  const pseudoPage = await readFile(
    resolve(pseudoRootOf('en-Arab-XB'), addresses.file('second', 'en-Arab-XB')),
    'utf8',
  );
  const englishPage = await readFile(
    resolve(
      pseudoRootOf(INIT_REQUEST.sourceLocale),
      addresses.file('second', INIT_REQUEST.sourceLocale),
    ),
    'utf8',
  );

  // Direction and language, read off the rendered document rather than off configuration. The tag
  // carries the script and the script carries the direction, so a prerendered page that is not RTL
  // means the tag did not survive to the renderer, which is the failure this locale exists to make
  // impossible to bolt on afterwards.
  assert.match(
    pseudoPage,
    /<html[^>]*\slang="en-Arab-XB"/u,
    'The prerendered pseudo-locale page did not carry its own language tag',
  );
  assert.match(
    pseudoPage,
    /<html[^>]*\sdir="rtl"/u,
    'The prerendered pseudo-locale page was not rendered right to left',
  );

  const pseudoText = routeViewText(pseudoPage, 'second');
  const englishText = routeViewText(englishPage, 'second');
  assert.ok(
    pseudoText.startsWith('⟦') && pseudoText.endsWith('⟧'),
    `The prerendered pseudo-locale page carried text that equator generate --pseudo did not transform: ${JSON.stringify(pseudoText)}`,
  );
  assert.notEqual(
    pseudoText,
    englishText,
    'The prerendered pseudo-locale page rendered the source locale',
  );
  // The control for the two assertions above. Both would pass on a build where the transform ran
  // over everything, which is the one thing a pseudo-locale must never do to the locales that ship.
  assert.ok(
    !englishText.includes('⟦'),
    `A pseudo build transformed the English page: ${JSON.stringify(englishText)}`,
  );
  recordCapabilityClaim(
    `${consumerName}: the second page in en-Arab-XB, prerendered`,
    'capability:pseudo-locale',
    { document: pseudoPage },
  );

  /*
   * The same text the client renders, and the reason that is checkable at all.
   *
   * The transform ran at build time, so what prerendering and the browser each received is one
   * compiled catalog. Asserting the rendered string appears in that catalog is what ties the two
   * ends together: `pseudo-locale-page.spec.ts` proved the browser renders this catalog's messages
   * with their markers, and this proves the page written without a browser carries the same
   * catalog's text, byte for byte.
   *
   * Escapes are decoded first. A generated module may write a non-ASCII character literally or as
   * `\uXXXX`, in either hex case: the bundle gate in `verify-package-structure.ts` was green
   * against a real leak for exactly this reason.
   */
  const decodeEscapes = (value: string) =>
    value.replace(/\\u([0-9a-fA-F]{4})/gu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  /*
   * Every compiled catalog this build wrote for one locale, joined.
   *
   * Located by name rather than by path, because compiled catalogs live under a set directory whose
   * name is a content-addressed identity: a literal path here would be a fingerprint to re-edit.
   * All of them rather than the first: an application has one catalog per scope per locale, and the
   * first found is whichever scope sorted first. That was this check's own first defect, and it read
   * as the transform having failed.
   */
  const readGeneratedCatalogs = async (
    name: string,
    root = generatedRoot,
  ): Promise<string[]> => {
    const found: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) {
        found.push(...(await readGeneratedCatalogs(name, path)));
      } else if (entry.name === name) {
        found.push(decodeEscapes(await readFile(path, 'utf8')));
      }
    }
    return found;
  };
  const catalogsFor = async (name: string) => {
    const found = await readGeneratedCatalogs(name);
    assert.ok(found.length > 0, `No generated ${name} under ${generatedRoot}`);
    return found.join('\n');
  };
  const pseudoCatalog = await catalogsFor('en-Arab-XB.ts');
  assert.ok(
    pseudoCatalog.includes(pseudoText),
    `The prerendered text is not in the compiled pseudo catalog: ${JSON.stringify(pseudoText)}`,
  );
  // The control. Without it the assertion above passes for a search that never worked, against the
  // wrong file, or against text no catalog could hold.
  const sourceCatalog = await catalogsFor('en-US.ts');
  assert.ok(
    sourceCatalog.includes(englishText),
    'The English page text is not in the compiled source catalog, so the search above proves nothing',
  );

  /*
   * Criterion 2, on a page nobody rendered in a browser.
   *
   * The article's title is content this application owns. Equator never sees it, so nothing could
   * pseudo-localize it, and the source supplies the English representation for a locale it has no
   * article in, which is what makes this page the clearest case the criterion has: an
   * application-owned string sitting untransformed beside shell messages that all carry markers.
   * That is what a developer is meant to notice, and here it is in a file written with no browser
   * involved.
   */
  const pseudoArticle = await readFile(
    resolve(
      pseudoRootOf('en-Arab-XB'),
      addresses.file('article', 'en-Arab-XB'),
    ),
    'utf8',
  );
  assert.ok(
    pseudoArticle.includes('The Equator localization handbook'),
    'The application-owned article title is not on the prerendered pseudo-locale page',
  );
  // And the shell around it did go through Equator. Without this the assertion above passes for a
  // page where the transform never ran at all.
  assert.ok(
    pseudoArticle.includes('⟦'),
    'The prerendered pseudo-locale article page carries no transformed message',
  );
}
if (prerenderedFile('second', 'en-Arab-XB', { pseudo: true }) !== undefined) {
  await verifyPseudoPages();
}

/**
 * The formatting declaration, read off the sheet the pseudo build prerendered for the locale it
 * names. `LOCALE_FORMATTING` gives `en-Arab-XB` the `arab` numbering system, so its number is
 * written in those digits; the source locale's sheet from the same build declares nothing and
 * keeps its own, which is what shows the digits came from the declaration.
 */
async function verifyPseudoFormatting() {
  const { decimal } = await readExerciseInputs(consumerRoot);
  const check = `${consumerName}: formatting declared for en-Arab-XB, prerendered`;
  let declaredSheet:
    { html: string; sheet: ReturnType<typeof sheetInDocument> } | undefined;
  for (const locale of ['en-Arab-XB', INIT_REQUEST.sourceLocale]) {
    const html = await readFile(
      resolve(pseudoRootOf(locale), addresses.file('exercise values', locale)),
      'utf8',
    );
    const sheet = sheetInDocument(html);
    const numberingSystem = (
      LOCALE_FORMATTING as Readonly<
        Record<string, { readonly numberingSystem: string } | undefined>
      >
    )[locale]?.numberingSystem;
    assert.equal(
      sheet.lines.get('formatNumber'),
      new Intl.NumberFormat(locale, {
        ...decimal.options,
        ...(numberingSystem === undefined ? {} : { numberingSystem }),
      }).format(Number(decimal.value)),
      `${check}: the ${locale} sheet's number is not written in the digits the formatting declaration gives it`,
    );
    if (numberingSystem !== undefined) declaredSheet = { html, sheet };
  }
  recordCapabilityClaim(check, 'declaration:locale-formatting', {
    document: declaredSheet!.html,
    policy: declaredSheet!.sheet.policy,
  });
}
if (
  prerenderedFile('exercise values', 'en-Arab-XB', { pseudo: true }) !==
  undefined
) {
  await verifyPseudoFormatting();
}

// And the generated source goes back to production shape, because the steps after this one rebuild
// this consumer from it. The `dist/` they read was never touched; this is the other half of the
// same tree.
run(['exec', 'equator', 'generate']);
const restoredLocaleTable = await readFile(
  resolve(generatedRoot, 'index.ts'),
  'utf8',
);
for (const tag of Object.keys(PSEUDO_LOCALES)) {
  assert.ok(
    !restoredLocaleTable.includes(tag),
    `The consumer was left with ${tag} generated, so every step after this one reads a pseudo build`,
  );
}
assert.ok(
  restoredLocaleTable.includes('ar-EG'),
  'The restored locale table was not read, so the absences above mean nothing',
);

/**
 * A route listed for prerender that the build has to refuse.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` sections 5 and 9. The route is listed where an
 * application lists it, in its own published routes, so the refusal is met the way a release meets
 * it. The three answers are gathered before any is asserted, so a build that lets the page through
 * reports every way it did. `@angular/build` before 22.1.7 drops a page whose render fails and
 * still succeeds, which is why the written files are read as well as the status, and why a refusal
 * met after the application has started, which reaches the build as such a page, expects the status
 * the installed tooling gives it. Built to its own output path and put back afterwards, because the
 * steps after this one read the production build and its source.
 */
const serverRoutesPath = resolve(consumerRoot, 'src/app/published-routes.ts');
const serverRoutes = await readFile(serverRoutesPath, 'utf8');
const buildTooling = (
  await readJson(
    resolve(consumerRoot, 'node_modules/@angular/build/package.json'),
  )
).version;
async function verifyRefusedPrerender({
  routeId,
  listed,
  listing,
  written,
  refused,
  status = 1,
}: RefusedPrerender) {
  assert.equal(
    serverRoutes.split(listed).length,
    2,
    `The published routes no longer carry the entry the refused ${routeId} is listed by`,
  );
  await writeFile(
    serverRoutesPath,
    serverRoutes.replace(listed, listing),
    'utf8',
  );
  const refusedRoot = resolve(consumerRoot, 'dist/feature-lab-refused');
  await rm(refusedRoot, { force: true, recursive: true });
  let refusedBuild: SpawnSyncReturns<string>;
  try {
    refusedBuild = spawnPnpm([
      'exec',
      'ng',
      'build',
      '--output-path',
      'dist/feature-lab-refused',
    ]);
  } finally {
    await writeFile(serverRoutesPath, serverRoutes, 'utf8');
  }
  const refusedOutput = [refusedBuild.stdout, refusedBuild.stderr].join('\n');
  const refusedPages = (
    await readdir(refusedRoot).then(
      () => collectPrerendered(refusedRoot),
      () => [],
    )
  ).filter((path) => written.test(path));
  assert.deepEqual(
    [
      ...refusedPages.map((path) => `it wrote ${path}`),
      ...(refusedBuild.status === status
        ? []
        : [`it exited ${String(refusedBuild.status)}`]),
      ...refused
        .filter((refusal) => !refusal.test(refusedOutput))
        .map((refusal) => `its output does not carry ${String(refusal)}`),
    ],
    [],
    `The build prerendered ${routeId}, which it has to refuse:\n${refusedOutput}`,
  );
  assert.equal(
    await readFile(serverRoutesPath, 'utf8'),
    serverRoutes,
    'The published routes were not put back after the refused build',
  );
}

/** A page's files, and the refusal its route meets, which names the address as a path. */
function routeRefusal(page: string, routeId: string, refusal: string) {
  const pageAddresses = INIT_REQUEST.locales
    .filter((locale) => addresses.has(page, locale))
    .map((locale) => addresses.path(page, locale));
  return {
    written: new RegExp(`(?:^|/)${page}/index\\.html$`, 'u'),
    refused: [
      new RegExp(
        `Route ${routeId} at "(?:${pageAddresses
          .map((address) => address.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
          .join('|')})" ${refusal}`,
        'u',
      ),
    ],
  };
}

// `route:lazy` is per visitor, which its route declares.
const listedBefore = "  { routeId: 'item', renderMode: RenderMode.Client },\n";
await verifyRefusedPrerender({
  routeId: 'route:lazy',
  listed: listedBefore,
  listing: `${listedBefore}  { routeId: 'route:lazy', renderMode: RenderMode.Prerender },\n`,
  ...routeRefusal(
    'lazy',
    'route:lazy',
    'is per-visitor, and it is being rendered ahead of a request',
  ),
});
// Under a locale-neutral policy `/second` is spelled alike in every locale, so it is per visitor
// whatever its route declares, and the application lists it for rendering on request.
if (addresses.policy === 'locale-neutral') {
  const onRequest =
    "  { routeId: 'route:second', renderMode: RenderMode.Server },\n";
  await verifyRefusedPrerender({
    routeId: 'route:second',
    listed: onRequest,
    listing: onRequest.replace('RenderMode.Server', 'RenderMode.Prerender'),
    ...routeRefusal(
      'second',
      'route:second',
      'is spelled alike in more than one locale, so which locale it is in depends on the visitor, and it is being rendered ahead of a request',
    ),
  });
}
// The topic page declares what each of these topics turned out to be, which a build has no request
// to answer for (section 5). Under a locale-neutral policy the address is refused before the page
// can declare anything, which the case above covers.
if (addresses.policy !== 'locale-neutral') {
  const declared = new Map([
    ['unfiled-topic', 'an absent entity'],
    ['retired-topic', 'a permanent removal'],
    ['unavailable-topic', 'an operational failure with status 503'],
  ]);
  await verifyRefusedPrerender({
    routeId: 'topic',
    listed: listedBefore,
    listing: `${listedBefore}  {\n    routeId: 'topic',\n    renderMode: RenderMode.Prerender,\n    prerender: [${[
      ...declared.keys(),
    ]
      .map((topic) => `{ topic: '${topic}' }`)
      .join(', ')}],\n  },\n`,
    written: new RegExp(
      `(?:^|/)topics/(?:${[...declared.keys()].join('|')})/index\\.html$`,
      'u',
    ),
    refused: [...declared.values()].map(
      (outcome) =>
        new RegExp(
          `A page declared ${outcome} while rendering ahead of a request`,
          'u',
        ),
    ),
    // angular/angular-cli#33965, released in 22.1.7.
    status: compareVersions(buildTooling, '22.1.7') >= 0 ? 1 : 0,
  });
}

/**
 * A build whose catalogs cannot load, which has to stop rather than write the recovery.
 *
 * `specs/06-runtime-and-angular.spec.md` section 5. A page written from a render that could not
 * start is served afterwards as the address's own, with no status left to say otherwise. Every
 * locale's shell is broken so no page can render, and the modules are put back afterwards for the
 * same reason the published routes are.
 */
const loadersPath = resolve(
  consumerRoot,
  'src/generated/i18n/catalog-loaders.ts',
);
// The specifier names the emitted file, and the source beside the loaders is TypeScript.
const shellModules = [
  ...(await readFile(loadersPath, 'utf8')).matchAll(
    /"[^"]+:shell:[^"]+": \(\) => import\("(\.\/catalogs\/[^"]+\.js)"\)/gu,
  ),
].map(([, path]) =>
  resolve(dirname(loadersPath), path!.replace(/\.js$/u, '.ts')),
);
assert.equal(
  shellModules.length,
  INIT_REQUEST.locales.length,
  'The generated loaders no longer name one shell module per locale in the form this check reads',
);
const shellSources = await Promise.all(
  shellModules.map((path) => readFile(path, 'utf8')),
);
const unloadableRoot = resolve(consumerRoot, 'dist/feature-lab-unloadable');
await rm(unloadableRoot, { force: true, recursive: true });
let unloadableBuild: SpawnSyncReturns<string>;
try {
  await Promise.all(
    shellModules.map((path, index) =>
      writeFile(
        path,
        `throw new Error('This catalog module was made unloadable.');\n${shellSources[index]}`,
        'utf8',
      ),
    ),
  );
  unloadableBuild = spawnPnpm([
    'exec',
    'ng',
    'build',
    '--output-path',
    'dist/feature-lab-unloadable',
  ]);
} finally {
  await Promise.all(
    shellModules.map((path, index) =>
      writeFile(path, shellSources[index]!, 'utf8'),
    ),
  );
}
const unloadableOutput = [unloadableBuild.stdout, unloadableBuild.stderr].join(
  '\n',
);
const unloadablePages = await readdir(unloadableRoot).then(
  () => collectPrerendered(unloadableRoot),
  () => [],
);
assert.deepEqual(
  [
    ...unloadablePages.map((path) => `it wrote ${path}`),
    ...(unloadableBuild.status === 1
      ? []
      : [`it exited ${String(unloadableBuild.status)}`]),
    ...(unloadableOutput.includes(
      'A generated local catalog module could not be loaded.',
    )
      ? []
      : ['its output does not name the catalog that could not load']),
  ],
  [],
  `The build went on with catalogs it could not load:\n${unloadableOutput}`,
);

/**
 * An application built the other way from feature-lab: Angular's own router, addresses that state
 * no locale, a page around it that owns the document's language, and a remembered choice in four
 * stores. It sits in the seat as a package of its own, so it installs nothing and is an owner of
 * its own to the toolkit, and it rides every row feature-lab does.
 *
 * Its default is `ar-EG`, whose catalog leaves out the greeting that `ar` has, so every page the
 * default decides shows a message the fallback chain supplied.
 */
const embeddedRoot = resolve(consumerRoot, 'embedded');
const runEmbedded = (
  entry: string,
  args: readonly string[],
  label: string,
  env: Readonly<Record<string, string>> = {},
) => {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: embeddedRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', ...env },
  });
  assert.equal(
    result.status,
    0,
    `The embedded application's ${label} failed:\n${[result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n')}`,
  );
  return result;
};
const equatorEntry = resolve(
  consumerRoot,
  'node_modules/@neolorn/equator-toolkit/cli.js',
);
runEmbedded(equatorEntry, ['generate'], 'equator generate');
runEmbedded(equatorEntry, ['check'], 'equator check');
runEmbedded(
  resolve(consumerRoot, 'node_modules/@angular/cli/bin/ng.js'),
  ['build'],
  'build',
);
// Its specs, in the environment feature-lab's run in, and counted from its sources the same way,
// so a spec that is not collected fails here.
const embeddedTested = runEmbedded(
  resolve(consumerRoot, 'node_modules/@angular/cli/bin/ng.js'),
  ['test'],
  'unit tests',
  consumerSpecsEnvironment(),
);
const embeddedSpecFiles = (
  await readdir(resolve(embeddedRoot, 'src'), { recursive: true })
).filter((entry) => entry.endsWith('.spec.ts'));
const embeddedTestedOutput =
  `${embeddedTested.stdout}\n${embeddedTested.stderr}`.replaceAll(
    /\u001B\[[0-9;]*m/gu,
    '',
  );
assert.match(
  embeddedTestedOutput,
  new RegExp(
    `Test Files\\s+${embeddedSpecFiles.length} passed\\s+\\(${embeddedSpecFiles.length}\\)`,
    'u',
  ),
  `The embedded application carries ${embeddedSpecFiles.length} spec files, and its run did not collect and pass them all:\n${embeddedTestedOutput}`,
);
const embeddedBuild = resolve(embeddedRoot, 'dist/embedded');
// The chain the generated configuration declares, which is the one the pages below must show.
const embeddedFallbacks = JSON.parse(
  /localeFallbacks: Object\.freeze\((\{.*?\}) as const\)/u.exec(
    await readFile(
      resolve(embeddedRoot, 'src/generated/i18n/index.ts'),
      'utf8',
    ),
  )?.[1] ?? 'null',
);
assert.deepEqual(
  embeddedFallbacks,
  { 'ar-EG': ['ar'] },
  'The embedded application no longer generates the localeFallbacks entry this check reads',
);

/** What an embedded page shows, read from its markup. */
function embeddedPage(html: string, where: string) {
  // A server renderer writes an attribute with no value either bare or as `=""`, and which one
  // depends on the Angular version the row installs.
  const panel =
    /<section data-panel(?:="")? lang="([^"]+)" dir="([^"]+)"/u.exec(html);
  const supplied = (name: string) =>
    new RegExp(
      `<[a-z0-9]+[^>]*\\bdata-${name}\\b[^>]*data-supplying="([^"]+)"`,
      'u',
    ).exec(html)?.[1];
  assert.notEqual(panel, null, `${where}: the panel was not rendered`);
  return {
    document: /<html[^>]*>/u.exec(html)?.[0],
    locale: panel![1],
    direction: panel![2],
    heading: supplied('heading'),
    greeting: supplied('greeting'),
  };
}

/**
 * Holds a page the default decided to the fallback chain and to the host page's language, and
 * claims the three under the context the page was produced in.
 */
function holdDefaultPage(
  html: string,
  check: string,
  observed: CapabilityObservation,
) {
  const source = 'default';
  const shown = embeddedPage(html, check);
  assert.deepEqual(
    shown,
    {
      document: '<html lang="en" dir="ltr">',
      locale: 'ar-EG',
      direction: 'rtl',
      heading: 'ar-EG',
      greeting: embeddedFallbacks['ar-EG'][0],
    },
    `${check}: withoutDocumentLocale left the host page's lang alone, the ${source} source withLocaleSources lists last named ar-EG, and the greeting ar-EG leaves out came from the localeFallbacks chain`,
  );
  recordCapabilityClaim(check, 'feature:withoutDocumentLocale', observed);
  recordCapabilityClaim(check, 'feature:withLocaleSources', observed);
  recordCapabilityClaim(check, 'source:default', observed);
  recordCapabilityClaim(check, 'capability:fallback-chain', observed);
}

{
  // A build has no request, so neither a stored choice nor the reader's languages can reach it,
  // and the page it writes is the default's.
  const check = `${consumerName}: the embedded application's prerendered page`;
  const html = (
    await readFile(resolve(embeddedBuild, 'browser/about/index.html'), 'utf8')
  ).replace(' data-beasties-container', '');
  assert.match(
    html,
    /\bng-server-context="ssg"/u,
    `${check} was not prerendered`,
  );
  holdDefaultPage(html, check, { document: html });
}

{
  // Each request arranged so one source only can name the locale it is answered in. The account's
  // choice arrives in a cookie only its store reads, and outranks the reader's languages, which ask
  // for Arabic.
  const asked = [
    {
      source: 'stored',
      headers: {
        cookie: 'embedded-account-locale=en-US',
        'accept-language': 'ar',
      },
      locale: 'en-US',
    },
    {
      source: 'browser',
      headers: { 'accept-language': 'en-US,en;q=0.8' },
      locale: 'en-US',
    },
    { source: 'default', headers: { 'accept-language': 'fr-FR' } },
  ];
  const answers = serverAnswers(
    asked.map(({ headers }) => ({ path: '/', headers })),
    { root: embeddedBuild },
  );
  asked.forEach(({ source, locale }, index) => {
    const { status, body } = answers[index]!;
    const check = `${consumerName}: the embedded application answered by its ${source} source`;
    assert.equal(status, 200, check);
    const html = body.replace(' data-beasties-container', '');
    assert.match(
      html,
      /\bng-server-context="ssr"/u,
      `${check} was not rendered for the request`,
    );
    const observed = { document: html };
    if (source === 'default') {
      holdDefaultPage(html, check, observed);
      return;
    }
    const shown = embeddedPage(html, check);
    const named =
      source === 'stored'
        ? 'the profileStore withPersistence asks after the two browser stores'
        : "the reader's languages";
    assert.deepEqual(
      [shown.document, shown.locale, shown.greeting],
      ['<html lang="en" dir="ltr">', locale, locale],
      `${check}: withoutDocumentLocale left the host page's lang alone while ${named}, through the ${source} source withLocaleSources lists, named ${locale}`,
    );
    recordCapabilityClaim(check, 'feature:withoutDocumentLocale', observed);
    recordCapabilityClaim(check, 'feature:withLocaleSources', observed);
    if (source === 'stored') {
      recordCapabilityClaim(check, 'source:stored', observed);
      // The account's store is the third of four. The two before it are not there on a server and
      // the memory after it is new for each request, so the choice the account names is the one
      // that decides.
      recordCapabilityClaim(check, 'store:profileStore', observed);
      recordCapabilityClaim(check, 'feature:withPersistence', observed);
    } else if (source === 'browser') {
      recordCapabilityClaim(check, 'source:browser', observed);
    }
  });
}

process.stdout.write(
  `Equator package consumer verified: ${consumerProfile.label}, Angular ${consumerProfile.angular}, TypeScript ${consumerProfile.typescript}, RxJS ${consumerProfile.rxjs}, ${collectedFiles[2]} spec file(s) and ${collectedCases[1]} case(s) passing.\n`,
);
