import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyOutputPlan, inspectOutputFreshness } from '../src/output-host.js';
import { createOutputPlan } from '../src/output-plan.js';

/**
 * A generated root that holds a link.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 9 has a linked root reported, and the freshness
 * inspection documents a failure as an `EQ1601` diagnostic. The inventory walk is where the link is
 * met, after the roots were validated and, for a generation, after the lock was taken. So the
 * refusal is a result on both paths, and a generation that is refused leaves no lock behind it.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const OWNER_ID = `sha256-${'A'.repeat(43)}`;

function plan(contents: string) {
  const created = createOutputPlan([{ path: 'index.ts', contents }]);
  if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
  return created.value;
}

/** A published generated root with a directory link put inside it afterwards. */
async function publishedWithLink() {
  const owner = await mkdtemp(resolve(tmpdir(), 'linked-content-'));
  roots.push(owner);
  const request = {
    ownerRoot: owner,
    generatedRoot: resolve(owner, 'src/generated/i18n'),
    workRoot: resolve(owner, '.equator'),
    ownerId: OWNER_ID,
    plan: plan('export const first = 1;\n'),
  };
  const applied = await applyOutputPlan(request);
  expect(applied.ok, JSON.stringify(applied.diagnostics)).toBe(true);
  const elsewhere = resolve(owner, 'elsewhere');
  await mkdir(elsewhere);
  const link = resolve(request.generatedRoot, 'linked');
  // A junction, which Windows lets any account create; elsewhere the type is ignored.
  await symlink(elsewhere, link, 'junction');
  return { request, link };
}

describe('a generated root that holds a link', () => {
  it('is reported by the freshness inspection as a diagnostic', async () => {
    const { request } = await publishedWithLink();

    const inspected = await inspectOutputFreshness(request);

    expect(inspected.ok).toBe(false);
    expect(inspected.diagnostics.map(({ code }) => code)).toEqual(['EQ1601']);
    expect(inspected.diagnostics[0]?.summary).toContain(
      'Equator refuses linked content in an owned root',
    );
  });

  it('refuses a generation with a diagnostic and leaves no lock', async () => {
    const { request, link } = await publishedWithLink();
    const next = { ...request, plan: plan('export const second = 2;\n') };

    const refused = await applyOutputPlan(next);

    expect(refused.ok).toBe(false);
    expect(refused.diagnostics.map(({ code }) => code)).toEqual(['EQ1601']);
    expect(await readdir(request.workRoot)).not.toContain('generation.lock');

    // With the link gone the same generation goes through, which a lock left held would refuse.
    await rm(link, { recursive: true, force: true });
    const applied = await applyOutputPlan(next);
    expect(applied.ok, JSON.stringify(applied.diagnostics)).toBe(true);
  });
});
