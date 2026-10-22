import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { defineConfig } from 'vitest/config';

/**
 * Standard decorators, lowered by the compiler the packages are built with.
 *
 * Vite transforms TypeScript with Oxc, which lowers only TypeScript's legacy decorators. The runtime
 * declares its injectables, components, directives and pipes with standard decorators, so Oxc leaves
 * `@Injectable()` in place and Node refuses the module. TypeScript lowers them at the target the
 * library compiles to, and only a file that declares one goes through it.
 */
const standardDecorators = {
  name: 'equator-standard-decorators',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.endsWith('.ts') || !/^@[A-Z]\w*\(/mu.test(code)) return null;
    const { outputText, sourceMapText } = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: true,
        sourceMap: true,
      },
    });
    return { code: outputText, map: sourceMapText ?? null };
  },
};

/**
 * Two aliases, and the rule that decides which specifiers may have one.
 *
 * `@neolorn/equator/core` and `@neolorn/equator/http` are real published entry points, so the
 * package's own sources import them by those specifiers rather than reaching across directories,
 * which is what keeps each compiled into exactly one bundle. Under vitest there is no published
 * package to resolve them against, so each is mapped to the source its entry point is built from.
 * The testing entry point's server seat imports the request handler that way, because a seat
 * compiled around a second copy of it would be answering through something other than what a
 * deployment installs.
 *
 * The primary is deliberately *not* aliased. An earlier attempt to alias `@neolorn/equator` to
 * `src/public-api.ts` threw `The injectable 'PlatformLocation' needs to be compiled using the JIT
 * compiler`, which was not a configuration problem to work around but the finding that started
 * this step: the primary cannot be loaded outside an Angular application. `core` and `http` import
 * no Angular at all, which is why aliasing them is safe and aliasing the primary is not.
 */
export default defineConfig({
  plugins: [standardDecorators],
  test: {
    /**
     * `tmp/` is never a source of tests, and after a red gate it holds four copies of them.
     *
     * `verify.mjs` keeps its worktrees under `tmp/verify-trees` when a run fails, so a resume
     * can reuse them, and vitest's positional filter is a substring match on the file path, so
     * `packages/toolkit/test` then matches the copy inside every kept tree as well as the real one.
     * A local `test:toolkit` went from 38 files to 190 without saying anything had changed.
     *
     * The cost is not the duration. Those copies are pinned at whatever commit the failed run was
     * gating, so a local suite silently runs stale tests beside current ones and reports them
     * together: a case deleted an hour ago comes back to life, and a fixture that moved fails in a
     * tree nobody is editing. Excluded here rather than in each suite, because it is true of all of
     * them and of anything added later.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'tmp/**'],
    /**
     * A hang detector, not a performance budget.
     *
     * Vitest's default is 5000ms and nobody here chose it. Under full-suite load the slowest
     * toolkit tests run between 3.3s and 6.0s, and this machine's own throughput moves about a
     * quarter across an hour, so a test measured at 4.2s passes or fails depending on when it
     * runs, and four tests had already been given individual escapes as they crossed. Green is not
     * allowed to depend on how busy the machine is.
     *
     * What a test costs is asserted by `verify:edit-cost`, which measures it. This number only has
     * to be high enough that reaching it means the test is never going to finish, and low enough to
     * sit inside the stage bound so a failure names the test rather than the stage: the same
     * inner-bound-inside-outer-guard shape as the `page.evaluate` bound in
     * `tools/verify-package-consumer-hydration.mjs`.
     */
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@neolorn/equator/core': fileURLToPath(
        new URL('./packages/runtime/core/src/public-api.ts', import.meta.url),
      ),
      '@neolorn/equator/http': fileURLToPath(
        new URL('./packages/runtime/http/src/public-api.ts', import.meta.url),
      ),
    },
  },
});
