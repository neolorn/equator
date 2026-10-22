/**
 * @vitest-environment jsdom
 */
// Angular's published packages declare their services in a form that is compiled when they load,
// which needs the compiler loaded first.
import '@angular/compiler';

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { provideLocationMocks } from '@angular/common/testing';
import { Component, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  PRIMARY_OUTLET,
  Router,
  provideRouter,
  withRouterConfig,
  type ActivatedRouteSnapshot,
  type Routes,
} from '@angular/router';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { analyzeApplication } from '../src/static-analysis.js';
import type { RouteProjection, ToolkitDiagnostic } from '../src/index.js';

/**
 * What a page receives from the routes above it.
 *
 * Angular gives a child route its parent's data, always under its default strategy and under
 * `emptyOnly` only where the child's path is empty or the parent renders no component. The runtime
 * reads a page's caching and indexing classes from the generated table and nowhere else, so the
 * table has to hold what Angular gives the page, or a class declared on a parent never reaches the
 * pages beneath it.
 *
 * The analysis here reads Angular's own declarations rather than a stub of them, because which
 * calls configure the router is decided by what their symbols resolve to.
 */

type Strategy = 'always' | 'emptyOnly' | undefined;

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
  const root = await mkdtemp(resolve(tmpdir(), 'route-inheritance-'));
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

function routeFile(body: string): string {
  return [
    "import type { Routes } from '@angular/router';",
    '',
    'export class Page {}',
    '',
    `export const routes: Routes = ${body};`,
    '',
  ].join('\n');
}

/** The provider file: Equator's routing options, and whatever configures the router. */
function configFile(...lines: readonly string[]): string {
  return [
    "import { ROUTER_CONFIGURATION, RouterModule, provideRouter, withRouterConfig, type ExtraOptions } from '@angular/router';",
    "import { withRouting } from '@neolorn/equator';",
    "import { routes } from './app.routes';",
    '',
    "export const routing = withRouting({ sitemap: { field: 'freshness', values: { daily: { changefreq: 'daily' }, archive: { changefreq: 'yearly', priority: 0.2 } }, lastmodField: 'updated' } });",
    ...lines,
    '',
  ].join('\n');
}

function strategyLine(strategy: Strategy): string {
  return strategy === undefined
    ? 'export const router = provideRouter(routes);'
    : `export const router = provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: '${strategy}' }));`;
}

function codes(analysed: Analysed): readonly string[] {
  return analysed.diagnostics.map(({ code }) => code);
}

interface Row {
  readonly caching: string | undefined;
  readonly indexing: string | undefined;
  readonly sitemap: RouteProjection['sitemap'];
}

function table(analysed: Analysed): Readonly<Record<string, Row>> {
  return Object.fromEntries(
    analysed.routes.map((route) => [
      route.id,
      {
        caching: route.caching,
        indexing: route.indexing,
        sitemap: route.sitemap,
      },
    ]),
  );
}

/** The same text the analysis reads, run the way the application runs it. */
function evaluate(source: string): Routes {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = {
    exports: {} as { routes?: Routes; Page?: Type<unknown> },
  };
  new Function('module', 'exports', outputText)(module, module.exports);
  if (
    module.exports.routes === undefined ||
    module.exports.Page === undefined
  ) {
    throw new Error('the route file exports no routes or no page');
  }
  // Angular refuses a lazily loaded class that is not a standalone component.
  Component({ template: '' })(module.exports.Page);
  return module.exports.routes;
}

/** Angular's router over `routes`, as the application configures it. */
function routerFor(routes: Routes, strategy: Strategy): Router {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        routes,
        ...(strategy === undefined
          ? []
          : [withRouterConfig({ paramsInheritanceStrategy: strategy })]),
      ),
      provideLocationMocks(),
    ],
  });
  return TestBed.inject(Router);
}

/** Every route Angular renders at `address`, the page and whatever renders beside it. */
async function renderedAt(
  routes: Routes,
  strategy: Strategy,
  address: string,
): Promise<ActivatedRouteSnapshot> {
  const router = routerFor(routes, strategy);
  expect(await router.navigateByUrl(address)).toBe(true);
  return router.routerState.snapshot.root;
}

