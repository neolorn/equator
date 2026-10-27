import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';

import { openSubpaths } from './exports-map.ts';
import { nodeRange } from './supported-versions.ts';

const cliTimeout = 30_000;
const cliMaxBuffer = 4 * 1024 * 1024;
const generatedFileLimit = 64;
const generatedByteLimit = 2 * 1024 * 1024;
const digestPattern = /^sha256-[A-Za-z0-9_-]{43}$/u;

/** The fields of an installed manifest that this row reads. */
interface RowManifest {
  readonly name?: unknown;
  readonly engines?: { readonly node?: unknown };
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly bin?: { readonly equator?: unknown };
}

/** A loaded module's namespace, read by export name. */
type ModuleNamespace = Readonly<Record<string, unknown>>;

/** One generated file as a snapshot records it. */
interface GeneratedFile {
  readonly path: string;
  readonly bytes: number;
  readonly digest: string;
  readonly mtimeMs: number;
}

/** The toolkit's compiled validator for its machine-result schema. */
interface CliResultValidator {
  (value: unknown): boolean;
  readonly errors?: unknown;
}

/** The part of Ajv's 2020 entry point this row uses. */
interface AjvModule {
  readonly default: new (options: {
    readonly allErrors: boolean;
    readonly strict: boolean;
  }) => { compile(schema: unknown): CliResultValidator };
}

/** The toolkit's host admission module, as this row calls it. */
interface HostCompatibilityModule {
  currentHostVersions(): {
    readonly node: unknown;
    readonly typescript: unknown;
    readonly angularCompiler: unknown;
  };
  admitHostCompatibility(): {
    readonly ok: unknown;
    readonly diagnostics: unknown;
    readonly value: { readonly profile: unknown };
  };
}

/** One machine-result line the CLI prints with `--json`. */
interface CliRecord {
  readonly profile: unknown;
  readonly command: unknown;
  readonly status: unknown;
  readonly diagnostics: unknown;
  readonly result: unknown;
}

interface MachineRun {
  readonly source: string;
  readonly record: CliRecord;
}

/** The `generate` result fields this row asserts. */
interface GenerationResult {
  readonly dryRun: unknown;
  readonly changed: unknown;
  readonly written: readonly unknown[];
  readonly removed: readonly unknown[];
  readonly unchanged: readonly unknown[];
  readonly inputFingerprint: string;
  readonly planDigest: string;
  readonly invalidation?: {
    readonly kind: unknown;
    readonly changedInputs: readonly unknown[];
    readonly affectedOutputs: readonly unknown[];
  };
  readonly catalogs: unknown;
  readonly scopes: unknown;
  readonly messages: unknown;
}

/** The `check` result fields this row asserts. */
interface CheckResult {
  readonly fix: unknown;
  readonly fresh: unknown;
  readonly missing: unknown;
  readonly changed: unknown;
  readonly stale: unknown;
  readonly fixedFiles: unknown;
  readonly inputFingerprint: unknown;
  readonly planDigest: unknown;
  readonly catalogs: unknown;
  readonly scopes: unknown;
  readonly messages: unknown;
}

/** A formatting call's result, as this row reads it. */
interface FormatResult {
  readonly ok: unknown;
  readonly value: { readonly text: string };
}

interface LocaleSelection {
  readonly locale: string;
  readonly timeZone: string;
}

/** The runtime functions the localized output evidence calls. */
interface RuntimeSurface extends ModuleNamespace {
  instant(value: string): unknown;
  decimal(value: string): unknown;
  money(amount: unknown, currency: string): unknown;
  formatNumber(
    value: unknown,
    context: LocaleSelection,
    options: object,
  ): FormatResult;
  formatMoney(
    value: unknown,
    context: LocaleSelection,
    options: object,
  ): FormatResult;
  formatInstant(
    value: unknown,
    context: LocaleSelection,
    options: object,
  ): FormatResult;
  formatRelativeTime(
    value: unknown,
    unit: string,
    context: LocaleSelection,
    options: object,
  ): FormatResult;
  formatList(
    items: readonly string[],
    context: LocaleSelection,
    options: object,
  ): FormatResult;
  selectPlural(count: number, locale: string, kind: string): unknown;
  languagePresentation(locale: string): { readonly direction: unknown };
}

