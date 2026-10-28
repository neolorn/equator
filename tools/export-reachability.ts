/**
 * Which published names does a consumer arrive at by following the surface from something it holds?
 *
 * The question `verify-export-surface.ts` asks about a type is whether a consumer has to be able
 * to name it. Occurrence counting answers that with a proxy: a name written more than twice across
 * the shipped declarations was called structural, on the argument that the third mention must be
 * another export's signature. The proxy is wrong in both directions. Two exports that only name
 * each other pass it together, and a type held once, in the one signature that matters, fails it:
 * `LabelAttribute` is the type of the attribute a consumer binds on the label directive, and an
 * occurrence count reads it as used because it is written exactly twice.
 *
 * So the reference is resolved rather than counted. Start from the exports something outside the
 * packages actually names, walk each declaration through the checker, and enqueue every symbol its
 * identifiers resolve to. What that reaches is what a consumer can arrive at: the parameter types,
 * the return types, the members of those, the constraints on the generics, and so on outward. What
 * it never reaches is a name with no path to it from anything anyone calls.
 *
 * The seed is the corpus rather than a list written here, so this calibrates itself: an export that
 * stops being used stops seeding, and whatever only it held becomes reachable from nothing and is
 * reported. A list would have to be maintained in the opposite direction, and the direction it gets
 * maintained in is the one that passes.
 */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import ts from 'typescript';

import { inputsRoot } from './stage-self-test.ts';

const workspaceRoot = inputsRoot();
const runtimeTypesRoot = resolve(workspaceRoot, 'dist/runtime/types');
const toolkitRoot = resolve(workspaceRoot, 'dist/toolkit');

function entryFiles() {
  const runtime = readdirSync(runtimeTypesRoot)
    .filter((file) => file.endsWith('.d.ts'))
    .sort()
    .map((file) => resolve(runtimeTypesRoot, file));
  assert.ok(
    runtime.length > 0,
    `No declaration files under ${runtimeTypesRoot}. Everything below would be reachable from nothing. Run pnpm run build first.`,
  );
  return [...runtime, resolve(toolkitRoot, 'index.d.ts')];
}

/**
 * The published names reachable from the ones the corpus already names.
 *
 * `namedByCorpus` decides what to start from and nothing else; the walk itself reads only the
 * declarations. Returns the set of published names reached, the seeds included.
 */
export function reachablePublishedNames(
  namedByCorpus: (name: string) => boolean,
): { reached: Set<string>; seeded: number; published: number } {
  const files = entryFiles();
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    baseUrl: workspaceRoot,
    // The entry points import one another by package name, and the package is not installed in this
    // workspace. Without this the primary's imports from the core resolve to nothing, the walk stops
    // at the entry-point boundary, and every core type held only by the primary reads as unreachable.
    paths: {
      '@neolorn/equator': ['dist/runtime/types/neolorn-equator.d.ts'],
      '@neolorn/equator/*': ['dist/runtime/types/neolorn-equator-*.d.ts'],
    },
  });
  const checker = program.getTypeChecker();

  // The control that matters most here. A path mapping that stopped resolving would make the walk
  // report a surface no consumer can reach, which is the answer this is trying to establish.
  const unresolved: string[] = [];
  for (const path of files) {
    for (const statement of (program.getSourceFile(path) as ts.SourceFile)
      .statements) {
      const specifier =
        (ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier
          : undefined;
      if (specifier === undefined) continue;
      if (!specifier.text.startsWith('@neolorn/')) continue;
      if (checker.getSymbolAtLocation(specifier) === undefined) {
        unresolved.push(
          `${relative(workspaceRoot, path)} -> ${specifier.text}`,
        );
      }
    }
  }
  assert.deepEqual(
    unresolved,
    [],
    `These imports between entry points did not resolve, so the walk stops at the package boundary: ${unresolved.join(', ')}`,
  );

  const ours = new Set(
    program
      .getSourceFiles()
      .map((file) => file.fileName)
      .filter((name) => {
        const full = resolve(name);
        return (
          full.startsWith(runtimeTypesRoot) || full.startsWith(toolkitRoot)
        );
      }),
  );

  const resolveAlias = (symbol: ts.Symbol): ts.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;

  const identity = (symbol: ts.Symbol): string | undefined => {
    const declaration = symbol.declarations?.[0];
    if (declaration === undefined) return undefined;
    const file = declaration.getSourceFile().fileName;
    return `${relative(workspaceRoot, file).split(String.fromCharCode(92)).join('/')}:${declaration.pos}`;
  };

  const published: {
    name: string;
    key: string | undefined;
    symbol: ts.Symbol;
  }[] = [];
  for (const path of files) {
    const moduleSymbol = checker.getSymbolAtLocation(
      program.getSourceFile(path) as ts.SourceFile,
    );
    for (const exported of checker.getExportsOfModule(
      moduleSymbol as ts.Symbol,
    )) {
      const symbol = resolveAlias(exported);
      published.push({ name: exported.name, key: identity(symbol), symbol });
    }
  }
  assert.ok(
    published.length > 100,
    `Only ${published.length} published export(s) resolved through the checker, which is fewer than Equator is known to publish. This is reading the wrong files.`,
  );

  const visited = new Set<string>();
  const queue: ts.Symbol[] = [];
  const enqueue = (symbol: ts.Symbol) => {
    const resolved = resolveAlias(symbol);
    const declarations = resolved.declarations ?? [];
    // A namespace import of an entry point resolves to the file. Walking a file visits every
    // statement in it, the export list included, so one qualified name anywhere would reach all
    // that the entry point publishes. The name after the qualifier is an identifier of its own and
    // is followed as one.
    if (declarations.some(ts.isSourceFile)) return;
    if (
      !declarations.some((declaration) =>
        ours.has(declaration.getSourceFile().fileName),
      )
    ) {
      return;
    }
    const key = identity(resolved);
    if (key === undefined || visited.has(key)) return;
    visited.add(key);
    queue.push(resolved);
  };

  let seeded = 0;
  for (const row of published) {
    if (!namedByCorpus(row.name)) continue;
    seeded += 1;
    enqueue(row.symbol);
  }

  while (queue.length > 0) {
    const symbol = queue.pop() as ts.Symbol;
    for (const declaration of symbol.declarations ?? []) {
      if (!ours.has(declaration.getSourceFile().fileName)) continue;
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          const found = checker.getSymbolAtLocation(node);
          if (found !== undefined) enqueue(found);
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(declaration, visit);
    }
  }

  const reached = new Set<string>();
  for (const { name, key } of published) {
    if (key !== undefined && visited.has(key)) reached.add(name);
  }
  return { reached, seeded, published: published.length };
}
