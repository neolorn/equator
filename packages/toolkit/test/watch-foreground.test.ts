import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeProject, watchProject } from '../src/project-host.js';
import { WAIT_BOUND_MS } from './fixtures.js';

/**
 * Watch is the calling process, for exactly as long as the caller keeps it. Once a stopped watch
 * has returned, no cycle is delivered, the watcher holds no reference that keeps the process alive,
 * and the event loop releases the operating system handle shortly after.
 *
 * Observed through the process's own list of active resources, where the platform watcher shows up
 * while it is open. A watcher left open after the call returns is a background process in all but
 * name: it keeps the host alive and keeps consuming events nobody reads.
 *
 * The list is read until the watcher has left it, not once. Node's `FSWatcher.close()` closes the
 * handle and emits `close` on the next tick, and the handle leaves the list later, in
 * `HandleWrap::OnClose`, which libuv calls when the close completes. On Windows that waits for the
 * pending directory read to be cancelled (`uv__fs_event_endgame`), which takes turns of the loop
 * nobody can count. So the claim held here is that the watcher is released with nothing further
 * from the caller, and that no cycle arrives once the call has returned.
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

const watchers = (): number =>
  process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap')
    .length;

describe('watch', () => {
  it('holds a platform watcher only between its start and its return', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'watch-foreground-'));
    roots.push(root);
    await write(
      root,
      'package.json',
      `${JSON.stringify({ name: '@example/watch-foreground', private: true, type: 'module' }, null, 2)}\n`,
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
      'tsconfig.app.json',
      `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
    );
    await write(
      root,
      'src/app.ts',
      "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
    );
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Foreground\n',
    );

    const before = watchers();
    const controller = new AbortController();
    let during = -1;
    let cycles = 0;
    let returned = false;
    const watched = watchProject({
      project: root,
      signal: controller.signal,
      onCycle: () => {
        cycles += 1;
        during = watchers();
        controller.abort();
      },
    }).finally(() => {
      returned = true;
    });
    const deadline = Date.now() + WAIT_BOUND_MS;
    while (during < 0 && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 20));
    }
    expect(during).toBeGreaterThan(before);
    const result = await watched;
    expect(returned).toBe(true);
    expect(result.ok).toBe(true);
    const cyclesAtReturn = cycles;
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Foreground, edited after the return\n',
    );
    await vi.waitFor(() => expect(watchers()).toBe(before), {
      timeout: WAIT_BOUND_MS,
      interval: 20,
    });
    expect(cycles).toBe(cyclesAtReturn);
  });
});
