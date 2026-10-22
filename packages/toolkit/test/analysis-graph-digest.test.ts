import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  fingerprintCompilerInputs,
  type CompilerAnalysisInput,
} from '../src/compiler.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * What of an analysis request reaches the digest of the analysis graph.
 *
 * The root names, the handle type names and the compiler options decide which files the analysis
 * reads and how it reads them, so a change to any of them can change what it finds with no source
 * file edited. A later run compares this digest to decide whether anything moved; a field left out
 * of it is a change that run reports as none.
 */

const owner = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated/i18n',
};

const projectRoot = resolve('fixtures/semantic-analysis/scope-startup');

function graphDigest(
  analysis: Omit<CompilerAnalysisInput, 'projectRoot'>,
): string | undefined {
  return fingerprintCompilerInputs({
    owner,
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [],
    analysis: { projectRoot, ...analysis },
  }).inputs.find(({ identity }) => identity === 'analysis-graph')?.digest;
}

describe('the digest of the analysis graph', () => {
  const rootNames = ['src/app.ts', 'src/main.ts'];

  it('is one digest for the same root names in either order', () => {
    const forward = graphDigest({ rootNames });

    expect(forward).toMatch(/^sha256-/u);
    expect(graphDigest({ rootNames: [...rootNames].reverse() })).toBe(forward);
    // The control: a different set of root names is a different digest.
    expect(graphDigest({ rootNames: ['src/app.ts'] })).not.toBe(forward);
  });

  it('is one digest for a root name written relative to the project and written in full', () => {
    expect(
      graphDigest({ rootNames: [resolve(projectRoot, 'src/app.ts')] }),
    ).toBe(graphDigest({ rootNames: ['src/app.ts'] }));
  });

  it('moves when handle type names are passed, and when they change', () => {
    const bare = graphDigest({ rootNames });
    const named = graphDigest({ rootNames, typeNames: ['AppMessage'] });

    expect(named).not.toBe(bare);
    expect(graphDigest({ rootNames, typeNames: ['AppText'] })).not.toBe(named);
    expect(graphDigest({ rootNames, typeNames: [] })).not.toBe(bare);
  });

  it('is one digest for the same handle type names in either order', () => {
    expect(
      graphDigest({ rootNames, typeNames: ['AppText', 'AppMessage'] }),
    ).toBe(graphDigest({ rootNames, typeNames: ['AppMessage', 'AppText'] }));
  });

  it('moves when a projection of the compiler options is passed, and when it changes', () => {
    const bare = graphDigest({ rootNames });
    const strict = graphDigest({
      rootNames,
      compilerOptionsDigestInput: { strict: true },
    });

    expect(strict).not.toBe(bare);
    expect(
      graphDigest({ rootNames, compilerOptionsDigestInput: { strict: false } }),
    ).not.toBe(strict);
    expect(graphDigest({ rootNames, compilerOptionsDigestInput: {} })).not.toBe(
      bare,
    );
  });
});
