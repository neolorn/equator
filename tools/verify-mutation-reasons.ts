/**
 * The surviving mutants nobody will write a test for, each with its reason.
 *
 * `stryker.config.mjs` runs on request and outside the gate. A mutant its suites execute and do not
 * notice is either a line no test can see fail, which is answered with a test, or a change no test
 * could notice, which is answered here: `tools/mutation-reasons.json` lists each of those by the
 * file, the mutator, the text it replaced and the replacement, under one of a closed set of
 * categories and with a sentence about that site.
 *
 * Without arguments this is the gate's half. It reads no report, so it cannot say a listed mutant
 * still survives; it says the entry still describes the source: the file exists, the text the
 * mutant replaced is still in it as often as the entry counts, the category is one the file
 * declares, and the reason is written. An entry whose text has gone is refused, so an edit to a
 * line with a recorded mutant has to look at the record.
 *
 * With `--report <stryker json>...` it is the reading's half, and it takes every report of the
 * reading together: the runtime's and the toolkit's, or one per module where a half is read in
 * parts. Every survivor in them must have an entry. A survivor is a verdict only where every test
 * planned for the mutant ran: a runner that stops a mutant's tests at the first failure scores a
 * run cut short with no failure recorded as survived, with fewer tests completed than planned.
 * Both configurations set `disableBail`, so a report that carries such a mutant was not taken
 * with them, and it is refused.
 *
 * Every entry must in turn be a survivor in one of the reports, as many times as it counts. An
 * entry the reading scored another way describes a mutant a test notices or a line the suites do
 * not reach, so its reason answers nothing, and it is refused with the scores the reports give
 * that mutant. An entry whose file no report holds is refused the same way, which is why the
 * reports are read together and not one at a time.
 *
 * Usage: node tools/verify-mutation-reasons.ts [--report <path>...]
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { inputsRoot } from './stage-self-test.ts';

/** The fields that identify a mutant, whatever the record holds in them. */
interface MutantKey {
  readonly file?: unknown;
  readonly mutator?: unknown;
  readonly original?: unknown;
  readonly replacement?: unknown;
}

/** One entry of `tools/mutation-reasons.json`, unchecked until this file checks it. */
interface SurvivorEntry extends MutantKey {
  readonly category?: unknown;
  readonly reason?: unknown;
  readonly count?: unknown;
}

interface ReasonsRecord {
  readonly categories?: Readonly<Record<string, unknown>>;
  readonly survivors?: readonly SurvivorEntry[];
}

interface RecordedEntry extends SurvivorEntry {
  readonly count: number;
  readonly where: string;
}

interface ReportPosition {
  readonly line: number;
  readonly column: number;
}

/** The parts of a Stryker JSON report this reads. */
interface MutationReport {
  readonly files: Readonly<
    Record<
      string,
      {
        readonly source: string;
        readonly mutants: readonly {
          readonly mutatorName: string;
          readonly replacement?: string;
          readonly status: string;
          readonly testsCompleted?: number;
          readonly coveredBy?: readonly string[];
          readonly location: {
            readonly start: ReportPosition;
            readonly end: ReportPosition;
          };
        }[];
      }
    >
  >;
}

const root = inputsRoot();
const RECORD = 'tools/mutation-reasons.json';
// A mutant that replaces a whole block is identified by the start of it; the rest is the block's
// body, which the entry would otherwise have to repeat in full.
export const ORIGINAL_LIMIT = 400;
const MINIMUM_REASON = 40;

const record = JSON.parse(
  readFileSync(resolve(root, RECORD), 'utf8'),
) as ReasonsRecord;
const failures: string[] = [];
const fail = (message: string): number => failures.push(message);
const keyOf = ({ file, mutator, original, replacement }: MutantKey): string =>
  JSON.stringify([file, mutator, original, replacement]);
const occurrences = (text: string, part: string): number =>
  text.split(part).length - 1;

const categories = new Map<unknown, unknown>(
  Object.entries(record.categories ?? {}),
);
const used = new Set<unknown>();
const entries = new Map<string, RecordedEntry>();
const sources = new Map<string, string | undefined>();
const sourceOf = (file: string): string | undefined => {
  if (!sources.has(file)) {
    const path = resolve(root, file);
    sources.set(
      file,
      existsSync(path)
        ? readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
        : undefined,
    );
  }
  return sources.get(file);
};

