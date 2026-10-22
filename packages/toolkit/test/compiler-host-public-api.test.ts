/**
 * The toolkit reaches Angular's compiler and TypeScript only through their published surface.
 *
 * `specs/02-packages-and-platform.spec.md` section 10: integration uses documented, supported APIs.
 * Angular marks what it does not support with a `ɵ` prefix and still ships it in its declarations,
 * so the typecheck accepts an import of one; a path below a package's root is likewise outside
 * what either package documents. Both are visible in an import declaration, so the source is read
 * as a program and every import from either package is checked.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url));
const HOSTS = /^(?:@angular\/compiler|typescript)(?:\/|$)/u;

interface HostImport {
  readonly file: string;
  readonly specifier: string;
  readonly names: readonly string[];
}

function hostImports(): HostImport[] {
  return readdirSync(SOURCE)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .flatMap((name) => {
      const file = join(SOURCE, name);
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
      );
      return source.statements.flatMap((statement) => {
        if (
          !ts.isImportDeclaration(statement) &&
          !ts.isExportDeclaration(statement)
        ) {
          return [];
        }
        const specifier = statement.moduleSpecifier;
        if (specifier === undefined || !ts.isStringLiteral(specifier))
          return [];
        if (!HOSTS.test(specifier.text)) return [];
        const bindings = ts.isImportDeclaration(statement)
          ? statement.importClause?.namedBindings
          : statement.exportClause;
        const names =
          bindings !== undefined &&
          (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
            ? bindings.elements.map(
                (element) => (element.propertyName ?? element.name).text,
              )
            : [];
        return [{ file: name, specifier: specifier.text, names }];
      });
    });
}

describe('the compiler hosts the toolkit imports', () => {
  const imports = hostImports();

  it('finds the imports it must find', () => {
    expect(imports).toContainEqual(
      expect.objectContaining({
        file: 'host-compatibility.ts',
        specifier: '@angular/compiler',
        names: expect.arrayContaining(['VERSION']) as unknown,
      }),
    );
    expect(imports.some(({ specifier }) => specifier === 'typescript')).toBe(
      true,
    );
  });

  it('imports no name either package marks as unsupported', () => {
    expect(
      imports.flatMap(({ file, names }) =>
        names
          .filter((name) => name.startsWith('ɵ'))
          .map((name) => `${file}: ${name}`),
      ),
    ).toEqual([]);
  });

  it('imports neither package below its root', () => {
    expect(
      imports
        .filter(
          ({ specifier }) =>
            specifier !== '@angular/compiler' && specifier !== 'typescript',
        )
        .map(({ file, specifier }) => `${file}: ${specifier}`),
    ).toEqual([]);
  });
});