/** The data Angular's router gives the page at `address`. */
async function dataAt(
  routes: Routes,
  strategy: Strategy,
  address: string,
): Promise<Readonly<Record<string, unknown>>> {
  // The page is the deepest route in the primary outlet. A route in a named outlet renders beside
  // it.
  let page = await renderedAt(routes, strategy, address);
  for (;;) {
    const next = page.children.find(({ outlet }) => outlet === PRIMARY_OUTLET);
    if (next === undefined) return page.data;
    page = next;
  }
}

/** The row the generated table must hold for data Angular gave a page, under the policies above. */
function rowFor(data: Readonly<Record<string, unknown>>): Row {
  const sitemapClasses: Readonly<
    Record<string, { changefreq?: string; priority?: number }>
  > = {
    daily: { changefreq: 'daily' },
    archive: { changefreq: 'yearly', priority: 0.2 },
  };
  const claim = {
    ...(typeof data['freshness'] === 'string'
      ? sitemapClasses[data['freshness']]
      : {}),
    ...(typeof data['updated'] === 'string'
      ? { lastmod: data['updated'] }
      : {}),
  };
  return {
    caching:
      typeof data['equatorCaching'] === 'string'
        ? data['equatorCaching']
        : undefined,
    indexing:
      typeof data['equatorIndexing'] === 'string'
        ? data['equatorIndexing']
        : 'indexable',
    sitemap: Object.keys(claim).length === 0 ? undefined : claim,
  };
}

// Every shape the rule distinguishes, each commented where it is declared.
const INHERITING_ROUTES = routeFile(`[
  // A parent that renders a component. A child with a path of its own inherits only under
  // 'always'; an empty child inherits under either, and is the page at the parent's address.
  { path: 'shop', component: Page, data: { equatorCaching: 'per-visitor', equatorIndexing: 'private', freshness: 'daily' }, children: [
    { path: '', component: Page, data: { updated: '2026-09-01' } },
    { path: 'cart', component: Page, data: { equatorIndexing: 'non-indexable' } },
    { path: ':item', component: Page },
  ] },
  // A parent that renders nothing passes its data down under either strategy, at every depth,
  // and a child's own key wins over what it inherits.
  { path: 'account', data: { equatorCaching: 'not-stored', equatorIndexing: 'private' }, children: [
    { path: 'profile', component: Page },
    { path: 'orders', component: Page, data: { equatorCaching: 'per-visitor', freshness: 'archive' }, children: [
      { path: ':id', component: Page, data: { equatorIndexing: 'non-indexable' } },
    ] },
  ] },
  // A component loaded later is still one the parent renders.
  { path: 'guides', loadComponent: () => Promise.resolve(Page), data: { equatorIndexing: 'non-indexable' }, children: [
    { path: 'intro', component: Page },
  ] },
  // A shell at the root address, with its path written after its children.
  { component: Page, data: { equatorCaching: 'per-visitor', freshness: 'daily' }, children: [
    { path: 'news', component: Page },
    { path: '', component: Page, data: { equatorIndexing: 'non-indexable' } },
  ], path: '' },
]`);

const INHERITING_IDENTITIES = [
  'route:shop',
  'route:shop.cart',
  'route:shop._',
  'route:account',
  'route:account.profile',
  'route:account.orders',
  'route:account.orders._',
  'route:guides',
  'route:guides.intro',
  'route:news',
  'route:_index',
];

