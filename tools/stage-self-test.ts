/**
 * The shared shape of a stage's self-test: the stage, run over a copy of what it reads, refusing
 * each defect planted into that copy.
 *
 * A stage that takes part reads its inputs from `inputsRoot()`, which is the repository unless the
 * command line names a copy with `--inputs <dir>`. The copy holds only the files the stage reads, so
 * `node_modules` and anything the stage runs stay the repository's.
 *
 * The unchanged copy must pass first, so every red after it is a change from a green this run saw.
 * A plant must change what it plants into, and must be refused with the words it names. A refusal
 * pattern the unchanged run already prints proves nothing, so each is required to be absent there.
 *
 * Some stages observe through the process rather than through a file: a heap reading needs Node's
 * `--expose-gc`. Such a stage names the flags it runs with as `nodeArgs`, and a plant that gives
 * its own `nodeArgs` withdraws the observing mechanism instead of editing the copy. It must still
 * change something, so a plant that edits nothing and runs with the stage's own flags is refused.
 *
 * Some stages read more when the command line names it, as the mutation record reads the reports
 * of a reading. A plant for that half gives `args`, a function of the copy that answers the
 * arguments its run adds, and plants what they name.
 *
 * No run may change what it reads. `specs/12-verification.spec.md` section 9 forbids a failing run
 * rewriting the baseline it fails against, and a refusal read from the output cannot see that: a
 * stage that records its baseline while refusing prints the same words as one that does not. So
 * every file of the copy is compared with its bytes before each run, and every file of the
 * repository the copy was taken from is compared across the whole self-test, since a stage that
 * resolves its baseline without `inputsRoot()` writes there instead. A plant that declares
 * `rewrites` makes the stage rewrite that input, and is refused only when the comparison names it,
 * which is how the comparison is shown able to fail.
 *
 * A stage whose verdict is a measurement can pass with a defect planted because the reading moved,
 * and a pass that kept no reading cannot be told from a plant that stopped working. Such a stage
 * sets `measured`, and each of its plants names in `measures` the checks it is aimed at. What the
 * stage printed for each of those is then printed for every plant, refused or not, beside what the
 * unchanged run printed for the same check. A named check the stage printed nothing for is a
 * failure, so a check renamed in the stage cannot leave a plant's line empty.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What `String.prototype.replace` takes in place of a match. */
export type Replacement =
  string | ((match: string, ...groups: string[]) => string);

/** What every plant may give, whichever way it is judged. */
interface PlantBase {
  readonly id: string;
  readonly nodeArgs?: readonly string[];
  readonly args?: (root: string) => readonly string[];
  readonly measures?: readonly string[];
}

/** A plant the stage must refuse with the words `refusal` matches. */
export interface RefusedPlant extends PlantBase {
  readonly plant?: (root: string) => Promise<void>;
  readonly refusal: RegExp;
  readonly rewrites?: undefined;
}

/** A plant that makes a failing run rewrite the input `rewrites` names. */
export interface RewritingPlant extends PlantBase {
  readonly plant: (root: string) => Promise<void>;
  readonly rewrites: string;
  readonly refusal?: undefined;
}

export type StagePlant = RefusedPlant | RewritingPlant;

/** One stage's self-test: what it runs, what it reads, and what is planted into a copy of that. */
export interface StageSelfTest {
  readonly script: string;
  readonly args?: readonly string[];
  readonly inputs: readonly string[];
  readonly plants: readonly StagePlant[];
  readonly nodeArgs?: readonly string[];
  readonly timeout?: number;
  readonly measured?: boolean;
}

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function inputsRoot(argv: readonly string[] = process.argv): string {
  const index = argv.indexOf('--inputs');
  return index === -1 ? repositoryRoot : resolve(argv[index + 1] as string);
}

export async function editText(
  root: string,
  path: string,
  edit: (text: string) => string,
): Promise<void> {
  const file = resolve(root, path);
  const before = await readFile(file, 'utf8');
  const after = edit(before);
  if (after === before)
    throw new Error(`The plant changed nothing in ${path}.`);
  await writeFile(file, after, 'utf8');
}

export const replaceOnce =
  (find: string, replace: string) =>
  (text: string): string => {
    if (text.split(find).length !== 2) {
      throw new Error(
        `The plant expects ${JSON.stringify(find)} exactly once.`,
      );
    }
    return text.replace(find, () => replace);
  };

/**
 * `replaceOnce` for text a packager writes. Which quote a string is in, how deep a line is indented
 * and where a statement breaks are its choice, so the plant names what it edits with a pattern that
 * leaves those open, and the pattern must still match in one place only.
 */
