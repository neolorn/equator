import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * The linter, carrying only what the compiler cannot answer.
 *
 * `tsconfig.base.json` already runs `strict` with `noUncheckedIndexedAccess`,
 * `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`,
 * `useUnknownInCatchVariables`, `noImplicitOverride`, `noImplicitReturns`,
 * `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters` and `skipLibCheck: false`.
 * Every rule below is one the compiler cannot express, so nothing here is a second opinion on a
 * question `typecheck` already settles, and a preset is not extended: a rule that arrives in a
 * minor version of somebody else's recommended set is a gate nobody chose.
 *
 * Type-aware, which is the reason the tool is `typescript-eslint` rather than a faster linter that
 * cannot see types. `oxlint` would be first on cost (40 packages against 219, and its multi-file
 * analysis is in the core engine rather than rebuilt per rule) but its type-aware rules come from
 * `oxlint-tsgolint`, which requires TypeScript 7.0+; Equator is on 6.0.3, so it cannot see a
 * floating promise here at all. It is worth revisiting, and would be the better tool, the day
 * Equator moves to TypeScript 7. Biome is smaller still and its `noFloatingPromises` is in
 * `lint/nursery` on Biome's own inference engine, with no `typescript` dependency of any kind: an
 * incubating rule on an independent inference is the wrong place for a check whose whole value is
 * being right about a type.
 *
 * The programs are `tsconfig.typecheck.json` and `tools/tsconfig.json`, the two configurations in
 * this repository that are *checked* to load every file they cover, the first every file under
 * `packages/` and the second every file in `tools/`: `tools/verify-typecheck.ts` derives both lists
 * from disk and fails naming any file a program did not reach. Pointing the linter at the same
 * configs means a file outside every program cannot be quietly unlinted either.
 */
export default tseslint.config(
  {
    // The linter reads what the compiler reads. The fixtures are consumer applications with their
    // own toolchains, and everything else here is output.
    ignores: [
      '**/node_modules/',
      '.equator/',
      '.runtimes/',
      'tmp/',
      'dist/',
      'fixtures/',
      '*.mjs',
      '*.ts',
    ],
  },
  // One set of rules for both programs, each read through the configuration that types it, so the
  // tools are held to what the packages are and neither list can drift from the other.
  ...[
    { files: ['packages/**/*.ts'], project: './tsconfig.typecheck.json' },
    {
      files: ['tools/**/*.ts', 'tools/**/*.cts'],
      project: './tools/tsconfig.json',
    },
  ].map(({ files, project }) => ({
    files,
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        project: [project],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    settings: {
      // The module graph `import-x/no-cycle` walks is built by the plugin, not by the compiler, so
      // the plugin has to be told two separate things: how to turn a specifier into a path, and how
      // to read the file at the end of it. Only the first is obvious. Without `import-x/parsers`
      // the plugin cannot parse a TypeScript file at all, and every graph rule then reports nothing
      // (not an error, nothing), which is indistinguishable from a repository with no cycles.
      // That is exactly the state this configuration was in when `lint:self-test` first ran, and
      // finding it is the whole reason that stage exists.
      'import-x/extensions': ['.ts', '.mts', '.cts'],
      'import-x/parsers': {
        '@typescript-eslint/parser': ['.ts', '.mts', '.cts'],
      },
      'import-x/resolver-next': [createTypeScriptImportResolver({ project })],
    },
    rules: {
      // The one the stage was asked for. The idiom it expects is already in use here: eleven
      // deliberate `void` calls across the source say "started, not awaited, on purpose".
      '@typescript-eslint/no-floating-promises': 'error',
      // A promise where a boolean or a void callback is expected. The compiler accepts both: a
      // promise is truthy, and a function returning one is assignable to a void-returning type.
      '@typescript-eslint/no-misused-promises': 'error',
      // Awaiting something that is not thenable. It reads as a guarantee about ordering and is not
      // one.
      '@typescript-eslint/await-thenable': 'error',
      // An `async` with no `await` announces a boundary that is not there, and callers write their
      // own code around that announcement.
      '@typescript-eslint/require-await': 'error',
      // The other one the stage was asked for. There are no cycles today, measured over the source
      // with the scan shown to find a seeded one first.
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      // It reads a declared type as runtime truth, so it fails wherever a type claims more than
      // the bytes guarantee. That is the value of it here: an artifact from disk, a value a
      // consumer passed and a host whose own declarations over-promise each arrive in a form that
      // says what was read, and the check that settles it is a check the compiler cannot fold
      // away. A warning from this rule means a type is claiming something, not that a check is
      // spare.
      '@typescript-eslint/no-unnecessary-condition': 'error',
    },
  })),
  {
    // `specs/01-standards-profile.spec.md` section 5 keeps host locale data to presentation. The
    // host's collation and its tailored case mappings are that data, so an order or a comparison
    // taken from them lets the machine a build runs on decide an identity. Code units and the
    // Unicode default case mapping are fixed by the engine's Unicode version instead.
    files: ['packages/**/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression > MemberExpression.callee > Identifier.property[name=/^(?:localeCompare|toLocaleLowerCase|toLocaleUpperCase)$/u]',
          message:
            'Host locale data is presentation only. Compare code units, or use toLowerCase() or toUpperCase(), wherever the result decides an identity or an order.',
        },
      ],
    },
  },
  {
    // `specs/12-verification.spec.md` section 3 seeds every generator from a constant the release
    // carries, so a failing case can be run again. A draw from the platform's random source in a
    // test makes the failure a report that cannot be reproduced, and nothing else would notice it.
    files: ['packages/*/test/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Draw from a generator seeded with a constant the test carries.',
        },
        {
          object: 'crypto',
          property: 'getRandomValues',
          message:
            'Draw from a generator seeded with a constant the test carries.',
        },
      ],
    },
  },
);
