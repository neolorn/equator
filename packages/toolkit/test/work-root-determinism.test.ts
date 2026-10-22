import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

/**
 * The work root is a cache, so nothing in the output depends on it and nothing in it depends on
 * the machine or the moment that wrote it.
 *
 * The output is compared between a generation that had a history of earlier runs behind it and one
 * with the work root and the generated root deleted first. The work root is read for what would
 * make two machines, or two runs, disagree about a file that is otherwise the same.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

async function snapshot(directory: string): Promise<Map<string, string>> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = resolve(entry.parentPath, entry.name);
    files.set(
      absolute.slice(directory.length + 1).replaceAll('\\', '/'),
      (await readFile(absolute)).toString('base64'),
    );
  }
  return new Map([...files].sort(([left], [right]) => (left < right ? -1 : 1)));
}

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'work-root-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify({ name: '@example/work-root', private: true, type: 'module' }, null, 2)}\n`,
  );
  const initialized = await initializeProject({
    project: root,
    configuration: {
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    },
  });
  expect(initialized.ok).toBe(true);
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true, baseUrl: '.' }, include: ['src/**/*.ts'] }, null, 2)}\n`,
  );
  await write(
    root,
    'src/app.ts',
    "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
  );
  await write(root, 'i18n/shell/en-US.yaml', 'messages:\n  app-title: First\n');
  await write(root, 'i18n/shell/ar-EG.yaml', 'messages:\n  app-title: الأول\n');
  return root;
}

describe('the work root', () => {
  it('leaves no trace in the output: a clean generation writes the same bytes', async () => {
    const root = await project();
    const generatedRoot = resolve(root, 'src/generated/i18n');
    // A history for the cache to carry: an earlier input, then the one both runs compile.
    expect((await generateProject({ project: root })).ok).toBe(true);
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Second\n',
    );
    const incremental = await generateProject({ project: root });
    expect(incremental.ok).toBe(true);
    if (!incremental.ok) return;
    expect(
      incremental.value.compilation.invalidation.changedInputs.length,
    ).toBeGreaterThan(0);
    const withHistory = await snapshot(generatedRoot);
    expect(withHistory.size).toBeGreaterThan(0);

    await rm(resolve(root, '.equator'), { recursive: true });
    await rm(generatedRoot, { recursive: true });
    const clean = await generateProject({ project: root });
    expect(clean.ok).toBe(true);
    expect(await snapshot(generatedRoot)).toEqual(withHistory);
  });

  it('carries no timestamp, absolute path or process identity', async () => {
    const root = await project();
    expect((await generateProject({ project: root })).ok).toBe(true);
    const work = await snapshot(resolve(root, '.equator'));
    expect([...work.keys()]).toContain('cache/compiler-state.json');
    for (const [path, encoded] of work) {
      const text = Buffer.from(encoded, 'base64').toString('utf8');
      for (const spelling of [
        root,
        root.replaceAll('\\', '/'),
        root.replaceAll('\\', '\\\\'),
      ]) {
        expect(text.includes(spelling), `${path} names the owner root`).toBe(
          false,
        );
      }
      expect(text, path).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
      expect(text, path).not.toMatch(/\b1\d{12}\b/u);
      expect(text, path).not.toMatch(new RegExp(`\\b${process.pid}\\b`, 'u'));
    }
  });
});
