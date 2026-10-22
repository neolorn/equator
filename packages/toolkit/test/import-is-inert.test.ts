/**
 * Importing the toolkit's programmatic API does nothing but define it.
 *
 * `specs/02-packages-and-platform.spec.md` section 4: an import executes no command, mutates no
 * process state, installs no hook, writes no file, starts no watcher and makes no request. The CLI
 * lives in the same package and does all of those on purpose, so the case that matters is the API
 * reaching the CLI's module, which runs its command on evaluation. Reading a file is allowed and is
 * not counted: a module may read its own manifest.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const touched: string[] = [];

function counting<T extends Record<string, unknown>>(
  module: T,
  label: string,
  names: readonly string[],
): T {
  const copy: Record<string, unknown> = { ...module };
  for (const name of names) {
    const original = module[name];
    if (typeof original !== 'function') continue;
    copy[name] = (...parameters: unknown[]) => {
      touched.push(`${label}.${name}`);
      return (original as (...values: unknown[]) => unknown)(...parameters);
    };
  }
  return copy as T;
}

const FILE_EFFECTS = [
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'mkdir',
  'mkdirSync',
  'rm',
  'rmSync',
  'rename',
  'renameSync',
  'watch',
  'watchFile',
  'createWriteStream',
];

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const wrapped = counting(actual, 'fs', FILE_EFFECTS);
  return { ...wrapped, default: wrapped };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const wrapped = counting(actual, 'fs/promises', FILE_EFFECTS);
  return { ...wrapped, default: wrapped };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const wrapped = counting(actual, 'child_process', [
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
    'spawn',
    'spawnSync',
  ]);
  return { ...wrapped, default: wrapped };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('importing the toolkit API', () => {
  it('counts a write it must count', async () => {
    touched.length = 0;
    const fs = await import('node:fs');
    fs.mkdirSync(process.cwd(), { recursive: true });
    expect(touched).toEqual(['fs.mkdirSync']);
  });

  it('runs no command, touches no process state, writes nothing and requests nothing', async () => {
    touched.length = 0;
    const exitCode = process.exitCode;
    const listeners = ['on', 'once', 'addListener', 'prependListener'] as const;
    for (const name of listeners) {
      vi.spyOn(process, name).mockImplementation(function (this: unknown) {
        touched.push(`process.${name}`);
        return process;
      });
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      touched.push('process.stdout.write');
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      touched.push('process.stderr.write');
      return true;
    });
    vi.stubGlobal('fetch', () => {
      touched.push('fetch');
      return Promise.reject(new Error('no network'));
    });

    vi.resetModules();
    const api = await import('../src/index.js');
    // A command started on import may finish after the import settles, so its effects are given
    // the turns it would need before they are read.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(typeof api.parseCatalog).toBe('function');
    expect(touched).toEqual([]);
    expect(process.exitCode).toBe(exitCode);
  });
});
