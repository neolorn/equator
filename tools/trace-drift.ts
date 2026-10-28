import { existsSync, readFileSync } from 'node:fs';

import type { StageDeclaration } from './verify-stages.ts';

/**
 * A stage's declaration in `tools/verify-stages.ts` against what `tools/trace-artefacts.cts` saw it
 * do, compared in both directions.
 *
 * An artefact the stage touched and does not declare is an edge nobody drew, and a missing edge is a
 * race. An artefact it declares and never touched is a declaration nothing confirms: either an edge
 * the stage does not need, or an artefact the tracer cannot see. The two cannot be told apart
 * without looking, and the second is the dangerous one: a tree missing from the tracer's list leaves
 * every read and write declared on it compared with nothing, and a check that looks only for
 * undeclared artefacts has nothing to say about it.
 *
 * Here rather than inside `tools/verify.ts`, so the comparison the gate makes can be run on one
 * stage's trace without running the gate.
 */

/** One line of a trace, as `tools/trace-artefacts.cts` writes it. */
export interface TraceEntry {
  readonly pid: number;
  readonly kind: string;
  readonly artefact: string;
  readonly example: string;
}

/** One stage's trace, one entry per line; empty when the stage left none. */
export function readTrace(file: string): TraceEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TraceEntry);
}

/**
 * Every difference between the stage's declaration and its trace, one line each. A writer
 * implicitly reads, so a declared write covers a read of the same artefact, and a declared read is
 * confirmed by any touch at all: a stage that declares a read and writes instead is reported by the
 * write it does not declare.
 */
export function traceDrift(
  step: Pick<StageDeclaration, 'id' | 'reads' | 'writes'>,
  entries: readonly TraceEntry[],
): string[] {
  const reads = step.reads ?? [];
  const writes = step.writes ?? [];
  const declared = {
    read: new Set([...reads, ...writes]),
    write: new Set(writes),
  };
  const seen = { read: new Set<string>(), write: new Set<string>() };
  for (const entry of entries)
    (seen as Partial<Record<string, Set<string>>>)[entry.kind]?.add(
      entry.artefact,
    );
  const touched = new Set([...seen.read, ...seen.write]);

  const drift: string[] = [];
  for (const kind of ['read', 'write'] as const) {
    for (const artefact of seen[kind]) {
      if (!declared[kind].has(artefact))
        drift.push(
          `${step.id} ${kind}s ${artefact}, which it does not declare`,
        );
    }
  }
  for (const artefact of reads) {
    if (!touched.has(artefact))
      drift.push(`${step.id} declares a read of ${artefact} and never read it`);
  }
  for (const artefact of writes) {
    if (!seen.write.has(artefact))
      drift.push(
        `${step.id} declares a write of ${artefact} and never wrote it`,
      );
  }
  return drift;
}
