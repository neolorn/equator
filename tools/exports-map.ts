/**
 * The subpaths a package's `exports` map opens, for every tool that lists a package's entry points.
 *
 * A `null` target closes a subpath: Node throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for it (the
 * "Subpath patterns" section of Node's packages documentation). A reader that takes every key as an
 * entry point measures, documents and imports a subpath no consumer can reach, and fails on the
 * `null` it was never written to expect. One reader means a closed subpath is skipped by all of
 * them or by none.
 *
 * A pattern key opens subpaths the map does not name, so it cannot be listed, and a map keyed by
 * conditions rather than subpaths has no subpaths to list. Both are refused rather than read as
 * something else.
 */

/** A target an open subpath resolves to: a path, or conditions leading to one. */
export type ExportTarget = string | Readonly<Record<string, unknown>>;

/** One subpath the map opens, and the specifier a consumer imports it by. */
export interface OpenSubpath {
  readonly subpath: string;
  readonly specifier: string;
  readonly target: ExportTarget;
  /** Whether the subpath names a JSON file, which is imported with a type attribute. */
  readonly json: boolean;
}

/** What the reader needs of a manifest, as parsed and not yet checked. */
export interface ExportingManifest {
  readonly name?: unknown;
  readonly exports?: unknown;
}

// Conditions are closed when every one of them is: whichever condition a resolver matches, it
// arrives at `null`.
function closes(target: unknown): boolean {
  if (target === null) return true;
  if (typeof target !== 'object' || Array.isArray(target)) return false;
  const conditions = Object.values(target);
  return conditions.length > 0 && conditions.every(closes);
}

/** Every subpath `manifest.exports` opens, in the map's order, with the closed ones left out. */
export function openSubpaths(manifest: ExportingManifest): OpenSubpath[] {
  const { name, exports } = manifest;
  if (typeof name !== 'string' || name === '') {
    throw new Error(
      'A manifest names no package, so its subpaths have no specifier.',
    );
  }
  if (
    typeof exports !== 'object' ||
    exports === null ||
    Array.isArray(exports)
  ) {
    throw new Error(`${name} declares no exports map of subpaths.`);
  }
  const open: OpenSubpath[] = [];
  for (const [subpath, target] of Object.entries(exports)) {
    if (subpath !== '.' && !subpath.startsWith('./')) {
      throw new Error(
        `${name} keys its exports map by ${JSON.stringify(subpath)}, which is a condition, not a subpath.`,
      );
    }
    if (subpath.includes('*')) {
      throw new Error(
        `${name} exports the pattern ${subpath}, which opens subpaths the map does not name.`,
      );
    }
    if (closes(target)) continue;
    if (
      typeof target !== 'string' &&
      (typeof target !== 'object' || Array.isArray(target))
    ) {
      throw new Error(
        `${name} exports ${subpath} as ${JSON.stringify(target)}, which is neither a path nor conditions.`,
      );
    }
    open.push({
      subpath,
      specifier: subpath === '.' ? name : `${name}/${subpath.slice(2)}`,
      target: target as ExportTarget,
      json: subpath.endsWith('.json'),
    });
  }
  return open;
}
