import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { analyzeApplication } from '../src/static-analysis.js';
import type { ToolkitDiagnostic, RouteProjection } from '../src/index.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

/**
 * What a route is called, and whether that name can be relied on.
 *
 * A route identity is the key an application authors indexed copy under: a title and description
 * per route per locale. So the identity has to survive every edit that leaves the address alone.
 * Renaming `:id` to `:orderId` changes no URL and no page, and must therefore change no key, or a
 * rename silently orphans translated copy with nothing to report it.
 *
 * The derivation is also the only thing standing between two routes and a shared name. Sharing one
 * would attach a page's copy to a different page, which is worse than not indexing either, so a
 * collision is reported and neither route is projected.
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

// The route contract is recognized by its declaration coming from @angular/router, so the fixture
// supplies a stub at that path rather than a local type of the same name.
const ROUTER_STUB = [
  'export declare interface Route {',
  '  path?: string;',
  '  matcher?: (...args: never[]) => unknown;',
  '  data?: Record<string, unknown>;',
  '  redirectTo?: string;',
  '  component?: unknown;',
  '  loadComponent?: () => Promise<unknown>;',
  '  loadChildren?: () => Promise<unknown>;',
  '  children?: readonly Route[];',
  '}',
  'export type Routes = readonly Route[];',
  '',
].join('\n');

const ROUTER_MANIFEST = `${JSON.stringify(
  { name: '@angular/router', version: '0.0.0', types: './index.d.ts' },
  null,
  2,
)}
`;

// A stub of the Equator package. `withRouting` is recognized the same way every other Equator
// symbol is: the symbol is resolved and its declaration is required to come from inside
// @neolorn/equator, so a consumer's own function of the same name configures nothing.
const STUB =
  'export declare function withRouting(options: unknown): unknown;\n';

const MANIFEST = `${JSON.stringify(
  { name: '@neolorn/equator', version: '0.0.0', types: './index.d.ts' },
  null,
  2,
)}
`;

interface Analysed {
  readonly routes: readonly RouteProjection[];
  readonly diagnostics: readonly ToolkitDiagnostic[];
  readonly deferredSourcePaths: readonly string[];
}

async function analyse(
  files: Readonly<Record<string, string>>,
  order: 'as-written' | 'reversed' = 'as-written',
): Promise<Analysed> {
  const root = await mkdtemp(resolve(tmpdir(), 'route-id-'));
  temporaryRoots.push(root);
  const all = {
    'node_modules/@angular/router/index.d.ts': ROUTER_STUB,
    'node_modules/@angular/router/package.json': ROUTER_MANIFEST,
    'node_modules/@neolorn/equator/index.d.ts': STUB,
    'node_modules/@neolorn/equator/package.json': MANIFEST,
    ...files,
  };
  for (const [path, contents] of Object.entries(all)) {
    await write(root, path, contents);
  }
  const analysis = analyzeApplication({
    projectRoot: root,
    rootNames: (order === 'reversed'
      ? Object.keys(all).reverse()
      : Object.keys(all)
    ).map((path) => resolve(root, path)),
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
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
    deferredSourcePaths: analysis.value.deferredSourcePaths,
  };
}

/** A route file that defers its children to another, which declares them as a route table. */
function childRouteApplication(): Readonly<Record<string, string>> {
  return {
    'src/section/detail.ts': 'export class Detail {}\n',
    'src/section/routes.ts': [
      "import type { Routes } from '@angular/router';",
      "import { Detail } from './detail';",
      "export const sectionRoutes: Routes = [{ path: 'detail', component: Detail }];",
      '',
    ].join('\n'),
    'src/app.routes.ts': [
      "import type { Routes } from '@angular/router';",
      'export const routes: Routes = [',
      "  { path: 'section', loadChildren: () => import('./section/routes').then((m) => m.sectionRoutes) },",
      '];',
      '',
    ].join('\n'),
  };
}

async function analyseFailure(
  files: Readonly<Record<string, string>>,
): Promise<readonly ToolkitDiagnostic[]> {
  try {
    await analyse(files);
  } catch (error) {
    return (error as { readonly diagnostics: readonly ToolkitDiagnostic[] })
      .diagnostics;
  }
  throw new Error('the analysis was expected to fail');
}

