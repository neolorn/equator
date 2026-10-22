import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject, type ToolkitDiagnostic } from '../src/index.js';

/**
 * What the build says once it holds the configuration, the locale URL policy, the route table and
 * the templates together, at the edges of each judgement.
 *
 * Each judgement is made from two statements written in different files, so each finding has to say
 * which file it is about, and each has a boundary where a segment is not a segment at all: the
 * root address, a route parameter, a language written without its region.
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

const manifest = (name: string): string =>
  `${JSON.stringify({ name, version: '0.0.0', types: './index.d.ts' }, null, 2)}\n`;

const STUBS: Readonly<Record<string, string>> = {
  '@angular/core':
    'export declare function Component(options: unknown): ClassDecorator;\n',
  '@angular/router': [
    'export declare interface Route {',
    '  path?: string;',
    '  component?: unknown;',
    '}',
    'export type Routes = readonly Route[];',
    '',
  ].join('\n'),
  '@neolorn/equator':
    'export declare function createPathPrefixLocalePolicy(options: unknown): unknown;\n',
};

interface ProjectOptions {
  readonly configuredLocales?: readonly string[];
  /** The policy's options, as the source text of the object the factory is called with. */
  readonly policy: string;
  /** Lines written before the policy, for a constant it reads. */
  readonly beforePolicy?: readonly string[];
  readonly routePaths?: readonly string[];
  readonly template?: string;
}

