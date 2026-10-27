/**
 * `verify:normative-map:self-test`: the normative map, shown refusing each thing it exists to
 * refuse.
 *
 * A reader that finds no statements looks exactly like a map with nothing missing, so this first
 * requires the real reader to find every statement a planted document makes, including the one
 * inside a list and the one after a code span holding a full stop and a space, and none of its descriptive
 * sentences. Then it hands the real evaluation a map that fits the planted document, which must be
 * green, and each defect in turn, which must be red naming it:
 *
 * - a statement with no entry;
 * - a statement edited under its entry, which leaves the entry naming words the document no longer
 *   says;
 * - a check nobody proves, including a runtime injection recorded as a known gap;
 * - an entry with both checks and a reason, one with neither, and a statement mapped twice.
 */
import assert from 'node:assert/strict';

import { evaluateMap, type MapEntry, provenChecks } from './normative-map.ts';
import { statementsOf } from './normative-statements.ts';

// No two-digit prefix, so the citation checks do not read the plant as a specification that is
// missing from `specs/`.
const SPEC = 'planted.spec.md';
const DOCUMENT = `# Planted

A description, which binds nothing.

## 1. Section

A release MUST refuse the planted input. A release reads the input. It MUST NOT echo \`a. B\` back.

A release MUST cover at least:

- the first case;
- the second case, which MAY be skipped.

Another description.
`;

const statements = statementsOf(SPEC, DOCUMENT);
assert.deepEqual(
  statements.map(({ statement }) => statement),
  [
    'A release MUST refuse the planted input.',
    'It MUST NOT echo `a. B` back.',
    'A release MUST cover at least: - the first case; - the second case, which MAY be skipped.',
  ],
  'The reader did not find exactly the planted statements, so an empty result proves nothing.',
);

const checks = provenChecks({
  assurance: [
    { id: 'planted-refusal', invariant: 'The planted input is refused.' },
  ],
  assuranceRuntime: [
    { id: 'planted-echo', invariant: 'Nothing is echoed.' },
    {
      id: 'planted-gap',
      invariant: 'Unguarded.',
      knownGap: 'Nothing sees it.',
    },
  ],
  stages: ['verify:planted', 'verify:planted:self-test', 'verify:unguarded'],
  stagePlants: {
    'verify:planted': ['planted-defect'],
    'verify:unguarded': ['planted-orphan'],
  },
});

const good = () => [
  {
    spec: SPEC,
    statement: statements[0]!.statement,
    checks: ['assurance:planted-refusal'],
  },
  {
    spec: SPEC,
    statement: statements[1]!.statement,
    checks: ['assurance-runtime:planted-echo'],
  },
  {
    spec: SPEC,
    statement: statements[2]!.statement,
    checks: [
      'self-test:verify:planted:self-test',
      'plant:verify:planted:planted-defect',
    ],
  },
];

const green = evaluateMap({ statements, entries: good(), checks });
assert.deepEqual(
  green.findings,
  [],
  'The planted map must be green before any defect is planted.',
);

const defects = [
  {
    name: 'a statement with no entry',
    entries: good().slice(1),
    expect: [['unmapped', 'refuse the planted input']],
  },
  {
    name: 'a statement edited under its entry',
    statements: statementsOf(
      SPEC,
      DOCUMENT.replace('MUST NOT echo', 'MUST NOT log'),
    ),
    expect: [
      ['gone', 'MUST NOT echo'],
      ['unmapped', 'MUST NOT log'],
    ],
  },
  {
    name: 'a check nobody proves',
    entries: good().map((entry, index) =>
      index === 0 ? { ...entry, checks: ['assurance:planted-absent'] } : entry,
    ),
    expect: [['missing-check', 'assurance:planted-absent']],
  },
  {
    name: 'a runtime injection recorded as a known gap',
    entries: good().map((entry, index) =>
      index === 1
        ? { ...entry, checks: ['assurance-runtime:planted-gap'] }
        : entry,
    ),
    expect: [['missing-check', 'assurance-runtime:planted-gap']],
  },
  {
    name: 'a stage that is not a self-test',
    entries: good().map((entry, index) =>
      index === 2 ? { ...entry, checks: ['self-test:verify:planted'] } : entry,
    ),
    expect: [['missing-check', 'self-test:verify:planted']],
  },
  {
    name: 'a plant its stage does not list',
    entries: good().map((entry, index) =>
      index === 2
        ? { ...entry, checks: ['plant:verify:planted:planted-absent'] }
        : entry,
    ),
    expect: [['missing-check', 'plant:verify:planted:planted-absent']],
  },
  {
    name: 'a plant whose stage has no self-test',
    entries: good().map((entry, index) =>
      index === 2
        ? { ...entry, checks: ['plant:verify:unguarded:planted-orphan'] }
        : entry,
    ),
    expect: [['missing-check', 'plant:verify:unguarded:planted-orphan']],
  },
  {
    name: 'an entry with both checks and a reason',
    entries: good().map((entry, index) =>
      index === 0 ? { ...entry, reason: 'Planted.' } : entry,
    ),
    expect: [['shape', 'both']],
  },
  {
    name: 'an entry with neither',
    entries: good().map((entry, index) =>
      index === 0 ? { spec: entry.spec, statement: entry.statement } : entry,
    ),
    expect: [['shape', 'neither']],
  },
  {
    name: 'a statement mapped twice',
    entries: [...good(), good()[0] as MapEntry],
    expect: [['duplicate', 'refuse the planted input']],
  },
];

for (const defect of defects) {
  const { findings } = evaluateMap({
    statements: defect.statements ?? statements,
    entries: defect.entries ?? good(),
    checks,
  });
  const named = findings.map(({ kind, message }, index) => {
    const [, names] = defect.expect[index] ?? [];
    return [
      kind,
      names !== undefined && message.includes(names) ? names : message,
    ];
  });
  assert.deepEqual(
    named,
    defect.expect,
    `The map did not go red naming ${defect.name}.`,
  );
  process.stdout.write(`refused  ${defect.name}\n`);
}

process.stdout.write(
  `\nverify:normative-map:self-test GREEN: the reader found the ${statements.length} planted statements and the map refused each of ${defects.length} planted defects.\n`,
);
