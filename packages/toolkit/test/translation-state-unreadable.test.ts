import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkProject, generateProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';
import { TRANSLATION_STATE_PATH } from '../src/translation-state.js';

/**
 * A translation-state record that is present and cannot be read.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 8: recomputing the record pronounces every
 * translation current, the one answer that is always wrong. Reading an unreadable record as empty
 * is that recomputation, so it is refused before anything is published and left for the owner to
 * resolve. A record that is absent is the first run.
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

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'translation-state-read-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify({ name: '@example/translation-state-read', private: true, type: 'module' }, null, 2)}\n`,
  );
  const initialized = await initializeProject({
    project: root,
    configuration: {
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    },
  });
  if (!initialized.ok) throw new Error(JSON.stringify(initialized.diagnostics));
  await write(root, 'i18n/shell/en-US.yaml', 'messages:\n  app-title: Home\n');
  await write(
    root,
    'i18n/shell/ar-EG.yaml',
    'messages:\n  app-title: الرئيسية\n',
  );
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
  );
  await write(
    root,
    'src/app.ts',
    "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
  );
  const generated = await generateProject({ project: root });
  if (!generated.ok) throw new Error(JSON.stringify(generated.diagnostics));
  return root;
}

function recordPath(root: string): string {
  return resolve(root, ...TRANSLATION_STATE_PATH.split('/'));
}

async function generatedShell(root: string): Promise<string> {
  return readFile(resolve(root, 'src/generated/i18n/shell.ts'), 'utf8');
}

describe('a translation-state record that cannot be read', () => {
  it.each([
    [
      'conflict markers a merge left',
      (record: string) =>
        record.replace(
          '  "entries": {',
          '<<<<<<< ours\n  "entries": {\n=======\n  "entries": {\n>>>>>>> theirs',
        ),
    ],
    ['a record cut short', (record: string) => record.slice(0, -8)],
    [
      'another profile',
      (record: string) =>
        record.replace(
          'equator-translation-state/1',
          'equator-translation-state/2',
        ),
    ],
    [
      'an entry that is not a pair of fingerprints',
      (record: string) => record.replace(/"target": "[^"]+"/u, '"target": 7'),
    ],
  ])('is refused and left unchanged: %s', async (_label, damage) => {
    const root = await project();
    const damaged = damage(await readFile(recordPath(root), 'utf8'));
    await writeFile(recordPath(root), damaged, 'utf8');
    const before = await generatedShell(root);
    // A source edit that a successful generate would publish, so a refusal is visible as output
    // that did not move.
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Start\n',
    );

    const generated = await generateProject({ project: root });
    expect(generated.ok).toBe(false);
    expect(generated.diagnostics.map(({ code }) => code)).toEqual(['EQ1702']);
    expect(await readFile(recordPath(root), 'utf8')).toBe(damaged);
    expect(await generatedShell(root)).toBe(before);

    const checked = await checkProject({ project: root });
    expect(checked.ok).toBe(false);
    expect(checked.diagnostics.map(({ code }) => code)).toEqual(['EQ1702']);
  });

  it('is written afresh when it is absent', async () => {
    const root = await project();
    await rm(recordPath(root));

    const generated = await generateProject({ project: root });
    expect(generated.ok, JSON.stringify(generated.diagnostics)).toBe(true);
    expect(await readFile(recordPath(root), 'utf8')).toContain('app-title');
  });
});
