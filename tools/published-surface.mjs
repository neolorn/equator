/**
 * What the built packages publish, read from their declaration files.
 *
 * Three callers ask this question and none of them should answer it separately: the export gate
 * asks whether anything reaches each export, the reference page asks what to list under each entry
 * point, and the guide coverage gate asks whether a reader was ever told a capability exists. Three
 * parsers would agree until one of them stopped matching, and the one that stopped would report a
 * clean result rather than an error.
 *
 * The declarations rather than the source, because the export map and the `.d.ts` files are what a
 * consumer's editor resolves. A name that exists in `src` and does not survive the build is not
 * published, whatever the source says.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';

import { inputsRoot } from './stage-self-test.mjs';

const workspaceRoot = inputsRoot();

/**
 * The names one declaration file publishes, read from its own export statements.
 *
 * Parsed rather than matched, because the compiler writes an export in more than one form: a
 * bundled declaration file ends in an `export { ... }` list, and a constant or a function exported
 * from the toolkit's barrel itself is written `export declare const`, which a pattern for the list
 * never sees. A star export from another entry point adds nothing here, since that entry point's
 * own file is read for its names; one from a module inside the package would hide what it
 * publishes, so it is refused rather than read as nothing.
 */
export function publishedNames(text) {
  const found = new Set();
  const source = ts.createSourceFile(
    'published.d.ts',
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause === undefined) {
        const from = statement.moduleSpecifier?.text ?? '';
        assert.ok(
          !from.startsWith('.'),
          `A declaration file re-exports everything from ${from}, so the names it publishes cannot be read from it.`,
        );
      } else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) found.add(element.name.text);
      } else {
        found.add(clause.name.text);
      }
      continue;
    }
    const exported = ts
      .getModifiers?.(statement)
      ?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) {
      for (const { name } of statement.declarationList.declarations) {
        if (ts.isIdentifier(name)) found.add(name.text);
      }
    } else if (
      statement.name !== undefined &&
      ts.isIdentifier(statement.name)
    ) {
      found.add(statement.name.text);
    }
  }
  // The `ɵ` prefix marks what one entry point hands another, which no question asked of this set is
  // about.
  return new Set([...found].filter((name) => /^[A-Za-z_$][\w$]*$/u.test(name)));
}

/**
 * What a declared function hands back, found by balancing the parentheses of its parameter list.
 *
 * A regular expression for the return type is what fails here. Several signatures take an object
 * type or a callback, so the first `)` after the name is not the end of the parameters, and a
 * pattern that assumes it is reads a member's type as the function's.
 */
export function returnTypeOf(text, name) {
  const declaration = new RegExp(
    `declare function ${name}\\b(?:<[^(]*>)?\\(`,
    'u',
  ).exec(text);
  if (declaration === null) return undefined;
  let depth = 1;
  let index = declaration.index + declaration[0].length;
  while (index < text.length && depth > 0) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') depth -= 1;
    index += 1;
  }
  return /^\s*:\s*([A-Za-z_$][\w$]*)/u.exec(text.slice(index))?.[1];
}

/**
 * Every declaration file the build produced, discovered rather than listed.
 *
 * An entry point added later is covered the day it lands, which is the rule that makes a search
 * start at `packages/`, applied to the place that reads what those entry points built.
 */
export function runtimeDeclarations() {
  const root = join(workspaceRoot, 'dist/runtime/types');
  const found = readdirSync(root)
    .filter((file) => file.endsWith('.d.ts'))
    .sort()
    .map((file) => ({
      entryPoint: file.replace(/\.d\.ts$/u, ''),
      text: readFileSync(join(root, file), 'utf8'),
    }));
  assert.ok(
    found.some(({ entryPoint }) => entryPoint === 'neolorn-equator'),
    `No neolorn-equator.d.ts under ${root}. Every reader of this would pass by finding nothing. Run \`pnpm run build\` first.`,
  );
  return found;
}

/** The toolkit barrel, which is what `exports["."].types` names. */
export function toolkitDeclaration() {
  return readFileSync(join(workspaceRoot, 'dist/toolkit/index.d.ts'), 'utf8');
}

/**
 * The exports a consumer composes: the features, and the calls that take them.
 *
 * Decided on the declared return type rather than on the name. `withBasePath` returns a string and
 * is an address helper, so a rule that went by the `with` prefix would file it beside the features
 * and be wrong about what can be passed to `provideLocalization`.
 */
const COMPOSABLE_RETURNS = new Set([
  'LocalizationFeature',
  'EnvironmentProviders',
]);

/** Whether one published name is something a consumer composes. */
export function isComposable(text, name) {
  return COMPOSABLE_RETURNS.has(returnTypeOf(text, name));
}

/**
 * Takes the declarations as a parameter so a self-test can hand it a planted export and require the
 * export to be found, which a reader of the build alone cannot show.
 */
export function composableExports(declarations = runtimeDeclarations()) {
  const composables = new Map();
  for (const { entryPoint, text } of declarations) {
    for (const name of publishedNames(text)) {
      if (!isComposable(text, name)) continue;
      if (!composables.has(name)) composables.set(name, entryPoint);
    }
  }
  // Two names that have to be here. Without them the return type scan has stopped matching, and a
  // coverage question answered from an empty set passes for the wrong reason.
  for (const anchor of ['provideLocalizationSetup', 'withRecoveryMessage']) {
    assert.ok(
      composables.has(anchor),
      `${anchor} is not in the composable set, so the scan that finds features has stopped matching and every reader of it is passing on nothing.`,
    );
  }
  return composables;
}
