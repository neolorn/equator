#!/usr/bin/env node

/**
 * The eight things a person can ask Equator to do, and the two that change a project's shape.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 11 separates them that way. Initialization
 * adds the setup an owner is missing and migration changes an established shape; generate,
 * check, format, clean, uninstall and watch do neither, because a command that runs unattended
 * in a build pipeline must not be able to scatter files through a build.
 */

import { lstat, open, readFile } from 'node:fs/promises';
import { posix, resolve, win32 } from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { AuthoredChangePlan } from './authoring-transaction.js';
import { CLI_COMMANDS, type CliCommand } from './cli-commands.js';
import { INIT_HELP, INIT_INVOCATION } from './cli-options.generated.js';
import {
  toolkitDiagnostic,
  diagnosticsBlock,
  toolkitFailure,
  type ToolkitDiagnostic,
  type ToolkitResult,
} from './diagnostics.js';
import type { InitConfiguration } from './configuration.js';
import {
  applyInitOption,
  initOptionForFlag,
  InvocationError,
} from './init-options.js';
import type {
  CheckProjectResult,
  GenerateProjectResult,
  InitProjectOptions,
  WatchCycle,
} from './project-host.js';
import { RESOURCE_LIMITS } from './resource-limits.js';

interface PackageManifest {
  readonly version: string;
}

type MachineCommand = CliCommand | 'unknown';

interface ParsedInvocation {
  readonly command: CliCommand;
  readonly project?: string;
  readonly plan?: string;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly fix: boolean;
  readonly catalogs: boolean;
  readonly requireComplete: boolean;
  readonly requireFresh: boolean;
  readonly pseudo: boolean;
  /**
   * The configuration fields this invocation sets, keyed as `equator.config.json` keys them.
   *
   * Not one field per flag. The flags are generated from `CONFIGURATION_SCHEMA`, so a named
   * field here would be a second list to keep in step with the first, and the second list going
   * quiet is the defect 10.5 reports rather than a risk it guards against. What the parser produces
   * is the shape the configuration parser accepts, and that parser is the only thing that decides
   * whether it is acceptable.
   */
  readonly initConfiguration: Readonly<Record<string, unknown>>;
}

const packageManifest = JSON.parse(
  await readFile(new URL('./package.json', import.meta.url), 'utf8'),
) as PackageManifest;

const commands: ReadonlySet<string> = new Set(CLI_COMMANDS);

function machineCommand(value: string | undefined): MachineCommand {
  return value !== undefined && commands.has(value)
    ? (value as CliCommand)
    : 'unknown';
}

const projectHost = () => import('./project-host.js');
const authoredChanges = () => import('./authoring-transaction.js');

function helpText(): string {
  return `Equator toolkit ${packageManifest.version}

Usage: equator <command> [options]

Commands:
  init       Add compatible Equator configuration and package setup
  generate   Compile and safely publish generated #i18n artifacts
  check      Validate authored inputs, analysis, and generated freshness
  format     Canonically format Equator configuration and catalogs
  clean      Remove only verified Equator-owned generated and work state
  uninstall  Remove Equator from this owner, keeping authored catalogs
  watch      Reconcile changes in one foreground process
  migrate    Preview or apply one explicit Equator-authored migration plan

Common options:
  --project <path>   Select an owner directory or equator.config.json
  --json             Emit deterministic machine-readable JSON
  --dry-run          Preview init, generate, format, clean, uninstall, or migrate
  --help             Show this help
  --version          Show the toolkit version

${INIT_HELP}

Uninstall options:
  --catalogs         Also remove authored catalogs (off by default)

Check options:
  --fix              Apply only semantic-preserving canonical formatting
  --require-complete Fail when a required target locale omits a source message
  --require-fresh    Fail when generated output does not match the sources
  --pseudo           Also generate the configured pseudo-locales (development only)

Migrate options:
  --plan <path>      Select one equator-authored-change-plan/1 JSON file
  --project <owner>  Select the explicit migration owner (required)

Exit codes: 0 success, 1 diagnostics, 2 invocation/configuration, 3 environment, 130 interruption.
`;
}

function requireValue(
  arguments_: readonly string[],
  index: number,
  flag: string,
): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new InvocationError(`${flag} requires one value.`);
  }
  return value;
}

