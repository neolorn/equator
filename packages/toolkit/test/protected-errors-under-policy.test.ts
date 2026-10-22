import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkProject, parseCatalog } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * No policy a project or a run selects makes a protected error less than an error.
 *
 * The one downgrade the configuration offers is declaring a locale still in progress, and the
 * policies a run opts into are the completeness and freshness gates. Each is shown to be in effect
 * on the same input, by the completeness finding it does move, beside an invented input it must not
 * move: a translation that renders a value the source never supplies is a defect whatever the
 * state of the locale.
 */

const SOURCE =
  'messages:\n  greeting: "Hello, {$name}!"\n  farewell: Goodbye\n';
// Omits farewell, which the policies govern, and invents an input, which they must not.
const TARGET = 'messages:\n  greeting: "مرحبا {$user}"\n';

function catalog(role: 'source' | 'target', locale: string, body: string) {
  const result = parseCatalog(body, {
    role,
    providerId: 'home',
    scopeId: 'shell',
    locale,
    sourcePath: `i18n/shell/${locale}.yaml`,
  });
  if (!result.ok) throw new Error(`fixture ${locale} failed to parse`);
  return result.value;
}

const DECLARED = {
  inProgress: { 'ar-EG': { note: 'Translation starts later.' } },
};

describe('a protected error under every completeness policy', () => {
  for (const declared of [false, true]) {
    for (const requireCompleteTargets of [false, true]) {
      it(`stays an error (declared in progress: ${declared}, completeness required: ${requireCompleteTargets})`, () => {
        const analysis = analyzeCatalogSet({
          configuration: testProjectConfiguration(
            ['en-US', 'ar-EG'],
            declared ? DECLARED : {},
          ),
          catalogs: [
            catalog('source', 'en-US', SOURCE),
            catalog('target', 'ar-EG', TARGET),
          ],
          requireCompleteTargets,
        });
        const invented = analysis.diagnostics.filter(
          ({ code }) => code === 'EQ1304',
        );
        expect(invented).toHaveLength(1);
        expect(invented[0]?.severity).toBe('error');
        expect(analysis.ok).toBe(false);

        const omitted = analysis.diagnostics.find(
          ({ code }) => code === 'EQ1307',
        );
        expect(omitted?.severity).toBe(
          requireCompleteTargets && !declared ? 'error' : 'warning',
        );
        if (requireCompleteTargets && declared) {
          expect(omitted?.summary).toContain('declared still in progress');
        }
      });
    }
  }
});

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

describe('a protected error under every run policy together', () => {
  it('stays an error and fails the check', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'protected-errors-'));
    roots.push(root);
    await write(
      root,
      'package.json',
      `${JSON.stringify({ name: '@example/protected', private: true, type: 'module' }, null, 2)}\n`,
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
    await write(root, 'i18n/shell/en-US.yaml', SOURCE);
    await write(root, 'i18n/shell/ar-EG.yaml', TARGET);
    await write(
      root,
      'tsconfig.app.json',
      `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
    );
    await write(
      root,
      'src/app.ts',
      "import { messages } from '#i18n/shell';\n\nexport const used = [messages.greeting, messages.farewell];\n",
    );

    const checked = await checkProject({
      project: root,
      requireCompleteTargets: true,
      requireFreshOutput: true,
    });
    const invented = checked.diagnostics.filter(
      ({ code }) => code === 'EQ1304',
    );
    expect(invented, JSON.stringify(checked.diagnostics)).toHaveLength(1);
    expect(invented[0]?.severity).toBe('error');
    expect(checked.ok).toBe(false);
  });
});
