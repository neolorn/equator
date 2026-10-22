import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverProject } from '../src/project-host.js';

/**
 * One configuration file, found by looking upward, and a failure that names every candidate when
 * looking upward finds more than one.
 *
 * Picking the nearest of two would make which project a command acts on depend on the directory it
 * was typed in, and a second configuration format, or one that runs code, would let two sources
 * disagree about the same project.
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

async function temporary(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'configuration-discovery-'));
  roots.push(root);
  return root;
}

describe('configuration discovery', () => {
  it('fails with both candidates when a package and a directory inside it each carry one', async () => {
    const root = await temporary();
    await write(root, 'package.json', '{ "name": "@example/discovery" }\n');
    await write(root, 'equator.config.json', '{}\n');
    await write(root, 'application/equator.config.json', '{}\n');
    const nested = resolve(root, 'application', 'src');
    await mkdir(nested, { recursive: true });

    const discovered = await discoverProject({ cwd: nested });
    expect(discovered.ok).toBe(false);
    expect(discovered.diagnostics.map(({ code }) => code)).toEqual(['EQ1702']);
    const summary = discovered.diagnostics[0]?.summary ?? '';
    expect(summary).toContain(JSON.stringify(root));
    expect(summary).toContain(JSON.stringify(resolve(root, 'application')));

    // Selecting one explicitly is the way out the diagnostic names, and it works.
    const selected = await discoverProject({ cwd: nested, project: '..' });
    expect(selected.ok).toBe(true);
  });

  it('does not take a configuration module as a configuration, and does not run it', async () => {
    const root = await temporary();
    await write(root, 'package.json', '{ "name": "@example/discovery" }\n');
    for (const name of [
      'equator.config.mjs',
      'equator.config.js',
      'equator.config.ts',
    ]) {
      await write(
        root,
        name,
        "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./executed', import.meta.url), '');\nexport default {};\n",
      );
    }

    const discovered = await discoverProject({ cwd: root });
    expect(discovered.ok).toBe(false);
    expect(discovered.diagnostics.map(({ code }) => code)).toEqual(['EQ1702']);
    expect(await readdir(root)).not.toContain('executed');
  });
});