function readArguments() {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    const value = process.argv[index + 1];
    assert.ok(
      name?.startsWith('--'),
      `Unexpected argument ${name ?? '<missing>'}`,
    );
    assert.notEqual(value, undefined, `Missing value for ${name}`);
    values.set((name as string).slice(2), value as string);
  }
  for (const name of ['expected-version', 'harness-root', 'row']) {
    assert.ok(values.has(name), `Missing --${name}`);
  }
  return Object.freeze({
    expectedVersion: values.get('expected-version') as string,
    harnessRoot: resolve(values.get('harness-root') as string),
    row: values.get('row') as string,
  });
}

const isWithin = (candidate: string, owner: string): boolean => {
  const path = relative(owner, candidate);
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  );
};

const readJson = async (path: string): Promise<RowManifest> =>
  JSON.parse(await readFile(path, 'utf8')) as RowManifest;

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException | null | undefined)?.code === 'ENOENT' ||
      (error as NodeJS.ErrnoException | null | undefined)?.code === 'ENOTDIR'
    )
      return false;
    throw error;
  }
}

async function writeProjectFile(
  projectRoot: string,
  portablePath: string,
  contents: string,
): Promise<void> {
  const outputPath = resolve(projectRoot, ...portablePath.split('/'));
  assert.ok(
    outputPath !== projectRoot && isWithin(outputPath, projectRoot),
    `Fixture path ${portablePath} escapes its project root`,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, contents, 'utf8');
}

async function createProjectFixture(projectRoot: string): Promise<void> {
  const files = Object.freeze({
    'package.json': `${JSON.stringify(
      {
        name: '@example/node-row-fixture',
        version: '0.0.0',
        private: true,
        type: 'module',
        imports: {
          '#i18n': './src/generated/i18n/index.ts',
          '#i18n/*': './src/generated/i18n/*.ts',
        },
        scripts: {
          'equator:generate': 'equator generate',
          'equator:check': 'equator check',
        },
      },
      null,
      2,
    )}\n`,
    'equator.config.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
      },
      null,
      2,
    )}\n`,
    'i18n/shell/en-US.yaml': [
      'messages:',
      '  app-title: Equator Node row fixture',
      "  welcome: 'Welcome, {$name}!'",
      '  recovery.unavailable: Localization is temporarily unavailable.',
      '',
    ].join('\n'),
    'i18n/shell/ar-EG.yaml': [
      'messages:',
      '  app-title: تطبيق Equator',
      "  welcome: 'مرحبًا، {$name}!'",
      '  recovery.unavailable: الترجمة غير متاحة مؤقتًا.',
      '',
    ].join('\n'),
    'tsconfig.app.json': `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'preserve',
          moduleResolution: 'bundler',
          resolvePackageJsonImports: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
    // Every message this fixture authors is read, so the unused-source-message advisory has
    // nothing to say and the row keeps asserting that generation reports no diagnostics at all.
    // Loosening that to "no errors" would take the shape a known defect had: a severity filter a real
    // regression can hide behind.
    'src/app.ts': [
      "import { messages } from '#i18n/shell';",
      '',
      'export const title = messages.appTitle.messageId;',
      'export const greeting = messages.welcome.messageId;',
      'export const unavailable = messages.recovery.unavailable.messageId;',
      '',
    ].join('\n'),
  });
  for (const [portablePath, contents] of Object.entries(files)) {
    await writeProjectFile(projectRoot, portablePath, contents);
  }
}

const compareNames = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

