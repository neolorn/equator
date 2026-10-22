import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';

/**
 * Making a message available is not using it.
 *
 * Each case below puts the `issue` group where something outside the application could reach it:
 * re-exported from the generated module, exported under a name of the application's own, exported
 * as a default, and used from a file the application's program does not include. None of them is a
 * reachability root, so `issue.unknown` stays in the unused-message advisory. Counting any of them
 * would silence the advisory for every message a library-shaped application exports.
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

async function unreached(
  body: readonly string[],
  others: Readonly<Record<string, string>> = {},
): Promise<readonly string[]> {
  const root = await mkdtemp(resolve(tmpdir(), 'public-export-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@example/public-export',
        private: true,
        type: 'module',
        imports: {
          '#i18n': './src/generated/i18n/index.ts',
          '#i18n/*': './src/generated/i18n/*.ts',
        },
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'equator.config.json',
    `${JSON.stringify({ schemaVersion: 1, sourceLocale: 'en-US', defaultLocale: 'en-US', locales: ['en-US'] }, null, 2)}\n`,
  );
  await write(
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
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'i18n/shell/en-US.yaml',
    'messages:\n  app-title: Public export\n  issue.unknown: Something went wrong.\n',
  );
  await write(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      '',
      'declare function present(value: unknown): string;',
      'declare const code: string;',
      '',
      'export const title = messages.appTitle.messageId;',
      ...body,
      '',
    ].join('\n'),
  );
  for (const [path, text] of Object.entries(others))
    await write(root, path, text);
  const generated = await generateProject({ project: root });
  expect(generated.ok, JSON.stringify(generated.diagnostics)).toBe(true);
  const advisory = generated.diagnostics.find(({ code }) => code === 'EQ1311');
  return advisory === undefined
    ? []
    : [...advisory.summary.matchAll(/"([^"]+)"/gu)].map(
        ([, name]) => name ?? '',
      );
}

describe('what is not a reachability root', () => {
  it('a public export, a re-export, a default export, or a file outside the program', async () => {
    expect(
      await unreached(
        [
          "export { messages as shellMessages } from '#i18n/shell';",
          'export const issues = messages.issue;',
          'export default messages.issue;',
        ],
        {
          'scripts/outside.ts':
            "import { messages } from '#i18n/shell';\nexport const reached = messages.issue.unknown.messageId;\n",
        },
      ),
    ).toEqual(['issue.unknown']);
  });
});