export const replaceOnceMatching =
  (pattern: RegExp, replace: Replacement) =>
  (text: string): string => {
    const everywhere = new RegExp(
      pattern.source,
      `${pattern.flags.replace('g', '')}g`,
    );
    if ([...text.matchAll(everywhere)].length !== 1) {
      throw new Error(`The plant expects ${pattern} exactly once.`);
    }
    // One call for both forms of `replace`, which the declarations of `replace` give as separate overloads.
    return text.replace(pattern, replace as string);
  };

export const editJson =
  <T>(path: string, edit: (value: T) => void) =>
  (root: string): Promise<void> =>
    editText(root, path, (text) => {
      const value = JSON.parse(text) as T;
      edit(value);
      return `${JSON.stringify(value, null, 2)}\n`;
    });

/** The bytes of every file under `paths` in `root`, by path relative to `root`. */
export function inputDigests(
  root: string,
  paths: readonly string[],
): Map<string, string> {
  const digests = new Map<string, string>();
  // A plant may remove an input outright, and a run may; either reads as its files going missing.
  const visit = (path: string): void => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
      return;
    }
    digests.set(
      relative(root, path).replaceAll('\\', '/'),
      createHash('sha256').update(readFileSync(path)).digest('hex'),
    );
  };
  for (const path of paths) visit(resolve(root, path));
  return digests;
}

/** The paths whose bytes differ between two readings, including any added or removed. */
export function changedInputs(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

/**
 * What a stage printed about one of its checks: every line that names the check, and the indented
 * lines under each, which is where a stage puts the reading.
 */
export function measurementLines(printed: string, check: string): string[] {
  const lines = printed.split(/\r?\n/u);
  const found: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!(lines[index] as string).includes(check)) continue;
    found.push(lines[index] as string);
    while (
      index + 1 < lines.length &&
      /^\s+\S/u.test(lines[index + 1] as string)
    ) {
      index += 1;
      found.push(lines[index] as string);
    }
  }
  return found;
}

/**
 * Runs `script` with `args` over a fresh copy of `inputs` once unchanged and once per plant, and
 * prints the verdict. Resolves to the number of failures, which the caller turns into the status.
 */
