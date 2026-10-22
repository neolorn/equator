import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The compiler core reaches no process state, network, filesystem mutation, scheduling or watch.
 *
 * Read from the sources rather than observed at run time, because a run observes only the paths a
 * fixture takes, and a write or a timer behind a branch no fixture reaches is still the host's
 * lifecycle inside the core. What is read is every declaration `compiler.ts` can run, followed by
 * name across modules: a module the core imports one pure helper from may hold the host's writes
 * beside it, and loading that module is not running them.
 */

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Reading is how the analysis reaches the consumer's graph, so it is the one filesystem use the
// core keeps; every name here leaves the disk as it was.
const READS = new Set([
  'readFile',
  'readFileSync',
  'readdir',
  'readdirSync',
  'lstat',
  'lstatSync',
  'stat',
  'statSync',
  'realpath',
  'realpathSync',
  'existsSync',
]);

const FORBIDDEN_MODULES = new Set([
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'dns/promises',
  'http',
  'http2',
  'https',
  'net',
  'readline',
  'readline/promises',
  'timers',
  'timers/promises',
  'tls',
  'worker_threads',
]);

const FORBIDDEN_GLOBALS = new Set([
  'process',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'fetch',
  'WebSocket',
]);

interface Finding {
  readonly module: string;
  readonly reason: string;
}

interface Binding {
  readonly specifier: string;
  readonly name: string;
}

interface Module {
  readonly declarations: ReadonlyMap<string, ts.Node>;
  readonly imports: ReadonlyMap<string, Binding>;
  readonly reexports: ReadonlyMap<string, Binding>;
  readonly starExports: readonly string[];
  /** Statements that run when the module loads. */
  readonly effects: readonly ts.Node[];
}

type Source = (name: string) => string;

const fromDisk: Source = (name) => readFileSync(resolve(SOURCE, name), 'utf8');

function parse(name: string, text: string): Module {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true);
  const declarations = new Map<string, ts.Node>();
  const imports = new Map<string, Binding>();
  const reexports = new Map<string, Binding>();
  const starExports: string[] = [];
  const effects: ts.Node[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause === undefined || clause.isTypeOnly) continue;
      const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      if (clause.name !== undefined) {
        imports.set(clause.name.text, { specifier, name: 'default' });
      }
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        imports.set(bindings.name.text, { specifier, name: '*' });
      } else if (bindings !== undefined) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          imports.set(element.name.text, {
            specifier,
            name: (element.propertyName ?? element.name).text,
          });
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || statement.moduleSpecifier === undefined) {
        continue;
      }
      const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      const clause = statement.exportClause;
      if (clause === undefined) starExports.push(specifier);
      else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          reexports.set(element.name.text, {
            specifier,
            name: (element.propertyName ?? element.name).text,
          });
        }
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      declarations.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const bound of boundNames(declaration.name)) {
          declarations.set(bound, declaration);
        }
      }
    } else if (
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      !ts.isModuleDeclaration(statement)
    ) {
      effects.push(statement);
    }
  }
  return { declarations, imports, reexports, starExports, effects };
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : boundNames(element.name),
  );
}