function routeFile(body: string): Record<string, string> {
  return {
    'src/app.routes.ts': [
      "import type { Routes } from '@angular/router';",
      '',
      // Every route here carries a component, because Angular refuses one that carries nothing:
      // `validateNode` throws on it, though only in a development build, which is why the analysis
      // now refuses it too. A fixture that omitted it was describing a table that cannot run.
      'export class Page {}',
      '',
      `export const routes: Routes = ${body};`,
      '',
    ].join('\n'),
  };
}

function identities(analysed: Analysed): readonly string[] {
  return analysed.routes.map(({ id }) => id);
}

function classes(analysed: Analysed): Readonly<Record<string, string>> {
  return Object.fromEntries(
    analysed.routes.map((route) => [route.id, route.indexing ?? 'absent']),
  );
}

/** A provider file declaring the consumer's own route-data field. */
function routingProvider(indexing: string): Record<string, string> {
  return {
    'src/app.config.ts': [
      "import { withRouting } from '@neolorn/equator';",
      '',
      `export const routing = withRouting({ indexing: ${indexing} });`,
      '',
    ].join('\n'),
  };
}

/** The same file, with whatever options the case is about. */
function routingOptions(options: string): Record<string, string> {
  return {
    'src/app.config.ts': [
      "import { withRouting } from '@neolorn/equator';",
      '',
      `export const routing = withRouting({ ${options} });`,
      '',
    ].join('\n'),
  };
}

function claims(
  analysed: Analysed,
): Readonly<Record<string, RouteProjection['sitemap']>> {
  return Object.fromEntries(
    analysed.routes.map((route) => [route.id, route.sitemap]),
  );
}

function codes(analysed: Analysed): readonly string[] {
  return analysed.diagnostics.map(({ code }) => code);
}

function caching(analysed: Analysed): Readonly<Record<string, string>> {
  return Object.fromEntries(
    analysed.routes.map((route) => [route.id, route.caching ?? 'absent']),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * Which routes are indexable.
 *
 * Equator must not read a field name belonging to a particular consumer, so the field is named by
 * the consumer through `withRouting()` and read out of that call's source text when the owner is
 * compiled. Routes default to indexable: an application marks its exceptions rather than
 * annotating every route it has.
 */
describe('route indexing', () => {
  it('treats an unmarked route as indexable', async () => {
    const analysed = await analyse(
      routeFile("[{ path: 'orders', component: Page }]"),
    );

    expect(classes(analysed)).toEqual({ 'route:orders': 'indexable' });
  });

  it('reads its own field when the consumer names none', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', data: { equatorIndexing: 'private' }, component: Page }, { path: 'draft', data: { equatorIndexing: 'non-indexable' }, component: Page }]",
      ),
    );

    expect(classes(analysed)).toEqual({
      'route:admin': 'private',
      'route:draft': 'non-indexable',
    });
    claimCapability('declaration:route-indexing-class');
  });

  it("reads the consumer's own field when one is named", async () => {
    // The point of the option. A project that already classifies its routes points Equator at the
    // field it already has, in its own vocabulary, and writes nothing new on any route.
    const analysed = await analyse({
      ...routingProvider(
        "{ field: 'routeClass', values: { authenticated: 'private', staging: 'non-indexable' } }",
      ),
      ...routeFile(
        "[{ path: 'account', data: { routeClass: 'authenticated' }, component: Page }, { path: 'preview', data: { routeClass: 'staging' }, component: Page }, { path: 'home', data: { routeClass: 'public' }, component: Page }]",
      ),
    });

    expect(classes(analysed)).toEqual({
      'route:account': 'private',
      'route:preview': 'non-indexable',
      // 'public' is not in the table, and does not need to be: unlisted means indexable.
      'route:home': 'indexable',
    });
  });

  it('stops reading its own field once the consumer names one', async () => {
    // Two fields would mean two answers. Naming a field replaces the default rather than adding to
    // it, so `equatorIndexing` left behind by an earlier setup cannot quietly override the field
    // the application actually classifies by.
    const analysed = await analyse({
      ...routingProvider(
        "{ field: 'routeClass', values: { hidden: 'private' } }",
      ),
      ...routeFile(
        "[{ path: 'admin', data: { equatorIndexing: 'private' }, component: Page }]",
      ),
    });

    expect(classes(analysed)).toEqual({ 'route:admin': 'indexable' });
    claimCapability('declaration:route-indexing-class');
  });

  it('ignores a withRouting that is not the one Equator exports', async () => {
    const analysed = await analyse({
      'src/app.config.ts': [
        'function withRouting(options: unknown): unknown {',
        '  return options;',
        '}',
        '',
        "export const routing = withRouting({ indexing: { field: 'routeClass', values: { authenticated: 'private' } } });",
        '',
      ].join('\n'),
      ...routeFile(
        "[{ path: 'account', data: { routeClass: 'authenticated' }, component: Page }]",
      ),
    });

    expect(classes(analysed)).toEqual({ 'route:account': 'indexable' });
    claimCapability('declaration:route-indexing-class');
  });
});

