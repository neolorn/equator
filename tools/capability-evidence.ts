/**
 * The file a stage's claims go to, and the two things that write it.
 *
 * A stage's claims are one file, named for the stage, and the gate hands a claiming stage its path
 * in `EQUATOR_CAPABILITY_CLAIMS`. A process with nothing in that variable records nothing, which is
 * what keeps a run under an injected defect out of the matrix: the stages that inject are never
 * handed a path. Every writer appends one line per record, so the suites, the drivers and the
 * command steps of one stage can all write to the same file.
 *
 * The file opens with a line from each writer, before any claim. A stage that recorded no claims
 * still leaves that line, which is how `verify:matrix` tells a stage whose checks assert nothing
 * it can name from a stage whose writer never ran.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import type { Reporter, TestCase, Vitest } from 'vitest/node';

import {
  CLAIMS_FILE_VARIABLE,
  CLAIMS_META_KEY,
  claimRecord,
  type CapabilityObservation,
  type ClaimsMeta,
} from './capability-claims.ts';

export const EVIDENCE_PROFILE = 'equator-capability-evidence/1';

/**
 * A claim as a stage's evidence file holds it: the record `claimRecord` built, the check that made
 * it, and the consumer row it ran in.
 */
export interface EvidenceClaim {
  readonly capability: string;
  readonly check: string;
  readonly node: string | null;
  readonly policy?: { readonly kind: string; readonly [flag: string]: unknown };
  readonly platform?: string;
  readonly document?: readonly string[];
  readonly adoptedElements?: number;
  readonly clientNavigations?: number;
  readonly engine?: { readonly name: string; readonly version: string };
  readonly angularRow?: string;
}

/** One stage's evidence, read back. */
export interface Evidence {
  readonly missing: boolean;
  readonly writers: string[];
  readonly claims: EvidenceClaim[];
  readonly unreadable: number[];
}

/** A line of an evidence file, before it is known to be a writer's line or a claim. */
interface EvidenceLine {
  readonly profile?: unknown;
  readonly writer?: unknown;
  readonly capability?: unknown;
  readonly check?: unknown;
}

const append = (file: string, record: object): void => {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
};

const opened = (file: string, writer: string): void =>
  append(file, {
    profile: EVIDENCE_PROFILE,
    writer,
    node: process.versions.node,
  });

/**
 * The vitest reporter that writes a suite's claims.
 *
 * A test holds its claims in its own metadata until it finishes (`capability-claims-in-tests.ts`).
 * This reads them from the final result and writes them only for a test that passed, so the state
 * that decides is the one vitest reports, after retries and after `fails` has been applied.
 */
export class CapabilityClaimsReporter implements Reporter {
  declare readonly file: string;
  declare readonly consumer: boolean | string;
  declare root: string | undefined;
  declare angularRow: string | undefined;

  constructor(
    file: string,
    { consumer = false }: { readonly consumer?: boolean | string } = {},
  ) {
    this.file = file;
    this.consumer = consumer;
    this.root = undefined;
    this.angularRow = undefined;
  }

  onInit(vitest: Vitest): void {
    // An application nested in the consumer names its checks from the consumer's root, so two
    // applications with a spec at the same path still make two checks.
    this.root =
      typeof this.consumer === 'string'
        ? resolve(vitest.config.root, this.consumer)
        : vitest.config.root;
    if (this.consumer) this.angularRow = consumerRow(this.root);
    opened(this.file, 'vitest');
  }

  onTestCaseResult(testCase: TestCase): void {
    const claims = (testCase.meta() as ClaimsMeta)[CLAIMS_META_KEY];
    if (!Array.isArray(claims) || claims.length === 0) return;
    if (testCase.result().state !== 'passed') return;
    // onInit sets the root before vitest reports any test.
    const module = relative(this.root as string, testCase.module.moduleId)
      .split(sep)
      .join('/');
    // A test in browser mode cannot ask its own engine what it is, and its user agent is a string
    // an engine chooses. The project it ran in holds the browser the provider launched, which
    // reports its own name and version the way a browser stage's driver does.
    const browser = (
      testCase.project.browser?.provider as
        | { readonly browser?: CapabilityObservation['engine'] | null }
        | undefined
    )?.browser;
    for (const claim of claims) {
      if (!(claim.assertions > 0)) continue;
      append(this.file, {
        ...claim,
        ...(browser == null
          ? {}
          : {
              engine: claimRecord(claim.capability, { engine: browser })[
                'engine'
              ],
            }),
        ...(this.angularRow === undefined
          ? {}
          : { angularRow: this.angularRow }),
        check: `${module} > ${testCase.fullName}`,
      });
    }
  }
}

