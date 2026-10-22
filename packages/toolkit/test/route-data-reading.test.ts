import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { analyzeApplication } from '../src/static-analysis.js';
import type { RouteProjection, ToolkitDiagnostic } from '../src/index.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

/**
 * How far the build reads a route's declarations, and what it says where it stops.
 *
 * A declaration the build reads wrongly is worse than one it cannot read, because nothing says so.
 * So every form a declaration can take is either read as the application runs it or reported, and
 * a class the build cannot read is answered as the reading that exposes nothing.
 *
 * Angular's own route types are used rather than a stub, because what a spread or an expression may
 * set is decided by its type.
 */

const temporaryRoots: string[] = [];

const require = createRequire(import.meta.url);
const routerManifestPath = require.resolve('@angular/router/package.json');
const ROUTER_TYPES = resolve(
  dirname(routerManifestPath),
  (
    JSON.parse(await readFile(routerManifestPath, 'utf8')) as {
      readonly exports: { readonly '.': { readonly types: string } };
    }
  ).exports['.'].types,
);

const EQUATOR_STUB =
  'export declare function withRouting(options: unknown): unknown;\n';

const EQUATOR_MANIFEST = `${JSON.stringify(
  { name: '@neolorn/equator', version: '0.0.0', types: './index.d.ts' },
  null,
  2,
)}
`;

interface Analysed {
  readonly routes: readonly RouteProjection[];
  readonly diagnostics: readonly ToolkitDiagnostic[];
}

async function analyse(
  files: Readonly<Record<string, string>>,
): Promise<Analysed> {
  const root = await mkdtemp(resolve(tmpdir(), 'route-data-'));
  temporaryRoots.push(root);
  const all = {
    'node_modules/@neolorn/equator/index.d.ts': EQUATOR_STUB,
    'node_modules/@neolorn/equator/package.json': EQUATOR_MANIFEST,
    ...files,
  };
  for (const [path, contents] of Object.entries(all)) {
    const absolute = resolve(root, ...path.split('/'));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }
  const analysis = analyzeApplication({
    projectRoot: root,
    rootNames: Object.keys(all).map((path) => resolve(root, path)),
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      paths: { '@angular/router': [ROUTER_TYPES] },
    },
  });
  if (!analysis.ok) {
    throw Object.assign(new Error('analysis failed'), {
      diagnostics: analysis.diagnostics,
    });
  }
  return {
    routes: analysis.value.routes,
    diagnostics: analysis.diagnostics,
  };
}

/** A route file: the lines before the table, then the table. */
function routeFile(
  body: string,
  ...before: readonly string[]
): Record<string, string> {
  return {
    'src/app.routes.ts': [
      "import type { Data, Routes } from '@angular/router';",
      '',
      'export class Page {}',
      ...before,
      '',
      `export const routes: Routes = ${body};`,
      '',
    ].join('\n'),
  };
}

/** A provider file: the lines before the call, then Equator's routing options. */
function routingFile(
  options: string,
  ...before: readonly string[]
): Record<string, string> {
  return {
    'src/app.config.ts': [
      "import { withRouting } from '@neolorn/equator';",
      '',
      ...before,
      `export const routing = withRouting(${options});`,
      '',
    ].join('\n'),
  };
}

interface Row {
  readonly indexing: string | undefined;
  readonly caching: string | undefined;
  readonly sitemap?: RouteProjection['sitemap'];
}

function rows(analysed: Analysed): Readonly<Record<string, Row>> {
  return Object.fromEntries(
    analysed.routes.map((route) => [
      route.id,
      {
        indexing: route.indexing,
        caching: route.caching,
        ...(route.sitemap === undefined ? {} : { sitemap: route.sitemap }),
      },
    ]),
  );
}

function codes(analysed: Analysed): readonly string[] {
  return analysed.diagnostics.map(({ code }) => code).sort();
}

