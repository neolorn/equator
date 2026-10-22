import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkProject,
  generateProject,
  type ToolkitDiagnostic,
} from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

import { runCli } from './cli-run.js';

/**
 * The command line and the programmatic API give one answer, because both are the same core.
 *
 * Compared on a project whose answer is not empty: two messages nothing uses and a catalog that
 * omits one, so the run carries advisories of more than one severity and a surface that filtered,
 * rewrote or reordered what the core said would show it.
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

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'cli-surface-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify({ name: '@example/cli-surface', private: true, type: 'module' }, null, 2)}\n`,
  );
  const initialized = await initializeProject({
    project: root,
    configuration: {
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'fr-FR'],
    },
  });
  expect(initialized.ok).toBe(true);
  await write(
    root,
    'i18n/shell/en-US.yaml',
    'messages:\n  app-title: Surface fixture\n  unused-one: One\n  unused-two: Two\n',
  );
  await write(
    root,
    'i18n/shell/fr-FR.yaml',
    'messages:\n  app-title: Surface\n',
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
  return root;
}

interface MachineDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly path: readonly (string | number)[];
}

function answer(diagnostics: readonly MachineDiagnostic[]): string[] {
  return diagnostics
    .map(
      ({ code, severity, path }) =>
        `${code} ${severity} ${JSON.stringify(path)}`,
    )
    .sort();
}

function fromApi(diagnostics: readonly ToolkitDiagnostic[]): string[] {
  return [...new Set(answer(diagnostics))].sort();
}

describe('the command line and the programmatic API', () => {
  it('check the same project to the same diagnostics', async () => {
    const root = await project();
    const api = await checkProject({ project: root });
    expect(api.diagnostics.length).toBeGreaterThan(0);
    expect(
      new Set(api.diagnostics.map(({ severity }) => severity)).size,
    ).toBeGreaterThan(1);

    const cli = await runCli(['check', '--json', '--project', root]);
    const result = JSON.parse(cli.stdout) as {
      diagnostics: MachineDiagnostic[];
      result: { planDigest: string; inputFingerprint: string } | null;
    };
    expect(answer(result.diagnostics)).toEqual(fromApi(api.diagnostics));
    expect(cli.exitCode).toBe(
      api.ok && !api.diagnostics.some(({ severity }) => severity === 'error')
        ? 0
        : 1,
    );
    if (!api.ok) return;
    expect(result.result?.planDigest).toBe(
      api.value.compilation.artifacts.outputPlan.planDigest,
    );
    expect(result.result?.inputFingerprint).toBe(
      api.value.compilation.state.inputFingerprint,
    );
  });

  it('generate the same project to the same plan', async () => {
    const root = await project();
    const cli = await runCli(['generate', '--json', '--project', root]);
    const result = JSON.parse(cli.stdout) as {
      diagnostics: MachineDiagnostic[];
      result: { planDigest: string; inputFingerprint: string } | null;
    };
    const api = await generateProject({ project: root });
    expect(api.ok).toBe(true);
    if (!api.ok) return;
    expect(answer(result.diagnostics)).toEqual(fromApi(api.diagnostics));
    expect(result.result?.planDigest).toBe(
      api.value.compilation.artifacts.outputPlan.planDigest,
    );
  });
});