function parseInvocation(arguments_: readonly string[]): ParsedInvocation {
  const commandValue = arguments_[0];
  if (commandValue === undefined || !commands.has(commandValue)) {
    throw new InvocationError(
      commandValue === undefined
        ? 'Equator requires a command.'
        : `Unknown Equator command: ${commandValue}`,
    );
  }
  const command = commandValue as CliCommand;
  let project: string | undefined;
  let plan: string | undefined;
  let json = false;
  let dryRun = false;
  let fix = false;
  let requireComplete = false;
  let requireFresh = false;
  let pseudo = false;
  let catalogs = false;
  const initConfiguration: Record<string, unknown> = Object.create(
    null,
  ) as Record<string, unknown>;
  let firstInitFlag: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const flag = arguments_[index] as string;
    switch (flag) {
      case '--project': {
        if (project !== undefined)
          throw new InvocationError('--project may appear once.');
        project = requireValue(arguments_, index, flag);
        index += 1;
        break;
      }
      case '--plan': {
        if (plan !== undefined)
          throw new InvocationError('--plan may appear once.');
        plan = requireValue(arguments_, index, flag);
        index += 1;
        break;
      }
      case '--json':
        if (json) throw new InvocationError('--json may appear once.');
        json = true;
        break;
      case '--dry-run':
        if (dryRun) throw new InvocationError('--dry-run may appear once.');
        dryRun = true;
        break;
      case '--fix':
        if (fix) throw new InvocationError('--fix may appear once.');
        fix = true;
        break;
      case '--catalogs':
        if (catalogs) throw new InvocationError('--catalogs may appear once.');
        catalogs = true;
        break;
      case '--require-complete':
        if (requireComplete) {
          throw new InvocationError('--require-complete may appear once.');
        }
        requireComplete = true;
        break;
      case '--require-fresh':
        if (requireFresh) {
          throw new InvocationError('--require-fresh may appear once.');
        }
        requireFresh = true;
        break;
      case '--pseudo':
        if (pseudo) throw new InvocationError('--pseudo may appear once.');
        pseudo = true;
        break;
      default: {
        // Every configuration flag arrives here, because there is no case to write for one: the
        // set of them is `CONFIGURATION_SCHEMA`, read at build time into
        // `cli-options.generated.ts`. A key added to the parser is a flag on the day it lands, and
        // an unknown flag still falls through to the same error it always did.
        const option = initOptionForFlag(flag);
        if (option === undefined) {
          throw new InvocationError(
            `Unknown option for equator ${command}: ${flag}`,
          );
        }
        firstInitFlag ??= flag;
        applyInitOption(
          initConfiguration,
          option,
          requireValue(arguments_, index, flag),
        );
        index += 1;
        break;
      }
    }
  }
  if (
    dryRun &&
    !['init', 'generate', 'format', 'clean', 'uninstall', 'migrate'].includes(
      command,
    )
  ) {
    throw new InvocationError(
      `--dry-run is not supported by equator ${command}.`,
    );
  }
  if (fix && command !== 'check') {
    throw new InvocationError(`--fix is not supported by equator ${command}.`);
  }
  if (catalogs && command !== 'uninstall') {
    throw new InvocationError(
      '--catalogs is supported only by equator uninstall.',
    );
  }
  if (firstInitFlag !== undefined && command !== 'init') {
    throw new InvocationError(
      `${firstInitFlag} is supported only by equator init.`,
    );
  }
  if (requireComplete && command !== 'check') {
    throw new InvocationError(
      '--require-complete is supported only by equator check.',
    );
  }
  if (requireFresh && command !== 'check') {
    throw new InvocationError(
      '--require-fresh is supported only by equator check.',
    );
  }
  // `check` as well as `generate`, and for one reason: `--require-fresh` compares generated output
  // against what the sources say it should be. A check that did not know pseudo-locales had been
  // asked for would read their catalogs as output belonging to no source, and report a build that
  // is exactly correct as stale.
  if (pseudo && command !== 'generate' && command !== 'check') {
    throw new InvocationError(
      '--pseudo is supported only by equator generate and equator check.',
    );
  }
  if (plan !== undefined && command !== 'migrate') {
    throw new InvocationError('--plan is supported only by equator migrate.');
  }
  if (command === 'migrate' && project === undefined) {
    throw new InvocationError('equator migrate requires --project <owner>.');
  }
  if (command === 'migrate' && plan === undefined) {
    throw new InvocationError('equator migrate requires --plan <path>.');
  }
  return Object.freeze({
    command,
    ...(project === undefined ? {} : { project }),
    ...(plan === undefined ? {} : { plan }),
    json,
    dryRun,
    fix,
    catalogs,
    requireComplete,
    requireFresh,
    pseudo,
    initConfiguration: Object.freeze(initConfiguration),
  });
}