export async function verifyStagePlants({
  stage,
  script,
  args = [],
  inputs,
  plants,
  nodeArgs = [],
  timeout = 180_000,
  measured = false,
}: StageSelfTest & { readonly stage: string }): Promise<number> {
  // Inside the workspace, so a copied package resolves its dependencies from the repository's
  // `node_modules` the way the original does.
  const base = resolve(
    repositoryRoot,
    'tmp',
    `${stage.replaceAll(':', '-')}-self-test`,
  );
  const pristine = resolve(base, 'pristine');
  const work = resolve(base, 'work');
  const out = (line: string): boolean => process.stdout.write(`${line}\n`);
  const run = (flags: readonly string[], added: readonly string[]) => {
    const began = Date.now();
    const result = spawnSync(
      process.execPath,
      [
        ...flags,
        resolve(repositoryRoot, script),
        ...args,
        '--inputs',
        work,
        ...added,
      ],
      { cwd: repositoryRoot, encoding: 'utf8', timeout },
    );
    return { ...result, ms: Date.now() - began };
  };
  const fresh = async () => {
    await rm(work, { recursive: true, force: true });
    await cp(pristine, work, { recursive: true });
  };

  const failures: string[] = [];
  const repositoryBefore = inputDigests(repositoryRoot, inputs);
  // Read after the plant rather than from the pristine copy, so what a plant edits is not taken
  // for something the run wrote.
  const runComparing = (
    flags: readonly string[],
    added: readonly string[] = [],
  ) => {
    const before = inputDigests(work, inputs);
    const result = run(flags, added);
    return {
      ...result,
      changed: changedInputs(before, inputDigests(work, inputs)),
    };
  };
  const exercise = async () => {
    await rm(base, { recursive: true, force: true });
    for (const path of inputs) {
      await mkdir(dirname(resolve(pristine, path)), { recursive: true });
      await cp(resolve(repositoryRoot, path), resolve(pristine, path), {
        recursive: true,
      });
    }

    await fresh();
    const control = runComparing(nodeArgs);
    out(`control: status ${control.status} in ${control.ms} ms`);
    if (control.changed.length > 0) {
      failures.push(
        `The unchanged run changed what it reads: ${control.changed.join(', ')}.`,
      );
    }
    if (control.error !== undefined || control.status !== 0) {
      failures.push(
        `The unchanged copy does not pass, so no refusal would mean anything:\n${control.stdout}${control.stderr}${control.error ?? ''}`,
      );
      return;
    }
    const controlText = `${control.stdout}${control.stderr}`;
    const reportMeasurements = (
      id: string,
      measures: readonly string[],
      printed: string,
    ): void => {
      for (const check of measures) {
        const readings: readonly (readonly [string, string[]])[] = [
          ['unchanged', measurementLines(controlText, check)],
          ['planted', measurementLines(printed, check)],
        ];
        for (const [run, lines] of readings) {
          if (lines.length === 0) {
            failures.push(
              `${id}: the ${run} run printed nothing for ${JSON.stringify(check)}, so what it measured cannot be read.`,
            );
            continue;
          }
          out(`  ${run}:`);
          for (const line of lines) out(`    ${line}`);
        }
      }
    };

    for (const {
      id,
      plant,
      nodeArgs: planted,
      args: added,
      refusal,
      rewrites,
      measures = [],
    } of plants) {
      if (measured && rewrites === undefined && measures.length === 0) {
        failures.push(
          `${id}: the stage's verdict is a measurement, and the plant names no check whose reading to print.`,
        );
        continue;
      }
      if (rewrites !== undefined) {
        await fresh();
        await plant(work);
        const result = runComparing(nodeArgs);
        out(`${id}: status ${result.status} in ${result.ms} ms`);
        if (result.error !== undefined) {
          failures.push(
            `${id}: the stage did not finish: ${String(result.error)}`,
          );
        } else if (result.status === 0) {
          failures.push(
            `${id}: the stage passed; the plant is a failing run that rewrites ${rewrites}.`,
          );
        } else if (!result.changed.includes(rewrites)) {
          failures.push(
            `${id}: the failing run rewrote ${rewrites} and the comparison of what it reads did not name it (it named ${result.changed.join(', ') || 'nothing'}).`,
          );
        }
        continue;
      }
      if (refusal.test(controlText)) {
        failures.push(`${id}: the unchanged run already prints ${refusal}.`);
        continue;
      }
      const flags = planted ?? nodeArgs;
      if (
        plant === undefined &&
        JSON.stringify(flags) === JSON.stringify(nodeArgs)
      ) {
        failures.push(
          `${id}: the plant edits nothing and runs with the stage's own flags.`,
        );
        continue;
      }
      await fresh();
      // A plant that cannot be planted has shown nothing, and the verdict below is printed whatever
      // happened, so its failure is counted here rather than left to end the run.
      try {
        if (plant !== undefined) await plant(work);
      } catch (error) {
        failures.push(`${id}: the plant could not be planted: ${error}`);
        continue;
      }
      const result = runComparing(flags, added?.(work));
      out(`${id}: status ${result.status} in ${result.ms} ms`);
      const printed = `${result.stdout}${result.stderr}`;
      reportMeasurements(id, measures, printed);
      if (result.changed.length > 0) {
        failures.push(
          `${id}: the run changed what it reads: ${result.changed.join(', ')}.`,
        );
      }
      if (result.error !== undefined) {
        failures.push(
          `${id}: the stage did not finish: ${String(result.error)}`,
        );
      } else if (result.status === 0) {
        failures.push(`${id}: the stage passed with the defect planted.`);
      } else if (!refusal.test(printed)) {
        failures.push(
          `${id}: the stage failed without naming the defect (${refusal}):\n${printed.slice(0, 2_000)}`,
        );
      }
    }
  };

  try {
    await exercise();
  } catch (error) {
    // The verdict below is printed whatever happened, and a self-test that stopped before it ran a
    // plant has seen nothing refused.
    failures.push(
      `The self-test did not finish: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
    const repositoryChanged = changedInputs(
      repositoryBefore,
      inputDigests(repositoryRoot, inputs),
    );
    if (repositoryChanged.length > 0) {
      failures.push(
        `The repository's own copy of what the stage reads changed during the self-test: ${repositoryChanged.join(', ')}.`,
      );
    }
    if (failures.length > 0) {
      out(`${stage}:self-test RED: ${failures.length} failures.`);
      for (const failure of failures) out(`  ${failure}`);
    } else {
      out(
        `${stage}:self-test GREEN: the stage refused all ${plants.length} planted defects, each by name, and no run changed what it reads except where a plant made it.`,
      );
    }
  }
  return failures.length;
}