describe('route identity', () => {
  it('projects one table whatever order the compiler is handed the files in', async () => {
    // Three route tables in three files, none referencing another, so each is placed on its own and
    // the order the program reads the files in is a real variable. The projection is the only
    // route manifest there is, and one that followed that order would give two builds of the same
    // source two different route tables.
    const application = {
      'src/page.ts': 'export class Page {}\n',
      'src/zeta/routes.ts': [
        "import type { Routes } from '@angular/router';",
        "import { Page } from '../page';",
        "export const zetaRoutes: Routes = [{ path: 'last', component: Page }];",
        '',
      ].join('\n'),
      'src/alpha/routes.ts': [
        "import type { Routes } from '@angular/router';",
        "import { Page } from '../page';",
        "export const alphaRoutes: Routes = [{ path: 'first', component: Page }];",
        '',
      ].join('\n'),
      'src/app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        "import { Page } from './page';",
        "export const routes: Routes = [{ path: 'home', component: Page }];",
        '',
      ].join('\n'),
    };

    const written = await analyse(application);
    const reversed = await analyse(application, 'reversed');

    expect(identities(written)).toHaveLength(3);
    expect(reversed.routes).toStrictEqual(written.routes);
  });

  it('names the empty path with something no literal path can produce', async () => {
    // `route:root` would collide, since a route at `/root` produces it too.
    const analysed = await analyse(
      routeFile(
        "[{ path: '', component: Page }, { path: 'root', component: Page }, { path: 'index', component: Page }]",
      ),
    );

    expect(identities(analysed)).toEqual([
      'route:_index',
      'route:root',
      'route:index',
    ]);
    expect(analysed.diagnostics).toEqual([]);
  });

  it('collapses a parameter to a mark, so renaming it changes nothing', async () => {
    const before = await analyse(
      routeFile("[{ path: 'orders/:id/items', component: Page }]"),
    );
    const after = await analyse(
      routeFile("[{ path: 'orders/:orderId/items', component: Page }]"),
    );

    expect(identities(before)).toEqual(['route:orders._.items']);
    expect(identities(after)).toEqual(identities(before));

    // The author's names are still reported: they are useful, they are just not the identity.
    expect(before.routes[0]?.parameterNames).toEqual(['id']);
    expect(after.routes[0]?.parameterNames).toEqual(['orderId']);
  });

  it('reads a nested route at its full address', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', children: [{ path: '', component: Page }, { path: 'users/:id', component: Page }] }]",
      ),
    );

    // The parent and its index child are one address, so they are one route.
    expect(identities(analysed)).toEqual([
      'route:admin',
      'route:admin.users._',
    ]);
    expect(analysed.diagnostics).toEqual([]);
  });

  it('descends through a pathless layout route', async () => {
    // An empty `path` renders without contributing a URL segment, so a visit that ends at one sees
    // nothing underneath it, lazy boundaries included.
    const analysed = await analyse({
      'src/admin.ts': "export const panel = 'admin';\n",
      ...routeFile(
        "[{ path: '', component: Page, children: [{ path: 'admin', loadComponent: () => import('./admin') }] }]",
      ),
    });

    expect(identities(analysed)).toContain('route:admin');
    expect(analysed.deferredSourcePaths).toContain('src/admin.ts');
  });

  it('refuses a route with an address and nothing to render it', async () => {
    // Angular's own rule, and the reason Equator has to restate it: `validateNode` throws on a
    // route carrying none of `component`, `loadComponent`, `redirectTo`, `children` or
    // `loadChildren`, but both of its call sites sit inside
    // `if (typeof ngDevMode === 'undefined' || ngDevMode)`. A production build validates no route
    // config at all, so such a route ships and surfaces only for whoever next runs a development
    // build. Equator reads the same table before either build.
    const failure = await analyseFailure(routeFile("[{ path: 'orders' }]"));

    const unrenderable = failure.filter(({ code }) => code === 'EQ1405');
    expect(unrenderable).toHaveLength(1);
    expect(unrenderable[0]?.severity).toBe('error');
    expect(unrenderable[0]?.summary).toContain('/orders');
  });

  it('accepts every shape Angular accepts', async () => {
    // The mutation for the check above. Each of the five alternatives has to pass on its own, or
    // the refusal is not Angular's rule but a narrower one wearing its name.
    const analysed = await analyse(
      routeFile(
        "[{ path: 'a', component: Page }, { path: 'b', loadComponent: () => import('./page') }, { path: 'c', redirectTo: 'a' }, { path: 'd', children: [{ path: 'e', component: Page }] }]",
      ),
    );

    expect(
      analysed.diagnostics.filter(({ code }) => code === 'EQ1405'),
    ).toEqual([]);
  });

  it('refuses a route with neither a path nor a matcher', async () => {
    // Read as pathless, it would give every route below it its parent's address, and Angular
    // matches no address to it at all.
    const failure = await analyseFailure(
      routeFile(
        "[{ component: Page, children: [{ path: 'orders', component: Page }] }]",
      ),
    );

    const refused = failure.filter(({ code }) => code === 'EQ1415');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.severity).toBe('error');
    expect(refused[0]?.summary).toContain('neither');
  });

  it('refuses a matcher beside a non-empty path', async () => {
    // Angular matches this route with the `matcher`, so the `path` is an address it does not serve.
    const failure = await analyseFailure(
      routeFile("[{ path: 'orders', matcher: () => null, component: Page }]"),
    );

    const refused = failure.filter(({ code }) => code === 'EQ1415');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.summary).toContain('/orders');
  });

  it('reads a matcher beside an empty path as pathless, as Angular does', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: '', matcher: () => null, component: Page, children: [{ path: 'orders', component: Page }] }]",
      ),
    );

    expect(identities(analysed)).toContain('route:orders');
    expect(analysed.diagnostics).toEqual([]);
  });

  it('names a matcher route instead of giving it an address', async () => {
    // Only the `matcher` knows which addresses the route serves, so neither it nor anything below
    // it has an address the projection can name.
    const analysed = await analyse(
      routeFile(
        "[{ path: 'shop', component: Page, children: [{ matcher: () => null, component: Page, children: [{ path: 'item', component: Page }] }] }]",
      ),
    );

    expect(identities(analysed)).toEqual(['route:shop']);
    const hidden = analysed.diagnostics.filter(({ code }) => code === 'EQ1406');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.severity).toBe('warning');
    expect(hidden[0]?.summary).toContain('/shop');
    expect(hidden[0]?.summary).toContain('`matcher`');
  });

  it('names a route whose path a spread may set', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': [
        "import type { Route, Routes } from '@angular/router';",
        '',
        'export class Page {}',
        "const base: Route = { path: 'admin' };",
        'export const routes: Routes = [',
        "  { ...base, component: Page, children: [{ path: 'users', component: Page }] },",
        '];',
        '',
      ].join('\n'),
    });

    expect(identities(analysed)).toEqual([]);
    const hidden = analysed.diagnostics.filter(({ code }) => code === 'EQ1406');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.summary).toContain('spread');
  });

  it('names a route whose path a computed key may set', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export class Page {}',
        "const key: string = 'path';",
        "export const routes: Routes = [{ [key]: 'admin', component: Page }];",
        '',
      ].join('\n'),
    });

    expect(identities(analysed)).toEqual([]);
    expect(codes(analysed)).toEqual(['EQ1406']);
  });

  it('keeps a path that no later spread can set', async () => {
    // The control for the two above: a spread whose type has no `path` or `matcher` cannot move
    // the address, and reading it as though it could would hide an ordinary route.
    const analysed = await analyse({
      'src/app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export class Page {}',
        "const extras = { data: { area: 'admin' } };",
        "export const routes: Routes = [{ path: 'admin', component: Page, ...extras }];",
        '',
      ].join('\n'),
    });

    expect(identities(analysed)).toEqual(['route:admin']);
    expect(analysed.diagnostics).toEqual([]);
  });

  it('names a shorthand path as computed', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export class Page {}',
        "const path = 'admin';",
        'export const routes: Routes = [{ path, component: Page }];',
        '',
      ].join('\n'),
    });

    expect(identities(analysed)).toEqual([]);
    const hidden = analysed.diagnostics.filter(({ code }) => code === 'EQ1406');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.summary).toContain('computes its `path`');
  });

  it('counts a component a spread supplies as one Angular renders', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export class Page {}',
        'const shell = { component: Page };',
        "export const routes: Routes = [{ ...shell, path: 'admin' }];",
        '',
      ].join('\n'),
    });

    expect(identities(analysed)).toEqual(['route:admin']);
    expect(analysed.diagnostics).toEqual([]);
  });

  it('names an address it cannot know, and keeps reading below it', async () => {
    // A computed path leaves the subtree unnameable. Every address below it is served at its
    // canonical spelling in the default locale, which under a locale prefix means a URL that looks
    // localized and a page that is not, so this is named rather than skipped.
    //
    // Naming it is not the same as stopping. A lazy boundary is a fact about modules, not about
    // URLs, and missing the one below an unnameable address would load those messages eagerly
    // forever. Both halves are asserted here because a refusal would have cost the second.
    const analysed = await analyse({
      'src/admin.ts': "export const panel = 'admin';\n",
      'src/app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        "const base = 'admin';",
        'export const routes: Routes = [',
        '  {',
        '    path: base,',
        "    children: [{ path: 'panel', loadComponent: () => import('./admin') }],",
        '  },',
        '];',
        '',
      ].join('\n'),
    });

    expect(identities(analysed)).toEqual([]);
    expect(analysed.deferredSourcePaths).toContain('src/admin.ts');

    const uncovered = analysed.diagnostics.filter(
      ({ code }) => code === 'EQ1406',
    );
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]?.severity).toBe('warning');
    expect(uncovered[0]?.summary).toContain('computes its `path`');
  });

  it('names a route whose children it was never shown', async () => {
    // `loadChildren` is the construct proven to occur, not the condition. The condition is that the
    // authored table names addresses the projection cannot reach, and a table assembled at runtime
    // or returned by a helper hides them the same way.
    const analysed = await analyse(childRouteApplication());

    const uncovered = analysed.diagnostics.filter(
      ({ code }) => code === 'EQ1406',
    );
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]?.summary).toContain('/section');
    expect(uncovered[0]?.summary).toContain('loadChildren');
  });

  it('does not invent an address for a child table it read on its own', async () => {
    // The half a diagnostic does not fix, and the reason the diagnostic alone is not enough.
    // `src/section/routes.ts` declares a `Routes` constant, so the pass over every source file
    // reaches it with no parent and would project `detail`: an address the application serves at
    // `section/detail` and nowhere else. A localized branch built from it addresses nothing.
    //
    // The control is the same file with nothing referencing it: then it *is* a route table in its
    // own right, `detail` is its real address, and the projection is correct to say so.
    const referenced = await analyse(childRouteApplication());
    expect(identities(referenced)).toEqual(['route:section']);

    const { 'src/app.routes.ts': _root, ...standalone } =
      childRouteApplication();
    expect(identities(await analyse(standalone))).toEqual(['route:detail']);
  });

  it('skips wildcards at every depth', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', children: [{ path: '**', component: Page }] }, { path: '**', component: Page }]",
      ),
    );

    expect(identities(analysed)).toEqual(['route:admin']);
  });

  it('reports two addresses that resolve to one name and projects neither', async () => {
    // Distinct URLs, one slug. Indexing either under a name that also describes the other attaches
    // a page's copy to the wrong page.
    const analysed = await analyse(
      routeFile(
        "[{ path: 'v1.2', component: Page }, { path: 'v1-2', component: Page }]",
      ),
    );

    expect(identities(analysed)).toEqual([]);

    const collision = analysed.diagnostics.filter(
      ({ code }) => code === 'EQ1404',
    );
    expect(collision).toHaveLength(1);
    expect(collision[0]?.severity).toBe('warning');
    expect(collision[0]?.summary).toContain('route:v1-2');
    expect(collision[0]?.summary).toContain('/v1.2');
  });

  it('reports an address it cannot name at all', async () => {
    const analysed = await analyse(
      routeFile("[{ path: 'الطلبات', component: Page }]"),
    );

    expect(identities(analysed)).toEqual([]);
    expect(
      analysed.diagnostics.filter(({ code }) => code === 'EQ1404'),
    ).toHaveLength(1);
    expect(analysed.diagnostics[0]?.summary).toContain('equatorRouteId');
  });

  it('lets a declared identity name what Equator could not', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'الطلبات', data: { equatorRouteId: 'route:orders' }, component: Page }]",
      ),
    );

    expect(identities(analysed)).toEqual(['route:orders']);
    expect(analysed.diagnostics).toEqual([]);
  });

  it('refuses a declared identity the runtime would reject', async () => {
    // Generated routing state is validated again when it is adopted, in the browser. An identity
    // that fails there should fail here, where there is a file and a line to point at.
    const analysed = await analyse(
      routeFile(
        "[{ path: 'orders', data: { equatorRouteId: 'has spaces' }, component: Page }]",
      ),
    );

    expect(identities(analysed)).toEqual([]);
    expect(
      analysed.diagnostics.filter(({ code }) => code === 'EQ1404'),
    ).toHaveLength(1);
  });

  it('prefers the deeper declaration when one address is declared twice', async () => {
    // The index child renders the page, so its route data is the more specific statement about it.
    const analysed = await analyse(
      routeFile(
        "[{ path: 'admin', children: [{ path: '', data: { equatorRouteId: 'route:dashboard' }, component: Page }] }]",
      ),
    );

    expect(identities(analysed)).toEqual(['route:dashboard']);
  });

  it('never derives an identity the runtime would reject', async () => {
    // A deep address can outgrow the identity grammar's 128 characters. Truncating it would invent
    // collisions; the consumer is asked for a name instead.
    const deep = Array.from(
      { length: 30 },
      (_, index) => `segment${index}`,
    ).join('/');
    const analysed = await analyse(
      routeFile(`[{ path: '${deep}', component: Page }]`),
    );

    expect(identities(analysed)).toEqual([]);
    expect(
      analysed.diagnostics.filter(({ code }) => code === 'EQ1404'),
    ).toHaveLength(1);
  });
});

