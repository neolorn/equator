import { describe, expect, it, vi } from 'vitest';

import { fingerprintCompilerInputs } from '../src/compiler.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * An analysis input whose file name holds backslashes.
 *
 * A compilation's state names its inputs with forward slashes, whatever the machine that wrote it
 * uses. Under POSIX rules a backslash is an ordinary character of a file name, and under Windows
 * rules it separates two names, so a name that holds one is not the same file on both and cannot
 * be written the portable way. It is refused on every platform, as a file Windows could not hold
 * is.
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

describe('an analysis input whose file name holds a backslash', () => {
  it.each([
    ['one backslash', 'src\\main.ts'],
    ['one backslash, under an absolute name', '/work/app/src/pages\\main.ts'],
    ['two backslashes in a row', 'src/pages\\\\main.ts'],
    ['a backslash after a slash', 'src/\\main.ts'],
    ['a backslash at its end', '/work/app/src/main.ts\\'],
  ])('is refused when its name holds %s', (_what, path) => {
    expect(() => identities(path, 'root name')).toThrow(TypeError);
    expect(() => identities(path, 'root name')).toThrow(ROOT_NAME);
    expect(() => identities(path, 'source')).toThrow(TypeError);
    expect(() => identities(path, 'source')).toThrow(SOURCE);
  });

  it('is named with forward slashes when no segment of it is empty', () => {
    // The control: the same rules accept a name whose every segment holds something.
    expect(identities('/work/app/src/main.ts', 'source')).toContain(
      'source:src/main.ts',
    );
    expect(identities('src/main.ts', 'root name')).toContain('analysis-graph');
  });
});
