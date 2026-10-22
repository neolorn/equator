import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

/**
 * Static analysis reads the application; it never runs it.
 *
 * Every construct in the fixture leaves a trace on the global object when it is evaluated: the
 * module body, a getter the message lookup goes through, a function whose result names a message,
 * and a decorator. The analysis still has to find the use of the message, so a run that found it
 * without a trace is one that read the code rather than ran it.
 */

const TRACE = 'equatorAnalysisTrace';

const roots: string[] = [];

afterEach(async () => {
  delete (globalThis as Record<string, unknown>)[TRACE];
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

describe('static analysis', () => {
  it('evaluates no module, getter, call or decorator of the application', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'analysis-executes-'));
    roots.push(root);
    await write(
      root,
      'package.json',
      `${JSON.stringify({ name: '@example/analysis', private: true, type: 'module' }, null, 2)}\n`,
    );
    const initialized = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
    });
    expect(initialized.ok).toBe(true);
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Analysis fixture\n  unused: Nothing reaches this\n',
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
            experimentalDecorators: true,
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
      [
        "import { messages } from '#i18n/shell';",
        '',
        `const trace = (step: string): void => {`,
        `  const record = globalThis as Record<string, unknown>;`,
        `  record['${TRACE}'] = [...((record['${TRACE}'] as string[] | undefined) ?? []), step];`,
        '};',
        '',
        "trace('module');",
        '',
        'function decorated(): ClassDecorator {',
        "  trace('decorator');",
        '  return () => undefined;',
        '}',
        '',
        '@decorated()',
        'export class Shell {',
        '  get title() {',
        "    trace('getter');",
        '    return messages.appTitle;',
        '  }',
        '}',
        '',
        'export function heading() {',
        "  trace('call');",
        '  return messages.appTitle.messageId;',
        '}',
        '',
        'export const title = heading();',
        '',
      ].join('\n'),
    );

    const generated = await generateProject({ project: root });
    expect(generated.ok, JSON.stringify(generated.diagnostics)).toBe(true);
    if (!generated.ok) return;
    // The use was found, so the module was analyzed; only the unreached message is reported unused.
    const unused = generated.diagnostics.find(({ code }) => code === 'EQ1311');
    expect(unused?.summary).toContain('unused');
    expect(unused?.summary).not.toContain('app-title');
    expect((globalThis as Record<string, unknown>)[TRACE]).toBeUndefined();
  });
});