/**
 * What a route claims about itself in a sitemap.
 *
 * The same shape as the indexing declaration above and for the same reason: Equator reads a field
 * name it was given rather than one of its own invention, from source text, because it does not
 * execute consumer code. What differs is that there is no Equator default field. A route that
 * claims nothing is published with its address and its alternates, which is a complete entry, where
 * a route with no indexing class has to be sorted into one.
 *
 * The refusals here are refusals rather than omissions. `changefreq` is a closed enumeration and
 * `priority` is bounded, both in the schema, so a value outside either produces a document a
 * validator rejects. Dropping it silently would turn a typo into a page that quietly says nothing.
 */
describe('route sitemap claims', () => {
  it('reads the class the route names, and leaves an unlisted class claiming nothing', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { section: 'editorial' } }, { path: 'terms', component: Page, data: { section: 'boilerplate' } }]",
      ),
      ...routingOptions(
        "sitemap: { field: 'section', values: { editorial: { changefreq: 'daily', priority: 0.9 } } }",
      ),
    });
    expect(claims(analysed)).toEqual({
      'route:news': { changefreq: 'daily', priority: 0.9 },
      // `boilerplate` is a word this project uses for its own reasons and the table says nothing
      // about it, so the route claims nothing rather than being given a default.
      'route:terms': undefined,
    });
    claimCapability('declaration:route-sitemap-entry');
  });

  it('claims nothing anywhere when the owner declares no sitemap policy', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'news', component: Page, data: { section: 'editorial' } }]",
      ),
    );
    expect(claims(analysed)).toEqual({ 'route:news': undefined });
  });

  it('reads lastmod from the field it was pointed at, as written', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { updated: '2026-09-01' } }]",
      ),
      ...routingOptions(
        "sitemap: { field: 'section', lastmodField: 'updated' }",
      ),
    });
    // Read and not computed. A build time or a file time is a date the page did not change on,
    // and the one element a crawler actually reads is worth less than nothing when it is wrong.
    expect(claims(analysed)).toEqual({
      'route:news': { lastmod: '2026-09-01' },
    });
    claimCapability('declaration:route-sitemap-entry');
  });

  it('refuses a lastmod that is not a W3C date and says so', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { updated: 'last Tuesday' } }]",
      ),
      ...routingOptions(
        "sitemap: { field: 'section', lastmodField: 'updated' }",
      ),
    });
    expect(codes(analysed)).toContain('EQ1412');
    expect(claims(analysed)).toEqual({ 'route:news': undefined });
    claimCapability('declaration:route-sitemap-entry');
  });

  it('refuses a changefreq the protocol does not list', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { section: 'editorial' } }]",
      ),
      ...routingOptions(
        "sitemap: { field: 'section', values: { editorial: { changefreq: 'fortnightly' } } }",
      ),
    });
    expect(codes(analysed)).toContain('EQ1412');
    expect(claims(analysed)).toEqual({ 'route:news': undefined });
    claimCapability('declaration:route-sitemap-entry');
  });

  it('refuses a priority outside the range, and keeps the rest of the class', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { section: 'editorial' } }]",
      ),
      ...routingOptions(
        "sitemap: { field: 'section', values: { editorial: { changefreq: 'daily', priority: 1.5 } } }",
      ),
    });
    expect(codes(analysed)).toContain('EQ1412');
    // The bad half is refused and the good half stands. An entry with a changefreq and no priority
    // is a valid entry, so throwing the class away would lose something the consumer got right.
    expect(claims(analysed)).toEqual({ 'route:news': { changefreq: 'daily' } });
    claimCapability('declaration:route-sitemap-entry');
  });

  it('reports an owner that declares two sitemap fields and uses the first', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'news', component: Page, data: { section: 'editorial' } }]",
      ),
      'src/app.config.ts': [
        "import { withRouting } from '@neolorn/equator';",
        '',
        "export const routing = withRouting({ sitemap: { field: 'section', values: { editorial: { priority: 0.9 } } } });",
        "export const other = withRouting({ sitemap: { field: 'kind', values: { editorial: { priority: 0.1 } } } });",
        '',
      ].join('\n'),
    });
    expect(codes(analysed)).toContain('EQ1412');
    expect(claims(analysed)).toEqual({ 'route:news': { priority: 0.9 } });
    claimCapability('declaration:route-sitemap-entry');
  });
});

