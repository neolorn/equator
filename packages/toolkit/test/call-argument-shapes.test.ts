import { describe, expect, it } from 'vitest';

import {
  applyAuthoredChangePlan,
  checkProject,
  cleanProject,
  compileProject,
  compileProjectFromDisk,
  createMigrationPlan,
  createPseudoCatalog,
  diffCatalogSets,
  exportXliff22,
  extensionDescriptor,
  formatCatalog,
  formatProject,
  generateProject,
  importXliff22,
  initializeProject,
  parseCatalog,
  parseConfiguration,
  planMessageRefactor,
  uninstallProject,
  watchProject,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * A call whose arguments are not the documented shape.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 2 has such a call thrown as a `TypeError` that
 * names the function and the argument, and the type received and never the value. Each case hands
 * one entry point one argument of the wrong kind and reads the name back out of the message.
 */

const owner = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated/i18n',
};

const identity = {
  role: 'source' as const,
  providerId: '@example/app',
  scopeId: 'shell',
  locale: 'en-US',
};

function request(change: object): never {
  return {
    owner,
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [],
    ...change,
  } as never;
}

const SECRET = 'value-that-must-not-be-repeated';

const synchronous: readonly (readonly [string, () => unknown])[] = [
  [
    'compileProject: request must be an object, not undefined.',
    () => compileProject(undefined as never),
  ],
  [
    'compileProject: request.configuration must be an object, not a string.',
    () => compileProject(request({ configuration: SECRET })),
  ],
  [
    'compileProject: request.catalogs must be an array, not an object.',
    () => compileProject(request({ catalogs: {} })),
  ],
  [
    'compileProject: request.catalogs[0] must be an object, not null.',
    () => compileProject(request({ catalogs: [null] })),
  ],
  [
    'compileProject: request.owner.providerId must be a string, not a number.',
    () => compileProject(request({ owner: { ...owner, providerId: 7 } })),
  ],
  [
    'compileProject: request.owner.generatedRootPath must be well-formed Unicode, and holds an unpaired surrogate.',
    () =>
      compileProject(
        request({ owner: { ...owner, generatedRootPath: 'src/\ud800' } }),
      ),
  ],
  [
    'compileProject: request.analysis.rootNames[1] must be a string, not an array.',
    () =>
      compileProject(
        request({ analysis: { projectRoot: '.', rootNames: ['a.ts', []] } }),
      ),
  ],
  [
    'compileProject: request.analysis.sources[0].contents must be a string, not a number.',
    () =>
      compileProject(
        request({
          analysis: {
            projectRoot: '.',
            rootNames: [],
            sources: [{ path: 'a.ts', contents: 7 }],
          },
        }),
      ),
  ],
  [
    'compileProject: request.analysis.typeNames[0] must be a string, not a number.',
    () =>
      compileProject(
        request({
          analysis: { projectRoot: '.', rootNames: [], typeNames: [7] },
        }),
      ),
  ],
  [
    'compileProject: request.analysis.compilerOptionsDigestInput.target must be JSON data, not a function.',
    () =>
      compileProject(
        request({
          analysis: {
            projectRoot: '.',
            rootNames: [],
            compilerOptionsDigestInput: { target: () => SECRET },
          },
        }),
      ),
  ],
  [
    'compileProject: request.recoveryMessageIdentities must be an array, not a string.',
    () => compileProject(request({ recoveryMessageIdentities: SECRET })),
  ],
  [
    'compileProject: request.recoveryMessageIdentities[0] must be a string, not a number.',
    () => compileProject(request({ recoveryMessageIdentities: [7] })),
  ],
  [
    'compileProject: request.observability.emit must be a function, not undefined.',
    () => compileProject(request({ observability: {} })),
  ],
  [
    'parseCatalog: options must be an object, not undefined.',
    () => parseCatalog('messages: {}\n', undefined as never),
  ],
  [
    'parseCatalog: options.extensions.descriptors must be an array, not undefined.',
    () =>
      parseCatalog('messages: {}\n', { ...identity, extensions: {} as never }),
  ],
  [
    'parseConfiguration: options must be an object, not null.',
    () => parseConfiguration('{}', null as never),
  ],
  [
    'formatCatalog: catalog must be an object, not undefined.',
    () => formatCatalog(undefined as never),
  ],
  [
    'formatCatalog: options must be an object, not a string.',
    () => formatCatalog({} as never, SECRET as never),
  ],
  [
    'createPseudoCatalog: source must be an object, not a string.',
    () => createPseudoCatalog(SECRET as never, { locale: 'en-XA' } as never),
  ],
  [
    'createPseudoCatalog: options must be an object, not undefined.',
    () =>
      createPseudoCatalog(
        { ...identity, messages: {}, families: {} } as never,
        undefined as never,
      ),
  ],
  [
    'exportXliff22: request.source must be an object, not undefined.',
    () => exportXliff22({} as never),
  ],
  [
    'exportXliff22: request.target must be an object, not a number.',
    () => exportXliff22({ source: {}, target: 7 } as never),
  ],
  [
    'importXliff22: request must be an object, not an array.',
    () => importXliff22([] as never),
  ],
  [
    'importXliff22: request.source must be an object, not null.',
    () => importXliff22({ document: '', source: null } as never),
  ],
  [
    'diffCatalogSets: request.before must be an object, not undefined.',
    () => diffCatalogSets({} as never),
  ],
  [
    'diffCatalogSets: request.after.catalogs must be an array, not undefined.',
    () =>
      diffCatalogSets({
        before: { configuration: {}, catalogs: [] },
        after: { configuration: {} },
      } as never),
  ],
  [
    'diffCatalogSets: request.identityMoves[0].to must be a string, not undefined.',
    () =>
      diffCatalogSets({
        before: { configuration: {}, catalogs: [] },
        after: { configuration: {}, catalogs: [] },
        identityMoves: [{ from: 'a' }],
      } as never),
  ],
  [
    'planMessageRefactor: request.from must be an object, not undefined.',
    () => planMessageRefactor({} as never),
  ],
  [
    'planMessageRefactor: request.to.messageId must be a string, not a number.',
    () =>
      planMessageRefactor({
        from: { providerId: 'a', scopeId: 'b', messageId: 'c' },
        to: { providerId: 'a', scopeId: 'b', messageId: 7 },
      } as never),
  ],
  [
    'createMigrationPlan: request.changes must be an array, not undefined.',
    () =>
      createMigrationPlan({
        id: 'a',
        domain: 'catalog',
        fromVersion: '1',
        toVersion: '2',
      } as never),
  ],
  [
    'createMigrationPlan: request.changes[0].path must be well-formed Unicode, and holds an unpaired surrogate.',
    () =>
      createMigrationPlan({
        id: 'a',
        domain: 'catalog',
        fromVersion: '1',
        toVersion: '2',
        changes: [{ path: 'i18n/\udc00.yaml', after: '' }],
      } as never),
  ],
  [
    'extensionDescriptor: registry.descriptors must be an array, not a string.',
    () =>
      extensionDescriptor(
        { descriptors: SECRET } as never,
        'message-function',
        'demo:x',
      ),
  ],
];

