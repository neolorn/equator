/**
 * A mutation reading in parts, each small enough for one hosted job.
 *
 * A job on a hosted runner ends at six hours, and one reading of either half takes many times that
 * at the four workers a runner has. Whole files do not divide it: a single function can cost more
 * than a job. So a file is divided between parts at the start of a statement, and each part runs
 * the whole file with every mutant outside its own regions switched off by Stryker's own
 * directives, `Stryker disable all` and `Stryker restore all`.
 *
 * That division is exact whatever the code looks like. Stryker reads a node's directives as it
 * enters the node and collects that node's mutants in the same step, so a mutant belongs to the
 * region its node starts in, including a mutant whose node spans the cut, such as a function body
 * emptied whole. A line range would lose that mutant, since Stryker keeps a mutant from a range
 * only when the range holds all of it. Each file's regions are checked to cover it from its first
 * line to its last with no gap and no overlap, so every mutant is read once and only once.
 *
 * Where the cuts fall is an estimate and only decides how evenly the parts come out, never what
 * they read: `tools/mutation-shards.json` names them by line, and a cut moves to the first
 * statement that begins a line at or after its line, so an edit that moves code changes how long a
 * part takes and nothing else. `tools/divide-mutation-shards.ts` computes them from a reading.
 *
 * Usage:
 *   node tools/mutation-shards.ts check
 *   node tools/mutation-shards.ts matrix
 *   node tools/mutation-shards.ts apply <half> <part> --disposable-checkout
 *
 * `apply` writes the directives into the sources of the checkout it runs in and prints the files
 * the part reads, comma-separated, for Stryker's `--mutate`. A checkout it has run in is not one
 * to commit from, which is why it asks to be told so.
 */
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as TypeScript from 'typescript';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(workspaceRoot, 'package.json'));
const ts = require('typescript') as typeof TypeScript;

export const DIVISION_PATH = resolve(
  workspaceRoot,
  'tools/mutation-shards.json',
);

/** One file's span in a part, as `tools/mutation-shards.json` writes it. */
export interface DivisionPart {
  file: string;
  from: number;
  to: number | null;
}

export interface DivisionShard {
  minutes: number;
  parts: DivisionPart[];
}

export interface DivisionHalf {
  configuration: string;
  basis?: unknown;
  shards: DivisionShard[];
}

/** The contents of `tools/mutation-shards.json`. */
export interface Division {
  halves: Record<string, DivisionHalf>;
}

interface Region {
  readonly from: number;
  readonly to: number | null;
  readonly shard: number;
}

interface DivisionReading {
  readonly configuration: string;
  readonly count: number;
  readonly regions: Map<string, Region[]>;
}

/** A division read into regions, with what is wrong with its tiling. */
export interface ReadDivision {
  readonly halves: Record<string, DivisionReading>;
  readonly problems: string[];
}

const DISABLE = '/* Stryker disable all */ ';
const RESTORE = '/* Stryker restore all */ ';

const fail: (message: string) => never = (message) => {
  process.stderr.write(`mutation-shards: ${message}\n`);
  process.exit(1);
};

/** The files a configuration's `mutate` list selects, with its exclusions applied. */
export async function mutatedFiles(configuration: string): Promise<string[]> {
  const { default: config } = (await import(
    pathToFileURL(resolve(workspaceRoot, configuration)).href
  )) as { readonly default: { readonly mutate: readonly string[] } };
  const take = (patterns: readonly string[]): Set<string> =>
    new Set(
      patterns.flatMap((pattern) =>
        globSync(pattern, { cwd: workspaceRoot }).map((path) =>
          path.replaceAll('\\', '/'),
        ),
      ),
    );
  const included = take(config.mutate.filter((p) => !p.startsWith('!')));
  const excluded = take(
    config.mutate.filter((p) => p.startsWith('!')).map((p) => p.slice(1)),
  );
  return [...included].filter((path) => !excluded.has(path)).sort();
}

/**
 * The offsets where a region may start: each statement or class member that is the first thing on
 * its line. A directive written just before one is that node's leading comment, which is where
 * Stryker reads it.
 */
