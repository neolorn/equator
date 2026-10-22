import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  TOOLKIT_EVENT_CODES,
  TOOLKIT_OBSERVABILITY_PROFILE,
  checkProject,
  generateProject,
  watchProject,
  type ToolkitObservabilityEvent,
} from '../src/index.js';
import { COMPILER_CACHE_PATH } from '../src/output-host.js';
import { RESOURCE_LIMITS } from '../src/resource-limits.js';
import {
  cleanProject,
  formatProject,
  initializeProject,
} from '../src/project-host.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

const temporaryRoots: string[] = [];

async function temporaryProject(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function writeProjectFile(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}

async function createPackage(root: string): Promise<void> {
  await writeProjectFile(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@example/host-fixture',
        version: '0.0.0',
        private: true,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  );
}

async function createInitializedProject(root: string): Promise<void> {
  await createPackage(root);
  const initialized = await initializeProject({
    project: root,
    configuration: {
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    },
  });
  expect(initialized.ok).toBe(true);
  await writeProjectFile(
    root,
    'i18n/shell/en-US.yaml',
    [
      'messages:',
      '  app-title: Equator host fixture',
      "  welcome: 'Welcome, {$name}!'",
      '  recovery.unavailable: Localization is temporarily unavailable.',
      '',
    ].join('\n'),
  );
  await writeProjectFile(
    root,
    'i18n/shell/ar-EG.yaml',
    [
      'messages:',
      '  app-title: تطبيق Equator',
      "  welcome: 'مرحبًا، {$name}!'",
      '  recovery.unavailable: الترجمة غير متاحة مؤقتًا.',
      '',
    ].join('\n'),
  );
  await writeProjectFile(
    root,
    'tsconfig.app.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'preserve',
          moduleResolution: 'bundler',
          resolvePackageJsonImports: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await writeProjectFile(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      '',
      'export const title = messages.appTitle.messageId;',
      '',
    ].join('\n'),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('Equator standalone project host', () => {
  it('initializes compatible setup idempotently and refuses mapping conflicts', async () => {
    const root = await temporaryProject('init-');
    await createPackage(root);

    const first = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
        aliases: { en: 'en-US' },
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.changed).toBe(true);
    expect(first.value.files).toEqual([
      'equator.config.json',
      'i18n',
      'package.json',
    ]);

    // `init` writes containers and never content, so the catalog directory it just made has to
    // be empty: no example message, no placeholder, nothing that would put Equator's words in a
    // consumer's product. `init` writes no catalog at all, so the assertion is at the directory.
    expect(await readdir(resolve(root, 'i18n'))).toEqual([]);

    // And because it writes neither, it names both. The first catalog was already named at the next
    // `generate`, by `EQ1702`; the recovery message was named by nothing until `EQ1310` refused a
    // build, by which time the reader has composed `provideLocalization` believing every feature
    // optional. Asserted on the substrings a reader needs rather than on the sentence, so rewording
    // is free and dropping either half is not.
    const guidance = first.diagnostics.find(({ code }) => code === 'EQ1706');
    expect(guidance?.severity).toBe('info');
    expect(guidance?.summary).toContain('i18n/shell/en-US.yaml');
    expect(guidance?.summary).toContain('withRecoveryMessage');

    const second = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
        aliases: { en: 'en-US' },
      },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.changed).toBe(false);

    const manifest = JSON.parse(
      await readFile(resolve(root, 'package.json'), 'utf8'),
    ) as Record<string, Record<string, string>>;
    expect(manifest['imports']).toEqual({
      '#i18n': './src/generated/i18n/index.ts',
      '#i18n/*': './src/generated/i18n/*.ts',
    });
    expect(manifest['scripts']?.['equator:generate']).toBe('equator generate');
    manifest['imports'] = {
      ...manifest['imports'],
      '#i18n': './consumer-owned.ts',
    };
    await writeFile(
      resolve(root, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    const conflict = await initializeProject({ project: root });
    expect(conflict.ok).toBe(false);
    expect(conflict.diagnostics[0]?.code).toBe('EQ1705');
    claimCapability('cli:init');
  });

  it('never selects a configuration above the package it is standing in', async () => {
    // The accident this closes shows up two ways. By hand: `equator init` inside a child package
    // whose parent carries a configuration initializes the **parent**, reports success, and names
    // three files the reader cannot find where they are standing. Through the gate: a stray
    // configuration at this repository's root makes every consumer materialized under `tmp/`
    // select that root as its owner instead of itself, so four stages fail with "Equator init is
    // already complete" against a consumer whose configuration does not exist.
    const parent = await temporaryProject('boundary-');
    await writeProjectFile(
      parent,
      'package.json',
      `${JSON.stringify({ name: '@example/outer', private: true }, null, 2)}\n`,
    );
    await initializeProject({
      project: parent,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
    });

    const child = resolve(parent, 'child');
    await mkdir(child, { recursive: true });
    await writeProjectFile(
      child,
      'package.json',
      `${JSON.stringify({ name: '@example/inner', private: true }, null, 2)}\n`,
    );

    // A build command standing in the child finds nothing rather than the parent's project, and
    // the refusal names the configuration it declined and why, because a reader who can see one is
    // otherwise told none exists.
    const generated = await generateProject({ cwd: child });
    expect(generated.ok).toBe(false);
    const refusal = generated.diagnostics.find(({ code }) => code === 'EQ1702');
    expect(refusal?.summary).toContain(JSON.stringify(child));
    expect(refusal?.summary).toContain(JSON.stringify(parent));

    // And `init` standing in the child initializes the child.
    const initialized = await initializeProject({
      cwd: child,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
    });
    expect(initialized.ok).toBe(true);
    expect(await stat(resolve(child, 'equator.config.json'))).toBeTruthy();
    expect(await readdir(resolve(child, 'i18n'))).toEqual([]);
    // The parent is untouched: its own `i18n` is the one its own init made, and nothing was added
    // to it.
    expect(await readdir(resolve(parent, 'i18n'))).toEqual([]);
    claimCapability('cli:generate');
    claimCapability('cli:init');
  });

  it('still finds a workspace-root owner from a directory inside it', async () => {
    // The boundary is the nearest `package.json`, not the nearest directory, which is what keeps
    // section 134's layout working: an owner at a workspace root with its application nested.
    // Nothing between the two carries a manifest, so the search reaches the root and stops there.
    const root = await temporaryProject('nested-');
    await createPackage(root);
    await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
    });
    const nested = resolve(root, 'projects', 'application', 'src');
    await mkdir(nested, { recursive: true });

    const checked = await checkProject({ cwd: nested });
    expect(
      checked.diagnostics.some(
        ({ summary }) =>
          summary.includes('No equator.config.json') ||
          summary.includes('discovery is ambiguous'),
      ),
    ).toBe(false);
    claimCapability('cli:check');
  });

  it('preserves a pre-existing consumer file at the authoring-lock path', async () => {
    const root = await temporaryProject('lock-');
    await createPackage(root);
    const lockPath = resolve(root, '.equator-authoring.lock');
    await writeFile(lockPath, 'consumer-owned\n', 'utf8');
    const initialized = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
    });
    expect(initialized.ok).toBe(false);
    expect(await readFile(lockPath, 'utf8')).toBe('consumer-owned\n');
    claimCapability('cli:init');
  });

  it('generates, checks, caches, formats, and cleans without touching unchanged output', async () => {
    const root = await temporaryProject('generate-');
    await createInitializedProject(root);

    const first = await generateProject({ project: root });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.publication.changed).toBe(true);
    expect(first.value.compilation.invalidation.kind).toBe('initial');
    const manifestPath = resolve(
      root,
      'src/generated/i18n/.equator-manifest.json',
    );
    const firstMtime = (await stat(manifestPath)).mtimeMs;
    expect(
      await readFile(
        resolve(root, '.equator', ...COMPILER_CACHE_PATH.split('/')),
        'utf8',
      ),
    ).toContain('equator-compiler-cache/1');

    const second = await generateProject({ project: root });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.publication.changed).toBe(false);
    expect(second.value.compilation.invalidation.kind).toBe('none');
    expect((await stat(manifestPath)).mtimeMs).toBe(firstMtime);

    const checked = await checkProject({ project: root });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.freshness.fresh).toBe(true);

    await writeProjectFile(
      root,
      'equator.config.json',
      '{"schemaVersion":1,"sourceLocale":"en-US","defaultLocale":"en-US","locales":["en-US","ar-EG"]}\n',
    );
    const dryFormat = await formatProject({ project: root, dryRun: true });
    expect(dryFormat.ok).toBe(true);
    if (!dryFormat.ok) return;
    expect(dryFormat.value.files).toContain('equator.config.json');
    const formatted = await formatProject({ project: root });
    expect(formatted.ok).toBe(true);
    expect(
      await readFile(resolve(root, 'equator.config.json'), 'utf8'),
    ).toContain('\n  "sourceLocale": "en-US"');

    const cleaned = await cleanProject({ project: root });
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) return;
    expect(cleaned.value.changed).toBe(true);
    expect(await pathMetadataForTest(resolve(root, 'src/generated/i18n'))).toBe(
      undefined,
    );
    expect(await pathMetadataForTest(resolve(root, '.equator'))).toBe(
      undefined,
    );
    const again = await cleanProject({ project: root });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.changed).toBe(false);
    claimCapability('cli:generate');
    claimCapability('cli:check');
    claimCapability('cli:format');
    claimCapability('cli:clean');
  });

  it('propagates content-free observability through generation, host integration, and compilation', async () => {
    const root = await temporaryProject('observability-host-');
    await createInitializedProject(root);
    const events: ToolkitObservabilityEvent[] = [];
    const generated = await generateProject({
      project: root,
      observability: {
        emit(event): void {
          events.push(event);
        },
      },
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const outputCount =
      generated.value.compilation.artifacts.outputPlan.files.length;
    const publishedCount =
      generated.value.publication.written.length +
      generated.value.publication.removed.length;
    expect(events).toEqual([
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'generation',
        status: 'started',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'integration',
        status: 'started',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'compilation',
        status: 'started',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'compilation',
        status: 'succeeded',
        count: outputCount,
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'integration',
        status: 'succeeded',
        count: outputCount,
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'generation',
        status: 'succeeded',
        count: publishedCount,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(root);
    expect(JSON.stringify(events)).not.toContain('Welcome');
    claimCapability('cli:generate');
  });

  it('discovers, validates, formats, and compiles the conventional extension registry', async () => {
    const root = await temporaryProject('extensions-');
    await createInitializedProject(root);
    await writeProjectFile(
      root,
      'equator.extensions.json',
      JSON.stringify({
        profile: 'equator-extension-registry/1',
        descriptors: [
          {
            kind: 'message-function',
            id: 'fixture:uppercase',
            operandType: 'string',
            resultType: 'string',
            selector: 'none',
            maximumOutputLength: 64,
          },
        ],
      }),
    );
    await writeProjectFile(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: "{$name :fixture:uppercase}"\n',
    );
    await writeProjectFile(
      root,
      'i18n/shell/ar-EG.yaml',
      'messages:\n  app-title: "{$name :fixture:uppercase}"\n',
    );

    const generated = await generateProject({ project: root });
    expect(generated.ok, JSON.stringify(generated.diagnostics, null, 2)).toBe(
      true,
    );
    if (!generated.ok) return;
    expect(
      await readFile(resolve(root, 'src/generated/i18n/index.ts'), 'utf8'),
    ).toContain('fixture:uppercase');

    const formatted = await formatProject({ project: root });
    expect(formatted.ok).toBe(true);
    expect(
      await readFile(resolve(root, 'equator.extensions.json'), 'utf8'),
    ).toContain('\n  "profile": "equator-extension-registry/1"');
    claimCapability('cli:generate');
    claimCapability('cli:format');
    claimCapability('extension:message-function');
  });

  it('ignores corrupt disposable cache state and reconciles a foreground watch event', async () => {
    const root = await temporaryProject('watch-');
    await createInitializedProject(root);
    const generated = await generateProject({ project: root });
    expect(generated.ok).toBe(true);
    await writeFile(
      resolve(root, '.equator', ...COMPILER_CACHE_PATH.split('/')),
      '{broken',
      'utf8',
    );
    const checked = await checkProject({ project: root });
    expect(checked.ok).toBe(true);
    expect(checked.diagnostics.some(({ code }) => code === 'EQ1703')).toBe(
      true,
    );

    const controller = new AbortController();
    const catalogPath = resolve(root, 'i18n/shell/en-US.yaml');
    const watched = watchProject({
      project: root,
      signal: controller.signal,
      debounceMilliseconds: 20,
      onCycle: ({ sequence }) => {
        if (sequence === 1) {
          setTimeout(() => {
            void readFile(catalogPath, 'utf8').then((source) =>
              writeFile(
                catalogPath,
                source.replace(
                  'Equator host fixture',
                  'Equator watched fixture',
                ),
                'utf8',
              ),
            );
          }, 75);
        } else {
          controller.abort();
        }
      },
    });
    // Waited on directly, under the suite's own `testTimeout`. A bound inside that one fires first
    // whenever the machine is busy, so it reports how loaded the gate was rather than anything
    // about the watcher, and its rejection leaves the watch running: the cleanup that follows then
    // removes a directory something still holds open.
    const result = await watched;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cycles).toBeGreaterThanOrEqual(2);
    claimCapability('cli:check');
    claimCapability('cli:watch');
  });

  it('refuses clean when the generated root contains a consumer-owned file', async () => {
    const root = await temporaryProject('clean-refusal-');
    await createInitializedProject(root);
    const generated = await generateProject({ project: root });
    expect(generated.ok).toBe(true);
    const consumerFile = resolve(root, 'src/generated/i18n/consumer-owned.txt');
    await writeFile(consumerFile, 'keep me\n', 'utf8');
    const cleaned = await cleanProject({ project: root });
    expect(cleaned.ok).toBe(false);
    expect(cleaned.diagnostics[0]?.code).toBe('EQ1601');
    expect(await readFile(consumerFile, 'utf8')).toBe('keep me\n');
    claimCapability('cli:clean');
  });
});

async function pathMetadataForTest(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

describe('an authored file that is not UTF-8 text, or is over its ceiling', () => {
  // 0xC3 opens a two-byte sequence and 0x28 cannot continue it, so no decoder reads it as UTF-8.
  // It is placed inside a string, so decoded with replacement the file is still well formed and the
  // encoding is its only fault.
  const NOT_UTF8 = Buffer.from([0xc3, 0x28]);

  const withBytes = (text: string, at: string, bytes: Buffer): Buffer => {
    const index = text.indexOf(at);
    expect(index, at).toBeGreaterThanOrEqual(0);
    return Buffer.concat([
      Buffer.from(text.slice(0, index)),
      bytes,
      Buffer.from(text.slice(index + at.length)),
    ]);
  };

  const refusal = async (root: string) => {
    const checked = await checkProject({ project: root });
    expect(checked.ok).toBe(false);
    if (checked.ok) return undefined;
    return checked.diagnostics.find(({ severity }) => severity === 'error');
  };

  it('is refused with the code of the file it is, naming it from the owner', async () => {
    for (const [file, code] of [
      ['equator.config.json', 'EQ1001'],
      ['package.json', 'EQ1702'],
      ['i18n/shell/en-US.yaml', 'EQ1101'],
      ['angular.json', 'EQ1702'],
      ['equator.extensions.json', 'EQ1805'],
    ] as const) {
      const root = await temporaryProject('not-utf8-');
      await createInitializedProject(root);
      const path = resolve(root, ...file.split('/'));
      const text = await readFile(path, 'utf8').catch(() => undefined);
      await writeFile(
        path,
        file.endsWith('.yaml')
          ? withBytes(text ?? '', 'host fixture', NOT_UTF8)
          : withBytes(
              text?.replace('{', '{"x": "@",') ?? '{"x": "@"}\n',
              '@',
              NOT_UTF8,
            ),
      );
      const diagnostic = await refusal(root);
      expect(diagnostic, file).toMatchObject({ code });
      expect(diagnostic?.summary, file).toContain(
        `${JSON.stringify(file)} because it is not UTF-8 text`,
      );
    }
  });

  it('is refused over its ceiling with its own code rather than as an environment failure', async () => {
    const root = await temporaryProject('over-ceiling-');
    await createInitializedProject(root);
    await writeFile(
      resolve(root, 'i18n/shell/en-US.yaml'),
      Buffer.alloc(RESOURCE_LIMITS.catalogBytes + 1, 0x20),
    );
    const diagnostic = await refusal(root);
    expect(diagnostic).toMatchObject({ code: 'EQ1101' });
    expect(diagnostic?.summary).toContain(
      `"i18n/shell/en-US.yaml" because it exceeds the ${RESOURCE_LIMITS.catalogBytes}-byte`,
    );
    expect(diagnostic?.summary).not.toContain(root);
  });
});

describe('a JSON project file saved with a byte-order mark', () => {
  const MARK = String.fromCharCode(0xfeff);

  it('is read as the JSON after it, and keeps it when Equator rewrites the file', async () => {
    const root = await temporaryProject('byte-order-mark-');
    await createInitializedProject(root);
    await writeProjectFile(root, 'angular.json', '{}\n');
    await writeProjectFile(
      root,
      'equator.extensions.json',
      JSON.stringify({
        profile: 'equator-extension-registry/1',
        descriptors: [],
      }),
    );
    for (const file of [
      'package.json',
      'angular.json',
      'equator.config.json',
      'equator.extensions.json',
    ]) {
      const path = resolve(root, file);
      await writeFile(path, `${MARK}${await readFile(path, 'utf8')}`, 'utf8');
    }
    // Written on one line, so formatting has something to rewrite.
    const configurationPath = resolve(root, 'equator.config.json');
    const configuration = await readFile(configurationPath, 'utf8');
    await writeFile(
      configurationPath,
      `${MARK}${JSON.stringify(JSON.parse(configuration.slice(1)))}`,
      'utf8',
    );

    const checked = await checkProject({ project: root });
    expect(checked.ok, JSON.stringify(checked.diagnostics)).toBe(true);

    const formatted = await formatProject({ project: root });
    expect(formatted.ok, JSON.stringify(formatted.diagnostics)).toBe(true);
    if (!formatted.ok) return;
    expect(formatted.value.files).toContain('equator.config.json');
    expect(formatted.value.files).toContain('equator.extensions.json');
    for (const file of ['equator.config.json', 'equator.extensions.json']) {
      const rewritten = await readFile(resolve(root, file), 'utf8');
      expect(rewritten.startsWith(MARK), file).toBe(true);
      expect(rewritten.slice(1).startsWith(MARK), file).toBe(false);
    }
  });
});