/**
 * The reporters a suite runs with: vitest's own, and the claims reporter when the gate asked for
 * claims. Outside the gate a suite runs with vitest's reporter alone and reports nothing about
 * claims.
 *
 * `consumer` is for a suite running inside a materialized consumer, whose claims also carry the
 * consumer row it was built as: `true` when the suite runs at the consumer's root, or the path from
 * the suite's root to the consumer's when it belongs to an application nested inside it.
 */
export function capabilityClaimsReporters({
  consumer = false,
}: { readonly consumer?: boolean | string } = {}): (
  'default' | CapabilityClaimsReporter
)[] {
  const file = claimsFile();
  return file === undefined
    ? ['default']
    : ['default', new CapabilityClaimsReporter(file, { consumer })];
}

/**
 * The consumer row the consumer at `root` was built as, read from the stamp the materializer left
 * and held to what is installed.
 *
 * The stamp alone would say which row was asked for. Each version it names is checked against the
 * package in `node_modules`, so a consumer installed from another row's lock, or left over from
 * another row's run, fails here rather than crediting that row with what a different one ran.
 */
export function consumerRow(root: string): string {
  const stampPath = resolve(root, 'tools/consumer-row.json');
  if (!existsSync(stampPath)) {
    throw new Error(
      `${stampPath} is missing, so these claims cannot name the consumer row they ran in. Materialize the consumer again.`,
    );
  }
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  for (const [name, version] of Object.entries(stamp.versions)) {
    const installed = JSON.parse(
      readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'),
    ).version;
    if (installed !== version) {
      throw new Error(
        `The ${stamp.row} consumer names ${name} ${version}, and ${installed} is installed. Its claims would credit a row that did not run.`,
      );
    }
  }
  return stamp.row;
}

const claimsFile = (): string | undefined => {
  const file = process.env[CLAIMS_FILE_VARIABLE];
  return file === undefined || file === '' ? undefined : file;
};

// The consumer row the checks of this process drive, when they drive one.
let openedConsumerRow: string | undefined;

/**
 * Opens a check that is not a vitest test (a browser row's section, a command step, a Node row) as
 * a writer of its stage's claims. Called once when the check starts, before it has asserted
 * anything, so its stage shows the writer ran even when nothing it asserted can be named yet.
 *
 * `consumer` is the root of the materialized consumer the check drives. Its claims then carry the
 * row that consumer was built as, read the way the suite reporter reads it.
 */
export function openCapabilityEvidence(
  writer: string,
  { consumer }: { readonly consumer?: string } = {},
): void {
  const file = claimsFile();
  if (file === undefined) return;
  if (consumer !== undefined) openedConsumerRow = consumerRow(consumer);
  opened(file, writer);
}

/**
 * The claim such a check makes, after the section's assertions, as `claimCapability` is in a test.
 * Outside a claiming stage it records nothing.
 *
 * There is no assertion count to read here, and none is needed: a section that throws fails its
 * stage, and a failed stage leaves `verify:matrix` skipped rather than reading what it wrote.
 */
export function recordCapabilityClaim(
  check: string,
  capability: string,
  observed?: CapabilityObservation,
): void {
  const file = claimsFile();
  if (file === undefined) return;
  append(file, {
    ...claimRecord(capability, observed),
    ...(openedConsumerRow === undefined
      ? {}
      : { angularRow: openedConsumerRow }),
    check,
  });
}

/**
 * One stage's evidence, read back: whether its writers ran, and every claim it recorded.
 *
 * Returns `missing` when there is no file, and names every line that is not a record, because a
 * line nobody can read is a claim the matrix would otherwise drop without saying so.
 */
export function readEvidence(file: string): Evidence {
  if (!existsSync(file))
    return { missing: true, writers: [], claims: [], unreadable: [] };
  const writers: string[] = [];
  const claims: EvidenceClaim[] = [];
  const unreadable: number[] = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      let record: EvidenceLine;
      try {
        record = JSON.parse(line) as EvidenceLine;
      } catch {
        unreadable.push(index + 1);
        return;
      }
      if (
        record.profile === EVIDENCE_PROFILE &&
        typeof record.writer === 'string'
      ) {
        writers.push(record.writer);
      } else if (
        typeof record.capability === 'string' &&
        typeof record.check === 'string'
      ) {
        claims.push(record as EvidenceClaim);
      } else {
        unreadable.push(index + 1);
      }
    });
  return { missing: false, writers, claims, unreadable };
}
