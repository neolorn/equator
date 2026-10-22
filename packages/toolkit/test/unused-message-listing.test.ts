import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * How many of a scope's unreached messages the advisory names.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 6 makes the unused-message report a grouped
 * advisory. A scope that has drifted has drifted by dozens, so the advisory names the first twenty
 * in code point order and counts the rest: the whole number is still stated, and one scope cannot
 * push every other finding off the screen.
 */

const projectRoot = resolve('fixtures/semantic-analysis/scope-startup');
const appPath = resolve(projectRoot, 'src/app.ts');

/** The advisory for a scope of `count` messages, compiled beside an application that uses none. */
function advisory(count: number): string {
  // Message ids are lower-case letters, so the ids are `orphan-a`, `orphan-b` and onward, which is
  // also their code point order.
  const messages = Array.from(
    { length: count },
    (_, index) =>
      `  orphan-${String.fromCharCode(97 + index)}: Nobody reads this.`,
  );
  const catalog = parseCatalog(['messages:', ...messages, ''].join('\n'), {
    role: 'source',
    providerId: 'home',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
  });
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const compiled = compileProject({
    owner: { providerId: 'home', generatedRootPath: 'src/generated/i18n' },
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
    analysis: {
      projectRoot,
      rootNames: [appPath],
      sources: [{ path: appPath, contents: "export const name = 'app';\n" }],
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
  const advisories = compiled.diagnostics.filter(
    ({ code }) => code === 'EQ1311',
  );
  expect(advisories).toHaveLength(1);
  expect(advisories[0]?.severity).toBe('info');
  return advisories[0]?.summary ?? '';
}

const named = (summary: string): readonly string[] =>
  [...summary.matchAll(/"(orphan-[a-z])"/gu)].map(([, id]) => id ?? '');

const letters = (count: number): readonly string[] =>
  Array.from(
    { length: count },
    (_, index) => `orphan-${String.fromCharCode(97 + index)}`,
  );

describe('the advisory for source messages nothing reaches', () => {
  it('names every message of a scope that has twenty, and counts no remainder', () => {
    const summary = advisory(20);

    expect(named(summary)).toEqual(letters(20));
    expect(summary).toContain('20 source messages');
    expect(summary).not.toMatch(/\d+ more/u);
  });

  it('names the first twenty of a scope that has more, and counts the rest', () => {
    const summary = advisory(21);

    expect(named(summary)).toEqual(letters(20));
    expect(summary).toContain('21 source messages');
    expect(summary).toMatch(/\b1 more\b/u);
  });
});
