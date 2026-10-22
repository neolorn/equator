import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';

/**
 * A message is used through its generated handle, and through nothing that merely spells it.
 *
 * Each case below names `issue.unknown` without holding its handle: as a string, as a string
 * assembled at run time, through an index the type system cannot bound, as an object shaped like a
 * handle, and through a cast that asserts a handle type onto a value that is not one. None of them
 * is a use, so the message stays in the unused-message advisory. The advisory is the observable
 * because it is where a spelling mistaken for an identity would show: as a message reported
 * reachable that nothing can render.
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

async function unreached(body: readonly string[]): Promise<readonly string[]> {
  const root = await mkdtemp(resolve(tmpdir(), 'identity-sources-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@example/identity-sources',
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
    'messages:\n  app-title: Identity sources\n  issue.unknown: Something went wrong.\n',
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
  const generated = await generateProject({ project: root });
  expect(generated.ok, JSON.stringify(generated.diagnostics)).toBe(true);
  const advisory = generated.diagnostics.find(({ code }) => code === 'EQ1311');
  return advisory === undefined
    ? []
    : [...advisory.summary.matchAll(/"([^"]+)"/gu)].map(
        ([, name]) => name ?? '',
      );
}

describe('what does not become a message identity', () => {
  it('a string, an interpolated string, an unbounded index, or an object spelled like a handle', async () => {
    expect(
      await unreached([
        "export const raw = present('issue.unknown');",
        "export const whole = present('@example/identity-sources:shell:issue.unknown');",
        'export const interpolated = present(`issue.${code}`);',
        'export const indexed = present((messages.issue as Record<string, unknown>)[code]);',
        'export const spelled = present({',
        "  generatedAbi: 'equator-generated/1',",
        "  resultKind: 'plain',",
        "  identity: '@example/identity-sources:shell:issue.unknown',",
        '} as const);',
      ]),
    ).toEqual(['issue.unknown']);
  });

  it('a cast that asserts a handle type onto a value that is not a handle', async () => {
    expect(
      await unreached([
        'type Held = typeof messages.issue.unknown;',
        "export const cast = present('issue.unknown' as unknown as Held);",
      ]),
    ).toEqual(['issue.unknown']);
  });
});