function diagnosticKey(diagnostic: ToolkitDiagnostic): string {
  return [
    diagnostic.span?.sourcePath ?? '',
    String(diagnostic.span?.start.offset ?? -1).padStart(12, '0'),
    diagnostic.code,
    diagnostic.severity,
    JSON.stringify(diagnostic.path),
    diagnostic.summary,
  ].join('\u0000');
}

function orderedDiagnostics(
  diagnostics: readonly ToolkitDiagnostic[],
): readonly ToolkitDiagnostic[] {
  const unique = new Map<string, ToolkitDiagnostic>();
  for (const diagnostic of diagnostics) {
    unique.set(diagnosticKey(diagnostic), diagnostic);
  }
  return [...unique.values()].sort((left, right) => {
    const leftKey = diagnosticKey(left);
    const rightKey = diagnosticKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function machineSafeSummary(summary: string): string {
  // A machine-absolute path is the consumer's machine, and
  // `specs/10-compiler-and-tooling.spec.md` section 7 keeps those out of what Equator publishes.
  // It cannot be matched exactly, because a Windows path may contain spaces and so has no
  // reliable end; the stop set is what a path may not contain.
  //
  // The quote is in that set because a path in a summary is written with `JSON.stringify`, which
  // means the closing quote is where it ends: exactly, not heuristically. Without it the redaction
  // ate the rest of the sentence: `EQ1602` names the two owner identities and the recovery, and in
  // machine output the whole of that ended at `<machine-path>`, because nothing after the path
  // happened to be a comma. A diagnostic that says what to do only in human output says it to half
  // its readers. A Windows path cannot contain a quote, so nothing that is a path is left behind.
  return summary.replace(/\b[A-Za-z]:[\\/][^\r\n,;)"]*/gu, '<machine-path>');
}

function machineDiagnostic(diagnostic: ToolkitDiagnostic) {
  const sourcePath = diagnostic.span?.sourcePath?.replaceAll('\\', '/');
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    summary: machineSafeSummary(diagnostic.summary),
    path: diagnostic.path,
    ...(diagnostic.span === undefined
      ? {}
      : {
          span: {
            ...(sourcePath === undefined
              ? {}
              : {
                  sourcePath:
                    posix.isAbsolute(sourcePath) || win32.isAbsolute(sourcePath)
                      ? '<machine-path>'
                      : sourcePath,
                }),
            start: diagnostic.span.start,
            end: diagnostic.span.end,
          },
        }),
  };
}

function humanDiagnostic(diagnostic: ToolkitDiagnostic): string {
  const location =
    diagnostic.span?.sourcePath === undefined
      ? ''
      : `${diagnostic.span.sourcePath}:${diagnostic.span.start.line + 1}:${
          diagnostic.span.start.column + 1
        }: `;
  return `${location}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.summary}\n`;
}

function failureExitCode(
  diagnostics: readonly ToolkitDiagnostic[],
  command?: MachineCommand,
): number {
  if (
    command === 'migrate' &&
    diagnostics.some(({ code }) => code === 'EQ1805')
  ) {
    return 2;
  }
  if (
    diagnostics.some(
      ({ code }) =>
        code === 'EQ1701' ||
        code === 'EQ1702' ||
        code === 'EQ1705' ||
        code === 'EQ1806' ||
        /^EQ100[1-6]$/u.test(code),
    )
  ) {
    return 2;
  }
  if (
    diagnostics.some(
      ({ code, severity }) =>
        severity === 'error' && (code === 'EQ1602' || code === 'EQ1703'),
    )
  ) {
    return 3;
  }
  return 1;
}

function statusForExit(exitCode: number): string {
  switch (exitCode) {
    case 0:
      return 'success';
    case 1:
      return 'diagnostic-failure';
    case 2:
      return 'invocation-or-configuration-failure';
    case 3:
      return 'environment-failure';
    case 130:
      return 'interrupted';
    default:
      return 'failure';
  }
}

function writeMachineResult(
  command: MachineCommand,
  exitCode: number,
  diagnostics: readonly ToolkitDiagnostic[],
  result: unknown,
): void {
  process.stdout.write(
    `${JSON.stringify({
      profile: 'equator-cli-result/1',
      command,
      status: statusForExit(exitCode),
      diagnostics: orderedDiagnostics(diagnostics).map(machineDiagnostic),
      result,
    })}\n`,
  );
}

function reportFailure(
  invocation: {
    readonly command: MachineCommand;
    readonly json: boolean;
  },
  diagnostics: readonly ToolkitDiagnostic[],
): number {
  const ordered = orderedDiagnostics(diagnostics);
  const exitCode = failureExitCode(ordered, invocation.command);
  if (invocation.json) {
    writeMachineResult(invocation.command, exitCode, ordered, null);
  } else {
    for (const diagnostic of ordered)
      process.stderr.write(humanDiagnostic(diagnostic));
    if (
      invocation.command === 'init' &&
      ordered.some(({ code }) => code === 'EQ1701')
    ) {
      process.stderr.write(
        `Complete invocation: ${INIT_INVOCATION} [--project <path>]\n`,
      );
    } else if (
      invocation.command === 'migrate' &&
      ordered.some(({ code }) => code === 'EQ1701')
    ) {
      process.stderr.write(
        'Complete invocation: equator migrate --plan <path> --project <owner> [--dry-run] [--json]\n',
      );
    }
  }
  return exitCode;
}

function generationSummary(result: GenerateProjectResult) {
  return {
    changed: result.publication.changed,
    written: result.publication.written,
    removed: result.publication.removed,
    unchanged: result.publication.unchanged,
    inputFingerprint: result.compilation.state.inputFingerprint,
    planDigest: result.compilation.artifacts.outputPlan.planDigest,
    invalidation: result.compilation.invalidation,
    catalogs: result.compilation.artifacts.catalogs.length,
    scopes: result.compilation.graph.scopes.length,
    messages: result.compilation.graph.scopes.reduce(
      (count, scope) => count + scope.messages.length,
      0,
    ),
    routes: result.compilation.analysis?.routes.length ?? 0,
  };
}

function checkSummary(result: CheckProjectResult) {
  return {
    fresh: result.freshness.fresh,
    missing: result.freshness.missing,
    changed: result.freshness.changed,
    stale: result.freshness.stale,
    fixedFiles: result.fixedFiles,
    inputFingerprint: result.compilation.state.inputFingerprint,
    planDigest: result.compilation.artifacts.outputPlan.planDigest,
    catalogs: result.compilation.artifacts.catalogs.length,
    scopes: result.compilation.graph.scopes.length,
    messages: result.compilation.graph.scopes.reduce(
      (count, scope) => count + scope.messages.length,
      0,
    ),
    routes: result.compilation.analysis?.routes.length ?? 0,
  };
}

function reportSuccess(
  invocation: Pick<ParsedInvocation, 'command' | 'json' | 'dryRun'>,
  diagnostics: readonly ToolkitDiagnostic[],
  result: unknown,
  human: string,
): number {
  const ordered = orderedDiagnostics(diagnostics);
  // A command can do what it was asked to do and still have found something that is not allowed to
  // pass. Unless the success path reads severity, `equator check --require-complete` returns exit 0
  // and `"status": "success"` while carrying `EQ1310` at `severity: error`, and `equator generate`
  // does the same.
  //
  // The test is on **severity**, never on a list of codes.
  // `specs/10-compiler-and-tooling.spec.md` section 12 keys it that way, a bare check fails
  // only on an error, and the alternative is a trap: a hardcoded blocking-codes list is a second
  // place every new error-severity diagnostic has to be registered, and the one nobody remembers is
  // silent. `failureExitCode` still chooses *which* non-zero code, because that mapping is about
  // the kind of failure, not about whether there is one.
  const exitCode = diagnosticsBlock(ordered)
    ? failureExitCode(ordered, invocation.command)
    : 0;
  if (invocation.json) {
    writeMachineResult(invocation.command, exitCode, ordered, result);
  } else {
    for (const diagnostic of ordered)
      process.stderr.write(humanDiagnostic(diagnostic));
    // The success lines say "passed". Printing one beside a blocking diagnostic would be the same
    // untruth in human output that the exit code just stopped telling machines.
    if (exitCode === 0) process.stdout.write(`${human}\n`);
  }
  return exitCode;
}

function aliasRecord(
  values: readonly string[],
): Readonly<Record<string, string>> {
  const aliases: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const value of values) {
    const equals = value.indexOf('=');
    if (equals <= 0 || equals === value.length - 1) {
      throw new InvocationError(
        `Interactive alias ${JSON.stringify(value)} must use <alias>=<locale>.`,
      );
    }
    aliases[value.slice(0, equals).trim()] = value.slice(equals + 1).trim();
  }
  return Object.freeze(aliases);
}

async function interactiveInitOptions(
  invocation: ParsedInvocation,
): Promise<InitProjectOptions> {
  const hasArguments = Object.keys(invocation.initConfiguration).length > 0;
  if (hasArguments || !process.stdin.isTTY || !process.stderr.isTTY) {
    return {
      ...(invocation.project === undefined
        ? {}
        : { project: invocation.project }),
      // The one cast in this path, and the parser is the next thing that runs. `applyInitOption`
      // builds each value in the shape the generated table says the schema wants, and
      // `parseConfiguration` is what decides whether it was right, so a cast here is
      // narrowing a value that is about to be validated rather than asserting it is already valid.
      ...(hasArguments
        ? {
            configuration: invocation.initConfiguration as InitConfiguration,
          }
        : {}),
      dryRun: invocation.dryRun,
    };
  }
  const { discoverProject } = await projectHost();
  const discovered = await discoverProject({
    ...(invocation.project === undefined
      ? {}
      : { project: invocation.project }),
  });
  if (discovered.ok) {
    try {
      const metadata = await lstat(discovered.value.configurationPath);
      if (metadata.isFile() && !metadata.isSymbolicLink()) {
        return {
          ...(invocation.project === undefined
            ? {}
            : { project: invocation.project }),
          dryRun: invocation.dryRun,
        };
      }
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const sourceLocale = (await prompt.question('Source locale: ')).trim();
    const defaultLocale = (await prompt.question('Default locale: ')).trim();
    const locales = (
      await prompt.question('Supported locales (comma-separated): ')
    )
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const aliasText = (
      await prompt.question(
        'Aliases (comma-separated alias=locale, optional): ',
      )
    ).trim();
    const aliases =
      aliasText.length === 0
        ? Object.freeze({})
        : aliasRecord(aliasText.split(',').map((value) => value.trim()));
    return {
      ...(invocation.project === undefined
        ? {}
        : { project: invocation.project }),
      // Four questions, because the tooling specification fixes what a bare `equator init` on a TTY
      // may ask. The fields the flags reach beyond these are set on the command line, and widening
      // the prompt list is a specification change rather than a parser change.
      configuration: {
        sourceLocale,
        defaultLocale,
        locales,
        ...(Object.keys(aliases).length === 0 ? {} : { aliases }),
      },
      dryRun: invocation.dryRun,
    };
  } finally {
    prompt.close();
  }
}

async function executeInit(invocation: ParsedInvocation): Promise<number> {
  const { initializeProject } = await projectHost();
  const options = await interactiveInitOptions(invocation);
  const preview = await initializeProject({ ...options, dryRun: true });
  if (!preview.ok) return reportFailure(invocation, preview.diagnostics);
  if (invocation.dryRun) {
    return reportSuccess(
      invocation,
      preview.diagnostics,
      {
        dryRun: true,
        changed: preview.value.changed,
        files: preview.value.files,
        configuration: preview.value.configuration,
      },
      preview.value.changed
        ? `Equator init would update: ${preview.value.files.join(', ')}.`
        : 'Equator init is already complete.',
    );
  }
  if (!invocation.json && preview.value.changed) {
    process.stdout.write(
      `Equator init plan: ${preview.value.files.join(', ')}.\n`,
    );
  }
  const applied = await initializeProject({ ...options, dryRun: false });
  if (!applied.ok) return reportFailure(invocation, applied.diagnostics);
  return reportSuccess(
    invocation,
    applied.diagnostics,
    {
      dryRun: false,
      changed: applied.value.changed,
      files: applied.value.files,
      configuration: applied.value.configuration,
    },
    applied.value.changed
      ? `Equator init updated: ${applied.value.files.join(', ')}.`
      : 'Equator init is already complete.',
  );
}

async function executeGenerate(invocation: ParsedInvocation): Promise<number> {
  const { generateProject } = await projectHost();
  const result = await generateProject({
    ...(invocation.project === undefined
      ? {}
      : { project: invocation.project }),
    dryRun: invocation.dryRun,
    pseudoLocales: invocation.pseudo,
  });
  if (!result.ok) return reportFailure(invocation, result.diagnostics);
  const summary = generationSummary(result.value);
  const human = invocation.dryRun
    ? result.value.publication.changed
      ? `Equator generate would write ${result.value.publication.written.length} and remove ${result.value.publication.removed.length} files.`
      : 'Equator generated output is already current.'
    : result.value.publication.changed
      ? `Equator generated ${result.value.publication.written.length} files and removed ${result.value.publication.removed.length} stale files.`
      : 'Equator generated output is already current.';
  return reportSuccess(
    invocation,
    result.diagnostics,
    { dryRun: invocation.dryRun, ...summary },
    human,
  );
}

async function executeCheck(invocation: ParsedInvocation): Promise<number> {
  const { checkProject } = await projectHost();
  const result = await checkProject({
    ...(invocation.project === undefined
      ? {}
      : { project: invocation.project }),
    fix: invocation.fix,
    requireCompleteTargets: invocation.requireComplete,
    requireFreshOutput: invocation.requireFresh,
    pseudoLocales: invocation.pseudo,
  });
  if (!result.ok) return reportFailure(invocation, result.diagnostics);
  return reportSuccess(
    invocation,
    result.diagnostics,
    { fix: invocation.fix, ...checkSummary(result.value) },
    result.value.freshness.fresh
      ? 'Equator check passed; generated output is current.'
      : 'Equator check passed with a generated-output freshness advisory.',
  );
}

async function executeFormat(invocation: ParsedInvocation): Promise<number> {
  const { formatProject } = await projectHost();
  const result = await formatProject({
    ...(invocation.project === undefined
      ? {}
      : { project: invocation.project }),
    dryRun: invocation.dryRun,
  });
  if (!result.ok) return reportFailure(invocation, result.diagnostics);
  return reportSuccess(
    invocation,
    result.diagnostics,
    {
      dryRun: invocation.dryRun,
      changed: result.value.changed,
      files: result.value.files,
    },
    result.value.changed
      ? invocation.dryRun
        ? `Equator format would update: ${result.value.files.join(', ')}.`
        : `Equator formatted: ${result.value.files.join(', ')}.`
      : 'Equator authoring files are already canonical.',
  );
}

async function executeClean(invocation: ParsedInvocation): Promise<number> {
  const { cleanProject } = await projectHost();
  const result = await cleanProject({
    ...(invocation.project === undefined
      ? {}
      : { project: invocation.project }),
    dryRun: invocation.dryRun,
  });
  if (!result.ok) return reportFailure(invocation, result.diagnostics);
  return reportSuccess(
    invocation,
    result.diagnostics,
    {
      dryRun: invocation.dryRun,
      changed: result.value.changed,
      removed: result.value.removed,
    },
    result.value.changed
      ? invocation.dryRun
        ? `Equator clean would remove ${result.value.removed.length} owned files.`
        : `Equator clean removed ${result.value.removed.length} owned files.`
      : 'Equator clean found no owned state.',
  );
}

async function executeUninstall(invocation: ParsedInvocation): Promise<number> {
  const { uninstallProject } = await projectHost();
  const result = await uninstallProject({
    ...(invocation.project === undefined
      ? {}
      : { project: invocation.project }),
    dryRun: invocation.dryRun,
    catalogs: invocation.catalogs,
  });
  if (!result.ok) return reportFailure(invocation, result.diagnostics);
  const retained =
    result.value.retained.length === 0
      ? ''
      : ` Left alone because they were edited: ${result.value.retained.join(', ')}.`;
  return reportSuccess(
    invocation,
    result.diagnostics,
    {
      dryRun: invocation.dryRun,
      changed: result.value.changed,
      removed: result.value.removed,
      retained: result.value.retained,
      catalogs: result.value.catalogs,
    },
    result.value.changed
      ? `${
          invocation.dryRun
            ? `Equator uninstall would remove ${result.value.removed.length} files or entries.`
            : `Equator uninstall removed ${result.value.removed.length} files or entries.`
        }${retained}`
      : `Equator uninstall found nothing of its own to remove.${retained}`,
  );
}

function missingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function readMigrationPlan(
  path: string,
): Promise<ToolkitResult<AuthoredChangePlan>> {
  const absolutePath = resolve(path);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(absolutePath);
  } catch (error) {
    if (missingFileError(error)) {
      throw new InvocationError(
        `Equator migration plan ${JSON.stringify(path)} does not exist.`,
      );
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new InvocationError(
      'Equator --plan must select an ordinary non-symbolic JSON file.',
    );
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(absolutePath, 'r');
  } catch (error) {
    if (missingFileError(error)) {
      throw new InvocationError(
        `Equator migration plan ${JSON.stringify(path)} does not exist.`,
      );
    }
    throw error;
  }
  try {
    const openedMetadata = await handle.stat();
    if (!openedMetadata.isFile()) {
      throw new InvocationError(
        'Equator --plan must select an ordinary JSON file.',
      );
    }
    const maximum = RESOURCE_LIMITS.authoredChangePlanBytes;
    if (openedMetadata.size > maximum) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1805',
          `Equator authored change plan exceeds the ${maximum}-byte implementation ceiling.`,
        ),
      ]);
    }
    const chunks: Buffer[] = [];
    let position = 0;
    while (position <= maximum) {
      const capacity = Math.min(64 * 1024, maximum + 1 - position);
      const chunk = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(chunk, 0, capacity, position);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position > maximum) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1805',
          `Equator authored change plan exceeds the ${maximum}-byte implementation ceiling.`,
        ),
      ]);
    }
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, position),
      );
    } catch {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1805',
          'Equator authored change plan must be valid UTF-8 JSON.',
        ),
      ]);
    }
    const { parseAuthoredChangePlan } = await authoredChanges();
    return parseAuthoredChangePlan(source, {
      sourcePath: '<migration-plan>',
      kind: 'migration',
    });
  } finally {
    await handle.close();
  }
}

