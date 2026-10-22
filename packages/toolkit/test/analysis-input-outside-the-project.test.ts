import { describe, expect, it, vi } from 'vitest';

import { fingerprintCompilerInputs } from '../src/compiler.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * An analysis input that is not under the project.
 *
 * A compilation's state names its inputs relative to the project, so that a state written on one
 * machine is usable on another. A file above the project has a name that climbs out of it, and a
 * file on another drive has no relative name at all: the path from the project to it is the
 * absolute path itself, with no `..` in it to give it away. Taken as a name, either would put one
 * machine's layout into the state.
 */

// Another drive exists only under Windows path rules, so the compiler is given those rules on
// every platform.
vi.mock('node:path', async (original) => {
  const actual = await original<typeof import('node:path')>();
  return { ...actual.win32, default: actual.win32 };
});

const owner = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated/i18n',
};

const projectRoot = 'F:\\work\\app';

// The refusal names the member of the request that named the file.
const ROOT_NAME =
  'compileProject: request.analysis.rootNames[0] must be a file inside request.analysis.projectRoot';
const SOURCE =
  'compileProject: request.analysis.sources[0].path must be a file inside request.analysis.projectRoot';

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

describe('an analysis input outside the project', () => {
  it.each([
    ['on another drive', 'C:\\elsewhere\\main.ts'],
    ['beside the project', 'F:\\work\\other\\main.ts'],
    ['beside the project, written relative to it', '..\\other\\main.ts'],
    ['that is the directory above the project', 'F:\\work'],
  ])('is refused when it is %s', (_where, path) => {
    expect(() => identities(path, 'root name')).toThrow(TypeError);
    expect(() => identities(path, 'root name')).toThrow(ROOT_NAME);
    expect(() => identities(path, 'source')).toThrow(TypeError);
    expect(() => identities(path, 'source')).toThrow(SOURCE);
  });

  it('is named relative to the project when it is inside it', () => {
    // The control: the same file name under the project is an input like any other.
    expect(identities('F:\\work\\app\\src\\main.ts', 'source')).toContain(
      'source:src/main.ts',
    );
    expect(identities('src\\main.ts', 'source')).toContain(
      'source:src/main.ts',
    );
    expect(identities('F:\\work\\app\\src\\main.ts', 'root name')).toContain(
      'analysis-graph',
    );
  });
});