function summaries(analysed: Analysed, code: string): readonly string[] {
  return analysed.diagnostics
    .filter((diagnostic) => diagnostic.code === code)
    .map(({ summary }) => summary);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('route data written through a binding', () => {
  it('reads a class written through a const', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'account', component: Page, data: { equatorCaching: CLASS } }]",
        "const CLASS = 'per-visitor';",
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:account': { indexing: 'indexable', caching: 'per-visitor' },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-caching-class');
  });

  it('reads a class imported through a const', async () => {
    const analysed = await analyse({
      'src/classes.ts': "export const PRIVATE = 'private';\n",
      ...routeFile(
        "[{ path: 'admin', component: Page, data: { equatorIndexing: PRIVATE } }]",
        "import { PRIVATE } from './classes';",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-indexing-class');
  });

  it('reads data a const holds whole', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', component: Page, data: DATA }]",
        "const DATA = { equatorIndexing: 'non-indexable', equatorCaching: 'per-visitor' };",
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'non-indexable', caching: 'per-visitor' },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-indexing-class');
  });

  it('reads data written as a shorthand', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', component: Page, data }]",
        "const data = { equatorIndexing: 'non-indexable' };",
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'non-indexable', caching: undefined },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-indexing-class');
  });

  it('reads a spread of a const, with the later key winning either way', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'over', component: Page, data: { ...BASE, equatorCaching: 'not-stored' } }, { path: 'under', component: Page, data: { equatorIndexing: 'indexable', ...MAYBE } }]",
        "const BASE = { equatorIndexing: 'non-indexable', equatorCaching: 'per-visitor' };",
        'const MAYBE: { equatorIndexing?: string; equatorCaching?: string } = BASE;',
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:over': { indexing: 'non-indexable', caching: 'not-stored' },
      'route:under': { indexing: 'non-indexable', caching: 'per-visitor' },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-caching-class');
  });

  it('reads a value of any length', async () => {
    const value = 'staff-'.repeat(30);
    const analysed = await analyse({
      ...routeFile(
        `[{ path: 'admin', component: Page, data: { area: '${value}' } }]`,
      ),
      ...routingFile(
        `{ indexing: { field: 'area', values: { '${value}': 'private' } } }`,
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-indexing-class');
  });

  it('reads a class after any number of other entries', async () => {
    const others = Array.from(
      { length: 40 },
      (_, index) => `note${index.toString()}: 'x'`,
    ).join(', ');
    const analysed = await analyse(
      routeFile(
        `[{ path: 'admin', component: Page, data: { ${others}, equatorIndexing: 'private' } }]`,
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-indexing-class');
  });
});

describe('route data the build cannot read', () => {
  it('answers a class behind a binding it cannot follow as private, once, where it is written', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', data: { equatorIndexing: CLASS }, children: [{ path: 'users', component: Page }, { path: 'roles', component: Page }] }]",
        "let CLASS = 'indexable';",
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
      'route:admin.users': { indexing: 'private', caching: undefined },
      'route:admin.roles': { indexing: 'private', caching: undefined },
    });
    expect(summaries(analysed, 'EQ1414')).toEqual([
      'Route "/admin" sets "equatorIndexing" to something other than a string literal or a `const` bound to one, so the build cannot read which indexing class it names. It and every route that inherits its data are answered as private until the value is corrected.',
    ]);
    expect(codes(analysed)).toEqual(['EQ1414']);
    claimCapability('declaration:route-indexing-class');
  });

  it('answers a class a resolver supplies as private, for the route and what inherits it', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', resolve: { equatorIndexing: () => 'indexable' }, children: [{ path: '', component: Page }, { path: 'users', component: Page }] }]",
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
      'route:admin.users': { indexing: 'private', caching: undefined },
    });
    expect(summaries(analysed, 'EQ1414')).toEqual([
      'Route "/admin" supplies "equatorIndexing" through a resolver, which runs only when the page is visited, so the build cannot read which indexing class it names. It and every route that inherits its data are answered as private until the value is corrected.',
    ]);
    expect(codes(analysed)).toEqual(['EQ1414']);
    claimCapability('declaration:route-indexing-class');
  });

  it('answers a class a spread may set as private, and a caching class as not-stored', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', component: Page, data: { ...shared(), equatorRouteId: 'route:admin' } }]",
        'declare function shared(): Data;',
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: 'not-stored' },
    });
    expect(codes(analysed)).toEqual(['EQ1413', 'EQ1414']);
    expect(summaries(analysed, 'EQ1413')[0]).toContain(
      'may set "equatorCaching" through a spread the build cannot follow',
    );
    expect(summaries(analysed, 'EQ1414')[0]).toContain(
      'may set "equatorIndexing" through a spread the build cannot follow',
    );
    claimCapability('declaration:route-caching-class');
  });

  it('answers a class a computed key may set as private', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', component: Page, data: { [KEY]: 'indexable' } }]",
        "declare const KEY: 'equatorIndexing' | 'title';",
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
    });
    expect(codes(analysed)).toEqual(['EQ1414']);
    expect(summaries(analysed, 'EQ1414')[0]).toContain(
      'may set "equatorIndexing" through a computed key the build cannot read',
    );
    claimCapability('declaration:route-indexing-class');
  });

  it('follows eight spreads deep, and answers a class past them as private', async () => {
    const chain = (length: number): readonly string[] => [
      "const D0 = { equatorIndexing: 'non-indexable' };",
      ...Array.from(
        { length },
        (_, index) =>
          `const D${(index + 1).toString()} = { ...D${index.toString()} };`,
      ),
    ];
    const read = await analyse(
      routeFile("[{ path: 'admin', component: Page, data: D8 }]", ...chain(8)),
    );
    const past = await analyse(
      routeFile("[{ path: 'admin', component: Page, data: D9 }]", ...chain(9)),
    );

    expect(rows(read)).toEqual({
      'route:admin': { indexing: 'non-indexable', caching: undefined },
    });
    expect(codes(read)).toEqual([]);
    expect(rows(past)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
    });
    expect(summaries(past, 'EQ1414')[0]).toContain(
      'may set "equatorIndexing" through a spread the build cannot follow',
    );
    expect(codes(past)).toEqual(['EQ1414']);
    claimCapability('declaration:route-indexing-class');
  });

  it('does not name a route whose data it cannot read at all, and reports it', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', component: Page, data: shared() }, { path: 'news', component: Page }]",
        'declare function shared(): Data;',
      ),
    );

    expect(rows(analysed)).toEqual({
      'route:news': { indexing: 'indexable', caching: undefined },
    });
    expect(summaries(analysed, 'EQ1404')).toEqual([
      'Route "/admin" takes its `data` from an expression the build cannot read, which may set "equatorRouteId", so the build cannot read the identity it declares, and it is not indexed until the value is corrected.',
    ]);
    expect(codes(analysed)).toEqual(['EQ1404']);
  });
});

