import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

const compilations = vi.hoisted(() => ({
  names: new Set([
    'createProgram',
    'createWatchProgram',
    'createLanguageService',
    'createIncrementalProgram',
    'createSourceFile',
    'transpileModule',
  ]),
  calls: [] as string[],
}));

// TypeScript publishes its API as accessors that cannot be redefined, so the compiler is observed
// through a module that forwards to it rather than through a spy on it.
vi.mock('typescript', async (original) => {
  const actual = (await original()) as { default: object };
  const forwarded = new Proxy(actual.default, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (
        typeof property === 'string' &&
        compilations.names.has(property) &&
        typeof value === 'function'
      ) {
        return (...args: unknown[]) => {
          compilations.calls.push(`ts.${property}`);
          return Reflect.apply(value, target, args) as unknown;
        };
      }
      return value;
    },
  });
  return { ...actual, default: forwarded };
});

/**
 * A build script that imports the toolkit to read one type pays for nothing else.
 *
 * Nothing in this file imports the entry point statically, so the dynamic import below is the
 * first evaluation of every module under it. The spies go on the builtin objects and are then
 * synchronized into their ESM named exports, because the sources import `mkdir` and `watch` by
 * name and a spy on the object alone would never see those calls.
 */

const WRITES = [
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'mkdir',
  'mkdirSync',
  'mkdtemp',
  'mkdtempSync',
  'open',
  'openSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'symlink',
  'symlinkSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'writeFile',
  'writeFileSync',
  'watch',
  'watchFile',
] as const;

const PROMISE_WRITES = [
  'appendFile',
  'copyFile',
  'cp',
  'mkdir',
  'mkdtemp',
  'open',
  'rename',
  'rm',
  'rmdir',
  'symlink',
  'truncate',
  'unlink',
  'writeFile',
  'watch',
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
});

function isReadFlag(flags: unknown): boolean {
  return (
    flags === undefined ||
    flags === 'r' ||
    flags === 'rs' ||
    flags === fs.constants.O_RDONLY
  );
}

function listeners(): Record<string, number> {
  return Object.fromEntries(
    process
      .eventNames()
      .map((name) => [String(name), process.listenerCount(name)]),
  );
}

describe('importing the toolkit entry point', () => {
  it('starts no compilation, no process mutation, no watch and no filesystem write', async () => {
    const calls: string[] = [];
    const replace = (
      target: Record<string, unknown>,
      label: string,
      names: readonly string[],
    ): void => {
      for (const name of names) {
        const original = target[name];
        if (typeof original !== 'function') continue;
        vi.spyOn(
          target as Record<string, (...args: unknown[]) => unknown>,
          name,
        ).mockImplementation(((...args: unknown[]) => {
          // The module loader opens every source it reads, so an open is a write only when its
          // flags ask for one.
          if (name.startsWith('open') && isReadFlag(args[1])) {
            return Reflect.apply(original, target, args) as unknown;
          }
          // Recorded and not performed, so a write during the import fails the assertion below
          // rather than the import itself, and leaves nothing behind on disk.
          calls.push(`${label}.${name}`);
          return label === 'fs/promises'
            ? Promise.resolve(undefined)
            : undefined;
        }) as never);
      }
    };
    replace(
      (fs as unknown as { default: Record<string, unknown> }).default,
      'fs',
      WRITES,
    );
    replace(
      (fsPromises as unknown as { default: Record<string, unknown> }).default,
      'fs/promises',
      PROMISE_WRITES,
    );
    syncBuiltinESMExports();
    const before = listeners();
    const exitCode = process.exitCode;
    const cwd = process.cwd();
    const environment = { ...process.env };

    // The spies must be live where the sources read them, or an empty list proves nothing.
    fs.mkdirSync('never');
    await fsPromises.writeFile('never', '');
    expect(calls).toEqual(['fs.mkdirSync', 'fs/promises.writeFile']);
    ts.createSourceFile('probe.ts', '', ts.ScriptTarget.ES2022);
    expect(compilations.calls).toEqual(['ts.createSourceFile']);
    calls.length = 0;
    compilations.calls.length = 0;

    const toolkit = await import('../src/index.js');

    expect(typeof toolkit.generateProject).toBe('function');
    expect(calls).toEqual([]);
    expect(compilations.calls).toEqual([]);
    expect(listeners()).toEqual(before);
    expect(process.exitCode).toBe(exitCode);
    expect(process.cwd()).toBe(cwd);
    expect(process.env).toEqual(environment);
  });
});