function reach(
  entry: string,
  source: Source = fromDisk,
): { modules: Set<string>; findings: Finding[] } {
  const parsed = new Map<string, Module>();
  const load = (name: string): Module => {
    let loaded = parsed.get(name);
    if (loaded === undefined) {
      loaded = parse(name, source(name));
      parsed.set(name, loaded);
    }
    return loaded;
  };
  const reached = new Set<string>();
  const requested = new Set<string>();
  const findings: Finding[] = [];
  const pending: [string, string][] = [];

  const request = (module: string, name: string): void => {
    const key = `${module}#${name}`;
    if (requested.has(key)) return;
    requested.add(key);
    pending.push([module, name]);
  };
  const follow = (module: string, { specifier, name }: Binding): void => {
    if (specifier.startsWith('./')) {
      const target = specifier.slice(2).replace(/\.js$/u, '.ts');
      if (name === '*') {
        for (const each of load(target).declarations.keys()) {
          request(target, each);
        }
      } else request(target, name);
      return;
    }
    const builtin = specifier.replace(/^node:/u, '');
    if (FORBIDDEN_MODULES.has(builtin)) {
      findings.push({ module, reason: `uses ${specifier}` });
    } else if (
      (builtin === 'fs' || builtin === 'fs/promises') &&
      !READS.has(name)
    ) {
      findings.push({ module, reason: `uses ${name} from ${specifier}` });
    }
  };
  const scan = (module: string, node: ts.Node): void => {
    const loaded = load(module);
    const visit = (child: ts.Node): void => {
      if (ts.isIdentifier(child) && !isNameOnly(child)) {
        const imported = loaded.imports.get(child.text);
        if (imported !== undefined) follow(module, imported);
        else if (loaded.declarations.has(child.text)) {
          request(module, child.text);
        } else if (
          FORBIDDEN_GLOBALS.has(child.text) &&
          !isRuntimeIdentity(child)
        ) {
          findings.push({ module, reason: `refers to ${child.text}` });
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
  };
  const enter = (module: string): void => {
    if (reached.has(module)) return;
    reached.add(module);
    for (const effect of load(module).effects) scan(module, effect);
  };

  enter(entry);
  for (const name of load(entry).declarations.keys()) request(entry, name);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [module, name] = next;
    enter(module);
    const loaded = load(module);
    const declaration = loaded.declarations.get(name);
    const reexported = loaded.reexports.get(name);
    if (declaration !== undefined) scan(module, declaration);
    else if (reexported !== undefined) follow(module, reexported);
    else {
      for (const specifier of loaded.starExports) {
        follow(module, { specifier, name });
      }
    }
  }
  return { modules: reached, findings };
}

// Which runtime is executing is fixed for the life of the process, and refusing an unsupported one
// is part of the answer rather than state the answer depends on.
function isRuntimeIdentity(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    node.text === 'process' &&
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === node &&
    parent.name.text === 'versions'
  );
}

// A property, a member, a type or a declaration spelled like a global is not a reference to it.
function isNameOnly(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ((ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    ts.isTypeReferenceNode(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent)
  );
}

describe('the compiler core', () => {
  it('reaches no process state, network, filesystem mutation, scheduling or watch', () => {
    const { modules, findings } = reach('compiler.ts');
    // The five modules the core is made of must all be reached, or the scan covers a different
    // program from the one the specification names.
    for (const module of [
      'compiler.ts',
      'semantic-model.ts',
      'generated-contracts.ts',
      'compiled-artifacts.ts',
      'output-plan.ts',
    ]) {
      expect(modules.has(module), module).toBe(true);
    }
    expect(findings).toEqual([]);
  });

  it('finds each kind of reach, and only in what the entry can run', () => {
    const sources: Record<string, string> = {
      'entry.ts': [
        "import { used } from './helpers.js';",
        "import { writeFile } from 'node:fs/promises';",
        "import { readFileSync } from 'node:fs';",
        "import { request } from 'node:https';",
        'export function run() {',
        '  void writeFile; void readFileSync; void request; void used;',
        '  return { process: 1 }.process + process.versions.node.length;',
        '}',
      ].join('\n'),
      'helpers.ts': [
        "import { rm } from 'node:fs/promises';",
        'export const used = () => setTimeout(() => undefined, 0);',
        'export const unused = () => rm("x");',
      ].join('\n'),
    };
    const { findings } = reach('entry.ts', (name) => sources[name] ?? '');
    expect(findings).toEqual([
      { module: 'entry.ts', reason: 'uses writeFile from node:fs/promises' },
      { module: 'entry.ts', reason: 'uses node:https' },
      { module: 'helpers.ts', reason: 'refers to setTimeout' },
    ]);
  });
});
