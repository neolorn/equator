import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyOutputPlan, inspectOutputFreshness } from '../src/output-host.js';
import {
  COMPLETION_MANIFEST_PATH,
  createOutputPlan,
} from '../src/output-plan.js';

/**
 * Generated output is accepted only when its completion manifest reads the same before and after
 * the inventory it vouches for is inspected.
 *
 * A generation running in another process can replace the manifest between the two reads, and an
 * inspection that trusts its first read would then call a half-published tree fresh. The change is
 * made on disk right after the first read returns, so the second read is the only thing that can
 * see it.
 */

const hook = vi.hoisted(() => ({
  after: undefined as ((path: string) => Promise<void>) | undefined,
  reads: 0,
}));

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const result = await actual.readFile(...args);
      const path = String(args[0]);
      if (hook.after !== undefined && path.endsWith(COMPLETION_MANIFEST_PATH)) {
        hook.reads += 1;
        if (hook.reads === 1) await hook.after(path);
      }
      return result;
    },
  };
});

const roots: string[] = [];

afterEach(async () => {
  hook.after = undefined;
  hook.reads = 0;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const OWNER_ID = `sha256-${'A'.repeat(43)}`;

async function published() {
  const owner = await mkdtemp(resolve(tmpdir(), 'manifest-reread-'));
  roots.push(owner);
  const plan = createOutputPlan([
    { path: 'index.ts', contents: 'export const first = 1;\n' },
  ]);
  if (!plan.ok) throw new Error(JSON.stringify(plan.diagnostics));
  const request = {
    ownerRoot: owner,
    generatedRoot: resolve(owner, 'src/generated/i18n'),
    workRoot: resolve(owner, '.equator'),
    ownerId: OWNER_ID,
    plan: plan.value,
  };
  const applied = await applyOutputPlan(request);
  expect(applied.ok, JSON.stringify(applied.diagnostics)).toBe(true);
  return request;
}

describe('output freshness', () => {
  it('is fresh when the manifest holds still, and read twice', async () => {
    const request = await published();
    hook.after = async () => {};
    const inspected = await inspectOutputFreshness(request);
    expect(inspected.ok, JSON.stringify(inspected.diagnostics)).toBe(true);
    if (inspected.ok) expect(inspected.value.fresh).toBe(true);
    expect(hook.reads).toBe(2);
  });

  it('fails as stale when the manifest is replaced between its two reads', async () => {
    const request = await published();
    const other = createOutputPlan([
      { path: 'index.ts', contents: 'export const second = 2;\n' },
    ]);
    if (!other.ok) throw new Error(JSON.stringify(other.diagnostics));
    const otherRoot = await mkdtemp(
      resolve(tmpdir(), 'manifest-reread-other-'),
    );
    roots.push(otherRoot);
    const otherRequest = {
      ...request,
      ownerRoot: otherRoot,
      generatedRoot: resolve(otherRoot, 'src/generated/i18n'),
      workRoot: resolve(otherRoot, '.equator'),
      plan: other.value,
    };
    expect((await applyOutputPlan(otherRequest)).ok).toBe(true);
    const { readFile, writeFile } =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    const replacement = await readFile(
      resolve(otherRequest.generatedRoot, COMPLETION_MANIFEST_PATH),
      'utf8',
    );
    hook.after = (path) => writeFile(path, replacement, 'utf8');

    const inspected = await inspectOutputFreshness(request);
    expect(inspected.ok).toBe(false);
    expect(inspected.diagnostics.map(({ code }) => code)).toEqual(['EQ1603']);
  });

  it('fails as stale when the manifest disappears between its two reads', async () => {
    const request = await published();
    const { unlink } =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    hook.after = (path) => unlink(path);

    const inspected = await inspectOutputFreshness(request);
    expect(inspected.ok).toBe(false);
    expect(inspected.diagnostics.map(({ code }) => code)).toEqual(['EQ1603']);
  });
});
