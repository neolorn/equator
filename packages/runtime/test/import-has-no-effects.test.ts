/**
 * Importing a runtime entry point defines it and does nothing else.
 *
 * `specs/02-packages-and-platform.spec.md` section 8: a runtime module is free of side effects on
 * import, and importing `@neolorn/equator` starts no timer, watcher or request, reads or writes no
 * document, storage or global state, and registers nothing. Each of those is reached through a
 * global, so the globals are the instrument: every one is replaced with a recorder before the
 * import and read after it. The import is fresh, because a module evaluated by an earlier case
 * would not evaluate again here. The test runner reaches the same globals while it loads a module,
 * and so does Angular while its own modules evaluate, so only an access whose immediate caller is
 * one of the runtime's own sources is counted. Angular is imported above for the same reason: the
 * globals it defines on its own evaluation are Angular's, and a snapshot taken after it sees only
 * what the runtime adds.
 */
import '@angular/compiler';
import '@angular/common';
import '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WATCHED = [
  'setTimeout',
  'setInterval',
  'setImmediate',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'history',
  'location',
] as const;

const RUNTIME_SOURCE = /packages[\\/]runtime[\\/](?:core[\\/])?src[\\/]/u;

function fromRuntime(): boolean {
  // Below the message line sit this function and the recorder, so the fourth line is the caller.
  const frames = (new Error().stack ?? '').split('\n');
  return RUNTIME_SOURCE.test(frames[3] ?? '');
}

function instrument(touched: string[]): () => void {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of WATCHED) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    let current = (globalThis as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        if (fromRuntime()) touched.push(name);
        return current;
      },
      set: (value: unknown) => {
        if (fromRuntime()) touched.push(`${name}=`);
        current = value;
      },
    });
  }
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) {
        delete (globalThis as Record<string, unknown>)[name];
      } else {
        Object.defineProperty(globalThis, name, descriptor);
      }
    }
  };
}

let restore: (() => void) | undefined;
let added: (string | symbol)[] = [];

// Node's fetch keeps its dispatcher under these, created on first use by whoever uses it first.
const PLATFORM_GLOBAL = /^Symbol\(undici\./u;

// A global left by one case would already exist when the next case takes its snapshot, and that
// case would pass whatever its own entry point did.
afterEach(() => {
  restore?.();
  restore = undefined;
  for (const key of added) {
    delete (globalThis as Record<string | symbol, unknown>)[key];
  }
  added = [];
});

describe('importing a runtime entry point', () => {
  it.each([
    ['@neolorn/equator', '../src/public-api.js'],
    ['@neolorn/equator/core', '../core/src/public-api.js'],
  ])('%s touches no global and adds none', async (_entry, specifier) => {
    vi.resetModules();
    const touched: string[] = [];
    const before = new Set(Reflect.ownKeys(globalThis));
    restore = instrument(touched);
    const module = (await import(/* @vite-ignore */ specifier)) as Record<
      string,
      unknown
    >;
    restore();
    restore = undefined;

    added = Reflect.ownKeys(globalThis).filter(
      (key) => !before.has(key) && !PLATFORM_GLOBAL.test(String(key)),
    );

    expect(Object.keys(module).length).toBeGreaterThan(0);
    expect(touched).toEqual([]);
    expect(added.map(String)).toEqual([]);
  });
});