beforeAll(() => {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

afterAll(() => {
  TestBed.resetTestEnvironment();
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('route data inheritance', () => {
  it.each<[string, Strategy]>([
    ['as Angular does by default', undefined],
    ["under 'always'", 'always'],
    ["under 'emptyOnly'", 'emptyOnly'],
  ])(
    'holds the data Angular gives every page, %s',
    async (_label, strategy) => {
      const analysed = await analyse({
        'src/app.routes.ts': INHERITING_ROUTES,
        'src/app.config.ts': configFile(strategyLine(strategy)),
      });
      const routes = evaluate(INHERITING_ROUTES);

      expect(analysed.routes.map(({ id }) => id).sort()).toEqual(
        [...INHERITING_IDENTITIES].sort(),
      );
      const expected: Record<string, Row> = {};
      for (const route of analysed.routes) {
        const address = `/${route.path
          .split('/')
          .map((segment) => (segment.startsWith(':') ? 'x1' : segment))
          .join('/')}`;
        expected[route.id] = rowFor(await dataAt(routes, strategy, address));
      }
      expect(table(analysed)).toEqual(expected);
    },
  );

  it('tells the two strategies apart', async () => {
    const always = await analyse({
      'src/app.routes.ts': INHERITING_ROUTES,
      'src/app.config.ts': configFile(strategyLine('always')),
    });
    const emptyOnly = await analyse({
      'src/app.routes.ts': INHERITING_ROUTES,
      'src/app.config.ts': configFile(strategyLine('emptyOnly')),
    });

    expect(table(always)['route:shop.cart']).toEqual({
      caching: 'per-visitor',
      indexing: 'non-indexable',
      sitemap: { changefreq: 'daily' },
    });
    expect(table(emptyOnly)['route:shop.cart']).toEqual({
      caching: undefined,
      indexing: 'non-indexable',
      sitemap: undefined,
    });
    expect(codes(always)).not.toContain('EQ1416');
    expect(codes(emptyOnly)).not.toContain('EQ1416');
  });
});

/** A parent whose class reaches its child only under `always`. */
const SHOP = routeFile(
  "[{ path: 'shop', component: Page, data: { equatorCaching: 'per-visitor' }, children: [{ path: 'cart', component: Page }] }]",
);

async function cartCaching(
  ...config: readonly string[]
): Promise<{ readonly caching: string; readonly codes: readonly string[] }> {
  const analysed = await analyse({
    'src/app.routes.ts': SHOP,
    'src/app.config.ts': configFile(...config),
  });
  const cart = analysed.routes.find(({ id }) => id === 'route:shop.cart');
  return { caching: cart?.caching ?? 'absent', codes: codes(analysed) };
}

describe('the router inheritance strategy', () => {
  it('reads it from RouterModule.forRoot', async () => {
    expect(
      await cartCaching(
        "export const routerModule = RouterModule.forRoot(routes, { paramsInheritanceStrategy: 'emptyOnly' });",
      ),
    ).toEqual({ caching: 'absent', codes: [] });
  });

  it('reads it from a ROUTER_CONFIGURATION provider', async () => {
    expect(
      await cartCaching(
        "export const providers = [{ provide: ROUTER_CONFIGURATION, useValue: { paramsInheritanceStrategy: 'emptyOnly' } }];",
      ),
    ).toEqual({ caching: 'absent', codes: [] });
  });

  it('reads a strategy written through a const', async () => {
    expect(
      await cartCaching(
        "const STRATEGY = 'emptyOnly';",
        'export const router = provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: STRATEGY }));',
      ),
    ).toEqual({ caching: 'absent', codes: [] });
  });

  it('reads a ROUTER_CONFIGURATION value written as a shorthand', async () => {
    expect(
      await cartCaching(
        "const useValue = { paramsInheritanceStrategy: 'emptyOnly' } as const;",
        'export const providers = [{ provide: ROUTER_CONFIGURATION, useValue }];',
      ),
    ).toEqual({ caching: 'absent', codes: [] });
  });

  it('reports a strategy it cannot read, and inherits always', async () => {
    const result = await cartCaching(
      "let STRATEGY: 'emptyOnly' | 'always' = 'emptyOnly';",
      'export const router = provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: STRATEGY }));',
    );

    expect(result).toEqual({ caching: 'per-visitor', codes: ['EQ1416'] });
  });

  it('reports a strategy a spread may set', async () => {
    const result = await cartCaching(
      'declare const base: ExtraOptions;',
      "export const router = provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly', ...base }));",
    );

    expect(result).toEqual({ caching: 'per-visitor', codes: ['EQ1416'] });
  });

  it('reports a configuration a factory produces', async () => {
    const result = await cartCaching(
      "export const providers = [{ provide: ROUTER_CONFIGURATION, useFactory: () => ({ paramsInheritanceStrategy: 'emptyOnly' }) }];",
    );

    expect(result).toEqual({ caching: 'per-visitor', codes: ['EQ1416'] });
  });

  it('reports a second configuration beside one that sets the strategy', async () => {
    // Angular provides the token non-multi, so either configuration may replace the other whole.
    const result = await cartCaching(
      "export const router = provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' }));",
      'export const routerModule = RouterModule.forRoot(routes);',
    );

    expect(result).toEqual({ caching: 'per-visitor', codes: ['EQ1416'] });
  });

  it('says nothing of configurations that leave the strategy alone', async () => {
    const result = await cartCaching(
      "export const router = provideRouter(routes, withRouterConfig({ urlUpdateStrategy: 'deferred' }));",
      'export const routerModule = RouterModule.forRoot(routes);',
    );

    expect(result).toEqual({ caching: 'per-visitor', codes: [] });
  });

  it('ignores a withRouterConfig that is not Angular’s', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': SHOP,
      'src/app.config.ts': [
        'function withRouterConfig(options: unknown): unknown {',
        '  return options;',
        '}',
        "export const router = withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' });",
        '',
      ].join('\n'),
    });

    expect(table(analysed)['route:shop.cart']?.caching).toBe('per-visitor');
    expect(codes(analysed)).toEqual([]);
  });
});

describe('what a route inherits', () => {
  it('lets a child inherit where a spread may supply its parent’s component', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': routeFile(
        "[{ path: 'shop', ...extra, data: { equatorIndexing: 'private' }, children: [{ path: 'cart', component: Page }] }]",
      ).replace(
        'export class Page {}',
        'export class Page {}\ndeclare const extra: { component?: typeof Page };',
      ),
      'src/app.config.ts': configFile(strategyLine('emptyOnly')),
    });

    expect(table(analysed)['route:shop.cart']?.indexing).toBe('private');
  });

  it('reports a value it cannot read once, where it is written', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': routeFile(
        "[{ path: 'account', data: { equatorCaching: CLASS }, children: [{ path: 'profile', component: Page }, { path: 'orders', component: Page }] }]",
      ).replace(
        'export class Page {}',
        "export class Page {}\nlet CLASS: string = 'per-visitor';",
      ),
      'src/app.config.ts': configFile(),
    });

    expect(
      analysed.diagnostics.filter(({ code }) => code === 'EQ1413'),
    ).toHaveLength(1);
    expect(
      Object.fromEntries(
        analysed.routes.map(({ id, caching }) => [id, caching]),
      ),
    ).toEqual({
      'route:account': 'not-stored',
      'route:account.profile': 'not-stored',
      'route:account.orders': 'not-stored',
    });
  });

  it('reports a malformed date once, where it is written', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': routeFile(
        "[{ path: 'news', data: { updated: 'yesterday' }, children: [{ path: 'world', component: Page }, { path: 'sport', component: Page }] }]",
      ),
      'src/app.config.ts': configFile(),
    });

    expect(
      analysed.diagnostics.filter(({ code }) => code === 'EQ1412'),
    ).toHaveLength(1);
    expect(analysed.routes.map(({ sitemap }) => sitemap)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('keeps the deepest route at a shared address wherever its path is written', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': routeFile(
        "[{ path: 'a', component: Page, data: { equatorIndexing: 'private' }, children: [{ component: Page, children: [{ path: '', component: Page, data: { equatorIndexing: 'non-indexable' } }], path: '' }] }]",
      ),
      'src/app.config.ts': configFile(),
    });

    expect(table(analysed)).toEqual({
      'route:a': {
        caching: undefined,
        indexing: 'non-indexable',
        sitemap: undefined,
      },
    });
  });

  it('names a shared address by the identity a route above the page declares, and no other address', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': routeFile(
        "[{ path: 'admin', data: { equatorRouteId: 'route:console' }, component: Page, children: [{ path: '', component: Page }, { path: 'users', component: Page }] }]",
      ),
      'src/app.config.ts': configFile(),
    });

    expect(analysed.routes.map(({ id }) => id)).toEqual([
      'route:console',
      'route:admin.users',
    ]);
  });
});