function authoredFiles(count: number): string {
  return `${count} authored ${count === 1 ? 'file' : 'files'}`;
}

async function executeMigrate(invocation: ParsedInvocation): Promise<number> {
  if (invocation.project === undefined || invocation.plan === undefined) {
    throw new InvocationError(
      'equator migrate requires --plan <path> and --project <owner>.',
    );
  }
  const { discoverProject } = await projectHost();
  const location = await discoverProject({
    project: invocation.project,
  });
  if (!location.ok) return reportFailure(invocation, location.diagnostics);
  const plan = await readMigrationPlan(invocation.plan);
  if (!plan.ok) return reportFailure(invocation, plan.diagnostics);
  const { applyAuthoredChangePlan } = await authoredChanges();
  const preview = await applyAuthoredChangePlan({
    ownerRoot: location.value.ownerRoot,
    plan: plan.value,
    dryRun: true,
  });
  if (!preview.ok) return reportFailure(invocation, preview.diagnostics);
  if (invocation.dryRun) {
    return reportSuccess(
      invocation,
      preview.diagnostics,
      {
        dryRun: true,
        changed: preview.value.changed,
        files: preview.value.files,
        planId: plan.value.id,
        planDigest: preview.value.planDigest,
        regenerate: plan.value.regenerate,
      },
      preview.value.changed
        ? `Equator migrate would apply ${plan.value.id} to ${authoredFiles(preview.value.files.length)}: ${preview.value.files.join(', ')}.`
        : `Equator migration ${plan.value.id} is already applied.`,
    );
  }
  if (!invocation.json && preview.value.changed) {
    process.stdout.write(
      `Equator migrate plan ${plan.value.id}: ${authoredFiles(preview.value.files.length)}.\n`,
    );
  }
  const applied = await applyAuthoredChangePlan({
    ownerRoot: location.value.ownerRoot,
    plan: plan.value,
  });
  if (!applied.ok) return reportFailure(invocation, applied.diagnostics);
  return reportSuccess(
    invocation,
    applied.diagnostics,
    {
      dryRun: false,
      changed: applied.value.changed,
      files: applied.value.files,
      planId: plan.value.id,
      planDigest: applied.value.planDigest,
      regenerate: plan.value.regenerate,
    },
    applied.value.changed
      ? `Equator migrate applied ${plan.value.id} to ${authoredFiles(applied.value.files.length)}: ${applied.value.files.join(', ')}. Run equator generate.`
      : `Equator migration ${plan.value.id} is already applied.`,
  );
}

