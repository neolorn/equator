/**
 * `verify:matrix:self-test`: the matrix, shown refusing each thing it exists to refuse.
 *
 * A matrix that reads no claims looks exactly like one that reads them and finds none, and a check
 * nobody has seen fail is indistinguishable from one that cannot. So this runs a planted suite
 * through the real claim and the real reporter, then hands the real evaluation each defect in
 * turn, and requires it to go red naming the cell or the claim the defect is about:
 *
 * - a claim from a test that failed, from a test marked to fail, and from a claim made before any
 *   assertion, none of which may reach the evidence;
 * - a claim taken away, which must leave its cell red;
 * - a reason placed over an exercised cell, and a reason over no cell at all;
 * - a claim for a capability its test never names, an entry point its test names only through a
 *   type, and a route class claimed through a field the application declared for another class;
 * - a composable export the packages did not publish, an optional member of an option interface
 *   the registry reads, and a consumer profile the gate did not declare, each of which must open a
 *   row or a column whose cells are red;
 * - a render mode Angular adds that has no column, and a placement whose member is gone;
 * - a document a server answered, marked or not, which must not fill the client render column;
 * - a stage whose evidence is missing, and evidence no writer opened;
 * - a claim that no check's source makes;
 * - a run handed no claims path, which must write nothing.
 *
 * Before any defect, the planted suite's one good claim must fill its cell, so every red below is a
 * change from a green this run saw.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAIMS_FILE_VARIABLE } from './capability-claims.ts';
import { readEvidence, type EvidenceClaim } from './capability-evidence.ts';
import {
  claimSitesIn,
  columnsFrom,
  evaluateMatrix,
  readDeclared,
  readPublished,
  rowsFrom,
  type MatrixInput,
  type MatrixResult,
} from './capability-matrix.ts';
import {
  fixtureContentLanguages,
  fixtureLocales,
  localeKindCoverage,
  pinnedLocaleData,
} from './locale-kinds.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Nested under `tmp`, so it is no artefact another stage can see, and inside the workspace, so the
// planted suite resolves `vitest` the way the real suites do.
const planted = resolve(workspaceRoot, 'tmp/matrix-self-test');
const evidencePath = resolve(planted, 'evidence.jsonl');

const SUITE = `import { expect, it } from 'vitest';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

const formatMoney = (value) => value;
const formatNumber = (value) => value;
const formatList = (value) => value;
const formatPercent = (value) => value;
const formatDuration = (value) => value;
let attempts = 0;

it('passes and claims', () => {
  expect(formatMoney(1)).toBe(1);
  claimCapability('format:formatMoney');
});

it('fails after claiming', () => {
  expect(formatNumber(1)).toBe(1);
  claimCapability('format:formatNumber');
  throw new Error('planted failure');
});

it('claims before asserting', () => {
  claimCapability('format:formatList');
  expect(formatList(1)).toBe(1);
});

it.fails('passes its body and is marked to fail', () => {
  expect(formatPercent(1)).toBe(1);
  claimCapability('format:formatPercent');
});

it('fails once and passes on retry', { retry: 1 }, () => {
  attempts += 1;
  expect(formatDuration(1)).toBe(1);
  claimCapability('format:formatDuration');
  if (attempts === 1) throw new Error('planted first attempt');
});
`;

// The column a planted claim fills: the suites planted below run on this process's Node, and the
// matrix names a Node column by its line.
const ownNode = `node:${process.versions.node.split('.')[0]}`;

const CONFIG = `import { capabilityClaimsReporters } from '../../tools/capability-evidence.ts';

export default { test: { include: ['planted.test.mjs'], reporters: capabilityClaimsReporters() } };
`;

const MISLABELLED = `import { expect, it } from 'vitest';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

it('asserts one thing and claims another', () => {
  expect(1).toBe(1);
  claimCapability('pipe:localizedMoney');
});
`;

const NAMED_BY_TYPE_ONLY = `import { expect, it } from 'vitest';
import { type Localization } from '@neolorn/equator';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

it('names the entry point only through a type', () => {
  const held: Localization | undefined = undefined;
  expect(held).toBeUndefined();
  claimCapability('entry:@neolorn/equator');
});
`;

// The same body twice, once declaring its field for the class it claims and once for another, so
// the refusal below is of the undeclared field and not of something else in the body.
const routeClassClaim = (key: string) => `import { expect, it } from 'vitest';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

it('classifies a route by a field of its own', () => {
  const routes = "[{ path: 'admin', data: { area: 'staff' } }]";
  const options = "{ ${key}: { field: 'area', values: { staff: 'private' } } }";
  expect(routes + options).toContain('area');
  claimCapability('declaration:route-indexing-class');
});
`;

const results: string[] = [];
const expectRed = (name: string, check: () => void) => {
  check();
  results.push(name);
  process.stdout.write(`red as required: ${name}\n`);
};

rmSync(planted, { recursive: true, force: true });
mkdirSync(planted, { recursive: true });
try {
  writeFileSync(resolve(planted, 'planted.test.mjs'), SUITE);
  writeFileSync(resolve(planted, 'vitest.config.mjs'), CONFIG);

  const runPlanted = (claimsPath: string | undefined) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env[CLAIMS_FILE_VARIABLE];
    if (claimsPath !== undefined) env[CLAIMS_FILE_VARIABLE] = claimsPath;
    return spawnSync(
      process.execPath,
      [
        resolve(workspaceRoot, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--root',
        planted,
        '--config',
        'vitest.config.mjs',
      ],
      { cwd: planted, encoding: 'utf8', timeout: 120_000, env },
    );
  };

  // First, while the directory holds only the suite and its configuration, so anything a run with
  // no claims path leaves behind is visible as a new file. A run under an injected defect is one
  // of these, and what it claimed must not reach any evidence.
  const unclaimed = runPlanted(undefined);
  assert.ok(
    /Tests\s+3 failed \| 2 passed/u.test(
      `${unclaimed.stdout}\n${unclaimed.stderr}`,
    ),
    'The planted suite did not run as planted with no claims path.',
  );
  expectRed('a run handed no claims path', () => {
    // Vitest keeps its own results cache under node_modules/.vite in the root it runs, which is
    // not a claim.
    assert.deepEqual(
      readdirSync(planted)
        .filter((name) => name !== 'node_modules')
        .sort(),
      ['planted.test.mjs', 'vitest.config.mjs'],
      'A run handed no claims path wrote a file.',
    );
  });

  const run = runPlanted(evidencePath);
  const output = `${run.stdout}\n${run.stderr}`;
  // The planted suite fails on purpose; what must not happen is that it failed to run at all.
  assert.ok(
    /Tests\s+3 failed \| 2 passed/u.test(output),
    `The planted suite did not run as planted (exit ${run.status}):\n${output.slice(-3000)}`,
  );

  const evidence = { stage: 'planted', ...readEvidence(evidencePath) };
  assert.deepEqual(
    evidence.writers,
    ['vitest'],
    'The reporter did not open the evidence.',
  );
  const claimed = evidence.claims.map(({ capability }) => capability).sort();
  assert.deepEqual(
    claimed,
    ['format:formatDuration', 'format:formatMoney'],
    'The evidence kept a claim it must drop, or dropped one it must keep.',
  );

  const published = readPublished();
  const declared = readDeclared();
  const { rows } = rowsFrom(published);
  const columns = columnsFrom(declared);
  const sites = claimSitesIn(
    'tmp/matrix-self-test/planted.test.mjs',
    readFileSync(resolve(planted, 'planted.test.mjs'), 'utf8'),
  );
  assert.deepEqual(
    sites.problems,
    [],
    'The planted suite claims in a way the scan cannot read.',
  );
  const evaluate = (overrides: Partial<MatrixInput>) =>
    evaluateMatrix({
      rows,
      columns,
      reasons: [],
      evidence: [evidence],
      sites: sites.sites,
      ...overrides,
    });
  const isRed = (result: MatrixResult, row: string, column: string) =>
    result.red.some((cell) => cell.row === row && cell.column === column);
  const finding = (result: MatrixResult, kind: string, text: string) =>
    result.findings.some(
      (each) => each.kind === kind && each.message.includes(text),
    );

  // The green every red below is measured against.
  const baseline = evaluate({});
  assert.ok(
    baseline.exercised.has(`format:formatMoney @ ${ownNode}`),
    'The planted good claim did not fill its cell, so no red below would mean anything.',
  );
  assert.deepEqual(
    baseline.findings.filter(({ kind }) => kind !== 'unreasoned'),
    [],
    'The planted baseline has findings of its own.',
  );

  expectRed(
    'a claim from a failed test, a test marked to fail, and a claim before any assertion',
    () => {
      for (const row of [
        'format:formatNumber',
        'format:formatPercent',
        'format:formatList',
      ]) {
        assert.ok(
          isRed(baseline, row, ownNode),
          `${row} @ ${ownNode} was filled by a claim that must not count.`,
        );
      }
    },
  );

  expectRed('a claim taken away', () => {
    const result = evaluate({
      evidence: [
        {
          ...evidence,
          claims: evidence.claims.filter(
            ({ capability }) => capability !== 'format:formatMoney',
          ),
        },
      ],
    });
    assert.ok(
      isRed(result, 'format:formatMoney', ownNode),
      'Taking the claim away left its cell filled.',
    );
  });

  expectRed('a reason over an exercised cell', () => {
    const result = evaluate({
      reasons: [
        {
          id: 'planted',
          rows: ['format:formatMoney'],
          columns: [ownNode],
          reason: 'planted',
        },
      ],
    });
    assert.ok(
      finding(result, 'stale-reason', `format:formatMoney @ ${ownNode}`),
      'A reason over an exercised cell was accepted.',
    );
  });

  expectRed('a reason that covers no cell', () => {
    const result = evaluate({
      reasons: [
        {
          id: 'planted',
          rows: ['format:nothing'],
          columns: [ownNode],
          reason: 'planted',
        },
      ],
    });
    assert.ok(
      finding(result, 'idle-reason', 'planted'),
      'A reason over nothing was accepted.',
    );
  });

  expectRed('a claim for a capability its test never names', () => {
    const mislabelled = claimSitesIn(
      'tmp/matrix-self-test/mislabelled.test.mjs',
      MISLABELLED,
    );
    const result = evaluate({ sites: [...sites.sites, ...mislabelled.sites] });
    assert.ok(
      finding(result, 'mislabel', 'pipe:localizedMoney'),
      'A claim its test never names was accepted.',
    );
  });

  expectRed('an entry point claimed through a name that is only a type', () => {
    const typed = claimSitesIn(
      'tmp/matrix-self-test/named-by-type.test.ts',
      NAMED_BY_TYPE_ONLY,
    );
    const result = evaluate({ sites: [...sites.sites, ...typed.sites] });
    assert.ok(
      finding(result, 'mislabel', 'entry:@neolorn/equator'),
      'An entry point claimed through a type-only import was accepted.',
    );
  });

  expectRed(
    'a route class claimed through a field the application declared for another class',
    () => {
      const claimed = (key: string) =>
        evaluate({
          sites: [
            ...sites.sites,
            ...claimSitesIn(
              'tmp/matrix-self-test/declared-field.test.mjs',
              routeClassClaim(key),
            ).sites,
          ],
        });
      assert.ok(
        !finding(
          claimed('indexing'),
          'mislabel',
          'declaration:route-indexing-class',
        ),
        'A claim through the field the application declared for that class was refused.',
      );
      assert.ok(
        finding(
          claimed('caching'),
          'mislabel',
          'declaration:route-indexing-class',
        ),
        'A claim through a field the application declared for another class was accepted.',
      );
    },
  );

  expectRed('a claim that no check source makes', () => {
    const result = evaluate({
      evidence: [
        {
          ...evidence,
          claims: [
            ...evidence.claims,
            // The evidence was just held to two claims, so the first is there.
            {
              ...(evidence.claims[0] as EvidenceClaim),
              capability: 'pipe:localizedMoney',
            },
          ],
        },
      ],
    });
    assert.ok(
      finding(result, 'unsited-claim', 'pipe:localizedMoney'),
      'A claim no check source makes was accepted.',
    );
  });

  // One export and one consumer row that exist nowhere but here. A derivation that consulted a list
  // of its own, or read the build again instead of what it was handed, gives neither, and the cell
  // the new capability or context opens would never be red.
  expectRed('a composable export added to what is published', () => {
    const exported = 'withPlantedCapability';
    const runtime = published.runtime.map((entry) =>
      entry.entryPoint === 'neolorn-equator'
        ? {
            ...entry,
            text: `${entry.text}\ndeclare function ${exported}(): LocalizationFeature;\nexport { ${exported} };\n`,
          }
        : entry,
    );
    const row = `feature:${exported}`;
    assert.ok(
      !rows.some(({ id }) => id === row),
      `${row} is a row before it was planted.`,
    );
    const grown = rowsFrom({ ...published, runtime }).rows;
    assert.ok(
      grown.some(({ id }) => id === row),
      `A composable export added to what is published has no row ${row}.`,
    );
    assert.ok(
      isRed(evaluate({ rows: grown }), row, ownNode),
      `The row ${row} was derived and its cell was not red.`,
    );
  });

  expectRed('a consumer profile added to what the gate declares', () => {
    const profile = 'planted-consumer';
    const column = `angular:${profile}`;
    assert.ok(
      !columns.some(({ id }) => id === column),
      `${column} is a column before it was planted.`,
    );
    const grown = columnsFrom({
      ...declared,
      profiles: new Map([
        ...declared.profiles,
        [profile, { label: 'Planted consumer row' }],
      ]),
    });
    assert.ok(
      grown.some(({ id }) => id === column),
      `A consumer profile added to what the gate declares has no column ${column}.`,
    );
    assert.ok(
      isRed(evaluate({ columns: grown }), 'format:formatMoney', column),
      `The column ${column} was derived and format:formatMoney @ ${column} was not red.`,
    );
  });

  // An option an application may declare, added to an interface the registry reads. A registry
  // that listed its members would give it no row.
  expectRed('an optional member added to a declared option interface', () => {
    const member = 'plantedOption';
    const row = `declaration:RouteLocalizationOptions.${member}`;
    let planted = 0;
    const runtime = published.runtime.map((entry) => {
      const head = /\binterface RouteLocalizationOptions\b[^{]*\{/u.exec(
        entry.text,
      );
      if (head === null) return entry;
      planted += 1;
      const at = head.index + head[0].length;
      return {
        ...entry,
        text: `${entry.text.slice(0, at)}\n    readonly ${member}?: string;${entry.text.slice(at)}`,
      };
    });
    assert.equal(planted, 1, 'RouteLocalizationOptions was not found once.');
    assert.ok(
      !rows.some(({ id }) => id === row),
      `${row} is a row before it was planted.`,
    );
    const grown = rowsFrom({ ...published, runtime }).rows;
    assert.ok(
      grown.some(({ id }) => id === row),
      `An optional member added to RouteLocalizationOptions has no row ${row}.`,
    );
    assert.ok(
      isRed(evaluate({ rows: grown }), row, ownNode),
      `The row ${row} was derived and its cell was not red.`,
    );
  });

  // The client column is filled by a render on the browser platform and by nothing a server
  // answered, marked or not: an unmarked answer is one the server wrote without rendering.
  expectRed('a client render read from a document a server answered', () => {
    const observing = (observed: Partial<EvidenceClaim>) =>
      evaluate({
        evidence: [
          {
            ...evidence,
            claims: evidence.claims.map((claim) => ({ ...claim, ...observed })),
          },
        ],
      });
    assert.ok(
      isRed(
        observing({ document: ['ssr'] }),
        'format:formatMoney',
        'render:client',
      ),
      'A claim observing a server-marked document filled render:client.',
    );
    assert.ok(
      isRed(observing({ document: [] }), 'format:formatMoney', 'render:client'),
      'A claim observing a document a server answered without rendering filled render:client.',
    );
    assert.ok(
      isRed(
        observing({ platform: 'browser', document: ['ssr'] }),
        'format:formatMoney',
        'render:client',
      ),
      'A claim from a hydrated page, on the browser platform over a server-rendered document, filled render:client.',
    );
    assert.ok(
      !isRed(
        observing({ platform: 'browser' }),
        'format:formatMoney',
        'render:client',
      ),
      'A claim rendered on the browser platform left render:client red.',
    );
  });

  expectRed('a render mode Angular adds', () => {
    assert.throws(
      () =>
        columnsFrom({
          ...declared,
          renderModes: [...declared.renderModes, 'Planted'],
        }),
      /RenderMode has a member Planted/u,
    );
  });

  expectRed('a placement whose member is gone', () => {
    const runtime = published.runtime.map((entry) => ({
      ...entry,
      text: entry.text.replace(
        /(\binterface GeneratedRouteProjectionEntry\b[^{]*\{[\s\S]*?)readonly sourcePath\?:/u,
        '$1readonly plantedPath?:',
      ),
    }));
    const { resolveFailures } = rowsFrom({ ...published, runtime });
    assert.ok(
      resolveFailures.includes(
        'placement:GeneratedRouteProjectionEntry.sourcePath',
      ),
      `A placement for a member no interface declares was accepted: ${resolveFailures.join(', ') || 'no failures'}.`,
    );
  });

  expectRed('a stage whose evidence is missing', () => {
    const result = evaluate({
      evidence: [
        evidence,
        {
          stage: 'planted-missing',
          ...readEvidence(resolve(planted, 'absent.jsonl')),
        },
      ],
    });
    assert.ok(
      finding(
        result,
        'missing-evidence',
        'planted-missing records claims and left no evidence',
      ),
      'A stage with no evidence was accepted.',
    );
  });

  expectRed('a stage whose evidence no writer opened', () => {
    const result = evaluate({
      evidence: [
        evidence,
        { ...evidence, stage: 'planted-unopened', writers: [] },
      ],
    });
    assert.ok(
      finding(
        result,
        'missing-evidence',
        'planted-unopened left evidence with no writer',
      ),
      'Evidence no writer opened was accepted.',
    );
  });
  // The locale kinds, read from the real fixtures and then with one kind's only cover taken away.
  // Each removal is the smallest edit that leaves the kind uncovered, so a classification that
  // counted a locale for the wrong reason would stay green here.
  const localeData = pinnedLocaleData(workspaceRoot);
  const locales = fixtureLocales(workspaceRoot);
  const contentLanguages = fixtureContentLanguages(workspaceRoot);
  const uncovered = (coverage: ReturnType<typeof localeKindCoverage>) =>
    coverage
      .filter(({ covering }) => covering.length === 0)
      .map(({ id }) => id);
  assert.deepEqual(
    uncovered(
      localeKindCoverage({ locales, contentLanguages, data: localeData }),
    ),
    [],
    'The fixtures as they stand leave a locale kind uncovered.',
  );
  expectRed(
    'a script written without spaces that no fixture configures',
    () => {
      assert.deepEqual(
        uncovered(
          localeKindCoverage({
            locales: locales.filter(({ locale }) => locale !== 'th'),
            contentLanguages,
            data: localeData,
          }),
        ),
        ['without-spaces'],
      );
    },
  );
  expectRed('non-Latin digits no locale declares', () => {
    assert.deepEqual(
      uncovered(
        localeKindCoverage({
          locales: locales.map(({ numberingSystem, ...entry }) => entry),
          contentLanguages,
          data: localeData,
        }),
      ),
      ['non-latin-digits'],
    );
  });
  expectRed('content of a fixed language that no fixture presents', () => {
    assert.deepEqual(
      uncovered(
        localeKindCoverage({
          locales,
          contentLanguages: new Set(
            [...contentLanguages].filter((tag) => tag !== 'zxx'),
          ),
          data: localeData,
        }),
      ),
      ['unknown-or-fixed-content'],
    );
  });
} finally {
  rmSync(planted, { recursive: true, force: true });
}

process.stdout.write(
  `verify:matrix:self-test: all ${results.length} planted defects turned the matrix red.\n`,
);
