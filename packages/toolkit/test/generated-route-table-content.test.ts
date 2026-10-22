import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { compileProject, generateProject } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * What a generation writes into the route table from what the analysis read.
 *
 * The analysis reads a route's classes and the files it defers; the generated table is what the
 * application imports. A class the analysis read and the table dropped is a route served with the
 * default, and a scope the table dropped is a page that renders before its catalog arrives.
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
  '@angular/router': [
    'export declare interface Route {',
    '  path?: string;',
    '  data?: Record<string, unknown>;',
    '  component?: unknown;',
    '  loadComponent?: () => Promise<unknown>;',
    '}',
    'export type Routes = readonly Route[];',
    '',
  ].join('\n'),
  '@neolorn/equator':
    'export declare function withRouting(options: unknown): unknown;\n',
};

/**
 * @param scopes  The scopes the project has; each is given one message, `heading`.
 * @param sources  The application's files under `src/`, as lines.
 */
async function project(
  scopes: readonly string[],
  sources: Readonly<Record<string, readonly string[]>>,
): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'route-table-'));
  temporaryRoots.push(root);

  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: 'route-table',
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
        locales: ['en-US'],
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
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  for (const scope of scopes) {
    await write(
      root,
      `i18n/${scope}/en-US.yaml`,
      ['messages:', `  heading: The ${scope} heading`, ''].join('\n'),
    );
  }
  for (const [name, declarations] of Object.entries(STUBS)) {
    await write(root, `node_modules/${name}/index.d.ts`, declarations);
    await write(root, `node_modules/${name}/package.json`, manifest(name));
  }
  for (const [path, lines] of Object.entries(sources)) {
    await write(root, `src/${path}`, [...lines, ''].join('\n'));
  }
  return root;
}

async function routeTable(root: string): Promise<string> {
  const generated = await generateProject({ project: root });
  expect(generated.diagnostics.map(({ code }) => code)).toEqual([]);
  expect(generated.ok).toBe(true);
  return readFile(resolve(root, 'src/generated/i18n/routes.ts'), 'utf8');
}

/** The one line of the generated table that declares a route. */
function row(table: string, id: string): string {
  const found = table
    .split('\n')
    .find((line) => line.includes(`id: ${JSON.stringify(id)}`));
  if (found === undefined) throw new Error(`no row for ${id} in:\n${table}`);
  return found;
}

const SHELL = [
  "import { messages } from '#i18n/shell';",
  '',
  'export const heading = messages.heading.messageId;',
];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('the route table a generation writes', () => {
  it('carries the indexing, caching and sitemap classes the analysis read', async () => {
    const root = await project(['shell'], {
      'shell.ts': SHELL,
      'app.config.ts': [
        "import { withRouting } from '@neolorn/equator';",
        '',
        'export const routing = withRouting({',
        "  indexing: { field: 'audience', values: { staff: 'non-indexable' } },",
        "  caching: { field: 'area', values: { themed: 'per-visitor' } },",
        "  sitemap: { field: 'freshness', values: { daily: { changefreq: 'daily' } } },",
        '});',
      ],
      'app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export class Page {}',
        '',
        'export const routes: Routes = [',
        "  { path: 'news', component: Page, data: { audience: 'staff', area: 'themed', freshness: 'daily' } },",
        "  { path: 'plain', component: Page },",
        '];',
      ],
    });

    const table = await routeTable(root);
    const news = row(table, 'route:news');
    expect(news).toContain('indexing: "non-indexable"');
    expect(news).toContain('caching: "per-visitor"');
    expect(news).toContain('changefreq: "daily"');
    // The control: a route that declares no class is written with the default indexing and with
    // neither of the two classes that have no default.
    const plain = row(table, 'route:plain');
    expect(plain).toContain('indexing: "indexable"');
    expect(plain).not.toContain('caching:');
    expect(plain).not.toContain('sitemap:');
  });

  it('lists every scope a lazily loaded route uses, each once', async () => {
    const root = await project(['shell', 'page', 'panel'], {
      'shell.ts': SHELL,
      'page.ts': [
        "import { messages as page } from '#i18n/page';",
        "import { messages as panel } from '#i18n/panel';",
        "import { messages as shell } from '#i18n/shell';",
        '',
        'export const headings = [',
        '  shell.heading.messageId,',
        '  page.heading.messageId,',
        '  panel.heading.messageId,',
        '];',
      ],
      'app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export const routes: Routes = [',
        "  { path: 'page', loadComponent: () => import('./page') },",
        '];',
      ],
    });

    const lazy = row(await routeTable(root), 'route:page');
    expect(
      [...lazy.matchAll(/scopeId: "([a-z]+)"/gu)].map(([, id]) => id),
    ).toEqual(['page', 'panel', 'shell']);
  });

  it('gives a lazily loaded route the startup scopes and its own, and not the scope another lazy route defers', async () => {
    // A route waits for every scope in its list before it renders, so a scope that only another
    // route uses is a catalog downloaded for a page that never shows it.
    const lazy = (scope: string): readonly string[] => [
      `import { messages } from '#i18n/${scope}';`,
      '',
      'export const heading = messages.heading.messageId;',
    ];
    const root = await project(['shell', 'admin', 'reports'], {
      'shell.ts': SHELL,
      'admin.ts': lazy('admin'),
      'reports.ts': lazy('reports'),
      'app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export const routes: Routes = [',
        "  { path: 'admin', loadComponent: () => import('./admin') },",
        "  { path: 'reports', loadComponent: () => import('./reports') },",
        '];',
      ],
    });

    const table = await routeTable(root);
    const scopesOf = (id: string): readonly (string | undefined)[] =>
      [...row(table, id).matchAll(/scopeId: "([a-z]+)"/gu)].map(
        ([, scope]) => scope,
      );
    expect(scopesOf('route:admin')).toEqual(['admin', 'shell']);
    expect(scopesOf('route:reports')).toEqual(['reports', 'shell']);
  });

  it('gives a lazily loaded route no scope for a handle whose message no catalog defines', async () => {
    // An owner with no catalogs knows no message identities, so a handle written by hand is taken
    // as a use like any other. No scope holds its message, and the route that defers the file is
    // written without one.
    const root = await project([], {
      'page.ts': [
        'const handle = {',
        "  generatedAbi: 'equator-generated/1',",
        "  resultKind: 'plain',",
        "  identity: 'elsewhere:scope:message',",
        '} as const;',
        '',
        'export const handles = [handle];',
      ],
      'app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export const routes: Routes = [',
        "  { path: 'page', loadComponent: () => import('./page') },",
        '];',
      ],
    });

    const compiled = compileProject({
      owner: { providerId: 'home', generatedRootPath: 'src/generated/i18n' },
      configuration: testProjectConfiguration(['en-US']),
      catalogs: [],
      analysis: {
        projectRoot: root,
        rootNames: [resolve(root, 'src/app.routes.ts')],
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.Preserve,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          strict: true,
          skipLibCheck: true,
        },
      },
    });

    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(
      compiled.value.analysis?.messageUsages.map(({ identity }) => identity),
    ).toContain('elsewhere:scope:message');
    expect(compiled.value.analysis?.routes[0]?.deferredSourcePaths).toEqual([
      'src/page.ts',
    ]);
    const table = compiled.value.artifacts.outputPlan.files.find(({ path }) =>
      path.endsWith('routes.ts'),
    );
    expect(table?.contents).toContain('id: "route:page"');
    expect(table?.contents).not.toContain('scopes:');
  });
});
