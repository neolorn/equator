import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';

/**
 * Every locale-dependent table comes from the locale list in `equator.config.json`.
 *
 * The project is generated, then the one line that lists its locales gains `en-GB` and nothing else
 * changes: no catalog, no source file, no other key. Each generated table that depends on the
 * locale set has to carry the new locale on the next generation. `en-GB` is chosen because it
 * reaches every such table: CLDR names it, it inherits from `en` through `en-001`, and the pinned
 * release carries person-name patterns of its own for it.
 */

const temporaryRoots: string[] = [];

async function write(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}

async function declare(
  root: string,
  locales: readonly string[],
): Promise<void> {
  await write(
    root,
    'equator.config.json',
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceLocale: 'en',
        defaultLocale: 'en',
        locales: [...locales],
        aliases: { english: 'en' },
      },
      null,
      2,
    )}\n`,
  );
}

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'one-declaration-'));
  temporaryRoots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: 'one-declaration',
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
  await declare(root, ['en', 'ar-EG']);
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
  for (const locale of ['en', 'ar-EG']) {
    await write(
      root,
      `i18n/shell/${locale}.yaml`,
      ['messages:', '  app-title: Declaration probe', ''].join('\n'),
    );
  }
  await write(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      '',
      'export const title = messages.appTitle.messageId;',
      '',
    ].join('\n'),
  );
  return root;
}

interface Generated {
  readonly index: string;
  readonly personNames: string;
}

async function generate(root: string): Promise<Generated> {
  const result = await generateProject({ project: root });
  expect(
    result.diagnostics.filter(({ severity }) => severity === 'error'),
  ).toEqual([]);
  const read = (name: string) =>
    readFile(resolve(root, 'src/generated/i18n', name), 'utf8');
  return {
    index: await read('index.ts'),
    personNames: await read('person-names.ts'),
  };
}

/** One `configuration` field of the generated index, read back as the value it declares. */
function field(index: string, name: string): unknown {
  const line = index
    .split('\n')
    .find((candidate) => candidate.trimStart().startsWith(`${name}:`));
  const literal = /Object\.freeze\((.*?)(?: as const)?\),$/u.exec(
    line ?? '',
  )?.[1];
  return literal === undefined ? undefined : JSON.parse(literal);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('a locale added to the declaration alone', () => {
  it('reaches every table that depends on the locale set', async () => {
    const root = await project();
    const before = await generate(root);
    // The control: none of the tables knew the locale before it was declared.
    expect(`${before.index}${before.personNames}`).not.toContain('en-GB');

    await declare(root, ['en', 'ar-EG', 'en-GB']);
    const after = await generate(root);

    expect(field(after.index, 'locales')).toEqual(['en', 'ar-EG', 'en-GB']);
    expect(field(after.index, 'localeNames')).toMatchObject({
      'en-GB': 'British English',
    });
    expect(field(after.index, 'localeFallbacks')).toEqual({ 'en-GB': ['en'] });
    expect(after.personNames).toContain('"en-GB"');
    // The alias table is the declaration's too, and adding a locale leaves it as declared.
    expect(after.index).toContain('"english": "en",');
  });
});
