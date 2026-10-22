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

import { checkProject, parseConfiguration } from '../src/index.js';
import { parseCatalog } from '../src/catalog.js';
import { initializeProject } from '../src/project-host.js';

/**
 * A check that applies fixes changes how files look and nothing they mean.
 *
 * Compared by parsing every authored file before and after: the same models, the same message
 * identities, the same untranslated gap left untranslated, and no file added. A fix that wrote a
 * translation, renamed a key, dropped a message or added a suppression would each show up as a
 * difference in one of those.
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

const CATALOGS = {
  'i18n/shell/en-US.yaml': {
    locale: 'en-US',
    role: 'source' as const,
    text: 'messages:\n    app-title:   "Home"   # shown in the tab\n    farewell:    \'Goodbye\'\n    greeting: "Hello, {$name}!"\n',
  },
  'i18n/shell/ar-EG.yaml': {
    locale: 'ar-EG',
    role: 'target' as const,
    text: 'messages:\n    app-title:   "الرئيسية"\n    greeting:  "مرحبا، {$name}!"\n',
  },
};

function parsed(path: keyof typeof CATALOGS, text: string) {
  const { locale, role } = CATALOGS[path];
  const result = parseCatalog(text, {
    role,
    providerId: '@example/check-fix',
    scopeId: 'shell',
    locale,
    sourcePath: path,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

async function listing(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      resolve(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/'),
    )
    .filter(
      (path) =>
        !path.startsWith('.equator/') && !path.startsWith('src/generated/'),
    )
    .sort();
}

describe('check --fix', () => {
  it('reformats authored files without changing what any of them means', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'check-fix-'));
    roots.push(root);
    await write(
      root,
      'package.json',
      `${JSON.stringify({ name: '@example/check-fix', private: true, type: 'module' }, null, 2)}\n`,
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
    for (const [path, { text }] of Object.entries(CATALOGS))
      await write(root, path, text);
    await write(
      root,
      'tsconfig.app.json',
      `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
    );
    await write(
      root,
      'src/app.ts',
      "import { messages } from '#i18n/shell';\n\nexport const used = [messages.appTitle, messages.farewell, messages.greeting];\n",
    );
    const configurationPath = resolve(root, 'equator.config.json');
    const configurationText = await readFile(configurationPath, 'utf8');
    const configurationBefore = parseConfiguration(configurationText);
    expect(configurationBefore.ok).toBe(true);
    // The configuration is rewritten in an uncanonical but equivalent spelling, so the fix has
    // something to do in that file too.
    await writeFile(
      configurationPath,
      JSON.stringify(JSON.parse(configurationText), null, 8),
      'utf8',
    );
    const filesBefore = await listing(root);

    const checked = await checkProject({ project: root, fix: true });
    expect(checked.ok, JSON.stringify(checked.diagnostics)).toBe(true);
    if (!checked.ok) return;
    expect([...checked.value.fixedFiles].sort()).toEqual(
      ['equator.config.json', ...Object.keys(CATALOGS)].sort(),
    );

    for (const [path, { text }] of Object.entries(CATALOGS)) {
      const after = await readFile(resolve(root, ...path.split('/')), 'utf8');
      expect(after, path).not.toBe(text);
      const key = path as keyof typeof CATALOGS;
      expect(parsed(key, after), path).toEqual(parsed(key, text));
    }
    expect(
      await readFile(resolve(root, 'i18n/shell/en-US.yaml'), 'utf8'),
    ).toContain('# shown in the tab');
    // The target still has no farewell: a fix does not translate.
    expect(
      await readFile(resolve(root, 'i18n/shell/ar-EG.yaml'), 'utf8'),
    ).not.toContain('farewell');
    const configurationAfter = parseConfiguration(
      await readFile(configurationPath, 'utf8'),
    );
    expect(configurationAfter).toEqual(configurationBefore);
    expect(await listing(root)).toEqual(filesBefore);
  });
});
