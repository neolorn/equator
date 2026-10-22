import { describe, expect, it } from 'vitest';

import {
  compileProject,
  parseCatalog,
  type Catalog,
  type CompileProjectRequest,
  type CompileProjectResult,
  type CompilerState,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * What a compilation says moved since the state it was handed.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 2: the core takes the previous compiler state and
 * returns an invalidation decision. The state names its inputs one by one, so the next run can say
 * which of them changed and which outputs that puts in question.
 */

function catalog(scopeId: string, title: string): Catalog {
  const parsed = parseCatalog(
    ['messages:', `  app-title: ${title}`, ''].join('\n'),
    {
      role: 'source',
      providerId: '@example/app',
      scopeId,
      locale: 'en-US',
      sourcePath: `i18n/${scopeId}/en-US.yaml`,
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function compiled(
  catalogs: readonly Catalog[],
  previousState?: CompilerState,
): CompileProjectResult {
  const request: CompileProjectRequest = {
    owner: {
      providerId: '@example/app',
      generatedRootPath: 'src/generated/i18n',
    },
    configuration: testProjectConfiguration(['en-US']),
    catalogs,
    ...(previousState === undefined ? {} : { previousState }),
  };
  const result = compileProject(request);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const SHELL = 'catalog:@example/app:shell:en-US:source';
const ACCOUNT = 'catalog:@example/app:account:en-US:source';

describe('the invalidation a compilation reports against a previous state', () => {
  it('names nothing when every input is the one the state recorded', () => {
    const first = compiled([catalog('shell', 'Probe')]);
    const second = compiled([catalog('shell', 'Probe')], first.state);

    expect(second.invalidation).toEqual({
      kind: 'none',
      changedInputs: [],
      affectedOutputs: [],
    });
  });

  it('names the changed catalog and every planned output when one catalog moved', () => {
    const first = compiled([catalog('shell', 'Probe')]);
    const second = compiled([catalog('shell', 'Probe, reworded')], first.state);

    expect(second.invalidation.kind).toBe('inputs-changed');
    expect(second.invalidation.changedInputs).toEqual([SHELL]);
    expect(second.invalidation.affectedOutputs.length).toBeGreaterThan(0);
    expect(second.invalidation.affectedOutputs).toEqual(
      second.artifacts.outputPlan.files.map(({ path }) => path),
    );
  });

  it('lists the changed inputs in code point order, an added one among them', () => {
    const first = compiled([catalog('shell', 'Probe')]);
    // The added scope sorts before the one the state already knew.
    const second = compiled(
      [catalog('shell', 'Probe, reworded'), catalog('account', 'Account')],
      first.state,
    );

    expect(second.invalidation.changedInputs).toEqual([ACCOUNT, SHELL]);
  });

  it('reads a state stamped by another compiler as no state at all', () => {
    const first = compiled([catalog('shell', 'Probe')]);
    const foreign = {
      ...first.state,
      profile: 'equator-compiler-state/0',
    } as unknown as CompilerState;
    const second = compiled([catalog('shell', 'Probe')], foreign);

    // The inputs are the ones the state lists, so only the stamp can make this an initial run.
    expect(second.invalidation.kind).toBe('initial');
    expect(second.invalidation.changedInputs).toEqual(
      second.state.inputs.map(({ identity }) => identity),
    );
    expect(second.invalidation.affectedOutputs).toEqual(
      second.artifacts.outputPlan.files.map(({ path }) => path),
    );
  });
});
