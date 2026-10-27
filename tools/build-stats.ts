/**
 * The module graph an Angular build wrote with `--stats-json`, whichever way it was written.
 *
 * `@angular/build` writes one `stats.json` through 22.1, whether or not the application has a
 * server. From 22.2 it writes `browser-stats.json`, and `server-stats.json` beside it for an
 * application with a server. The rows of the consumer matrix install both sides of that change, so
 * the readers ask here and get one graph either way.
 *
 * The two files are merged rather than one of them chosen. A browser output and a server output
 * never share a name, the first being `.js` and the second `.mjs`, and an input both builds read is
 * the same source file with the same imports, so nothing in one overwrites a different fact in the
 * other.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BuildStatsImport {
  readonly path: string;
  readonly kind?: string;
  readonly external?: boolean;
}

export interface BuildStatsInput {
  readonly bytes?: number;
  readonly imports?: readonly BuildStatsImport[];
}

export interface BuildStatsOutput {
  readonly bytes?: number;
  readonly entryPoint?: string;
  readonly imports?: readonly BuildStatsImport[];
  readonly inputs?: Readonly<
    Record<string, { readonly bytesInOutput?: number }>
  >;
}

export interface BuildStats {
  readonly inputs: Record<string, BuildStatsInput>;
  readonly outputs: Record<string, BuildStatsOutput>;
}

const SPLIT = ['browser-stats.json', 'server-stats.json'];

/** The stats files a build left in its output directory, in the order they are merged. */
export function buildStatsFiles(outputDirectory: string): string[] {
  const single = resolve(outputDirectory, 'stats.json');
  if (existsSync(single)) return [single];
  return SPLIT.map((name) => resolve(outputDirectory, name)).filter((path) =>
    existsSync(path),
  );
}

/** One `{ inputs, outputs }` graph, or `undefined` when the build wrote no stats at all. */
export function readBuildStats(
  outputDirectory: string,
): BuildStats | undefined {
  const files = buildStatsFiles(outputDirectory);
  if (files.length === 0) return undefined;
  const merged: BuildStats = { inputs: {}, outputs: {} };
  for (const file of files) {
    const stats = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildStats>;
    Object.assign(merged.inputs, stats.inputs);
    Object.assign(merged.outputs, stats.outputs);
  }
  return merged;
}