async function snapshotGeneratedOutput(generatedRoot: string) {
  const files: GeneratedFile[] = [];
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareNames(left.name, right.name));
    for (const entry of entries) {
      const outputPath = resolve(directory, entry.name);
      assert.ok(
        isWithin(outputPath, generatedRoot),
        `Generated entry ${outputPath} escapes ${generatedRoot}`,
      );
      assert.equal(
        entry.isSymbolicLink(),
        false,
        `Generated output must not contain a symbolic link: ${outputPath}`,
      );
      if (entry.isDirectory()) {
        await visit(outputPath);
        continue;
      }
      assert.equal(
        entry.isFile(),
        true,
        `Generated output must contain only ordinary files: ${outputPath}`,
      );
      const metadata = await lstat(outputPath);
      assert.equal(
        metadata.isSymbolicLink(),
        false,
        `Generated output must not contain a symbolic link: ${outputPath}`,
      );
      const contents = await readFile(outputPath);
      bytes += contents.byteLength;
      files.push(
        Object.freeze({
          path: relative(generatedRoot, outputPath).split(sep).join('/'),
          bytes: contents.byteLength,
          digest: createHash('sha256').update(contents).digest('hex'),
          mtimeMs: metadata.mtimeMs,
        }),
      );
      assert.ok(
        files.length <= generatedFileLimit,
        `Generated fixture exceeded the ${generatedFileLimit}-file row limit`,
      );
      assert.ok(
        bytes <= generatedByteLimit,
        `Generated fixture exceeded the ${generatedByteLimit}-byte row limit`,
      );
    }
  };
  await visit(generatedRoot);
  assert.ok(files.length > 0, 'Equator generate did not publish any files');
  return Object.freeze({ files: Object.freeze(files), bytes });
}

function cliFailure(result: SpawnSyncReturns<string>): string {
  if (result.error !== undefined) return result.error.message;
  if (result.signal !== null) return `terminated by signal ${result.signal}`;
  return [result.stderr, result.stdout]
    .filter((value) => value.trim() !== '')
    .join('\n')
    .trim();
}