describe('routing options written through a binding', () => {
  it('reads options a const holds whole', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'admin', component: Page, data: { area: 'staff' } }]",
      ),
      ...routingFile(
        'OPTIONS',
        "const OPTIONS = { indexing: { field: 'area', values: { staff: 'private' } } };",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-indexing-class');
  });

  it('reads every field, table and value through consts', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { area: 'themed', freshness: 'daily', updated: '2026-09-01' } }]",
      ),
      ...routingFile(
        '{ caching: { field: AREA, values: CACHING }, sitemap: { field: FRESHNESS, values: SITEMAP, lastmodField: UPDATED } }',
        "const AREA = 'area';",
        "const THEMED = 'per-visitor';",
        'const CACHING = { themed: THEMED };',
        "const FRESHNESS = 'freshness';",
        "const DAILY = 'daily';",
        'const HALF = 0.5;',
        'const SITEMAP = { daily: { changefreq: DAILY, priority: HALF } };',
        "const UPDATED = 'updated';",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:news': {
        indexing: 'indexable',
        caching: 'per-visitor',
        sitemap: { changefreq: 'daily', priority: 0.5, lastmod: '2026-09-01' },
      },
    });
    expect(codes(analysed)).toEqual([]);
    claimCapability('declaration:route-sitemap-entry');
  });
});

