/**
 * Every stage that has a self-test: what it runs, what it reads, and the defects planted into a copy
 * of what it reads.
 *
 * `verify-stage-self-test.mjs <stage>` runs one entry. The normative map names a plant as
 * `plant:<stage>:<id>`, which is a check only while `<stage>:self-test` is in the gate.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { injections as fastInjections } from './assurance-injections.mjs';
import { injections as runtimeInjections } from './assurance-runtime-injections.mjs';
import { buildStatsFiles } from './build-stats.mjs';
import { plants as packageStructurePlants } from './package-structure-plants.mjs';
import {
  editJson,
  editText,
  replaceOnce,
  replaceOnceMatching,
  repositoryRoot,
} from './stage-self-test.mjs';
import {
  compareVersions,
  developmentNode,
  nodeFloors,
} from './supported-versions.mjs';

// The minimal consumer's module graph, in whichever file its Angular wrote it.
const MINIMAL_OUTPUT =
  'tmp/focused-package-consumer-verification/minimal-runtime-consumer/dist/minimal';
const editMinimalStats = (edit) => (root) => {
  const [file = resolve(root, MINIMAL_OUTPUT, 'stats.json')] = buildStatsFiles(
    resolve(root, MINIMAL_OUTPUT),
  );
  return editJson(relative(root, file), edit)(root);
};

const plantText = (path, find, replace) => (root) =>
  editText(root, path, replaceOnce(find, replace));

// For the runtime's built files, whose spelling is the packager's.
const plantMatching = (path, pattern, replace) => (root) =>
  editText(root, path, replaceOnceMatching(pattern, replace));

const runtimeBundle = 'dist/runtime/fesm2022/neolorn-equator.mjs';

// The Node rows the compatibility page lists as executed, as the page writes them. Read from the
// manifest and `.node-version`, so a plant that names them moves when the development Node does.
const executedNodeRows = [...new Set([...nodeFloors, developmentNode])]
  .sort(compareVersions)
  .map((version) => `\`${version}\``);

const suiteRoot = 'standards/data/message-format-tests-48.2';

// Every `src` under `packages/` at any depth, the directories the diagnostics scan reads, so the
// copy holds each secondary entry point the scan would find in the repository.
const packageSourceRoots = () => {
  const roots = [];
  const visit = (path) => {
    for (const entry of readdirSync(resolve(repositoryRoot, path), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const child = `${path}/${entry.name}`;
      if (entry.name === 'src') roots.push(child);
      else visit(child);
    }
  };
  visit('packages');
  return roots.sort();
};

/**
 * A mutation reading in which every recorded mutant survives where its text stands, written into
 * the copy as two reports, one per package, with `edit` applied: the one thing wrong with it.
 * Answers the plant and the arguments that name the reports to the stage.
 */
const plantReading = (edit) => {
  const names = ['reading-runtime.json', 'reading-toolkit.json'];
  return {
    args: (root) => ['--report', ...names.map((name) => resolve(root, name))],
    plant: async (root) => {
      const record = JSON.parse(
        readFileSync(resolve(root, 'tools/mutation-reasons.json'), 'utf8'),
      );
      const reports = names.map(() => ({ files: {} }));
      const placed = [];
      for (const entry of record.survivors) {
        const report =
          reports[entry.file.startsWith('packages/toolkit/') ? 1 : 0];
        report.files[entry.file] ??= {
          source: readFileSync(resolve(root, entry.file), 'utf8').replaceAll(
            '\r\n',
            '\n',
          ),
          mutants: [],
        };
        const { source, mutants } = report.files[entry.file];
        const position = (offset) => {
          const before = source.slice(0, offset);
          return {
            line: before.split('\n').length,
            column: offset - before.lastIndexOf('\n'),
          };
        };
        const own = [];
        let from = 0;
        for (let place = 0; place < (entry.count ?? 1); place += 1) {
          const start = source.indexOf(entry.original, from);
          from = start + entry.original.length;
          own.push({
            mutatorName: entry.mutator,
            replacement: entry.replacement,
            status: 'Survived',
            coveredBy: ['planted'],
            testsCompleted: 1,
            location: { start: position(start), end: position(from) },
          });
        }
        mutants.push(...own);
        placed.push(own);
      }
      edit({ record, reports, mutantsOf: (index) => placed[index] });
      for (const [index, name] of names.entries()) {
        await writeFile(resolve(root, name), JSON.stringify(reports[index]));
      }
    },
  };
};

// Made up per run, because the export gate reads this file as evidence of use, and a planted name
// written here would be one this file already uses.
const plantedExport = `planted${Date.now().toString(36)}`;

// The tarball `verify:npm-consumer` installs, at the version it reads in the copy it runs over. Read
// when a plant runs rather than when this file loads, because every self-test loads this file.
const packedTarball = (name, file) => (root) => {
  const { version } = JSON.parse(
    readFileSync(resolve(root, 'packages/runtime/package.json'), 'utf8'),
  );
  return `release/${name}/${version}/${file}-${version}.tgz`;
};

/**
 * Unpacks a tarball in the copy, hands `edit` the unpacked `package` folder, and packs it again in
 * place. Windows' own tar rather than whichever is first on the path, because it reads and writes
 * gzip and takes a drive letter as a path.
 */