function runMachineCommand(
  cliPath: string,
  projectRoot: string,
  command: string,
  validateCliResult: CliResultValidator,
): MachineRun {
  const result = spawnSync(
    process.execPath,
    [cliPath, command, '--project', projectRoot, '--json'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        NODE_PATH: '',
        NO_COLOR: '1',
      },
      maxBuffer: cliMaxBuffer,
      timeout: cliTimeout,
      windowsHide: true,
    },
  );
  assert.equal(
    result.error,
    undefined,
    `Equator ${command} could not launch: ${cliFailure(result)}`,
  );
  assert.equal(result.signal, null, `Equator ${command} ${cliFailure(result)}`);
  assert.equal(
    result.status,
    0,
    `Equator ${command} failed: ${cliFailure(result)}`,
  );
  assert.equal(
    result.stderr,
    '',
    `Equator ${command} emitted stderr: ${result.stderr}`,
  );
  const source = result.stdout.trim();
  const lines = source.split(/\r?\n/u).filter((line) => line !== '');
  assert.equal(
    lines.length,
    1,
    `Equator ${command} must emit exactly one machine-result line`,
  );
  let record: CliRecord;
  try {
    record = JSON.parse(lines[0] as string) as CliRecord;
  } catch (error) {
    throw new Error(
      `Equator ${command} emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assert.equal(
    validateCliResult(record),
    true,
    `Equator ${command} machine result violates the public schema: ${JSON.stringify(validateCliResult.errors)}`,
  );
  assert.equal(record.profile, 'equator-cli-result/1');
  assert.equal(record.command, command);
  assert.equal(record.status, 'success');
  assert.deepEqual(record.diagnostics, []);
  assert.equal(
    typeof record.result,
    'object',
    `Equator ${command} did not include a result object`,
  );
  assert.notEqual(record.result, null);
  return Object.freeze({ source, record });
}

function assertGeneration(
  run: MachineRun,
  changed: boolean,
  invalidationKind: string,
): GenerationResult {
  const result = run.record.result as GenerationResult;
  assert.equal(result.dryRun, false);
  assert.equal(result.changed, changed);
  assert.ok(Array.isArray(result.written));
  assert.ok(Array.isArray(result.removed));
  assert.ok(Array.isArray(result.unchanged));
  assert.match(result.inputFingerprint, digestPattern);
  assert.match(result.planDigest, digestPattern);
  assert.equal(result.invalidation?.kind, invalidationKind);
  assert.ok(Array.isArray(result.invalidation.changedInputs));
  assert.ok(Array.isArray(result.invalidation.affectedOutputs));
  assert.equal(result.catalogs, 2);
  assert.equal(result.scopes, 1);
  assert.equal(result.messages, 3);
  if (changed) {
    assert.ok(result.written.length > 0);
    assert.deepEqual(result.removed, []);
    assert.ok(result.invalidation.changedInputs.length > 0);
    assert.ok(result.invalidation.affectedOutputs.length > 0);
  } else {
    assert.deepEqual(result.written, []);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.invalidation.changedInputs, []);
    assert.deepEqual(result.invalidation.affectedOutputs, []);
  }
  return result;
}

function assertCheck(
  run: MachineRun,
  generation: GenerationResult,
): CheckResult {
  const result = run.record.result as CheckResult;
  assert.equal(result.fix, false);
  assert.equal(result.fresh, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.fixedFiles, []);
  assert.equal(result.inputFingerprint, generation.inputFingerprint);
  assert.equal(result.planDigest, generation.planDigest);
  assert.equal(result.catalogs, 2);
  assert.equal(result.scopes, 1);
  assert.equal(result.messages, 3);
  return result;
}

function defaultExportTarget(exportsEntry: unknown, label: string): string {
  const target =
    typeof exportsEntry === 'string'
      ? exportsEntry
      : (exportsEntry as { readonly default?: unknown } | null | undefined)
          ?.default;
  assert.equal(
    typeof target,
    'string',
    `${label} must declare a default JavaScript export target`,
  );
  assert.ok(
    (target as string).startsWith('./'),
    `${label} must use a relative export target`,
  );
  return target as string;
}

/**
 * Every runtime subpath this row actually loaded.
 *
 * Collected by the importing rather than written as a literal beside it. A literal
 * `['.', './forms', './router', './testing']` makes the summary read `runtime 4/4` whether or not
 * any of them loaded, and still read `4/4` after the `ssr` entry point is added, with the new one
 * unmentioned. A count that cannot move is not evidence of anything.
 */
const importedRuntimeEntrypoints: string[] = [];

async function importPublicEntry(
  packageRoot: string,
  manifest: RowManifest,
  subpath: string,
): Promise<ModuleNamespace> {
  const exportsEntry = manifest.exports?.[subpath];
  assert.notEqual(
    exportsEntry,
    undefined,
    `${manifest.name} does not declare public export ${subpath}`,
  );
  const target = defaultExportTarget(
    exportsEntry,
    `${manifest.name} export ${subpath}`,
  );
  const outputPath = resolve(packageRoot, target);
  assert.ok(
    isWithin(outputPath, packageRoot),
    `${manifest.name} export ${subpath} escapes its built package root`,
  );
  const loaded = (await import(
    pathToFileURL(outputPath).href
  )) as ModuleNamespace;
  if (manifest.name === '@neolorn/equator') {
    importedRuntimeEntrypoints.push(subpath);
  }
  return loaded;
}

function assertFunction(
  module: ModuleNamespace,
  name: string,
  entrypoint: string,
): void {
  assert.equal(
    typeof module[name],
    'function',
    `${entrypoint} is missing public function/class ${name}`,
  );
}

/**
 * What Equator actually renders on this Node runtime.
 *
 * Rendered rather than type-checked. Asserting that five exports are functions and invoking none
 * of them says nothing about the three Node majors `engines.node` advertises. ICU data differs
 * across majors, and server and client must not diverge in locale or formatting: a build that
 * prerenders on one major and a server that renders on another produce different text with every
 * export still passing a typeof check.
 *
 * Deliberately not pinned to a numbering system or a calendar where the default is the thing at
 * risk. If two supported Node majors disagree about what `ar-EG` means, that is precisely the
 * divergence this exists to surface, and the correct response is a decision rather than a silently
 * widened expectation.
 */
function localizedOutputEvidence(runtime: RuntimeSurface) {
  const arabic = Object.freeze({ locale: 'ar-EG', timeZone: 'Africa/Cairo' });
  const english = Object.freeze({ locale: 'en-US', timeZone: 'UTC' });
  const moment = runtime.instant('1800000000123456789');
  const text = (result: FormatResult): string => {
    assert.equal(
      result.ok,
      true,
      `Formatting failed: ${JSON.stringify(result)}`,
    );
    return result.value.text;
  };

  return Object.freeze({
    profile: 'equator-node-localized-output/1',
    numberArabic: text(
      runtime.formatNumber(runtime.decimal('1234567.89'), arabic, {}),
    ),
    numberEnglish: text(
      runtime.formatNumber(runtime.decimal('1234567.89'), english, {}),
    ),
    moneyArabic: text(
      runtime.formatMoney(
        runtime.money(runtime.decimal('1234.50'), 'EGP'),
        arabic,
        {},
      ),
    ),
    moneyEnglish: text(
      runtime.formatMoney(
        runtime.money(runtime.decimal('1234.50'), 'EGP'),
        english,
        {},
      ),
    ),
    instantArabic: text(
      runtime.formatInstant(moment, arabic, {
        dateStyle: 'long',
        timeStyle: 'medium',
      }),
    ),
    instantEnglish: text(
      runtime.formatInstant(moment, english, {
        dateStyle: 'long',
        timeStyle: 'medium',
      }),
    ),
    relativeArabic: text(
      runtime.formatRelativeTime(runtime.decimal('-1'), 'day', arabic, {
        numeric: 'auto',
      }),
    ),
    listArabic: text(
      runtime.formatList(['\u0623', '\u0628', '\u062c'], arabic, {}),
    ),
    // Arabic has six cardinal categories and they are the reason plural coverage is checked at
    // all. A Node major that resolved them differently would change which variant every counted
    // noun renders.
    pluralArabic: [0, 1, 2, 3, 11, 100].map((count) =>
      runtime.selectPlural(count, 'ar-EG', 'cardinal'),
    ),
    directionArabic: runtime.languagePresentation('ar-EG').direction,
  });
}

async function main() {
  const options = readArguments();
  assert.match(
    options.row,
    /^[a-z0-9-]+$/u,
    'The compatibility row identifier is unsafe',
  );
  assert.equal(
    process.versions.node,
    options.expectedVersion,
    `Compatibility row ${options.row} launched Node ${process.versions.node}, expected ${options.expectedVersion}`,
  );

  const harnessRoot = await realpath(options.harnessRoot);
  const runtimeRoot = resolve(
    harnessRoot,
    'node_modules',
    '@neolorn',
    'equator',
  );
  const toolkitRoot = resolve(
    harnessRoot,
    'node_modules',
    '@neolorn',
    'equator-toolkit',
  );
  const runtimeManifest = await readJson(resolve(runtimeRoot, 'package.json'));
  const toolkitManifest = await readJson(resolve(toolkitRoot, 'package.json'));

  assert.equal(runtimeManifest.name, '@neolorn/equator');
  assert.equal(toolkitManifest.name, '@neolorn/equator-toolkit');
  // The installed copies against what the packages declare, with the range read from the source
  // manifests rather than written again here.
  assert.equal(runtimeManifest.engines?.node, nodeRange);
  assert.equal(toolkitManifest.engines?.node, nodeRange);

  const harnessRequire = createRequire(resolve(harnessRoot, 'package.json'));
  const angularCompilerEntry = harnessRequire.resolve('@angular/compiler');
  await import(pathToFileURL(angularCompilerEntry).href);

  // Every module entry point the manifest publishes, read from it rather than listed here, so an
  // entry point the manifest gains is loaded on every Node row without a second list to update.
  // A JSON subpath, such as the manifest, is not a module.
  const runtimeEntries = new Map<string, ModuleNamespace>();
  for (const { subpath, json } of openSubpaths(runtimeManifest)) {
    if (json) continue;
    runtimeEntries.set(
      subpath,
      await importPublicEntry(runtimeRoot, runtimeManifest, subpath),
    );
  }
  const runtimeEntry = (subpath: string): ModuleNamespace => {
    const loaded = runtimeEntries.get(subpath);
    assert.notEqual(
      loaded,
      undefined,
      `@neolorn/equator does not publish ${subpath}`,
    );
    return loaded as ModuleNamespace;
  };
  const runtime = runtimeEntry('.');
  assertFunction(runtime, 'createLocalizationContext', '@neolorn/equator');
  assertFunction(runtime, 'provideLocalizationSetup', '@neolorn/equator');
  assertFunction(
    runtimeEntry('./core'),
    'localeProfile',
    '@neolorn/equator/core',
  );
  assertFunction(
    runtimeEntry('./forms'),
    'LocalizedInput',
    '@neolorn/equator/forms',
  );
  // `./http` and `./ssr` have the most to prove here: they are the Equator code that runs under Node
  // in production rather than in a test, and `./ssr` is the only entry point whose peer is optional
  // *and* server-only. An entry point that fails to load on a supported Node row fails at a
  // server's start or a consumer's prerender, the least recoverable places to find out.
  assertFunction(
    runtimeEntry('./http'),
    'createLocaleRequestHandler',
    '@neolorn/equator/http',
  );
  assertFunction(
    runtimeEntry('./router'),
    'provideLocalizedRouter',
    '@neolorn/equator/router',
  );
  assertFunction(
    runtimeEntry('./ssr'),
    'provideLocalizedServerRendering',
    '@neolorn/equator/ssr',
  );
  assertFunction(
    runtimeEntry('./testing'),
    'provideLocalizationTesting',
    '@neolorn/equator/testing',
  );

  const toolkit = await importPublicEntry(toolkitRoot, toolkitManifest, '.');
  assertFunction(toolkit, 'compileProject', '@neolorn/equator-toolkit');
  assertFunction(toolkit, 'parseConfiguration', '@neolorn/equator-toolkit');
  // Host admission is internal to the toolkit, so it comes from the module that declares it. The
  // public entry is still loaded above, because whether it loads at all on this row is half of what
  // this gate asks.
  const hostCompatibility = (await import(
    pathToFileURL(resolve(toolkitRoot, 'host-compatibility.js')).href
  )) as HostCompatibilityModule;
  const hostVersions = hostCompatibility.currentHostVersions();
  assert.equal(hostVersions.node, options.expectedVersion);
  const admission = hostCompatibility.admitHostCompatibility();
  assert.equal(
    admission.ok,
    true,
    `Host admission rejected ${JSON.stringify(hostVersions)}: ${JSON.stringify(admission.diagnostics)}`,
  );
  assert.equal(admission.value.profile, 'equator-host-compatibility/1');

  const formatting = localizedOutputEvidence(runtime as RuntimeSurface);

  assert.equal(
    typeof toolkit['CLI_RESULT_SCHEMA'],
    'object',
    'Toolkit public API is missing CLI_RESULT_SCHEMA',
  );
  const { default: Ajv2020 } = (await import(
    pathToFileURL(harnessRequire.resolve('ajv/dist/2020.js')).href
  )) as AjvModule;
  const validateCliResult = new Ajv2020({
    allErrors: true,
    strict: true,
  }).compile(toolkit['CLI_RESULT_SCHEMA']);

  const cliTarget = toolkitManifest.bin?.equator;
  assert.equal(typeof cliTarget, 'string', 'Toolkit equator binary is missing');
  const cliPath = resolve(toolkitRoot, cliTarget as string);
  assert.ok(
    isWithin(cliPath, toolkitRoot),
    'Toolkit equator binary escapes package',
  );
  const help = spawnSync(process.execPath, [cliPath, '--help'], {
    cwd: harnessRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      NODE_PATH: '',
      NO_COLOR: '1',
    },
    maxBuffer: 1_048_576,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(help.error, undefined, help.error?.message as string);
  assert.equal(
    help.signal,
    null,
    `Equator CLI help terminated by ${help.signal}`,
  );
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Usage: equator <command> \[options\]/u);
  assert.match(help.stdout, /migrate\s+Preview or apply/u);
  assert.match(help.stdout, /Exit codes: 0 success/u);

  const projectsRoot = resolve(harnessRoot, 'projects');
  await mkdir(projectsRoot, { recursive: true });
  const projectPrefix = `.node-row-${options.row}-`;
  let projectRoot: string | undefined;
  let workflowEvidence;
  try {
    projectRoot = await mkdtemp(resolve(projectsRoot, projectPrefix));
    await createProjectFixture(projectRoot);

    const firstGenerate = runMachineCommand(
      cliPath,
      projectRoot,
      'generate',
      validateCliResult,
    );
    const initialGeneration = assertGeneration(firstGenerate, true, 'initial');
    const generatedRoot = resolve(projectRoot, 'src/generated/i18n');
    const initialSnapshot = await snapshotGeneratedOutput(generatedRoot);

    const secondGenerate = runMachineCommand(
      cliPath,
      projectRoot,
      'generate',
      validateCliResult,
    );
    const stableGeneration = assertGeneration(secondGenerate, false, 'none');
    assert.equal(
      stableGeneration.inputFingerprint,
      initialGeneration.inputFingerprint,
    );
    assert.equal(stableGeneration.planDigest, initialGeneration.planDigest);
    const stableSnapshot = await snapshotGeneratedOutput(generatedRoot);
    assert.deepEqual(
      stableSnapshot,
      initialSnapshot,
      'A no-change generate mutated generated bytes or mtimes',
    );

    const thirdGenerate = runMachineCommand(
      cliPath,
      projectRoot,
      'generate',
      validateCliResult,
    );
    assertGeneration(thirdGenerate, false, 'none');
    assert.equal(
      thirdGenerate.source,
      secondGenerate.source,
      'Repeated no-change generate machine output is not deterministic',
    );
    assert.deepEqual(
      await snapshotGeneratedOutput(generatedRoot),
      initialSnapshot,
      'A repeated no-change generate mutated generated bytes or mtimes',
    );

    const firstCheck = runMachineCommand(
      cliPath,
      projectRoot,
      'check',
      validateCliResult,
    );
    assertCheck(firstCheck, stableGeneration);
    const secondCheck = runMachineCommand(
      cliPath,
      projectRoot,
      'check',
      validateCliResult,
    );
    assertCheck(secondCheck, stableGeneration);
    assert.equal(
      secondCheck.source,
      firstCheck.source,
      'Repeated check machine output is not deterministic',
    );
    assert.deepEqual(
      await snapshotGeneratedOutput(generatedRoot),
      initialSnapshot,
      'Equator check mutated generated bytes or mtimes',
    );

    workflowEvidence = Object.freeze({
      profile: 'equator-node-toolkit-workflow/1',
      fixture: 'two-locale-typescript',
      generatedFiles: initialSnapshot.files.length,
      generatedBytes: initialSnapshot.bytes,
      inputFingerprint: stableGeneration.inputFingerprint,
      planDigest: stableGeneration.planDigest,
      initialGenerate: 'changed',
      repeatedGenerate: 'unchanged-deterministic',
      repeatedCheck: 'fresh-deterministic-read-only',
    });
  } finally {
    if (projectRoot !== undefined) {
      const resolvedProject = resolve(projectRoot);
      assert.ok(
        isWithin(resolvedProject, projectsRoot) &&
          dirname(resolvedProject) === projectsRoot &&
          basename(resolvedProject).startsWith(projectPrefix),
        `Refusing to remove unexpected row project ${resolvedProject}`,
      );
      await rm(resolvedProject, { recursive: true, force: true });
      assert.equal(
        await pathExists(resolvedProject),
        false,
        `Row project cleanup failed for ${resolvedProject}`,
      );
    }
  }
  assert.notEqual(workflowEvidence, undefined);

  process.stdout.write(
    `EQUATOR_NODE_ROW ${JSON.stringify({
      profile: 'equator-node-compatibility/1',
      row: options.row,
      node: options.expectedVersion,
      architecture: process.arch,
      platform: process.platform,
      typescript: hostVersions.typescript,
      angularCompiler: hostVersions.angularCompiler,
      runtimeEntrypoints: [...importedRuntimeEntrypoints].sort(),
      formatting,
      toolkitEntrypoints: ['.'],
      hostAdmission: 'accepted',
      cliHelp: 'accepted',
      toolkitWorkflow: workflowEvidence,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `Equator Node row verification failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