describe('routing options the build cannot read', () => {
  it('answers the routes of an indexing entry it cannot read as private', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'admin', component: Page, data: { area: 'staff' } }, { path: 'news', component: Page, data: { area: 'editorial' } }]",
      ),
      ...routingFile(
        "{ indexing: { field: 'area', values: { staff: STAFF } } }",
        "let STAFF = 'indexable';",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
      'route:news': { indexing: 'indexable', caching: undefined },
    });
    expect(summaries(analysed, 'EQ1414')).toEqual([
      'This owner\'s indexing declaration cannot be used as written: "staff" does not name its class as a string literal or a `const` bound to one, so its routes are answered as private.',
    ]);
    expect(codes(analysed)).toEqual(['EQ1414']);
    claimCapability('declaration:route-indexing-class');
  });

  it('answers every route that sets a field whose table it cannot read as private', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'admin', component: Page, data: { area: 'staff' } }, { path: 'news', component: Page }]",
      ),
      ...routingFile(
        "{ indexing: { field: 'area', values: VALUES } }",
        "let VALUES = { staff: 'indexable' };",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
      'route:news': { indexing: 'indexable', caching: undefined },
    });
    expect(codes(analysed)).toEqual(['EQ1414']);
    claimCapability('declaration:route-indexing-class');
  });

  it('reports an indexing field it cannot read, and reads the default field', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'admin', component: Page, data: { equatorIndexing: 'private' } }, { path: 'staff', component: Page, data: { area: 'staff' } }]",
      ),
      ...routingFile(
        "{ indexing: { field: FIELD, values: { staff: 'private' } } }",
        "let FIELD = 'area';",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
      'route:staff': { indexing: 'indexable', caching: undefined },
    });
    expect(summaries(analysed, 'EQ1414')).toEqual([
      "This owner's indexing declaration cannot be used as written: the build cannot read its `field` as a string literal or a `const` bound to one, so it cannot tell which field its routes use, and they are read from `equatorIndexing`.",
    ]);
    expect(codes(analysed)).toEqual(['EQ1414']);
    claimCapability('declaration:route-indexing-class');
  });

  it('reports a sitemap field it cannot read, and claims nothing', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { freshness: 'daily' } }]",
      ),
      ...routingFile(
        "{ sitemap: { field: FIELD, values: { daily: { changefreq: 'daily' } } } }",
        "let FIELD = 'freshness';",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:news': { indexing: 'indexable', caching: undefined },
    });
    expect(codes(analysed)).toEqual(['EQ1412']);
    claimCapability('declaration:route-sitemap-entry');
  });

  it('reports a sitemap class it cannot read, and keeps the others', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { freshness: 'daily' } }, { path: 'archive', component: Page, data: { freshness: 'yearly' } }]",
      ),
      ...routingFile(
        "{ sitemap: { field: 'freshness', values: { daily: DAILY, yearly: { changefreq: 'yearly' } } } }",
        "let DAILY = { changefreq: 'daily' };",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:news': { indexing: 'indexable', caching: undefined },
      'route:archive': {
        indexing: 'indexable',
        caching: undefined,
        sitemap: { changefreq: 'yearly' },
      },
    });
    expect(codes(analysed)).toEqual(['EQ1412']);
    claimCapability('declaration:route-sitemap-entry');
  });

  it('reports a date field it cannot read, and keeps the class', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { freshness: 'daily', updated: '2026-09-01' } }]",
      ),
      ...routingFile(
        "{ sitemap: { field: 'freshness', values: { daily: { changefreq: 'daily' } }, lastmodField: UPDATED } }",
        "let UPDATED = 'updated';",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:news': {
        indexing: 'indexable',
        caching: undefined,
        sitemap: { changefreq: 'daily' },
      },
    });
    expect(codes(analysed)).toEqual(['EQ1412']);
    claimCapability('declaration:route-sitemap-entry');
  });

  it('reports a sitemap class or date a route declares in a way it cannot read', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { freshness: FRESHNESS, updated: UPDATED } }]",
        "let FRESHNESS = 'daily';",
        "let UPDATED = '2026-09-01';",
      ),
      ...routingFile(
        "{ sitemap: { field: 'freshness', values: { daily: { changefreq: 'daily' } }, lastmodField: 'updated' } }",
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:news': { indexing: 'indexable', caching: undefined },
    });
    expect(codes(analysed)).toEqual(['EQ1412', 'EQ1412']);
    claimCapability('declaration:route-sitemap-entry');
  });

  it('reports options it cannot read, once for each declaration they may hold', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'admin', component: Page, data: { equatorIndexing: 'private' } }]",
      ),
      ...routingFile('options()', 'declare function options(): unknown;'),
    });

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
    });
    expect(codes(analysed)).toEqual(['EQ1412', 'EQ1413', 'EQ1414']);
    claimCapability('declaration:route-indexing-class');
  });
});

