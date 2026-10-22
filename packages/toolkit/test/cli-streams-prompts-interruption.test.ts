import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeProject } from '../src/project-host.js';

import { runCli } from './cli-run.js';
import { WAIT_BOUND_MS } from './fixtures.js';

/**
 * What the executable puts on each stream, what it asks and when, and what it answers when it is
 * interrupted.
 *
 * Each is observed on the executable itself, run in this process, because each is decided in the
 * command-line layer and nowhere below it: the programmatic API has no streams, no prompts and no
 * signals.
 */

const roots: string[] = [];

afterEach(async () => {
  vi.doUnmock('node:readline/promises');
  vi.doUnmock('node:fs');
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify({ name: '@example/cli', private: true, type: 'module' }, null, 2)}\n`,
  );
  return root;
}

/**
 * A project whose check carries advisories, some located in a catalog: two messages nothing uses,
 * and a target catalog that omits them.
 */
async function project(): Promise<string> {
  const root = await temporary('cli-streams-');
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
    'messages:\n  app-title: Streams\n  unused-one: One\n  unused-two: Two\n',
  );
  await write(
    root,
    'i18n/shell/ar-EG.yaml',
    'messages:\n  app-title: تدفقات\n',
  );
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
  );
  await write(
    root,
    'src/app.ts',
    "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
  );
  return root;
}

interface MachineResult {
  readonly profile: string;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly span?: {
      readonly sourcePath?: string;
      readonly start: { readonly line: number; readonly column: number };
    };
  }[];
}

const ESCAPE = '\u001b';

describe('the standard streams', () => {
  it('carry one JSON document on standard output under --json, and nothing else', async () => {
    const root = await project();
    const run = await runCli(['check', '--json', '--project', root]);
    expect(run.exitCode).toBe(0);
    const lines = run.stdout.split('\n');
    expect(lines.at(-1)).toBe('');
    expect(lines).toHaveLength(2);
    const result = JSON.parse(lines[0] ?? '') as MachineResult;
    expect(result.profile).toBe('equator-cli-result/1');
    expect(result.diagnostics.some(({ code }) => code === 'EQ1311')).toBe(true);
    expect(run.stdout).not.toContain(ESCAPE);
    expect(run.stderr).not.toContain(ESCAPE);
  });

  it('carry human diagnostics on standard error, one line each, one-based where machines are zero-based', async () => {
    const root = await project();
    const machine = JSON.parse(
      (await runCli(['check', '--json', '--project', root])).stdout,
    ) as MachineResult;
    const spanned = machine.diagnostics.filter(
      ({ span }) => span?.sourcePath !== undefined,
    );
    expect(spanned.length, JSON.stringify(machine.diagnostics)).toBeGreaterThan(
      0,
    );

    const human = await runCli(['check', '--project', root]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).not.toMatch(/EQ\d{4}/u);
    expect(human.stderr).not.toContain(ESCAPE);
    const lines = human.stderr.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(machine.diagnostics.length);
    for (const line of lines) {
      expect(line).toMatch(/\b(?:info|warning|error) EQ\d{4}: /u);
    }
    for (const diagnostic of spanned) {
      const start = diagnostic.span?.start;
      const position = `${diagnostic.span?.sourcePath}:${(start?.line ?? 0) + 1}:${(start?.column ?? 0) + 1}: `;
      expect(
        lines.some((line) => line.startsWith(position)),
        position,
      ).toBe(true);
    }
  });
});

describe('interactive initialization', () => {
  // Each question is answered as it is asked. A stream that carries every answer up front ends
  // before the second question, and a terminal never does that.
  function answerQuestions(answers: readonly string[]): string[] {
    const questions: string[] = [];
    const remaining = [...answers];
    vi.doMock('node:readline/promises', async (original) => {
      const actual = await original<typeof import('node:readline/promises')>();
      return {
        ...actual,
        createInterface: (
          ...args: Parameters<typeof actual.createInterface>
        ) => {
          const prompt = actual.createInterface(...args);
          prompt.question = ((query: string) => {
            questions.push(query);
            return Promise.resolve(remaining.shift() ?? '');
          }) as typeof prompt.question;
          return prompt;
        },
      };
    });
    return questions;
  }

  const ANSWERS = ['en-US', 'en-US', 'en-US, ar-EG', 'en=en-US'];

  it('asks exactly the four questions on a terminal, then previews its init plan before applying it', async () => {
    const root = await temporary('cli-prompts-');
    const questions = answerQuestions(ANSWERS);
    const run = await runCli(['init', '--project', root], { terminal: true });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(questions).toEqual([
      'Source locale: ',
      'Default locale: ',
      'Supported locales (comma-separated): ',
      'Aliases (comma-separated alias=locale, optional): ',
    ]);
    const plan = run.stdout.indexOf('Equator init plan: ');
    expect(plan).toBeGreaterThanOrEqual(0);
    expect(run.stdout.indexOf('Equator init updated: ')).toBeGreaterThan(plan);
    const configuration = JSON.parse(
      await readFile(resolve(root, 'equator.config.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(configuration['sourceLocale']).toBe('en-US');
    expect(configuration['locales']).toEqual(['en-US', 'ar-EG']);
  });

  it('asks nothing off a terminal and names the complete invocation instead', async () => {
    const root = await temporary('cli-no-prompts-');
    const questions = answerQuestions(ANSWERS);
    const run = await runCli(['init', '--project', root], { terminal: false });
    expect(questions).toEqual([]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('Complete invocation: ');
    await expect(
      readFile(resolve(root, 'equator.config.json'), 'utf8'),
    ).rejects.toThrow();
  });
});

describe('an interrupted watch', () => {
  it('answers 130 even when the watch had already failed', async () => {
    const root = await project();
    const watcher = {
      current: undefined as import('node:events').EventEmitter | undefined,
    };
    vi.doMock('node:fs', async (original) => {
      const actual = await original<typeof import('node:fs')>();
      const { EventEmitter } =
        await vi.importActual<typeof import('node:events')>('node:events');
      return {
        ...actual,
        watch: () => {
          const emitter = new EventEmitter() as InstanceType<
            typeof EventEmitter
          > & {
            close(): void;
          };
          emitter.close = () => {};
          watcher.current = emitter;
          return emitter;
        },
      };
    });
    watcher.current = undefined;
    // Read through a call, because the mocked watch assigns it where the compiler cannot see.
    const current = () => watcher.current;
    const before = new Set(process.listeners('SIGINT'));
    const running = runCli(['watch', '--json', '--project', root]);
    const deadline = Date.now() + WAIT_BOUND_MS;
    while (current() === undefined && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(watcher.current).toBeDefined();
    const interrupt = process
      .listeners('SIGINT')
      .filter((listener) => !before.has(listener));
    expect(interrupt).toHaveLength(1);

    // The watcher fails first, so the run already has a failure to report, and the interruption
    // arrives on top of it. Calling the handler rather than raising the signal keeps the signal
    // away from the test runner's own handlers.
    current()?.emit('error', new Error('watcher lost'));
    for (const listener of interrupt) (listener as () => void)();

    const run = await running;
    expect(run.exitCode).toBe(130);
  });
});
