import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { analyzeApplication } from '../src/static-analysis.js';

/**
 * Routes are read from the route configuration's source, never by loading it.
 *
 * Every route file here leaves a trace on the global object when it is evaluated, at module scope
 * and in a function its route data calls, and the child table is reached only through a lazy
 * loader. The analysis has to find that table anyway, which it can do only by following the
 * loader's import specifier in the program, and the trace has to be absent.
 */

const TRACE = 'equatorRouteTrace';

const roots: string[] = [];

afterEach(async () => {
  delete (globalThis as Record<string, unknown>)[TRACE];
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const trace = (step: string): string =>
  `((globalThis as Record<string, unknown>)['${TRACE}'] = [...(((globalThis as Record<string, unknown>)['${TRACE}'] as string[] | undefined) ?? []), '${step}']);`;

const FILES: Readonly<Record<string, string>> = {
  'node_modules/@angular/router/index.d.ts': [
    'export declare interface Route {',
    '  path?: string;',
    '  data?: Record<string, unknown>;',
    '  component?: unknown;',
    '  loadChildren?: () => Promise<unknown>;',
    '  children?: readonly Route[];',
    '}',
    'export type Routes = readonly Route[];',
    '',
  ].join('\n'),
  'node_modules/@angular/router/package.json': `${JSON.stringify({ name: '@angular/router', version: '0.0.0', types: './index.d.ts' })}\n`,
  'src/section/detail.ts': 'export class Detail {}\n',
  'src/section/routes.ts': [
    "import type { Routes } from '@angular/router';",
    "import { Detail } from './detail';",
    trace('child module'),
    "export const sectionRoutes: Routes = [{ path: 'detail', component: Detail }];",
    '',
  ].join('\n'),
  'src/app.routes.ts': [
    "import type { Routes } from '@angular/router';",
    trace('root module'),
    `function label(): string { ${trace('route data')} return 'Home'; }`,
    'export const routes: Routes = [',
    "  { path: 'home', data: { label: label() }, children: [] },",
    "  { path: 'section', loadChildren: () => import('./section/routes').then((m) => m.sectionRoutes) },",
    '];',
    '',
  ].join('\n'),
};

describe('route analysis', () => {
  it('projects routes through a lazy loader without evaluating any route file', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'route-code-'));
    roots.push(root);
    for (const [path, contents] of Object.entries(FILES)) {
      const absolute = resolve(root, ...path.split('/'));
      await mkdir(resolve(absolute, '..'), { recursive: true });
      await writeFile(absolute, contents, 'utf8');
    }
    const analysis = analyzeApplication({
      projectRoot: root,
      rootNames: Object.keys(FILES).map((path) => resolve(root, path)),
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.Preserve,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
      },
    });
    expect(analysis.ok, JSON.stringify(analysis.diagnostics)).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.value.routes.map(({ path }) => path)).toEqual(
      expect.arrayContaining(['home', 'section']),
    );
    expect(analysis.value.deferredSourcePaths).toEqual(
      expect.arrayContaining(['src/section/routes.ts']),
    );
    expect((globalThis as Record<string, unknown>)[TRACE]).toBeUndefined();
  });
});