const editTarball = (locate, edit) => async (root) => {
  const file = resolve(root, locate(root));
  const unpacked = `${file}.unpacked`;
  const tar =
    process.platform === 'win32'
      ? resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe')
      : 'tar';
  await rm(unpacked, { recursive: true, force: true });
  await mkdir(unpacked, { recursive: true });
  execFileSync(tar, ['-xzf', file, '-C', unpacked]);
  await edit(resolve(unpacked, 'package'));
  execFileSync(tar, ['-czf', file, '-C', unpacked, 'package']);
  await rm(unpacked, { recursive: true, force: true });
};
const editManifest = (change) => async (folder) => {
  const path = resolve(folder, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  change(manifest);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

export const stageSelfTests = Object.freeze({
  'verify:npm-consumer': {
    script: 'tools/verify-npm-package-consumer.mjs',
    inputs: [
      'fixtures/npm-package-consumer',
      'packages/runtime/package.json',
      'release/runtime',
      'release/toolkit',
    ],
    timeout: 600_000,
    plants: [
      {
        // pnpm resolves the protocol inside the workspace and replaces it when it packs; a manifest
        // packed some other way carries it to a consumer, and npm cannot resolve it.
        id: 'workspace-protocol-published',
        plant: editTarball(
          packedTarball('runtime', 'neolorn-equator'),
          editManifest((manifest) => {
            manifest.dependencies.tslib = 'workspace:*';
          }),
        ),
        refusal: /EUNSUPPORTEDPROTOCOL|Unsupported URL Type "workspace:"/u,
      },
      {
        id: 'dependency-the-lock-does-not-hold',
        plant: editTarball(
          packedTarball('toolkit', 'neolorn-equator-toolkit'),
          editManifest((manifest) => {
            manifest.dependencies['left-pad'] = '1.3.0';
          }),
        ),
        refusal: /ENOTCACHED|changed what the committed lock pins/u,
      },
      {
        // A peer range no release of the peer satisfies, which npm refuses and pnpm only warns about.
        id: 'peer-range-nothing-satisfies',
        plant: editTarball(
          packedTarball('runtime', 'neolorn-equator'),
          editManifest((manifest) => {
            manifest.peerDependencies.rxjs = '>=8.0.0 <9.0.0';
          }),
        ),
        refusal: /ERESOLVE/u,
      },
      {
        id: 'exported-file-not-packed',
        plant: editTarball(
          packedTarball('runtime', 'neolorn-equator'),
          (folder) => rm(resolve(folder, 'fesm2022/neolorn-equator-http.mjs')),
        ),
        refusal: /An entry point of the installed packages did not load/u,
      },
    ],
  },
  'verify:packages': {
    script: 'tools/verify-package-structure.mjs',
    inputs: [
      'package.json',
      '.node-version',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'LICENSE',
      'standards/sources.lock.json',
      'standards/data/language-subtag-registry-2026-09-17.txt',
      'dist/runtime',
      'dist/toolkit',
      'packages/runtime/src',
      'packages/runtime/core/src',
      'packages/runtime/forms/src',
      'packages/runtime/http/src',
      'packages/runtime/router/src',
      'packages/runtime/ssr/src',
      'packages/runtime/testing/src',
      'packages/toolkit/src',
    ],
    plants: packageStructurePlants,
  },
  'verify:cli-options': {
    script: 'tools/generate-cli-options.mjs',
    args: ['--check'],
    inputs: ['dist/toolkit', 'packages/toolkit/src/cli-options.generated.ts'],
    plants: [
      {
        id: 'option-table-kept-by-hand',
        plant: plantText(
          'packages/toolkit/src/cli-options.generated.ts',
          "  | 'parentLocales'\n",
          '',
        ),
        refusal: /The checked-in equator init option table is stale/u,
      },
      {
        id: 'settable-field-without-a-description',
        plant: plantText(
          'dist/toolkit/schemas.js',
          "description: 'The locale the authored source catalogs are written in.',",
          '',
        ),
        refusal: /Configuration key sourceLocale has no description/u,
      },
    ],
  },
  'verify:diagnostics-reference': {
    script: 'tools/generate-diagnostics-reference.mjs',
    args: ['--check'],
    inputs: [
      'dist/toolkit',
      'dist/runtime/types',
      ...packageSourceRoots(),
      'packages/toolkit/DIAGNOSTICS.md',
      'docs/reference/diagnostics.md',
      'tools/code-record.json',
      'tools/code-descriptions.json',
    ],
    plants: [
      {
        id: 'recorded-toolkit-code-renumbered',
        plant: plantText(
          'dist/toolkit/diagnostic-reference.js',
          '    EQ1701: ',
          '    EQ1799: ',
        ),
        refusal:
          /EQ1701 is in tools\/code-record\.json and ToolkitDiagnosticCode no longer declares it/u,
      },
      {
        id: 'recorded-failure-code-withdrawn',
        plant: plantMatching(
          'dist/runtime/types/neolorn-equator-core.d.ts',
          /(["'])participant-timeout\1 \| /u,
          '',
        ),
        refusal:
          /participant-timeout is in tools\/code-record\.json and LocalizationFailureCode no longer declares it/u,
      },
      {
        id: 'runtime-event-code-moved-to-another-area',
        plant: plantMatching(
          'dist/runtime/types/neolorn-equator.d.ts',
          /(readonly transition: ["'])EQ-E2003(["'];\s+readonly formatting: ["'])EQ-E2004(["'];)/u,
          '$1EQ-E2004$2EQ-E2003$3',
        ),
        refusal:
          /EQ-E2003 is recorded for transition and RUNTIME_EVENT_CODES now declares it for formatting/u,
      },
      {
        id: 'toolkit-event-code-moved-to-another-area',
        plant: plantText(
          'dist/toolkit/observability.js',
          "interchange: 'EQ-E1002',\n    migration: 'EQ-E1003',",
          "interchange: 'EQ-E1003',\n    migration: 'EQ-E1002',",
        ),
        refusal:
          /EQ-E1002 is recorded for interchange and TOOLKIT_EVENT_CODES now declares it for migration/u,
      },
      {
        id: 'declared-code-not-recorded',
        plant: editJson('tools/code-record.json', (record) => {
          record.toolkitDiagnostics = record.toolkitDiagnostics.filter(
            (code) => code !== 'EQ1416',
          );
        }),
        refusal:
          /Declared and not in tools\/code-record\.json: EQ1416 \(ToolkitDiagnosticCode\)/u,
      },
      // A failing run that moves its own baseline the way that hides the failure: the built table the
      // stage imports renumbers a recorded code and rewrites the record to match. The stage still
      // fails on the renumbered code being raised nowhere, and prints nothing about the record, so
      // only the comparison of what the run reads can see it.
      {
        id: 'failing-run-rewrites-its-record',
        rewrites: 'tools/code-record.json',
        plant: (root) =>
          editText(root, 'dist/toolkit/diagnostic-reference.js', (text) =>
            [
              "import { readFileSync, writeFileSync } from 'node:fs';",
              "const recordUrl = new URL('../../tools/code-record.json', import.meta.url);",
              "writeFileSync(recordUrl, readFileSync(recordUrl, 'utf8').replace('\"EQ1701\"', '\"EQ1799\"'));",
              replaceOnce('    EQ1701: ', '    EQ1799: ')(text),
            ].join('\n'),
          ),
      },
      {
        id: 'declared-code-without-a-description',
        plant: editJson('tools/code-descriptions.json', (descriptions) => {
          delete descriptions.runtimeFailures['participant-timeout'];
        }),
        refusal:
          /participant-timeout is declared by LocalizationFailureCode and tools\/code-descriptions\.json has no description for it/u,
      },
      {
        id: 'description-for-an-undeclared-code',
        plant: editJson('tools/code-descriptions.json', (descriptions) => {
          descriptions.runtimeEvents['EQ-E2009'] =
            'An area the runtime does not declare.';
        }),
        refusal:
          /tools\/code-descriptions\.json describes EQ-E2009, which RUNTIME_EVENT_CODES does not declare/u,
      },
      {
        id: 'package-reference-kept-by-hand',
        plant: plantText(
          'packages/toolkit/DIAGNOSTICS.md',
          '### EQ1701',
          '### EQ1799',
        ),
        refusal:
          /packages[\\/]toolkit[\\/]DIAGNOSTICS\.md does not match the diagnostics table/u,
      },
      {
        id: 'web-reference-kept-by-hand',
        plant: plantText(
          'docs/reference/diagnostics.md',
          '### EQ1701',
          '### EQ1799',
        ),
        refusal:
          /docs[\\/]reference[\\/]diagnostics\.md does not match the diagnostics table/u,
      },
    ],
  },
  'verify:docs-reference': {
    script: 'tools/generate-docs-reference.mjs',
    args: ['--check'],
    inputs: ['dist/runtime', 'dist/toolkit', 'docs/reference', 'README.md'],
    plants: [
      {
        id: 'compatibility-page-calls-a-range-verified',
        plant: plantText(
          'docs/reference/compatibility.md',
          '## Angular, TypeScript and RxJS',
          '## Angular, TypeScript and RxJS, all verified',
        ),
        refusal:
          /compatibility\.md is not what its source of truth produces now/u,
      },
      {
        id: 'compatibility-page-lists-an-unexecuted-row',
        plant: plantText(
          'docs/reference/compatibility.md',
          `${executedNodeRows.join(', ')}.`,
          `${[executedNodeRows[0], '`22.30.0`', ...executedNodeRows.slice(1)].join(', ')}.`,
        ),
        refusal:
          /compatibility\.md is not what its source of truth produces now/u,
      },
      {
        id: 'readme-range-not-the-manifest-range',
        plant: plantText(
          'README.md',
          '| RxJS       | `>=7.4.0 <8.0.0`                      |',
          '| RxJS       | `>=7.0.0 <8.0.0`                      |',
        ),
        refusal: /README\.md offers RxJS at >=7\.0\.0 <8\.0\.0/u,
      },
      {
        id: 'readme-claims-a-wider-range',
        plant: plantText(
          'README.md',
          '| Angular    | `>=22.0.0 <23.0.0`                    |',
          '| Angular    | `>=22.0.0 <24.0.0`                    |',
        ),
        refusal: /README\.md offers Angular at >=22\.0\.0 <24\.0\.0/u,
      },
    ],
  },
  'verify:standards-sources': {
    script: 'tools/verify-standards-sources.mjs',
    inputs: ['standards'],
    plants: [
      {
        id: 'vendored-source-not-its-digest',
        plant: (root) =>
          editText(
            root,
            'standards/data/language-subtag-registry-2026-09-17.txt',
            (text) => `${text}%%\n`,
          ),
        refusal:
          /language-subtag-registry-2026-09-17\.txt is \d+ bytes, the lock says/u,
      },
      {
        // One byte, so the length still matches and only the digest can see it.
        id: 'standard-extract-one-byte-edited',
        plant: plantText(
          'standards/data/ecma-402-13.0-measurement-unit-identifiers.html',
          '<td>acre</td>',
          '<td>Acre</td>',
        ),
        refusal:
          /ecma-402-13\.0-measurement-unit-identifiers\.html hashes to [0-9a-f]+, the lock says/u,
      },
      {
        id: 'conformance-suite-edited',
        plant: plantText(
          `${suiteRoot}/test/README.md`,
          '# Unicode MessageFormat Test Suite',
          '# Unicode MessageFormat Test Suite (edited)',
        ),
        refusal:
          /message-format-tests-48\.2 manifest hashes to [0-9a-f]+, the lock says/u,
      },
      {
        id: 'vendored-notice-edited',
        plant: (root) =>
          editText(
            root,
            'standards/data/cldr-person-names-48.2.0/LICENSE',
            (text) => `${text}%%\n`,
          ),
        refusal:
          /its notice data\/cldr-person-names-48\.2\.0\/LICENSE is \d+ bytes, the lock says/u,
      },
      {
        id: 'vendored-source-records-no-notice',
        plant: plantText(
          'standards/sources.lock.json',
          ',\n        "noticeNotRequired": "IANA and the IETF place the protocol registries under the CC0 1.0 dedication, which asks for no notice on copies."',
          '',
        ),
        refusal:
          /its license records neither a noticeFile nor a noticeNotRequired reason/u,
      },
      {
        id: 'unrecorded-data-file',
        plant: (root) =>
          writeFile(resolve(root, 'standards/data/unrecorded.txt'), 'planted'),
        refusal: /data\/unrecorded\.txt is present, and no source records it/u,
      },
      {
        id: 'source-recorded-without-a-role',
        plant: editJson('standards/sources.lock.json', (lock) => {
          delete lock.dataSources.cldrJsonCore.role;
        }),
        refusal: /cldrJsonCore: the lock records no role/u,
      },
    ],
  },
  'verify:injection-anchors': {
    script: 'tools/verify-injection-anchors.mjs',
    // The files the injections patch, read from the lists, so a new source is copied on the day
    // an injection names it.
    inputs: [
      ...new Set(
        [...fastInjections, ...runtimeInjections].map(({ source }) => source),
      ),
    ].sort(),
    plants: [
      {
        id: 'anchor-gone-from-its-file',
        plant: plantText(
          'packages/toolkit/src/semantic-model.ts',
          '    if (missing.length === 0) continue;',
          '    if (missing.length < 1) continue;',
        ),
        refusal:
          /missing-plural-categories-unreported: the text it finds is in packages\/toolkit\/src\/semantic-model\.ts 0 time\(s\)/u,
      },
      {
        id: 'anchor-in-its-file-twice',
        plant: (root) =>
          editText(
            root,
            'packages/toolkit/src/semantic-model.ts',
            (text) => `${text}\n//     if (missing.length === 0) continue;\n`,
          ),
        refusal:
          /missing-plural-categories-unreported: the text it finds is in packages\/toolkit\/src\/semantic-model\.ts 2 time\(s\)/u,
      },
      {
        id: 'patched-file-gone',
        plant: (root) =>
          rm(resolve(root, 'packages/runtime/src/issue-convention.ts')),
        refusal: /packages\/runtime\/src\/issue-convention\.ts does not exist/u,
      },
    ],
  },
  'verify:mutation-reasons': {
    script: 'tools/verify-mutation-reasons.mjs',
    inputs: ['tools/mutation-reasons.json', ...packageSourceRoots()],
    plants: [
      {
        id: 'recorded-text-gone-from-its-file',
        plant: editJson('tools/mutation-reasons.json', (record) => {
          record.survivors[0].original = `${record.survivors[0].original} planted`;
        }),
        refusal:
          /the text the mutant replaced is in the file 0 time\(s\), the entry counts/u,
      },
      {
        id: 'recorded-under-an-undeclared-category',
        plant: editJson('tools/mutation-reasons.json', (record) => {
          record.survivors[0].category = 'planted';
        }),
        refusal: /the category planted is not one the file declares/u,
      },
      {
        id: 'recorded-without-a-reason',
        plant: editJson('tools/mutation-reasons.json', (record) => {
          record.survivors[0].reason = 'Equivalent.';
        }),
        refusal: /the reason is not written/u,
      },
      {
        id: 'recorded-twice',
        plant: editJson('tools/mutation-reasons.json', (record) => {
          record.survivors.push({ ...record.survivors[0] });
        }),
        refusal: /the same mutant is listed twice/u,
      },
      {
        id: 'recorded-in-a-file-that-is-gone',
        plant: editJson('tools/mutation-reasons.json', (record) => {
          record.survivors[0].file = 'packages/runtime/src/planted.ts';
        }),
        refusal: /the file does not exist/u,
      },
      // The reading's half. Each refusal ends at the count of one finding where the plant makes
      // one, so the rest of the planted reading is seen to pass.
      {
        id: 'reading-kills-a-recorded-mutant',
        ...plantReading(({ mutantsOf }) => {
          mutantsOf(0)[0].status = 'Killed';
        }),
        refusal:
          /survivors\[0\] [^\n]*the entry counts \d+ and the reports score \d+ as survived \(scored otherwise: Killed 1\)[^]*failed: 1 finding/u,
      },
      {
        id: 'reading-leaves-a-recorded-file-out',
        ...plantReading(({ record, reports }) => {
          for (const report of reports) {
            delete report.files[record.survivors[0].file];
          }
        }),
        refusal: /survivors\[0\] [^\n]*the file is in no report given/u,
      },
      {
        id: 'reading-holds-a-survivor-nobody-recorded',
        ...plantReading(({ mutantsOf, reports, record }) => {
          const [report] = reports.filter(
            ({ files }) => record.survivors[0].file in files,
          );
          report.files[record.survivors[0].file].mutants.push({
            ...mutantsOf(0)[0],
            replacement: 'planted',
          });
        }),
        refusal:
          /survived and has no reason: [^\n]* => planted[^]*failed: 1 finding/u,
      },
      {
        id: 'reading-cut-a-survivor-short',
        ...plantReading(({ mutantsOf }) => {
          mutantsOf(0)[0].testsCompleted = 0;
        }),
        refusal: /with 0 of 1 planned tests run, which is no verdict/u,
      },
      {
        id: 'reading-holds-a-file-twice',
        ...plantReading(({ record, reports }) => {
          const { file } = record.survivors[0];
          const [holder] = reports.filter(({ files }) => file in files);
          for (const report of reports) report.files[file] = holder.files[file];
        }),
        refusal: /is in two reports, [^\n]*so they are not one reading/u,
      },
    ],
  },
  'verify:locale-profile': {
    script: 'tools/generate-locale-profile.mjs',
    args: ['--check'],
    inputs: [
      'standards/sources.lock.json',
      'standards/data/language-subtag-registry-2026-09-17.txt',
      'standards/data/DerivedBidiClass-17.0.0.txt',
      'packages/runtime/core/src/locale-profile.generated.ts',
      'packages/runtime/core/src/encompassed-languages.generated.ts',
      'packages/toolkit/src/plural-categories.generated.ts',
      'packages/toolkit/src/endonyms.generated.ts',
      'packages/toolkit/src/parent-locales.generated.ts',
      'packages/toolkit/src/language-scripts.generated.ts',
      'packages/runtime/src/parent-locales.generated.ts',
      'packages/runtime/src/likely-scripts.generated.ts',
      'packages/toolkit/src/rtl-scripts.generated.ts',
      'packages/runtime/core/src/locale-aliases.generated.ts',
      'packages/toolkit/src/locale-aliases.generated.ts',
      'standards/data/tzdata-2026e',
      'packages/runtime/src/time-zone-identities.generated.ts',
      'packages/toolkit/src/time-zone-identities.generated.ts',
      'standards/data/ecma-402-13.0-measurement-unit-identifiers.html',
      'packages/toolkit/src/sanctioned-units.generated.ts',
      'packages/toolkit/src/currency-digits.generated.ts',
    ],
    plants: [
      {
        id: 'sanctioned-unit-table-not-the-pinned-one',
        plant: plantText(
          'packages/toolkit/src/sanctioned-units.generated.ts',
          '"second","stone",',
          '"second",',
        ),
        refusal:
          /The checked-in table of the units ECMA-402 sanctions is stale/u,
      },
      {
        id: 'unit-quotient-rule-not-the-transcribed-one',
        plant: plantText(
          'standards/data/ecma-402-13.0-measurement-unit-identifiers.html',
          'occurs exactly once',
          'occurs at least once',
        ),
        refusal:
          /IsWellFormedUnitIdentifier in the pinned ECMA-402 edition is not the algorithm/u,
      },
      {
        id: 'currency-digits-not-the-pinned-ones',
        plant: plantText(
          'packages/toolkit/src/currency-digits.generated.ts',
          '"JPY":0',
          '"JPY":2',
        ),
        refusal: /The checked-in table of currency fraction digits is stale/u,
      },
      {
        id: 'parent-locale-table-of-the-runtime-not-the-pinned-one',
        plant: plantText(
          'packages/runtime/src/parent-locales.generated.ts',
          '"ht":"fr-HT"',
          '"ht":"fr"',
        ),
        refusal: /The checked-in Equator parent-locale table is stale/u,
      },
      {
        id: 'collation-parent-table-not-the-pinned-one',
        plant: plantText(
          'packages/runtime/src/parent-locales.generated.ts',
          '"yue":"zh-Hant",',
          '',
        ),
        refusal: /The checked-in Equator parent-locale table is stale/u,
      },
      {
        id: 'likely-script-table-not-the-pinned-one',
        plant: plantText(
          'packages/runtime/src/likely-scripts.generated.ts',
          'zh-SR zh-TH zh-TW',
          'zh-SR zh-TH',
        ),
        refusal: /The checked-in Equator likely-script table is stale/u,
      },
      {
        id: 'language-script-table-not-the-pinned-one',
        plant: plantText(
          'packages/toolkit/src/language-scripts.generated.ts',
          'zh-TW zh-US',
          'zh-US',
        ),
        refusal: /The checked-in Equator language-script table is stale/u,
      },
      {
        id: 'time-zone-table-of-the-toolkit-not-the-pinned-one',
        plant: plantText(
          'packages/toolkit/src/time-zone-identities.generated.ts',
          'Asia/Calcutta>Asia/Kolkata',
          'Asia/Calcutta>Asia/Dhaka',
        ),
        refusal: /The checked-in Equator time zone identity table is stale/u,
      },
      {
        id: 'time-zone-link-not-the-pinned-one',
        plant: plantText(
          'packages/runtime/src/time-zone-identities.generated.ts',
          'Asia/Calcutta>Asia/Kolkata',
          'Asia/Calcutta>Asia/Dhaka',
        ),
        refusal: /The checked-in Equator time zone identity table is stale/u,
      },
      {
        id: 'zone-a-country-calls-its-own-read-as-a-link',
        plant: plantText(
          'standards/data/tzdata-2026e/zone.tab',
          'Europe/Oslo',
          'Europe/Oslo_',
        ),
        refusal: /The checked-in Equator time zone identity table is stale/u,
      },
      {
        id: 'former-name-resolved-outside-its-country',
        plant: plantText(
          'standards/data/tzdata-2026e/backzone',
          '#PACKRATLIST zone.tab Link Africa/Bamako Africa/Timbuktu',
          '#PACKRATLIST zone.tab Link Africa/Abidjan Africa/Timbuktu',
        ),
        refusal: /The checked-in Equator time zone identity table is stale/u,
      },
      {
        id: 'fixed-offset-zone-not-the-pinned-one',
        plant: plantText(
          'standards/data/tzdata-2026e/etcetera',
          'Etc/GMT+5',
          'Etc/GMT+15',
        ),
        refusal: /The checked-in Equator time zone identity table is stale/u,
      },
      {
        id: 'replacement-name-primary-inside-its-waiting-period',
        plant: plantText(
          'standards/sources.lock.json',
          '"released": "2022-08-10"',
          '"released": "2025-08-10"',
        ),
        refusal: /The checked-in Equator time zone identity table is stale/u,
      },
      {
        // The table an earlier pin would have left: the former name primary, the new one absent.
        id: 'rename-the-lock-does-not-record',
        plant: async (root) => {
          await editJson('standards/sources.lock.json', (lock) => {
            lock.dataSources.ianaTimeZoneDatabase.renames = [];
          })(root);
          await editText(
            root,
            'packages/runtime/src/time-zone-identities.generated.ts',
            (text) =>
              replaceOnce(
                'Europe/Kiev>Europe/Kyiv Europe/Kirov Europe/Kyiv ',
                'Europe/Kiev Europe/Kirov ',
              )(
                replaceOnce(
                  "'tzdata-2026e/equator-time-zone-1'",
                  "'tzdata-2026d/equator-time-zone-1'",
                )(text),
              ),
          );
        },
        refusal: /does not record the rename of Europe\/Kiev to Europe\/Kyiv/u,
      },
      {
        id: 'alias-rule-not-the-pinned-one',
        plant: plantText(
          'packages/toolkit/src/locale-aliases.generated.ts',
          ',tw>ak,',
          ',tw>tw,',
        ),
        refusal: /The checked-in Equator locale alias table is stale/u,
      },
      {
        id: 'plural-table-not-from-the-pinned-source',
        plant: plantText(
          'packages/toolkit/src/plural-categories.generated.ts',
          "export const PLURAL_DATA_PROFILE = 'cldr-48.2/equator-plurals-1' as const;",
          "export const PLURAL_DATA_PROFILE = 'cldr-48.2/equator-plurals-2' as const;",
        ),
        refusal: /The checked-in Equator plural-category table is stale/u,
      },
      {
        id: 'plural-categories-not-the-pinned-ones',
        plant: plantText(
          'packages/toolkit/src/plural-categories.generated.ts',
          '"ar":["zero","one","two","few","many","other"],"ars"',
          '"ar":["one","other"],"ars"',
        ),
        refusal: /The checked-in Equator plural-category table is stale/u,
      },
      {
        id: 'script-distance-read-as-encompassing',
        plant: plantText(
          'packages/runtime/core/src/encompassed-languages.generated.ts',
          '"zh":{"cdo":10',
          '"zh-Hant":{"zh-Hans":50},"zh":{"cdo":10',
        ),
        refusal: /The checked-in Equator encompassed-language table is stale/u,
      },
    ],
  },
  'verify:cost-reference': {
    script: 'tools/generate-cost-reference.mjs',
    args: ['--check'],
    inputs: [
      'dist/runtime',
      'dist/toolkit',
      'docs/reference/cost.md',
      ...[
        'tmp/focused-package-consumer-verification/minimal-runtime-consumer',
        'tmp/package-consumer-verification/package-consumer',
      ].flatMap((root) => [
        `${root}/src/generated/i18n`,
        `${root}/node_modules/@angular/build/package.json`,
      ]),
      'tmp/focused-package-consumer-verification/minimal-runtime-consumer/dist/minimal',
      'tmp/package-consumer-verification/package-consumer/dist/feature-lab',
    ],
    plants: [
      {
        id: 'entry-point-grew',
        plant: editMinimalStats((stats) => {
          const input = Object.values(stats.outputs)
            .flatMap(({ inputs }) => Object.entries(inputs ?? {}))
            .find(([path]) =>
              path.endsWith(
                'node_modules/@neolorn/equator/fesm2022/neolorn-equator-core.mjs',
              ),
            );
          input[1].bytesInOutput += 100;
        }),
        refusal:
          /docs\/reference\/cost\.md is not what the builds measure now/u,
      },
      {
        id: 'published-figure-edited',
        plant: (root) =>
          editText(root, 'docs/reference/cost.md', (text) =>
            text.replace(/\d{1,3}(?:,\d{3})+/u, (figure) =>
              (Number(figure.replaceAll(',', '')) + 1).toLocaleString('en-US'),
            ),
          ),
        refusal:
          /docs\/reference\/cost\.md is not what the builds measure now/u,
      },
      // A store layout the suffix does not match would attribute every input to nothing and print a
      // page of zeros, which a page generated the same way would agree with.
      {
        id: 'entry-point-attributed-to-nothing',
        plant: editMinimalStats((stats) => {
          for (const output of Object.values(stats.outputs)) {
            output.inputs = Object.fromEntries(
              Object.entries(output.inputs ?? {}).map(([path, value]) => [
                path.replace('/@neolorn/equator/', '/@neolorn/elsewhere/'),
                value,
              ]),
            );
          }
        }),
        refusal:
          /Minimal consumer: no input of the build was attributed to @neolorn\/equator\./u,
      },
    ],
  },
  'verify:format-shapes': {
    script: 'tools/generate-format-shapes.mjs',
    args: ['--check'],
    inputs: [
      'dist/toolkit',
      'dist/runtime/types',
      'dist/runtime/fesm2022',
      'tools/format-shapes.json',
      'tools/released-format-stamps.json',
    ],
    plants: [
      {
        id: 'field-removed-under-the-same-stamp',
        plant: plantText(
          'dist/toolkit/output-host.d.ts',
          '    readonly ownerId: string;\n}\nexport interface ApplyOutputPlanRequest',
          '}\nexport interface ApplyOutputPlanRequest',
        ),
        refusal:
          /equator-work-owner\/1: \S+#WorkOwnerMarker\.ownerId: removed \(incompatible\)/u,
      },
      {
        id: 'field-added-to-a-closed-format',
        plant: plantText(
          'dist/toolkit/project-host.d.ts',
          '    readonly stateDigest: string;\n',
          '    readonly stateDigest: string;\n    readonly planted?: string;\n',
        ),
        refusal:
          /equator-compiler-cache\/1: \S+#CompilerCacheEnvelope\.planted: added as optional \(incompatible\)/u,
      },
      // Compatible, so it is not a reason to move the stamp, and still a difference the record does
      // not hold: the check is red until the record is written again.
      {
        id: 'optional-field-added-to-an-open-format',
        plant: plantText(
          'dist/toolkit/output-host.d.ts',
          '    readonly operations: readonly TransactionOperation[];\n',
          '    readonly operations: readonly TransactionOperation[];\n    readonly planted?: string;\n',
        ),
        refusal:
          /equator-output-transaction\/1: \S+#TransactionJournal\.planted: added as optional \(compatible\)/u,
      },
      {
        id: 'runtime-reader-field-retyped',
        plant: plantMatching(
          'dist/runtime/types/neolorn-equator-core.d.ts',
          /(\/\*\* The stable name for this route, which is what every address is built from\. \*\/\s+readonly id: )string;/u,
          '$1number;',
        ),
        refusal:
          /equator-route-projection\/1: \S+#GeneratedRouteProjection\.\S*\.id: type changed from "string" to "number" \(incompatible\)/u,
      },
      {
        id: 'released-stamp-replaced',
        plant: editJson('tools/released-format-stamps.json', (file) => {
          file.released.push('equator-work-owner/1');
        }),
        args: () => ['--replace', 'equator-work-owner/1'],
        refusal: /equator-work-owner.1 has been released/u,
      },
      // The record holds a code this build does not write: the build withdrew it.
      {
        id: 'value-withdrawn-from-an-open-set',
        plant: editJson('tools/format-shapes.json', (record) => {
          record.formats['equator-toolkit-observability-event/1'].declarations[
            'dist/toolkit/observability.d.ts#ToolkitObservabilityEvent'
          ].object.code.type.open.push('EQ-E1000');
        }),
        refusal:
          /equator-toolkit-observability-event\/1: \S+#ToolkitObservabilityEvent\.code: value "EQ-E1000" removed from an open set \(incompatible\)/u,
      },
      // Compatible, and still a difference the record does not hold.
      {
        id: 'value-added-to-an-open-set',
        plant: editJson('tools/format-shapes.json', (record) => {
          record.formats['equator-toolkit-observability-event/1'].declarations[
            'dist/toolkit/observability.d.ts#ToolkitObservabilityEvent'
          ].object.code.type.open.pop();
        }),
        refusal:
          /equator-toolkit-observability-event\/1: \S+#ToolkitObservabilityEvent\.code: value "EQ-E1003" added to an open set \(compatible\)/u,
      },
      {
        id: 'published-schema-admits-other-data',
        plant: editJson(
          'dist/toolkit/schemas/cli-result.v1.schema.json',
          (schema) => {
            schema.properties.planted = { type: 'string' };
          },
        ),
        refusal:
          /equator-cli-result\/1: dist\/toolkit\/schemas\/cli-result\.v1\.schema\.json: the published schema admits different data \(incompatible\)/u,
      },
      {
        id: 'stamp-nothing-records',
        plant: plantText(
          'dist/toolkit/output-host.js',
          "export const WORK_OWNER_PROFILE = 'equator-work-owner/1';",
          "export const WORK_OWNER_PROFILE = 'equator-work-owner/1';\nexport const PLANTED_PROFILE = 'equator-planted-format/1';",
        ),
        refusal:
          /equator-planted-format\/1 \(in dist\/toolkit\/output-host\.js\): not a recorded format, a same-build stamp, or a digest label/u,
      },
    ],
  },
  'verify:export-surface': {
    script: 'tools/verify-export-surface.mjs',
    inputs: [
      'dist/runtime/types',
      'dist/toolkit',
      'fixtures/package-consumer-template/src',
      'fixtures/minimal-package-consumer-template/src',
      'fixtures/semantic-analysis',
      'tools',
      'packages/toolkit/test',
      'packages/runtime/test',
      'docs',
      'README.md',
      'packages/runtime/README.md',
      'packages/toolkit/README.md',
    ],
    plants: [
      {
        id: 'runtime-export-nothing-reaches',
        plant: (root) =>
          editText(
            root,
            'dist/runtime/types/neolorn-equator-core.d.ts',
            (text) =>
              `${text}\nexport declare const ${plantedExport}: Readonly<object>;\n`,
          ),
        refusal: new RegExp(`core / ${plantedExport}$`, 'mu'),
      },
      {
        id: 'toolkit-export-nothing-reaches',
        plant: (root) =>
          editText(
            root,
            'dist/toolkit/index.d.ts',
            (text) => `${text}\nexport declare const ${plantedExport} = 0;\n`,
          ),
        refusal: new RegExp(`toolkit / ${plantedExport}$`, 'mu'),
      },
      {
        id: 'documented-example-imports-wiring',
        plant: (root) =>
          editText(
            root,
            'docs/how-to/translate-catalogs.md',
            (text) =>
              `${text}\n\`\`\`ts\nimport { ɵopenPageOutcomeChannel } from '@neolorn/equator/core';\n\`\`\`\n`,
          ),
        refusal:
          /^docs\/how-to\/translate-catalogs\.md: ɵopenPageOutcomeChannel from @neolorn\/equator\/core$/mu,
      },
      {
        id: 'fixture-reaches-wiring-through-a-namespace',
        plant: (root) =>
          editText(
            root,
            'fixtures/package-consumer-template/src/app/addresses.ts',
            (text) =>
              `${text}\nimport * as equatorCore from '@neolorn/equator/core';\nexport const planted = equatorCore.ɵopenPageOutcomeChannel;\n`,
          ),
        refusal:
          /^fixtures\/package-consumer-template\/src\/app\/addresses\.ts: ɵopenPageOutcomeChannel from @neolorn\/equator\/core$/mu,
      },
    ],
  },
  // Every run launches the three browser engines and the other Node rows, so the budget is the
  // stage's rather than the default one sized for a script that reads files.
  'verify:platform': {
    script: 'tools/verify-platform-capabilities.mjs',
    inputs: ['dist/toolkit', 'docs/reference/compatibility.md'],
    timeout: 600_000,
    plants: [
      {
        id: 'toolkit-keeps-a-deprecated-language',
        plant: plantText(
          'dist/toolkit/locales.js',
          '    const canonical = canonicalizeLanguageTag(locale);',
          "    const canonical = canonicalizeLanguageTag(locale) === 'he' ? 'iw' : canonicalizeLanguageTag(locale);",
        ),
        refusal:
          /The toolkit canonicalizes iw to iw, and the pinned CLDR alias data to he/u,
      },
      {
        id: 'canonicalizer-stops-before-the-alias-settles',
        plant: plantText(
          'dist/toolkit/language-tag.js',
          'const MAXIMUM_ALIAS_STEPS = 16;',
          'const MAXIMUM_ALIAS_STEPS = 0;',
        ),
        refusal: new RegExp(
          `Node v${developmentNode.replaceAll('.', '\\.')} canonicalizes iw to refused, and the pinned CLDR alias data to he`,
          'u',
        ),
      },
      {
        id: 'host-gap-left-undocumented',
        plant: plantText(
          'docs/reference/compatibility.md',
          '\n| Node `22.22.3` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |',
          '',
        ),
        refusal:
          /Node 22\.22\.3 lacks Intl\.DurationFormat, and docs\/reference\/compatibility\.md does not say so/u,
      },
      {
        id: 'host-gap-documented-and-absent',
        plant: plantText(
          'docs/reference/compatibility.md',
          '| Node `22.22.3` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |',
          '| Node `22.22.3` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |\n| Node `24.15.0` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |',
        ),
        refusal:
          /docs\/reference\/compatibility\.md says Node 24\.15\.0 lacks Intl\.DurationFormat, and the probe did not find that on any host it ran/u,
      },
    ],
  },
  'verify:message-format-conformance': {
    script: 'tools/verify-message-format-conformance.mjs',
    inputs: [
      `${suiteRoot}/test/tests`,
      'tools/message-format-conformance-baseline.json',
    ],
    plants: [
      {
        id: 'divergence-class-renamed',
        plant: plantText(
          'tools/message-format-conformance-baseline.json',
          '"unregistered-function-refused": {',
          '"unregistered-function-refused-renamed": {',
        ),
        refusal:
          /The baseline class "unregistered-function-refused-renamed" has no cases left/u,
      },
      {
        id: 'suite-file-dropped',
        plant: (root) =>
          rm(resolve(root, `${suiteRoot}/test/tests/syntax.json`)),
        refusal: /Expected 16 suite files and 461 cases, found 15/u,
      },
    ],
  },
  'verify:cost-budget': {
    script: 'tools/verify-cost-budget.mjs',
    nodeArgs: ['--expose-gc'],
    inputs: ['dist/runtime'],
    // Several budgets are growth ratios of wall-clock medians, so a planted run that passes has to
    // leave the ratio it read behind.
    measured: true,
    plants: [
      {
        // A heap reading needs the collector exposed. Without it both heap budgets have nothing
        // to read, and a run that reads nothing must not stand as one within budget.
        id: 'heap-growth-unmeasured',
        nodeArgs: [],
        measures: [
          'the shared formatter store is bounded by its ceiling',
          'repeated locale switching does not accumulate heap',
        ],
        refusal:
          /FAIL +the shared formatter store is bounded by its ceiling\n\s+not measured: node ran without --expose-gc[\s\S]*FAIL +repeated locale switching does not accumulate heap\n\s+not measured: node ran without --expose-gc/u,
      },
      {
        // The memo is what keeps a request from paying for the whole catalog. Without it every
        // context admits the catalog again, which costs the catalog's size on every request.
        id: 'catalog-admitted-on-every-request',
        plant: plantMatching(
          runtimeBundle,
          /admittedCatalogs\.set\(candidate, \{\s*key,\s*catalog,?\s*\}\);/u,
          'void key;',
        ),
        measures: [
          'request-scoped context construction is flat in catalog size',
        ],
        refusal:
          /FAIL +request-scoped context construction is flat in catalog size/u,
      },
      {
        // The quadratic strip the single backward scan replaced.
        id: 'trailing-zeros-rescanned',
        plant: plantMatching(
          runtimeBundle,
          /(function withoutTrailingZeros\(fraction\) \{)[^}]*\}/u,
          (_, head) => `${head} return fraction.replace(/0+$/u, ''); }`,
        ),
        measures: ['decimal() is sub-quadratic in input length'],
        refusal: /FAIL +decimal\(\) is sub-quadratic in input length/u,
      },
      {
        // Without eviction the shared store keeps every locale and option pair it is asked for.
        id: 'formatter-store-unbounded',
        plant: plantText(
          'dist/runtime/fesm2022/neolorn-equator.mjs',
          'while (this.values.size > this.maximumEntries)',
          'while (false)',
        ),
        measures: ['the shared formatter store is bounded by its ceiling'],
        refusal: /FAIL +the shared formatter store is bounded by its ceiling/u,
      },
      {
        // Every configured scope loaded at initialization, and so again at every switch.
        id: 'every-scope-loaded-up-front',
        plant: plantMatching(
          runtimeBundle,
          /this\.bootstrapScopes = this\.normalizeScopes\(options\.bootstrapScopes, (["'])bootstrapScopes\1\);/u,
          "this.bootstrapScopes = this.normalizeScopes(options.setup.configuration.scopes.map(({ providerId, scopeId }) => ({ providerId, scopeId })), 'bootstrapScopes');",
        ),
        measures: [
          'a switch loads the scopes in use',
          'initial loading takes the bootstrap scope only',
        ],
        refusal:
          /FAIL +a switch loads the scopes in use[\s\S]*FAIL +initial loading takes the bootstrap scope only/u,
      },
      {
        // A progressive switch holding its commit for the required participants.
        id: 'progressive-switch-waits',
        plant: plantMatching(
          runtimeBundle,
          /const requiredParticipants = mode === (["'])coordinated\1/u,
          'const requiredParticipants = true',
        ),
        measures: [
          'a coordinated switch waits for every required participant, and a progressive one for none',
        ],
        refusal:
          /FAIL +a coordinated switch waits for every required participant, and a progressive one for none/u,
      },
      {
        id: 'prepared-participant-kept',
        // The cohort that met an unavailable participant keeps every one that prepared for it.
        plant: plantMatching(
          runtimeBundle,
          /this\.discard\(item\.adapter, item\.context, item\.report\);(\s*this\.cleanup\(item\);\s*\}\s*throw refusal\.reason;)/u,
          'void item.report;$1',
        ),
        measures: [
          'a switch prepares each participant once and discards every one a refused switch prepared',
        ],
        refusal:
          /FAIL +a switch prepares each participant once and discards every one a refused switch prepared/u,
      },
      {
        // A failed load left in flight answers every later attempt with the same failure.
        id: 'failed-load-kept-in-flight',
        plant: plantText(
          'dist/runtime/fesm2022/neolorn-equator.mjs',
          '.finally(() => this.inFlight.delete(key));',
          '.finally(() => void key);',
        ),
        measures: ['each repeated failure costs one load and keeps nothing'],
        refusal:
          /FAIL +each repeated failure costs one load and keeps nothing/u,
      },
      {
        id: 'catalog-cache-unbounded',
        plant: plantText(
          'dist/runtime/fesm2022/neolorn-equator.mjs',
          'while (this.cache.size > this.maximumEntries) {',
          'while (false) {',
        ),
        measures: ['the catalog cache reloads only past maximumCachedCatalogs'],
        refusal:
          /FAIL +the catalog cache reloads only past maximumCachedCatalogs/u,
      },
      {
        // The length checked after the pattern has read the whole value, or not at all.
        id: 'oversized-number-read',
        plant: plantMatching(
          runtimeBundle,
          /(function normalizeDecimal\(value\) \{[^}]*?)value\.length > RUNTIME_LIMITS\.canonicalNumberCodeUnits \|\|\s*/u,
          '$1',
        ),
        measures: [
          'a number at the bound is accepted, and one beyond it is refused at a cost that does not grow',
        ],
        refusal:
          /FAIL +a number at the bound is accepted, and one beyond it is refused at a cost that does not grow/u,
      },
      {
        // Selection that reads every variant again for each variant it considers. The reading is
        // a built-in's scan and not a loop written here, because how soon the engine optimizes a
        // planted loop decided whether its cost showed: the same plant measured 39x on one run and
        // 6.3x on another.
        id: 'variants-rescanned',
        plant: plantMatching(
          runtimeBundle,
          /(for \(const variant of body\[(["'])variants\2\]\) \{)(\s*tick\(environment\);)/u,
          '$1 for (let scan = 0; scan < 4; scan += 1) void body[$2variants$2].includes(undefined);$3',
        ),
        measures: ['evaluating a message is linear in its variants'],
        refusal: /FAIL +evaluating a message is linear in its variants/u,
      },
    ],
  },
});

/** The plant identifiers by stage, which is what the normative map checks names against. */
export const stagePlants = Object.freeze(
  Object.fromEntries(
    Object.entries(stageSelfTests).map(([stage, { plants }]) => [
      stage,
      Object.freeze(plants.map(({ id }) => id)),
    ]),
  ),
);
