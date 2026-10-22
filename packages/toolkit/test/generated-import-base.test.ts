import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { posix, resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

/**
 * Generated modules reach one another through the package-private import base.
 *
 * A module that imported a sibling by a relative path, or by an alias only the compiler knows,
 * would work in the layout it was generated into and nowhere a consumer's bundler, test runner or
 * server resolves it differently. The one relative form generated output uses is the loader's
 * dynamic import of a compiled catalog chunk, and that is held to the generated root: it may not
 * climb out of it.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

interface Specifier {
  readonly text: string;
  readonly dynamic: boolean;
}

function specifiers(file: string, text: string): Specifier[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const found: Specifier[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ text: node.moduleSpecifier.text, dynamic: false });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({ text: node.arguments[0].text, dynamic: true });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push({ text: node.argument.literal.text, dynamic: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('generated output', () => {
  it('addresses its own modules through the import base, never a relative path or an alias', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'import-base-'));
    roots.push(root);
    await write(
      root,
      'package.json',
      `${JSON.stringify({ name: '@example/import-base', private: true, type: 'module' }, null, 2)}\n`,
    );
    const initialized = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
      },
    });
    expect(initialized.ok).toBe(true);
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Base\n',
    );
    await write(
      root,
      'i18n/shell/ar-EG.yaml',
      'messages:\n  app-title: قاعدة\n',
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
            paths: { '@generated/*': ['./src/generated/i18n/*'] },
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      )}\n`,
    );
    await write(
      root,
      'src/app.ts',
      "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
    );

    const generated = await generateProject({ project: root });
    expect(generated.ok, JSON.stringify(generated.diagnostics)).toBe(true);
    if (!generated.ok) return;
    const modules =
      generated.value.compilation.artifacts.outputPlan.files.filter(
        ({ path }) => path.endsWith('.ts'),
      );
    expect(modules.length).toBeGreaterThan(0);

    const refused: string[] = [];
    let base = 0;
    for (const { path } of modules) {
      const text = await readFile(
        resolve(root, 'src/generated/i18n', ...path.split('/')),
        'utf8',
      );
      for (const { text: specifier, dynamic } of specifiers(path, text)) {
        if (specifier === '#i18n' || specifier.startsWith('#i18n/')) {
          base += 1;
        } else if (specifier.startsWith('.')) {
          const target = posix.normalize(
            posix.join(posix.dirname(path), specifier),
          );
          if (!dynamic || target.startsWith('..')) {
            refused.push(`${path}: ${specifier}`);
          }
        } else if (
          specifier.startsWith('@generated/') ||
          specifier.startsWith('/')
        ) {
          refused.push(`${path}: ${specifier}`);
        }
      }
    }
    // The provider composes the generated modules, so a run with no import-base specifier at all
    // would mean the scan read nothing that mattered.
    expect(base).toBeGreaterThan(0);
    expect(refused).toEqual([]);
  });
});