async function project(options: ProjectOptions): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'judgement-edges-'));
  temporaryRoots.push(root);
  const locales = options.configuredLocales ?? ['en-US', 'ar-EG'];

  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: 'judgement-edges',
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
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales,
      },
      null,
      2,
    )}\n`,
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
          experimentalDecorators: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  for (const locale of locales) {
    await write(
      root,
      `i18n/shell/${locale}.yaml`,
      ['messages:', '  app-title: Judgement probe', ''].join('\n'),
    );
  }
  for (const [name, declarations] of Object.entries(STUBS)) {
    await write(root, `node_modules/${name}/index.d.ts`, declarations);
    await write(root, `node_modules/${name}/package.json`, manifest(name));
  }

  await write(
    root,
    'src/policy.ts',
    [
      "import { createPathPrefixLocalePolicy } from '@neolorn/equator';",
      '',
      ...(options.beforePolicy ?? []),
      `export const routePolicy = createPathPrefixLocalePolicy(${options.policy});`,
      '',
    ].join('\n'),
  );
  await write(
    root,
    'src/app.component.html',
    `${options.template ?? '<h1>{{ title }}</h1>'}\n`,
  );
  await write(
    root,
    'src/app.ts',
    [
      "import { Component } from '@angular/core';",
      "import { messages } from '#i18n/shell';",
      '',
      '@Component({',
      "  selector: 'app-root',",
      "  templateUrl: './app.component.html',",
      '})',
      'export class AppComponent {',
      '  protected readonly title = messages.appTitle;',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'src/app.routes.ts',
    [
      "import type { Routes } from '@angular/router';",
      '',
      "import { AppComponent } from './app';",
      '',
      'export const routes: Routes = [',
      ...['dashboard', ...(options.routePaths ?? [])].map(
        (path) =>
          `  { path: ${JSON.stringify(path)}, component: AppComponent },`,
      ),
      '];',
      '',
    ].join('\n'),
  );

  return root;
}

async function reported(
  root: string,
  code: string,
): Promise<readonly ToolkitDiagnostic[]> {
  const generated = await generateProject({ project: root });
  return generated.diagnostics.filter((diagnostic) => diagnostic.code === code);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

const AGREEING =
  "{ defaultLocale: 'en-US', locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' } }";

const paths = (
  diagnostics: readonly ToolkitDiagnostic[],
): readonly (readonly (string | number)[])[] =>
  diagnostics.map(({ path }) => path);

describe('a finding the build makes from two files says which one it is about', () => {
  it('places every locale-set disagreement at the file that declares the policy', async () => {
    const root = await project({
      configuredLocales: ['en-US', 'ar-EG', 'de-DE'],
      policy:
        "{ defaultLocale: 'ar-EG', locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'fr-FR': 'fr' } }",
    });

    // A locale with no address, a locale with no catalogs, and a default the two disagree on.
    expect(paths(await reported(root, 'EQ1408'))).toEqual([
      ['routes', 'src/policy.ts'],
      ['routes', 'src/policy.ts'],
      ['routes', 'src/policy.ts'],
    ]);
  });

  it('places the options it left unread at the file that declares the policy', async () => {
    const root = await project({
      policy:
        "{ defaultLocale: 'en-US', locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' }, localeNeutralRoots: ROOTS }",
      beforePolicy: ["const ROOTS = ['assets'];"],
    });

    expect(paths(await reported(root, 'EQ1417'))).toEqual([
      ['routes', 'src/policy.ts'],
    ]);
  });

  it('places a route at a claimed segment at the file that declares the route', async () => {
    const root = await project({
      policy: AGREEING,
      routePaths: ['ar-eg/tools'],
    });

    expect(paths(await reported(root, 'EQ1409'))).toEqual([
      ['routes', 'src/app.routes.ts'],
    ]);
  });

  it('places a routerLink that names a locale at the template that writes it', async () => {
    const root = await project({
      policy: AGREEING,
      template: '<a routerLink="/ar-eg/articles">Articles</a>',
    });

    expect(paths(await reported(root, 'EQ1411'))).toEqual([
      ['components', 'src/app.component.html'],
    ]);
  });

  it('places a locale spelled in a template at that template, as a literal and as an attribute', async () => {
    const root = await project({
      policy: AGREEING,
      template:
        '<button type="button" lang="ar" (click)="select(\'ar-EG\')">Arabic</button>',
    });

    const found = await reported(root, 'EQ1410');
    expect(found.map(({ severity }) => severity).sort()).toEqual([
      'error',
      'warning',
    ]);
    expect(paths(found)).toEqual([
      ['components', 'src/app.component.html'],
      ['components', 'src/app.component.html'],
    ]);
  });
});

describe('the locales a disagreement names', () => {
  it('are listed in code point order, whatever order the policy wrote them in', async () => {
    const root = await project({
      policy:
        "{ defaultLocale: 'en-US', locales: { 'en-US': 'en-us', 'ja-JP': 'ja', 'ar-EG': 'ar-eg', 'fr-FR': 'fr' } }",
    });

    const [summary] = (await reported(root, 'EQ1408')).map(
      (diagnostic) => diagnostic.summary,
    );
    expect(summary).toContain('"fr-FR"');
    expect(summary).toContain('"ja-JP"');
    expect(summary?.indexOf('"fr-FR"')).toBeLessThan(
      summary?.indexOf('"ja-JP"') ?? -1,
    );
  });

  it('are listed in code point order, whatever order the configuration wrote them in', async () => {
    const root = await project({
      configuredLocales: ['en-US', 'ar-EG', 'ja-JP', 'de-DE'],
      policy: AGREEING,
    });

    const found = await reported(root, 'EQ1408');
    expect(found).toHaveLength(1);
    const summary = found[0]?.summary;
    expect(summary).toContain('"de-DE"');
    expect(summary).toContain('"ja-JP"');
    expect(summary?.indexOf('"de-DE"')).toBeLessThan(
      summary?.indexOf('"ja-JP"') ?? -1,
    );
  });
});

describe('a leading segment that is not a segment', () => {
  // A prefix written as the empty string claims the empty segment, and the address of the root
  // begins with one. Nothing leads the root, so neither a route nor a link at it collides.
  const EMPTY_PREFIX =
    "{ defaultLocale: 'en-US', locales: { 'en-US': '', 'ar-EG': 'ar-eg' } }";

  it('leaves the root route alone under a policy that spells an empty prefix', async () => {
    const root = await project({
      policy: EMPTY_PREFIX,
      routePaths: ['', 'ar-eg/tools'],
    });

    const found = await reported(root, 'EQ1409');
    expect(found).toHaveLength(1);
    expect(found[0]?.summary).toContain('"/ar-eg/tools"');
  });

  it('leaves a routerLink to the root alone under a policy that spells an empty prefix', async () => {
    const root = await project({
      policy: EMPTY_PREFIX,
      template:
        '<a routerLink="/">Home</a><a routerLink="/ar-eg/articles">Articles</a>',
    });

    const found = await reported(root, 'EQ1411');
    expect(found).toHaveLength(1);
    expect(found[0]?.summary).toContain('"/ar-eg/articles"');
  });

  it('leaves a route parameter alone even when a claimed segment is spelled the same', async () => {
    // Whether the value a parameter takes collides is decided per value at run time. Its name is
    // not an address, so a claim that happens to be written like it reports nothing.
    const root = await project({
      policy:
        "{ defaultLocale: 'en-US', locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' }, aliases: { ':slug': 'ar-EG', ara: 'ar-EG' } }",
      routePaths: [':slug', 'ara/help'],
    });

    const found = await reported(root, 'EQ1409');
    expect(found).toHaveLength(1);
    expect(found[0]?.summary).toContain('"/ara/help"');
  });
});

describe('a language written without its region', () => {
  it('is a locale mention as a static lang and not as a literal in an expression', async () => {
    // `lang` on one option is written as the bare subtag, so the attribute is recognised by
    // language. A string in an expression is a locale only when it is one the configuration lists:
    // `'en'` there is not a locale this owner has.
    const root = await project({
      policy: AGREEING,
      template:
        '<button type="button" lang="en" (click)="select(\'en\')">English</button>',
    });

    expect(
      (await reported(root, 'EQ1410')).map(({ severity }) => severity),
    ).toEqual(['warning']);
  });
});