/**
 * Which routes a shared cache may not keep.
 *
 * Read like indexing, with one difference in what an unusable value means. An unlisted indexing
 * value is indexable because a consumer's field has other reasons to exist; a caching value the
 * build cannot use is answered as `not-stored`, because every class it could have named keeps the
 * page out of a shared cache, and reading it as absent would be the one answer that could not be
 * what its author meant.
 */
describe('route caching', () => {
  it('leaves a route that declares nothing to routing', async () => {
    const analysed = await analyse(
      routeFile("[{ path: 'news', component: Page }]"),
    );

    expect(caching(analysed)).toEqual({ 'route:news': 'absent' });
    expect(codes(analysed)).not.toContain('EQ1413');
  });

  it('reads its own field when the consumer names none', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'home', data: { equatorCaching: 'per-visitor' }, component: Page }, { path: 'account', data: { equatorCaching: 'not-stored' }, component: Page }]",
      ),
    );

    expect(caching(analysed)).toEqual({
      'route:home': 'per-visitor',
      'route:account': 'not-stored',
    });
    claimCapability('declaration:route-caching-class');
  });

  it("reads the consumer's own field, and an unlisted value there says nothing", async () => {
    const analysed = await analyse({
      ...routingOptions(
        "caching: { field: 'area', values: { themed: 'per-visitor', account: 'not-stored' } }",
      ),
      ...routeFile(
        "[{ path: 'home', data: { area: 'themed' }, component: Page }, { path: 'account', data: { area: 'account' }, component: Page }, { path: 'news', data: { area: 'editorial' }, component: Page }]",
      ),
    });

    expect(caching(analysed)).toEqual({
      'route:home': 'per-visitor',
      'route:account': 'not-stored',
      'route:news': 'absent',
    });
    expect(codes(analysed)).not.toContain('EQ1413');
    claimCapability('declaration:route-caching-class');
  });

  it('refuses a value in its own field that names no class', async () => {
    const analysed = await analyse(
      routeFile(
        "[{ path: 'account', data: { equatorCaching: 'private' }, component: Page }]",
      ),
    );

    expect(codes(analysed)).toContain('EQ1413');
    expect(caching(analysed)).toEqual({ 'route:account': 'not-stored' });
    claimCapability('declaration:route-caching-class');
  });

  it('refuses a route value it cannot read', async () => {
    const analysed = await analyse({
      'src/app.routes.ts': [
        "import type { Routes } from '@angular/router';",
        '',
        'export class Page {}',
        "let CLASS: string = 'per-visitor';",
        '',
        "export const routes: Routes = [{ path: 'account', data: { equatorCaching: CLASS }, component: Page }];",
        '',
      ].join('\n'),
    });

    expect(codes(analysed)).toContain('EQ1413');
    expect(caching(analysed)).toEqual({ 'route:account': 'not-stored' });
    claimCapability('declaration:route-caching-class');
  });

  it('refuses a table value it cannot read, and answers its routes as not-stored', async () => {
    const analysed = await analyse({
      'src/app.config.ts': [
        "import { withRouting } from '@neolorn/equator';",
        '',
        "let THEMED = 'per-visitor' as const;",
        "export const routing = withRouting({ caching: { field: 'area', values: { themed: THEMED } } });",
        '',
      ].join('\n'),
      ...routeFile(
        "[{ path: 'home', data: { area: 'themed' }, component: Page }]",
      ),
    });

    expect(codes(analysed)).toContain('EQ1413');
    expect(caching(analysed)).toEqual({ 'route:home': 'not-stored' });
    claimCapability('declaration:route-caching-class');
  });

  it('refuses a table it cannot read, and answers every route that sets the field as not-stored', async () => {
    const analysed = await analyse({
      'src/app.config.ts': [
        "import { withRouting } from '@neolorn/equator';",
        '',
        "let TABLE = { themed: 'per-visitor' } as const;",
        "export const routing = withRouting({ caching: { field: 'area', values: TABLE } });",
        '',
      ].join('\n'),
      ...routeFile(
        "[{ path: 'home', data: { area: 'themed' }, component: Page }, { path: 'news', component: Page }]",
      ),
    });

    expect(codes(analysed)).toContain('EQ1413');
    expect(caching(analysed)).toEqual({
      'route:home': 'not-stored',
      'route:news': 'absent',
    });
    claimCapability('declaration:route-caching-class');
  });

  it('reports an owner that declares two caching fields and uses the first', async () => {
    const analysed = await analyse({
      ...routeFile(
        "[{ path: 'home', component: Page, data: { area: 'themed', kind: 'themed' } }]",
      ),
      'src/app.config.ts': [
        "import { withRouting } from '@neolorn/equator';",
        '',
        "export const routing = withRouting({ caching: { field: 'area', values: { themed: 'per-visitor' } } });",
        "export const other = withRouting({ caching: { field: 'kind', values: { themed: 'not-stored' } } });",
        '',
      ].join('\n'),
    });

    expect(codes(analysed)).toContain('EQ1413');
    expect(caching(analysed)).toEqual({ 'route:home': 'per-visitor' });
    claimCapability('declaration:route-caching-class');
  });
});
