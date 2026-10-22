import { describe, expect, it, vi } from 'vitest';

import { fingerprintCompilerInputs } from '../src/compiler.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * An analysis input inside the project whose name cannot be carried to another machine.
 *
 * A compilation's state names its inputs relative to the project, with `/` between the segments,
 * and a later run compares those names as text. A name that is not in Normalization Form C has a
 * second spelling that reads the same, and a name whose segments are empty, `.` or `..` once its
 * backslashes are written as `/` no longer says which file it is.
 */

// A backslash is part of a file name only under POSIX path rules, so the compiler is given those
// rules on every platform.
vi.mock('node:path', async (original) => {
  const actual = await original<typeof import('node:path')>();
  return { ...actual.posix, default: actual.posix };
});

const owner = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated/i18n',
};

const projectRoot = '/work/app';

// The refusal names the member of the request that named the file.
const ROOT_NAME =
  'compileProject: request.analysis.rootNames[0] must be a portable file name under request.analysis.projectRoot';
const SOURCE =
  'compileProject: request.analysis.sources[0].path must be a portable file name under request.analysis.projectRoot';

/** The input identities of a compilation whose analysis has this one file as root and source. */
function identities(
  path: string,
  as: 'root name' | 'source',
): readonly string[] {
  return fingerprintCompilerInputs({
    owner,
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [],
    analysis:
      as === 'root name'
        ? { projectRoot, rootNames: [path] }
        : { projectRoot, rootNames: [], sources: [{ path, contents: '' }] },
  }).inputs.map(({ identity }) => identity);
}

describe('an analysis input whose name is not portable', () => {
  it.each([
    ['is not in Normalization Form C', 'src/cafe\u0301.ts'],
    ['has an empty segment between two backslashes', 'src\\\\main.ts'],
    ['has a backslash-separated segment that is a dot', 'src\\.\\main.ts'],
    ['has a backslash-separated segment that is two dots', 'src\\..\\main.ts'],
    ['is the project itself', '/work/app'],
  ])('is refused when it %s', (_what, path) => {
    expect(() => identities(path, 'root name')).toThrow(TypeError);
    expect(() => identities(path, 'root name')).toThrow(ROOT_NAME);
    expect(() => identities(path, 'source')).toThrow(TypeError);
    expect(() => identities(path, 'source')).toThrow(SOURCE);
  });

  it('is named as written when it is in Normalization Form C and every segment is a name', () => {
    // The control: the composed spelling of the refused name, and names that only begin with dots.
    expect(identities('src/caf\u00e9.ts', 'source')).toContain(
      'source:src/caf\u00e9.ts',
    );
    expect(identities('/work/app/src/.hidden/..main.ts', 'source')).toContain(
      'source:src/.hidden/..main.ts',
    );
    expect(identities('src/caf\u00e9.ts', 'root name')).toContain(
      'analysis-graph',
    );
  });
});