describe('route tables the build does not follow', () => {
  it('reports children taken from a route table, and keeps that table out of the root', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'section', component: Page, children: KIDS }]",
        "const KIDS: Routes = [{ path: 'detail', component: Page }];",
      ),
    );

    expect(Object.keys(rows(analysed))).toEqual(['route:section']);
    expect(summaries(analysed, 'EQ1406')).toEqual([
      '"/section" takes its children from `KIDS`, which Equator does not follow, so their addresses stay outside the localized route table and are served at their canonical spelling, in the default locale. Declare those children inline to localize them.',
    ]);
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('reports children taken from a binding that is not a route table', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'section', component: Page, children: KIDS }]",
        "const KIDS = [{ path: 'detail', component: Page }];",
      ),
    );

    expect(Object.keys(rows(analysed))).toEqual(['route:section']);
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('reports children written as a shorthand, and keeps that table out of the root', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'section', component: Page, children }]",
        "const children: Routes = [{ path: 'detail', component: Page }];",
      ),
    );

    expect(Object.keys(rows(analysed))).toEqual(['route:section']);
    expect(summaries(analysed, 'EQ1406')[0]).toContain(
      'takes its children from `children`',
    );
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('reports children a spread may set', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ ...extra, path: 'section', component: Page }]",
        'declare const extra: { children?: Routes };',
      ),
    );

    expect(Object.keys(rows(analysed))).toEqual(['route:section']);
    expect(summaries(analysed, 'EQ1406')[0]).toContain(
      '"/section" may take its `children` from a spread or a computed key',
    );
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('reports a route table spread in among child routes, and keeps it out of the root', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'section', component: Page, children: [...MORE, { path: 'own', component: Page }] }]",
        "const MORE: Routes = [{ path: 'detail', component: Page }];",
      ),
    );

    expect(Object.keys(rows(analysed))).toEqual([
      'route:section',
      'route:section.own',
    ]);
    expect(summaries(analysed, 'EQ1406')).toEqual([
      'A spread of `MORE` in the children of "/section" brings in routes Equator does not follow, so their addresses stay outside the localized route table and are served at their canonical spelling, in the default locale. Declare those routes inline to localize them.',
    ]);
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('reads a route table spread in among root routes as root routes', async () => {
    const analysed = await analyse(
      routeFile(
        "[...MORE, { path: 'own', component: Page }]",
        "const MORE: Routes = [{ path: 'detail', component: Page }];",
      ),
    );

    expect(Object.keys(rows(analysed)).sort()).toEqual([
      'route:detail',
      'route:own',
    ]);
    expect(codes(analysed)).toEqual([]);
  });

  it('reports a spread among root routes that is not a route table', async () => {
    const analysed = await analyse(
      routeFile(
        "[...MORE, { path: 'own', component: Page }]",
        "const MORE = [{ path: 'detail', component: Page }];",
      ),
    );

    expect(Object.keys(rows(analysed))).toEqual(['route:own']);
    expect(summaries(analysed, 'EQ1406')[0]).toContain(
      'A spread of `MORE` in the route table `routes`',
    );
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('reports a route written as a binding', async () => {
    const analysed = await analyse(
      routeFile(
        "[DETAIL, { path: 'own', component: Page }]",
        "const DETAIL = { path: 'detail', component: Page };",
      ),
    );

    expect(Object.keys(rows(analysed))).toEqual(['route:own']);
    expect(summaries(analysed, 'EQ1406')).toEqual([
      'An entry of the route table `routes` is written as `DETAIL`, which Equator does not follow, so its address stays outside the localized route table and is served at its canonical spelling, in the default locale. Declare the route inline to localize it.',
    ]);
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('reports a route table written as a call', async () => {
    const analysed = await analyse(
      routeFile('build()', 'declare function build(): Routes;'),
    );

    expect(analysed.routes).toEqual([]);
    expect(summaries(analysed, 'EQ1406')).toEqual([
      'The route table `routes` is written as a call to `build`, which Equator does not follow, so its addresses stay outside the localized route table and are served at their canonical spelling, in the default locale. Declare its routes as an array literal to localize them.',
    ]);
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('keeps a table spread in among the routes of a child route file out of the root', async () => {
    const analysed = await analyse({
      'src/section/more.ts': [
        "import type { Routes } from '@angular/router';",
        'export class Extra {}',
        "export const moreRoutes: Routes = [{ path: 'extra', component: Extra }];",
        '',
      ].join('\n'),
      'src/section/routes.ts': [
        "import type { Routes } from '@angular/router';",
        "import { moreRoutes } from './more';",
        'export class Detail {}',
        "export const sectionRoutes: Routes = [{ path: 'detail', component: Detail }, ...moreRoutes];",
        '',
      ].join('\n'),
      'src/app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        "export const routes: Routes = [{ path: 'section', loadChildren: () => import('./section/routes').then((m) => m.sectionRoutes) }];",
        '',
      ].join('\n'),
    });

    expect(Object.keys(rows(analysed))).toEqual(['route:section']);
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('keeps a table named both at the root and below it at the root', async () => {
    const analysed = await analyse(
      routeFile(
        "[...SHARED, { path: 'section', component: Page, children: SHARED }]",
        "const SHARED: Routes = [{ path: 'detail', component: Page }];",
      ),
    );

    expect(Object.keys(rows(analysed)).sort()).toEqual([
      'route:detail',
      'route:section',
    ]);
    expect(codes(analysed)).toEqual(['EQ1406']);
  });
});

describe('a provider file', () => {
  it('is read from its source and never run', async () => {
    // Section 14 of `specs/07-routing-rendering-and-seo.spec.md`: the build obtains the indexing
    // declaration without executing consumer code. The file below leaves a mark on the global object
    // when it runs, so a build that ran it to learn the table would still answer correctly and be
    // caught by the mark rather than by the answer.
    const MARK = 'equatorProviderFileEvaluated';
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'admin', component: Page, data: { area: 'staff' } }]",
      ),
      ...routingFile(
        "{ indexing: { field: 'area', values: { staff: 'private' } } }",
        `Reflect.set(globalThis, '${MARK}', true);`,
      ),
    });

    expect(rows(analysed)).toEqual({
      'route:admin': { indexing: 'private', caching: undefined },
    });
    expect(Reflect.has(globalThis, MARK)).toBe(false);
  });
});