for (const [index, entry] of (record.survivors ?? []).entries()) {
  const where = `${RECORD} survivors[${index}] (${entry.file}, ${entry.mutator})`;
  for (const field of ['file', 'mutator', 'original', 'replacement'] as const) {
    if (typeof entry[field] !== 'string') {
      fail(`${where}: ${field} is not written.`);
    }
  }
  if (!categories.has(entry.category)) {
    fail(
      `${where}: the category ${entry.category} is not one the file declares.`,
    );
  }
  used.add(entry.category);
  if (
    typeof entry.reason !== 'string' ||
    entry.reason.trim().length < MINIMUM_REASON
  ) {
    fail(`${where}: the reason is not written.`);
  }
  const count = (entry.count ?? 1) as number;
  if (!Number.isInteger(count) || count < 1) {
    fail(`${where}: the count is not a positive whole number.`);
  }
  if (
    typeof entry.original === 'string' &&
    entry.original.length > ORIGINAL_LIMIT
  ) {
    fail(
      `${where}: the replaced text is longer than ${ORIGINAL_LIMIT} characters.`,
    );
  }
  const key = keyOf(entry);
  if (entries.has(key)) fail(`${where}: the same mutant is listed twice.`);
  entries.set(key, { ...entry, count, where });
  if (typeof entry.file !== 'string' || typeof entry.original !== 'string')
    continue;
  const source = sourceOf(entry.file);
  if (source === undefined) {
    fail(`${where}: the file does not exist.`);
  } else if (occurrences(source, entry.original) < count) {
    fail(
      `${where}: the text the mutant replaced is in the file ${occurrences(source, entry.original)} time(s), the entry counts ${count}.`,
    );
  }
}
for (const id of categories.keys()) {
  if (!used.has(id)) fail(`${RECORD}: the category ${id} has no entry.`);
}

// Every argument after `--report` up to the next option is a report.
const reportPaths: string[] = [];
for (
  let index = process.argv.indexOf('--report') + 1;
  index > 0 &&
  index < process.argv.length &&
  !(process.argv[index] as string).startsWith('--');
  index += 1
) {
  reportPaths.push(process.argv[index] as string);
}
let read = '';
if (process.argv.includes('--report')) {
  if (reportPaths.length === 0) fail('--report names no report.');
  const seen = new Map<string, number>();
  // How the reports score each mutant, so a refused entry says what its mutant did instead of
  // surviving.
  const scores = new Map<string, Map<string, number>>();
  const reportOf = new Map<unknown, string>();
  let survivors = 0;
  let unsettled = 0;
  for (const reportPath of reportPaths) {
    const report = JSON.parse(
      readFileSync(resolve(reportPath), 'utf8'),
    ) as MutationReport;
    for (const [file, { source, mutants }] of Object.entries(report.files)) {
      if (reportOf.has(file)) {
        fail(
          `${file} is in two reports, ${reportOf.get(file)} and ${reportPath}, so they are not one reading.`,
        );
        continue;
      }
      reportOf.set(file, reportPath);
      const lines = source.replaceAll('\r\n', '\n').split('\n');
      const starts = [0];
      for (const line of lines)
        starts.push((starts.at(-1) as number) + line.length + 1);
      const offset = ({ line, column }: ReportPosition): number =>
        (starts[line - 1] as number) + column - 1;
      const text = lines.join('\n');
      for (const mutant of mutants) {
        const key = keyOf({
          file,
          mutator: mutant.mutatorName,
          original: text
            .slice(offset(mutant.location.start), offset(mutant.location.end))
            .slice(0, ORIGINAL_LIMIT),
          replacement: mutant.replacement ?? '',
        });
        const cutShort =
          mutant.status === 'Survived' &&
          (mutant.testsCompleted ?? 0) < (mutant.coveredBy ?? []).length;
        const score = cutShort ? 'no verdict' : mutant.status;
        const byScore = scores.get(key) ?? new Map<string, number>();
        byScore.set(score, (byScore.get(score) ?? 0) + 1);
        scores.set(key, byScore);
        if (mutant.status !== 'Survived') continue;
        if (cutShort) {
          unsettled += 1;
          fail(
            `${file}:${mutant.location.start.line} ${mutant.mutatorName} is scored as survived with ${mutant.testsCompleted ?? 0} of ${(mutant.coveredBy ?? []).length} planned tests run, which is no verdict. Take the reading with disableBail.`,
          );
          continue;
        }
        survivors += 1;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        const entry = entries.get(key);
        if (entry === undefined || (seen.get(key) as number) > entry.count) {
          fail(
            `${file}:${mutant.location.start.line} ${mutant.mutatorName} survived and has no reason: ${JSON.parse(key)[2].slice(0, 80)} => ${(mutant.replacement ?? '').slice(0, 60)}`,
          );
        }
      }
    }
  }
  for (const [key, entry] of entries) {
    const survived = seen.get(key) ?? 0;
    if (survived >= entry.count) continue;
    const mutant =
      `${String(entry.original).slice(0, 80)} => ${String(entry.replacement).slice(0, 60)}`.replaceAll(
        '\n',
        ' ',
      );
    if (!reportOf.has(entry.file)) {
      fail(
        `${entry.where}: the file is in no report given, so nothing shows the mutant survives: ${mutant}`,
      );
      continue;
    }
    const others = [...(scores.get(key) ?? [])]
      .filter(([score]) => score !== 'Survived')
      .map(([score, places]) => `${score} ${places}`)
      .sort();
    fail(
      `${entry.where}: the entry counts ${entry.count} and the reports score ${survived} as survived (${others.length === 0 ? 'no other mutant has this text' : `scored otherwise: ${others.join(', ')}`}): ${mutant}`,
    );
  }
  read = `, ${survivors} survivor(s) in ${reportPaths.length} report(s), ${unsettled} more with no verdict`;
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.stderr.write(
    `verify:mutation-reasons failed: ${failures.length} finding(s).\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `verify:mutation-reasons passed: ${entries.size} recorded mutant(s) in ${sources.size} file(s), ${categories.size} categories${read}.\n`,
  );
}
