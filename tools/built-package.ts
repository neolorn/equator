/**
 * The `file:` locator a consumer's manifest names a built Equator package by.
 *
 * The package's manifest is read here before the locator is handed out, for two reasons. A package
 * that was never built is then refused by the stage that needs it, by name, instead of by the
 * package manager in its own words. And the installing is done by pnpm, a native program the gate's
 * trace of what a stage reads does not follow, so without a read of the stage's own the gate would
 * see a stage that declares it reads `dist` and never does.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export function builtPackageLocator(
  consumerRoot: string,
  workspaceRoot: string,
  outputRoot: string,
): string {
  const packageRoot = resolve(workspaceRoot, outputRoot);
  const manifestPath = resolve(packageRoot, 'package.json');
  assert.ok(
    existsSync(manifestPath),
    `${outputRoot} holds no built package. Run pnpm run build.`,
  );
  const { name } = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    readonly name?: unknown;
  };
  assert.ok(
    typeof name === 'string' && name.startsWith('@neolorn/equator'),
    `${outputRoot}/package.json names ${String(name)}, which is not an Equator package.`,
  );
  return `file:${relative(consumerRoot, packageRoot).replaceAll('\\', '/')}`;
}