// Every shape that decides which route renders at an address another route shares, each commented
// where it is declared.
const SHARED_ROUTES = routeFile(`[
  // An empty-path route in a named outlet renders beside the page, which is its parent.
  { path: 'aside', component: Page, data: { equatorIndexing: 'non-indexable' }, children: [
    { path: '', outlet: 'aux', component: Page, data: { equatorIndexing: 'private' } },
  ] },
  // Written first, it still leaves the page to the empty-path route in the primary outlet.
  { path: 'beside', component: Page, children: [
    { path: '', outlet: 'aux', component: Page, data: { equatorIndexing: 'private' } },
    { path: '', component: Page, data: { equatorIndexing: 'non-indexable' } },
  ] },
  // An outlet named through a const is read through it.
  { path: 'side', component: Page, data: { equatorCaching: 'per-visitor' }, children: [
    { path: '', outlet: SIDE, component: Page, data: { equatorCaching: 'not-stored' } },
  ] },
  // A wildcard Angular reaches first renders, and receives what a child with a path of its own
  // does.
  { path: 'caught', component: Page, data: { equatorCaching: 'per-visitor' }, children: [
    { path: '**', component: Page, data: { equatorIndexing: 'non-indexable' } },
    { path: '', component: Page, data: { equatorIndexing: 'private' } },
  ] },
  // A wildcard names no address, so its parent's identity names the page.
  { path: 'fallback', component: Page, data: { equatorRouteId: 'route:lost-and-found', freshness: 'daily' }, children: [
    { path: '**', component: Page, data: { equatorRouteId: 'route:anything', equatorIndexing: 'non-indexable' } },
  ] },
  // A child that needs a segment does not render at its parent's address, whether its path is
  // written in place or through a const, and a guard list with nothing in it guards nothing.
  { path: 'listing', component: Page, children: [
    { path: ':id', component: Page, data: { equatorIndexing: 'private' } },
    { path: LIST, component: Page, data: { equatorIndexing: 'private' } },
    { path: '', canMatch: [], component: Page, data: { equatorIndexing: 'non-indexable' } },
  ] },
]`).replace(
  'export class Page {}',
  "export class Page {}\nconst SIDE = 'aux';\nconst LIST = 'list';",
);