function writeWatchCycle(
  invocation: ParsedInvocation,
  cycle: WatchCycle,
): void {
  if (!cycle.result.ok) {
    const exitCode = failureExitCode(cycle.result.diagnostics, 'watch');
    if (invocation.json) {
      process.stdout.write(
        `${JSON.stringify({
          profile: 'equator-cli-watch-event/1',
          command: 'watch',
          sequence: cycle.sequence,
          status: statusForExit(exitCode),
          diagnostics: orderedDiagnostics(cycle.result.diagnostics).map(
            machineDiagnostic,
          ),
          result: null,
        })}\n`,
      );
    } else {
      for (const diagnostic of orderedDiagnostics(cycle.result.diagnostics)) {
        process.stderr.write(humanDiagnostic(diagnostic));
      }
    }
    return;
  }
  if (invocation.json) {
    process.stdout.write(
      `${JSON.stringify({
        profile: 'equator-cli-watch-event/1',
        command: 'watch',
        sequence: cycle.sequence,
        status: 'success',
        diagnostics: orderedDiagnostics(cycle.result.diagnostics).map(
          machineDiagnostic,
        ),
        result: generationSummary(cycle.result.value),
      })}\n`,
    );
  } else {
    for (const diagnostic of orderedDiagnostics(cycle.result.diagnostics)) {
      process.stderr.write(humanDiagnostic(diagnostic));
    }
    process.stdout.write(
      `Equator watch cycle ${cycle.sequence}: ${
        cycle.result.value.publication.changed ? 'generated changes' : 'current'
      }.\n`,
    );
  }
}