export function cutCandidates(text: string, fileName = 'source.ts') {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const starts = new Set<number>();
  const visit = (node: TypeScript.Node): void => {
    if (ts.isStatement(node) || ts.isClassElement(node)) {
      const start = node.getStart(source);
      const { line, character } = source.getLineAndCharacterOfPosition(start);
      const lineStart = source.getPositionOfLineAndCharacter(line, 0);
      if (text.slice(lineStart, lineStart + character).trim() === '') {
        starts.add(start);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return {
    offsets: [...starts].sort((a, b) => a - b),
    lineOf: (offset: number): number =>
      source.getLineAndCharacterOfPosition(offset).line + 1,
  };
}

/**
 * Where each region of a file starts, as an offset: the first candidate at or after the line its
 * part names. The first region starts at the file's first candidate, so it holds every mutant.
 */
export function regionStarts(
  text: string,
  fromLines: readonly number[],
  fileName: string,
): number[] {
  const { offsets, lineOf } = cutCandidates(text, fileName);
  if (offsets.length === 0) return fromLines.map(() => text.length);
  return fromLines.map((line, index) =>
    index === 0
      ? (offsets[0] as number)
      : (offsets.find((offset) => lineOf(offset) >= line) ?? text.length),
  );
}

/** The division, with each half's parts read into regions per file and checked to tile each file. */
export function readDivision(
  division: Division = JSON.parse(
    readFileSync(DIVISION_PATH, 'utf8'),
  ) as Division,
): ReadDivision {
  const problems: string[] = [];
  const halves: Record<string, DivisionReading> = {};
  for (const [half, { configuration, shards }] of Object.entries(
    division.halves,
  )) {
    const regions = new Map<string, Region[]>();
    shards.forEach(({ parts }, shard) => {
      for (const { file, from, to } of parts) {
        regions.set(file, [...(regions.get(file) ?? []), { from, to, shard }]);
      }
    });
    for (const [file, list] of regions) {
      list.sort((a, b) => a.from - b.from);
      list.forEach((region, index) => {
        const expectedFrom = index === 0 ? 1 : (list[index - 1] as Region).to;
        if (region.from !== expectedFrom) {
          problems.push(
            `${half}: ${file} has a region from line ${region.from} where one from line ${expectedFrom} was due, so a part of the file is read twice or not at all.`,
          );
        }
      });
      if ((list.at(-1) as Region).to !== null) {
        problems.push(
          `${half}: ${file} ends its last region at line ${(list.at(-1) as Region).to}, so the rest of the file is read by no part.`,
        );
      }
    }
    halves[half] = { configuration, count: shards.length, regions };
  }
  return { halves, problems };
}

/**
 * What one part reads: for every file it touches, the source with the directives that switch off
 * the regions of other parts. A file the division does not name is read whole by the last part, so a
 * file added since the division was made is read rather than lost.
 */
export async function partSources(
  half: string,
  shard: number,
  division: ReadDivision = readDivision(),
): Promise<{ file: string; text: string }[]> {
  const entry = division.halves[half];
  if (entry === undefined) fail(`no half named ${half}.`);
  if (!(shard >= 0 && shard < entry.count))
    fail(`${half} has parts 0 to ${entry.count - 1}.`);
  const files = await mutatedFiles(entry.configuration);
  const result: { file: string; text: string }[] = [];
  for (const file of files) {
    const regions = entry.regions.get(file);
    if (regions === undefined) {
      if (shard === entry.count - 1) {
        result.push({
          file,
          text: readFileSync(resolve(workspaceRoot, file), 'utf8'),
        });
      }
      continue;
    }
    if (!regions.some((region) => region.shard === shard)) continue;
    const text = readFileSync(resolve(workspaceRoot, file), 'utf8');
    if (/Stryker (disable|restore)/u.test(text)) {
      fail(
        `${file} carries a Stryker directive of its own, which would undo the division into parts.`,
      );
    }
    const starts = regionStarts(
      text,
      regions.map(({ from }) => from),
      file,
    );
    const insertions: { at: number; text: string }[] = [];
    let enabled = true;
    regions.forEach((region, index) => {
      const owned = region.shard === shard;
      if (owned !== enabled) {
        insertions.push({
          at: starts[index] as number,
          text: owned ? RESTORE : DISABLE,
        });
        enabled = owned;
      }
    });
    let marked = text;
    for (const { at, text: directive } of insertions.reverse()) {
      marked = `${marked.slice(0, at)}${directive}${marked.slice(at)}`;
    }
    result.push({ file, text: marked });
  }
  return result;
}

async function main() {
  const [command, half, part] = process.argv.slice(2);
  const division = readDivision();
  if (command === 'check') {
    for (const [name, { configuration, regions }] of Object.entries(
      division.halves,
    )) {
      const files = await mutatedFiles(configuration);
      for (const file of regions.keys()) {
        if (!files.includes(file)) {
          process.stdout.write(
            `${name}: ${file} is in the division and not in ${configuration}; no part reads it.\n`,
          );
        }
      }
      for (const file of files) {
        if (!regions.has(file)) {
          process.stdout.write(
            `${name}: ${file} is not in the division; the last part reads it whole.\n`,
          );
        }
      }
    }
    if (division.problems.length > 0) fail(division.problems.join('\n'));
    process.stdout.write(
      `Mutation parts verified: ${Object.entries(division.halves)
        .map(
          ([name, { count, regions }]) =>
            `${name} ${count} part(s) over ${regions.size} file(s)`,
        )
        .join(
          ', ',
        )}, each file covered once from its first line to its last.\n`,
    );
    return;
  }
  if (division.problems.length > 0) fail(division.problems.join('\n'));
  if (command === 'matrix') {
    process.stdout.write(
      `${JSON.stringify(
        Object.fromEntries(
          Object.entries(division.halves).map(([name, { count }]) => [
            name,
            Array.from({ length: count }, (_, index) => index),
          ]),
        ),
      )}\n`,
    );
    return;
  }
  if (command === 'apply') {
    if (!process.argv.includes('--disposable-checkout')) {
      fail(
        'apply writes into the sources it reads; run it in a checkout that is thrown away after, and say so with --disposable-checkout.',
      );
    }
    const sources = await partSources(half as string, Number(part), division);
    for (const { file, text } of sources)
      writeFileSync(resolve(workspaceRoot, file), text);
    process.stdout.write(`${sources.map(({ file }) => file).join(',')}\n`);
    return;
  }
  fail(
    'Usage: node tools/mutation-shards.ts check | matrix | apply <half> <part> --disposable-checkout',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