// What Angular decides when the page is visited. `allow` is read then, so a test can show both
// answers.
const DECIDED_ROUTES = routeFile(`[
  { path: 'matched', component: Page, data: { equatorCaching: 'per-visitor', freshness: 'daily' }, children: [
    { matcher: () => (allow() ? { consumed: [] } : null), component: Page, data: { equatorIndexing: 'non-indexable' } },
    { path: '', component: Page },
  ] },
  { path: 'guarded', component: Page, data: { equatorCaching: 'per-visitor', freshness: 'daily' }, children: [
    { path: '', canMatch: [() => allow()], component: Page, data: { equatorIndexing: 'non-indexable' } },
    { path: '', component: Page },
  ] },
  // Nothing below a redirect renders at the address.
  { path: 'moved', component: Page, children: [
    { path: '', redirectTo: 'here', pathMatch: 'full', data: { equatorIndexing: 'private' } },
    { path: 'here', component: Page },
  ] },
]`).replace(
  'export class Page {}',
  'export class Page {}\nconst allow = (): boolean => (globalThis as { allow?: boolean }).allow === true;',
);

/** Every route Angular activates below `snapshot`, in every outlet, by the file its data names. */
function renderedFiles(snapshot: ActivatedRouteSnapshot): readonly string[] {
  const files: string[] = [];
  const visit = (node: ActivatedRouteSnapshot): void => {
    const file = node.data['file'];
    if (typeof file === 'string') files.push(`src/${file}.ts`);
    node.children.forEach(visit);
  };
  visit(snapshot);
  return files.sort();
}

function diagnosticsNaming(
  analysed: Analysed,
  code: string,
  address: string,
): readonly ToolkitDiagnostic[] {
  return analysed.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === code &&
      diagnostic.summary.includes(JSON.stringify(address)),
  );
}