async function executeWatch(invocation: ParsedInvocation): Promise<number> {
  const { watchProject } = await projectHost();
  const controller = new AbortController();
  let interrupted = false;
  const interrupt = (): void => {
    interrupted = true;
    controller.abort();
  };
  // Raised inside the handler while the watch below is running, which is an assignment the
  // compiler cannot order against a plain read of the variable.
  const wasInterrupted = (): boolean => interrupted;
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const result = await watchProject({
      ...(invocation.project === undefined
        ? {}
        : { project: invocation.project }),
      signal: controller.signal,
      onCycle: (cycle) => writeWatchCycle(invocation, cycle),
    });
    if (wasInterrupted()) return 130;
    if (!result.ok) return reportFailure(invocation, result.diagnostics);
    return 0;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

async function execute(invocation: ParsedInvocation): Promise<number> {
  switch (invocation.command) {
    case 'init':
      return executeInit(invocation);
    case 'generate':
      return executeGenerate(invocation);
    case 'check':
      return executeCheck(invocation);
    case 'format':
      return executeFormat(invocation);
    case 'clean':
      return executeClean(invocation);
    case 'uninstall':
      return executeUninstall(invocation);
    case 'watch':
      return executeWatch(invocation);
    case 'migrate':
      return executeMigrate(invocation);
  }
}

async function main(): Promise<number> {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length === 0 ||
    arguments_.includes('--help') ||
    arguments_.includes('-h')
  ) {
    process.stdout.write(helpText());
    return 0;
  }
  if (arguments_.includes('--version') || arguments_.includes('-v')) {
    if (arguments_.length !== 1) {
      throw new InvocationError('--version cannot be combined with a command.');
    }
    process.stdout.write(`${packageManifest.version}\n`);
    return 0;
  }
  return execute(parseInvocation(arguments_));
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof InvocationError) {
    const diagnostic = toolkitDiagnostic('EQ1701', error.message);
    const json = process.argv.includes('--json');
    process.exitCode = reportFailure(
      {
        command: machineCommand(process.argv[2]),
        json,
      },
      [diagnostic],
    );
  } else {
    const detail = error instanceof Error ? error.message : String(error);
    const diagnostic = toolkitDiagnostic(
      'EQ1703',
      'Equator could not complete because an environment operation failed.',
    );
    const json = process.argv.includes('--json');
    if (json) {
      writeMachineResult(
        machineCommand(process.argv[2]),
        3,
        [diagnostic],
        null,
      );
      process.stderr.write(`${detail}\n`);
    } else {
      process.stderr.write(humanDiagnostic(diagnostic));
      process.stderr.write(`${detail}\n`);
    }
    process.exitCode = 3;
  }
}
