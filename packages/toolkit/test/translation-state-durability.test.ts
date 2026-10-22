import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';
import { cleanProject, initializeProject } from '../src/project-host.js';
import { TRANSLATION_STATE_PATH } from '../src/translation-state.js';

/**
 * The translation-state record is the project's own data, so nothing that disposes of generated
 * output disposes of it.
 *
 * It records what each translation was written against, and a checkout without it cannot tell a
 * stale translation from a current one. So it lives outside the generated root and the work root,
 * outside every tree a project ignores by default, and survives a clean.
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

// The trees a project's ignore file commonly leaves out of version control, the toolkit's own two
// roots among them.
const IGNORED = [
  'node_modules/',
  'dist/',
  'tmp/',
  '.angular/',
  '.equator/',
  'src/generated/',
];

describe('the translation-state record', () => {
  it('is written outside every disposable root and survives a clean', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'translation-state-'));
    roots.push(root);
    await write(
      root,
      'package.json',
      `${JSON.stringify({ name: '@example/translation-state', private: true, type: 'module' }, null, 2)}\n`,
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
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Home\n',
    );
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
    expect(generated.ok, JSON.stringify(generated.diagnostics)).toBe(true);
    for (const ignored of IGNORED) {
      expect(TRANSLATION_STATE_PATH.startsWith(ignored), ignored).toBe(false);
    }
    const recordPath = resolve(root, ...TRANSLATION_STATE_PATH.split('/'));
    const record = await readFile(recordPath, 'utf8');
    expect(record).toContain('app-title');

    const cleaned = await cleanProject({ project: root });
    expect(cleaned.ok).toBe(true);
    expect(await readFile(recordPath, 'utf8')).toBe(record);

    // And the next generation reads it rather than refusing or replacing it.
    const again = await generateProject({ project: root });
    expect(again.ok, JSON.stringify(again.diagnostics)).toBe(true);
    expect(await readFile(recordPath, 'utf8')).toBe(record);
  });
});