describe('the page at a shared address', () => {
  it.each<[string, Strategy]>([
    ['as Angular does by default', undefined],
    ["under 'always'", 'always'],
    ["under 'emptyOnly'", 'emptyOnly'],
  ])('is the route Angular renders there, %s', async (_label, strategy) => {
    const analysed = await analyse({
      'src/app.routes.ts': SHARED_ROUTES,
      'src/app.config.ts': configFile(strategyLine(strategy)),
    });
    const routes = evaluate(SHARED_ROUTES);

    expect(analysed.routes.map(({ id }) => id).sort()).toEqual(
      [
        'route:aside',
        'route:beside',
        'route:side',
        'route:caught',
        'route:lost-and-found',
        'route:listing',
        'route:listing._',
      ].sort(),
    );
    const expected: Record<string, Row> = {};
    for (const route of analysed.routes) {
      const address = `/${route.path
        .split('/')
        .map((segment) => (segment.startsWith(':') ? 'x1' : segment))
        .join('/')}`;
      expected[route.id] = rowFor(await dataAt(routes, strategy, address));
    }
    expect(table(analysed)).toEqual(expected);
    // The const path is reported for what it hides below it, and the empty-path child the
    // wildcard hides for never rendering.
    expect([...codes(analysed)].sort()).toEqual(['EQ1405', 'EQ1406']);
    expect(diagnosticsNaming(analysed, 'EQ1405', '/caught')).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ]);
  });

  it('is answered as private and not-stored where Angular decides it when the page is visited', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': DECIDED_ROUTES,
      'src/app.config.ts': configFile(),
    });
    const routes = evaluate(DECIDED_ROUTES);
    const page = async (allow: boolean, address: string): Promise<Row> => {
      (globalThis as { allow?: boolean }).allow = allow;
      try {
        return rowFor(await dataAt(routes, undefined, address));
      } finally {
        delete (globalThis as { allow?: boolean }).allow;
      }
    };

    for (const address of ['/matched', '/guarded']) {
      expect(await page(true, address)).not.toEqual(await page(false, address));
    }
    const rows = table(analysed);
    for (const id of ['route:matched', 'route:guarded']) {
      expect(rows[id]).toEqual({
        caching: 'not-stored',
        indexing: 'private',
        sitemap: undefined,
      });
    }
    for (const [address, cause] of [
      ['/matched', "a child's `matcher`"],
      ['/guarded', "a child's `canMatch` guard"],
    ] as const) {
      for (const code of ['EQ1413', 'EQ1414']) {
        expect(diagnosticsNaming(analysed, code, address)).toEqual([
          expect.objectContaining({
            severity: 'warning',
            summary: expect.stringContaining(cause),
          }),
        ]);
      }
    }
    expect(rows['route:moved']?.indexing).not.toBe('private');
    expect(diagnosticsNaming(analysed, 'EQ1413', '/moved')).toEqual([]);
    expect(diagnosticsNaming(analysed, 'EQ1414', '/moved')).toEqual([]);
  });

  it('is answered as private and not-stored where a value the build cannot read decides it', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': routeFile(`[
        { path: 'slot', component: Page, children: [{ path: '', outlet: SLOT, component: Page }] },
        { path: 'where', component: Page, children: [{ path: WHERE, component: Page }, { path: '', component: Page }] },
        { path: 'spread', component: Page, children: [{ path: '', ...extra, component: Page }] },
        { path: 'sent', component: Page, children: [{ path: '', ...target }, { path: 'there', component: Page }] },
      ]`).replace(
        'export class Page {}',
        [
          'export class Page {}',
          "let SLOT = 'aux';",
          "let WHERE = 'list';",
          'declare const extra: { canMatch?: (() => boolean)[] };',
          'declare const target: { redirectTo?: string; component?: typeof Page };',
        ].join('\n'),
      ),
      'src/app.config.ts': configFile(),
    });

    const rows = table(analysed);
    for (const [address, cause] of [
      ['/slot', 'a child whose `outlet` the build cannot read'],
      ['/where', 'a child whose `path` is not a string literal'],
      [
        '/spread',
        'a child whose `canMatch` a spread or a computed key may set',
      ],
      [
        '/sent',
        'a child whose `redirectTo` a spread or a computed key may set',
      ],
    ] as const) {
      expect(rows[`route:${address.slice(1)}`]).toEqual({
        caching: 'not-stored',
        indexing: 'private',
        sitemap: undefined,
      });
      for (const code of ['EQ1413', 'EQ1414']) {
        expect(diagnosticsNaming(analysed, code, address)).toEqual([
          expect.objectContaining({ summary: expect.stringContaining(cause) }),
        ]);
      }
    }
    // The outlet and the path are also reported where they are written, for the routes they hide.
    expect(
      analysed.diagnostics.filter(
        ({ code, summary }) =>
          code === 'EQ1406' &&
          (summary.includes('`outlet`') || summary.includes('computes its')),
      ),
    ).toHaveLength(2);
  });

  it('is never a route in a named outlet, and a route there with an address of its own is left out and reported', async () => {
    const source = routeFile(`[
      { path: 'shop', component: Page, children: [
        { path: 'chat', outlet: 'aux', component: Page, children: [{ path: 'thread', component: Page }] },
        { path: '', outlet: 'aux', component: Page, children: [{ path: 'help', component: Page }] },
        { path: 'cart', component: Page },
      ] },
    ]`);
    const analysed = await analyse({
      'src/app.routes.ts': source,
      'src/app.config.ts': configFile(),
    });
    const router = routerFor(evaluate(source), undefined);

    await expect(router.navigateByUrl('/shop/chat')).rejects.toThrow(/NG04002/);
    expect(analysed.routes.map(({ id }) => id)).toEqual([
      'route:shop',
      'route:shop.cart',
    ]);
    const reported = analysed.diagnostics.filter(
      ({ code }) => code === 'EQ1406',
    );
    expect(reported).toEqual([
      expect.objectContaining({
        severity: 'warning',
        summary: expect.stringMatching(
          /^The route "chat" under "\/shop" renders in the named outlet "aux"/,
        ),
      }),
      expect.objectContaining({
        severity: 'warning',
        summary: expect.stringMatching(
          /^The route "help" under "\/shop" renders in the named outlet "aux"/,
        ),
      }),
    ]);
  });

  it('brings the code of every route that renders beside a page with the page', async () => {
    const source = routeFile(`[
      { path: '', outlet: 'banner', loadComponent: () => import('./banner').then((m) => m.Banner) },
      { path: 'shop', component: Page, children: [
        { path: '', outlet: 'aux', loadComponent: () => import('./aside').then((m) => m.Aside) },
        { path: '', outlet: 'aux', loadComponent: () => import('./spare').then((m) => m.Spare) },
        { path: '', component: Page },
        { path: 'cart', component: Page },
      ] },
      { path: 'about', component: Page },
    ]`);
    const analysed = await analyse({
      'src/app.routes.ts': source,
      'src/app.config.ts': configFile(),
      'src/banner.ts': 'export class Banner {}\n',
      'src/aside.ts': 'export class Aside {}\n',
      'src/spare.ts': 'export class Spare {}\n',
    });
    // Angular's router over the same table, with each loaded component named in its data instead,
    // because what is asked here is which routes render, not what loading them does.
    const routes = evaluate(
      source.replace(
        /loadComponent: \(\) => import\('\.\/(\w+)'\)\.then\(\(m\) => m\.\w+\)/g,
        "component: Page, data: { file: '$1' }",
      ),
    );

    for (const route of analysed.routes) {
      expect(route.deferredSourcePaths).toEqual(
        renderedFiles(await renderedAt(routes, undefined, `/${route.path}`)),
      );
    }
    expect(
      Object.fromEntries(
        analysed.routes.map(({ id, deferredSourcePaths }) => [
          id,
          deferredSourcePaths,
        ]),
      ),
    ).toEqual({
      'route:shop': ['src/aside.ts', 'src/banner.ts'],
      'route:shop.cart': ['src/aside.ts', 'src/banner.ts'],
      'route:about': ['src/banner.ts'],
    });
  });
});
