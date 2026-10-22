/**
 * What a stage worked around and still passed.
 *
 * A stage that meets a failure outside Equator, gets past it, and passes would otherwise leave no
 * trace of it, and a rate nobody can see is a rate nobody notices rising. The stage records each
 * occurrence here with a signature, and the verification suite carries them into the run's summary,
 * its attempt ledger and its verdict line.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

/** The file a stage appends its occurrences to, handed to it by the suite. */
export const OCCURRENCES_FILE_VARIABLE = 'EQUATOR_OCCURRENCES_FILE';

/**
 * Record one occurrence. Written to standard error as well, so a stage run by hand, which has no
 * file to write to, still says what happened.
 */
export function recordOccurrence(
  { kind, signature, detail },
  environment = process.env,
) {
  const occurrence = {
    at: new Date().toISOString(),
    kind,
    signature,
    ...(detail === undefined ? {} : { detail }),
  };
  process.stderr.write(`=== OCCURRENCE ${kind}: ${signature}\n`);
  const file = environment[OCCURRENCES_FILE_VARIABLE];
  if (file !== undefined && file !== '') {
    appendFileSync(file, `${JSON.stringify(occurrence)}\n`);
  }
  return occurrence;
}

/** Every occurrence a stage recorded, oldest first; none when it recorded nothing. */
export function readOccurrences(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/** Every stage's occurrences, in stage order, each carrying the stage it came from. */
export const collectOccurrences = (stageIds, fileOf) =>
  stageIds.flatMap((stage) =>
    readOccurrences(fileOf(stage)).map((occurrence) => ({
      stage,
      ...occurrence,
    })),
  );

/** What the attempt ledger keeps of each: enough to count one signature across runs. */
export const ledgerOccurrences = (occurrences) =>
  occurrences.map(({ stage, kind, signature }) => ({ stage, kind, signature }));

/** The verdict line's mention of them, empty when there were none. */
export const verdictOccurrences = (occurrences) =>
  occurrences.length > 0
    ? `, ${occurrences.length} occurrence(s) worked around`
    : '';
