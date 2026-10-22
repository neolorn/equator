import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkProject, generateProject } from '../src/index.js';

/**
 * The address a refused routerLink is told to write instead, when the link names a locale and
 * nothing after it.
 *
 * A routerLink whose leading segment the policy claims is refused, and the refusal names the
 * canonical address: the one written, without the claimed segment. A link to a locale's own root,
 * `/ar-eg`, has nothing after that segment, and the canonical address of a root is `/`. An empty
 * address in its place would tell the author to write a link the Router reads as relative.
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

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const STUBS = {
  '@angular/core': [
    'export declare function Component(options: unknown): ClassDecorator;',
    '',
  ],
  '@angular/router': [
    'export declare interface Route {',
    '  path?: string;',
    '  component?: unknown;',
    '}',
    'export type Routes = readonly Route[];',
    '',
  ],
  '@neolorn/equator': [
    'export declare function createPathPrefixLocalePolicy(options: unknown): unknown;',
    '',
  ],
} as const;

/** A project whose one template carries `links`, under a policy that prefixes both locales. */
async function project(links: readonly string[]): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'router-link-root-'));
  temporaryRoots.push(root);

  await write(
    root,
    'package.json',
    json({
      name: 'router-link-root',
      private: true,
      type: 'module',
      imports: {
        '#i18n': './src/generated/i18n/index.ts',
        '#i18n/*': './src/generated/i18n/*.ts',
      },
    }),
  );
  await write(
    root,
    'equator.config.json',
    json({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    }),
  );
  await write(
    root,
    'tsconfig.app.json',
    json({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'preserve',
        moduleResolution: 'bundler',
        resolvePackageJsonImports: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
  for (const locale of ['en-US', 'ar-EG']) {
    await write(
      root,
      `i18n/shell/${locale}.yaml`,
      ['messages:', '  app-title: Router link probe', ''].join('\n'),
    );
  }
  for (const [name, lines] of Object.entries(STUBS)) {
    await write(root, `node_modules/${name}/index.d.ts`, lines.join('\n'));
    await write(
      root,
      `node_modules/${name}/package.json`,
      json({ name, version: '0.0.0', types: './index.d.ts' }),
    );
  }
  await write(
    root,
    'src/app.routes.ts',
    [
      "import type { Routes } from '@angular/router';",
      '',
      'export class Page {}',
      '',
      'export const routes: Routes = [',
      "  { path: 'articles/:slug', component: Page },",
      '];',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      "import { createPathPrefixLocalePolicy } from '@neolorn/equator';",
      '',
      'export const title = messages.appTitle.messageId;',
      '',
      'export const routePolicy = createPathPrefixLocalePolicy({',
      "  defaultLocale: 'en-US',",
      '  locales: {',
      "    'en-US': 'en-us',",
      "    'ar-EG': 'ar-eg',",
      '  },',
      '});',
      '',
    ].join('\n'),
  );
  await write(root, 'src/app.component.html', `${links.join('\n')}\n`);
  await write(
    root,
    'src/app.component.ts',
    [
      "import { Component } from '@angular/core';",
      '',
      '@Component({',
      "  selector: 'app-root',",
      "  templateUrl: './app.component.html',",
      '})',
      'export class AppComponent {}',
      '',
    ].join('\n'),
  );

  return root;
}

/** What each build step says about the project's routerLinks. */
async function refusals(root: string): Promise<{
  readonly generate: readonly string[];
  readonly check: readonly string[];
}> {
  const only = (
    diagnostics: readonly { readonly code: string; readonly summary: string }[],
  ): readonly string[] =>
    diagnostics
      .filter(({ code }) => code === 'EQ1411')
      .map(({ summary }) => summary);
  return {
    generate: only((await generateProject({ project: root })).diagnostics),
    check: only((await checkProject({ project: root })).diagnostics),
  };
}

/** The addresses a refusal quotes, in the order it quotes them. */
const quoted = (summary: string): readonly string[] =>
  [...summary.matchAll(/"(\/[^"]*)"/gu)].map((match) => match[1] ?? '');

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('a routerLink that names a locale and nothing after it', () => {
  it('is refused from both steps, and told to write the root', async () => {
    const root = await project(['<a routerLink="/ar-eg">the Arabic home</a>']);

    const { generate, check } = await refusals(root);

    expect(generate).toHaveLength(1);
    expect(check).toStrictEqual(generate);
    expect(quoted(generate[0] ?? '')).toStrictEqual(['/ar-eg', '/']);
  });

  it('is told to write the rest of the address when there is one', async () => {
    const root = await project([
      '<a routerLink="/ar-eg/articles/handbook">the Arabic handbook</a>',
    ]);

    const { generate } = await refusals(root);

    expect(generate).toHaveLength(1);
    expect(quoted(generate[0] ?? '')).toStrictEqual([
      '/ar-eg/articles/handbook',
      '/articles/handbook',
    ]);
  });
});