const asynchronous: readonly (readonly [string, () => Promise<unknown>])[] = [
  [
    'applyAuthoredChangePlan: options.ownerRoot must be a string, not undefined.',
    () => applyAuthoredChangePlan({} as never),
  ],
  [
    'applyAuthoredChangePlan: options.plan.changes must be an array, not undefined.',
    () =>
      applyAuthoredChangePlan({
        ownerRoot: '.',
        plan: { profile: 'p', id: 'i', kind: 'k' },
      } as never),
  ],
  [
    'compileProjectFromDisk: selection.cwd must be a string, not a number.',
    () => compileProjectFromDisk({ cwd: 7 } as never),
  ],
  [
    'generateProject: options.dryRun must be a boolean, not a string.',
    () => generateProject({ dryRun: 'yes' } as never),
  ],
  [
    'checkProject: options.fix must be a boolean, not a number.',
    () => checkProject({ fix: 1 } as never),
  ],
  [
    'formatProject: options must be an object, not null.',
    () => formatProject(null as never),
  ],
  [
    'initializeProject: options must be an object, not undefined.',
    () => initializeProject(undefined as never),
  ],
  [
    'initializeProject: options.configuration must be an object, not a string.',
    () => initializeProject({ configuration: SECRET } as never),
  ],
  [
    'uninstallProject: options.catalogs must be a boolean, not a string.',
    () => uninstallProject({ catalogs: 'all' } as never),
  ],
  [
    'cleanProject: options.project must be a string, not an array.',
    () => cleanProject({ project: [] } as never),
  ],
  [
    'watchProject: options.signal must be an object, not undefined.',
    () => watchProject({} as never),
  ],
  [
    'watchProject: options.onCycle must be a function, not a string.',
    () =>
      watchProject({
        signal: new AbortController().signal,
        onCycle: SECRET,
      } as never),
  ],
];

describe('a call whose arguments are not the documented shape', () => {
  it.each(synchronous)('throws "%s"', (message, call) => {
    let thrown: unknown;
    try {
      call();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe(message);
  });

  it.each(asynchronous)('rejects with "%s"', async (message, call) => {
    const thrown: unknown = await call().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe(message);
  });

  it('names the type it received and never the value', () => {
    for (const [message] of [...synchronous, ...asynchronous]) {
      expect(message).not.toContain(SECRET);
    }
  });

  it('leaves a well-shaped call to be judged as content', () => {
    // The control: the same entry point, handed arguments of the right kinds whose content is
    // wrong, answers with diagnostics.
    const refused = compileProject(
      request({
        catalogs: [
          { ...identity, role: 'neither', messages: {}, families: {} },
        ],
      }),
    );
    expect(refused.ok).toBe(false);
    expect(parseCatalog(7, identity).ok).toBe(false);
  });
});
