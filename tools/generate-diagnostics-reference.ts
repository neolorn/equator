/**
 * The diagnostics reference, written from the union that declares the codes.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 12 says Equator's diagnostic codes are stable and
 * documented, and the second half needs a document naming every code. A hand-kept list, in a
 * specification or anywhere else, is a second source, and it drifts from the union on the first
 * commit that adds one.
 *
 * So the reference is derived, the same way `cli-options.generated.ts` is derived from the
 * configuration schema and `locale-profile.generated.ts` from `cldr-core`. The one hand-written
 * thing is the sentence per code, which lives in `packages/toolkit/src/diagnostic-reference.ts`
 * beside the union it is checked against: `satisfies Record<ToolkitDiagnosticCode, string>` fails
 * the typecheck for a code with no sentence and for a sentence with no code, by name, in both
 * directions. This file turns that table into the document a reader gets, and `--check` fails when
 * the checked-in copy no longer matches.
 *
 * ## What this asserts beyond rendering
 *
 * Three things the type system cannot see.
 *
 * **No recorded code is withdrawn or moved.** `specs/11-diagnostics-and-observability.spec.md`
 * section 4 forbids reassigning a code, and the union alone cannot tell a code that was renumbered
 * from one that was never there. `tools/code-record.json` holds every code a release may have
 * shipped: the toolkit diagnostics, the toolkit and runtime event codes with the area each names,
 * and the runtime failure codes. A recorded code missing from what the built packages declare, or
 * an event code now naming another area, fails by name. A code's meaning moving under the same
 * number and area is a judgment no record can make; what is mechanical is that the code is still
 * there and still where it was.
 *
 * The record only grows, and only on purpose. `--record` appends what is declared and not yet
 * recorded, after the same refusal as `--check`, so it cannot make a withdrawn code pass. Neither
 * `--check` nor a plain run writes it, and `--check` refuses a declared code the record lacks, so
 * adding a code is the moment it is recorded (`specs/12-verification.spec.md` section 9).
 *
 * **Every event and failure code has a sentence, and every sentence has a code.** Section 4 of the
 * same specification says every code is documented, and consumers switch on the event codes and on
 * `LocalizationFailureCode` as much as on the diagnostics. Their sentences are in
 * `tools/code-descriptions.json`, keyed by the codes read from the built packages above, and a
 * declared code with no sentence or a sentence for a code nothing declares fails by name. They sit
 * under `tools/` rather than beside the declarations because the runtime's codes are a type and a
 * frozen object read from its declaration files, which carry no table to check against, and a
 * sentence table in the runtime's source would be published code whose only reader is this file.
 * The toolkit's event codes are described there too, so the three families share one check.
 *
 * **Every section has codes and every code has a section.** The section is read off the code's own
 * number, so a new code joins a section by being numbered; a new *block* with no section title fails
 * here, and a title no code uses fails here too.
 *
 * **Every documented code is raised somewhere.** A code that nothing emits is a documented promise
 * with nothing behind it, and the union cannot notice one. The scan is over every `src` directory
 * under `packages/`, because the runtime publishes entry points beside its own, and it is checked
 * for non-vacuity before its emptiness is read:
 * a scan that matched nothing at all would report every code as unraised and look like a finding.
 *
 * ## Running it
 *
 * Reads `dist/toolkit` and the runtime's declaration files under `dist/runtime/types`, so it needs
 * `build`. Nothing in the table derives from the document, so a stale document still compiles and
 * the loop is `build`, generate, `build`. `--record` writes the code record and nothing else.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { format, resolveConfig } from 'prettier';
import ts from 'typescript';

import { runtimeDeclarations } from './published-surface.ts';
import { inputsRoot } from './stage-self-test.ts';

const workspaceRoot = inputsRoot();
const builtReference = resolve(
  workspaceRoot,
  'dist/toolkit/diagnostic-reference.js',
);
const documentPath = resolve(workspaceRoot, 'packages/toolkit/DIAGNOSTICS.md');
// The same table, web readable. The package copy is what a reader with an install can open with
// no network; this is what a reader who has not installed anything yet can. Both come out of
// this run, so neither can describe a code union the other does not.
const webDocumentPath = resolve(workspaceRoot, 'docs/reference/diagnostics.md');
const check = process.argv.includes('--check');
const recording = process.argv.includes('--record');
const recordPath = resolve(workspaceRoot, 'tools/code-record.json');
const recordName = 'tools/code-record.json';

interface DiagnosticReferenceModule {
  readonly DIAGNOSTIC_REFERENCE: Readonly<Record<string, string>>;
  readonly DIAGNOSTIC_SECTIONS: Readonly<Record<string, string>>;
}

interface Family {
  readonly key: string;
  readonly declaration: string;
  readonly declared: Map<string, string | null>;
}

type CodeRecord = Record<string, string[] | Record<string, unknown>>;

interface CodeDescriptions {
  readonly runtimeFailures: Readonly<Record<string, string>>;
  readonly [family: string]: Readonly<Record<string, string>> | undefined;
}

let reference: DiagnosticReferenceModule;
try {
  reference = (await import(
    pathToFileURL(builtReference).href
  )) as DiagnosticReferenceModule;
} catch (error) {
  throw new Error(
    `Could not read ${builtReference}. This generator reads the built table rather than the source, so run pnpm run build first. (${(error as Error | undefined)?.message ?? error})`,
  );
}

const { DIAGNOSTIC_REFERENCE, DIAGNOSTIC_SECTIONS } = reference;
const codes = Object.keys(DIAGNOSTIC_REFERENCE).sort();
assert.ok(
  codes.length > 0,
  'The built diagnostics table is empty, so nothing below means anything.',
);

/* ------------------------------------------------------------------ *
 * No recorded code withdrawn or moved.                                *
 * ------------------------------------------------------------------ */

const { TOOLKIT_EVENT_CODES } = (await import(
  pathToFileURL(resolve(workspaceRoot, 'dist/toolkit/observability.js')).href
)) as { readonly TOOLKIT_EVENT_CODES?: Readonly<Record<string, string>> };

// The runtime's codes are read from its declaration files, which are what a consumer's editor
// resolves; `LocalizationFailureCode` is a type and exists nowhere else in what is published.
function runtimeDeclared(name: string): ts.TypeNode | undefined {
  const found: (ts.TypeNode | undefined)[] = [];
  for (const { entryPoint, text } of runtimeDeclarations()) {
    const source = ts.createSourceFile(
      `${entryPoint}.d.ts`,
      text,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    );
    for (const statement of source.statements) {
      if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name)
        found.push(statement.type);
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
          found.push(declaration.type);
      }
    }
  }
  assert.equal(
    found.length,
    1,
    `${name} is declared ${found.length} times under dist/runtime/types, so the codes it holds cannot be read from it.`,
  );
  return found[0];
}

const stringLiteral = (node: ts.TypeNode | undefined, name: string) => {
  assert.ok(
    node !== undefined &&
      ts.isLiteralTypeNode(node) &&
      ts.isStringLiteral(node.literal),
    `${name} holds something other than string literals, so the codes it holds cannot be read from it.`,
  );
  return node.literal.text;
};

const failureUnion = runtimeDeclared('LocalizationFailureCode') as ts.TypeNode;
assert.ok(
  ts.isUnionTypeNode(failureUnion),
  'LocalizationFailureCode is not a union, so the codes it holds cannot be read from it.',
);
const runtimeFailureCodes = failureUnion.types.map((node) =>
  stringLiteral(node, 'LocalizationFailureCode'),
);

// Declared as `Readonly<{ readonly area: "code"; ... }>`, the shape `Object.freeze` of a literal
// with `as const` compiles to.
const runtimeEventType = runtimeDeclared('RUNTIME_EVENT_CODES');
const runtimeEventMembers =
  runtimeEventType !== undefined &&
  ts.isTypeReferenceNode(runtimeEventType) &&
  runtimeEventType.typeArguments?.length === 1 &&
  ts.isTypeLiteralNode(runtimeEventType.typeArguments[0] as ts.TypeNode)
    ? (runtimeEventType.typeArguments[0] as ts.TypeLiteralNode).members
    : undefined;
assert.ok(
  runtimeEventMembers !== undefined,
  'RUNTIME_EVENT_CODES is not declared as Readonly of an object literal type, so the codes it holds cannot be read from it.',
);
const runtimeEventCodes = runtimeEventMembers.map(
  (member): [string, string] => {
    assert.ok(
      ts.isPropertySignature(member) && ts.isIdentifier(member.name),
      'RUNTIME_EVENT_CODES has a member that is not a named property.',
    );
    return [
      member.name.text,
      stringLiteral(member.type, 'RUNTIME_EVENT_CODES'),
    ];
  },
);

// A family whose codes carry no area is recorded as a list; an event code names the area it is
// about, and moving it to another area is the reassignment a dashboard keyed on it would miss.
const families: Family[] = [
  {
    key: 'toolkitDiagnostics',
    declaration: 'ToolkitDiagnosticCode',
    declared: new Map(codes.map((code) => [code, null])),
  },
  {
    key: 'toolkitEvents',
    declaration: 'TOOLKIT_EVENT_CODES',
    declared: new Map(
      Object.entries(TOOLKIT_EVENT_CODES ?? {}).map(([area, code]) => [
        code,
        area,
      ]),
    ),
  },
  {
    key: 'runtimeEvents',
    declaration: 'RUNTIME_EVENT_CODES',
    declared: new Map(runtimeEventCodes.map(([area, code]) => [code, area])),
  },
  {
    key: 'runtimeFailures',
    declaration: 'LocalizationFailureCode',
    declared: new Map(runtimeFailureCodes.map((code) => [code, null])),
  },
];
for (const { declaration, declared } of families) {
  assert.ok(
    declared.size > 0,
    `${declaration} was read as holding no codes, so every recorded code would read as withdrawn.`,
  );
}

let record: CodeRecord;
try {
  record = JSON.parse(readFileSync(recordPath, 'utf8')) as CodeRecord;
} catch (error) {
  throw new Error(
    `Could not read ${recordName}, the record of every code a release may have shipped. (${(error as Error | undefined)?.message ?? error})`,
  );
}
assert.deepEqual(
  Object.keys(record)
    .filter((key) => key !== 'note')
    .sort(),
  families.map(({ key }) => key).sort(),
  `${recordName} records families other than the ones declared here, so a code in one of them would go unchecked.`,
);

const recorded = (key: string) => {
  const value = record[key];
  return Array.isArray(value)
    ? new Map(value.map((code): [string, null] => [code, null]))
    : new Map(Object.entries(value as Record<string, unknown>));
};

for (const { key, declaration, declared } of families) {
  for (const [code, area] of recorded(key)) {
    assert.ok(
      declared.has(code),
      `${code} is in ${recordName} and ${declaration} no longer declares it. A code a release may have shipped is never withdrawn, renamed or renumbered.`,
    );
    assert.equal(
      declared.get(code),
      area,
      `${code} is recorded for ${area} and ${declaration} now declares it for ${declared.get(code)}. A code keeps the area it was recorded for; a new area takes a new code.`,
    );
  }
}

const unrecorded = families.flatMap(({ key, declaration, declared }) => {
  const known = recorded(key);
  return [...declared.keys()]
    .filter((code) => !known.has(code))
    .sort()
    .map((code) => ({ key, declaration, code, area: declared.get(code) }));
});

/* ------------------------------------------------------------------ *
 * Every event and failure code described, both ways.                  *
 * ------------------------------------------------------------------ */

const descriptionsPath = resolve(workspaceRoot, 'tools/code-descriptions.json');
const descriptionsName = 'tools/code-descriptions.json';
let descriptions: CodeDescriptions;
try {
  descriptions = JSON.parse(
    readFileSync(descriptionsPath, 'utf8'),
  ) as CodeDescriptions;
} catch (error) {
  throw new Error(
    `Could not read ${descriptionsName}, the sentences for the event and failure codes. (${(error as Error | undefined)?.message ?? error})`,
  );
}
const described = families.filter(({ key }) => key !== 'toolkitDiagnostics');
assert.deepEqual(
  Object.keys(descriptions)
    .filter((key) => key !== 'note')
    .sort(),
  described.map(({ key }) => key).sort(),
  `${descriptionsName} describes families other than ${described.map(({ key }) => key).join(', ')}, so a code in one of them would go undocumented or unchecked.`,
);
for (const { key, declaration, declared } of described) {
  const sentences = descriptions[key] as Readonly<Record<string, string>>;
  for (const code of declared.keys()) {
    assert.ok(
      typeof sentences[code] === 'string' && sentences[code].trim() !== '',
      `${code} is declared by ${declaration} and ${descriptionsName} has no description for it. Every code is documented.`,
    );
  }
  for (const code of Object.keys(sentences)) {
    assert.ok(
      declared.has(code),
      `${descriptionsName} describes ${code}, which ${declaration} does not declare.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Sections, both ways.                                                *
 * ------------------------------------------------------------------ */

const sectionOf = (code: string) => code.slice(-4, -2);
const used = new Set(codes.map(sectionOf));
for (const section of used) {
  assert.ok(
    typeof DIAGNOSTIC_SECTIONS[section] === 'string',
    `Codes EQ${section}xx exist and no section is titled "${section}". Add one to DIAGNOSTIC_SECTIONS.`,
  );
}
for (const section of Object.keys(DIAGNOSTIC_SECTIONS)) {
  assert.ok(
    used.has(section),
    `Section "${section}" is titled and no code uses it. Take it out; the sections follow the codes.`,
  );
}

/* ------------------------------------------------------------------ *
 * Every documented code is raised somewhere.                          *
 * ------------------------------------------------------------------ */

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      sourceFiles(path, found);
    } else if (/\.ts$/u.test(entry.name) && !/\.d\.ts$/u.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

// Every `src` under `packages/` at any depth, because the runtime's secondary entry points each
// keep theirs beside the primary one, and an entry point added later is covered the day it lands.
const roots: string[] = [];
const findRoots = (directory: string) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.name === 'src') roots.push(path);
    else findRoots(path);
  }
};
findRoots(resolve(workspaceRoot, 'packages'));
assert.ok(roots.length > 0, 'No package source roots were found.');

// The two files that name codes without raising them: the union that declares them, and the table
// that describes them. A code appearing only there is a code nothing can produce.
const DECLARATIONS = new Set<string | undefined>([
  'diagnostics.ts',
  'diagnostic-reference.ts',
]);
const raised = new Map<string, string[]>(codes.map((code) => [code, []]));
let occurrences = 0;
let scanned = 0;
for (const root of roots) {
  for (const file of sourceFiles(root)) {
    if (DECLARATIONS.has(file.split(/[\\/]/u).at(-1))) continue;
    scanned += 1;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/'(EQ\d{4})'/gu)) {
      occurrences += 1;
      raised.get(match[1] as string)?.push(relative(workspaceRoot, file));
    }
  }
}

// The scan is shown to have read something, before the empty results below are read as findings.
assert.ok(scanned > 0, 'The source scan read no files.');
assert.ok(
  occurrences > 0,
  'The source scan matched no diagnostic code at all, so "raised nowhere" below would be its own failure rather than a finding.',
);
const unraised = codes.filter(
  (code) => (raised.get(code) as string[]).length === 0,
);
assert.deepEqual(
  unraised,
  [],
  `Documented but raised nowhere in a src directory under packages/: ${unraised.join(', ')}. A code nothing emits is a promise with nothing behind it.`,
);

/* ------------------------------------------------------------------ *
 * The document.                                                       *
 * ------------------------------------------------------------------ */

const sections = [...used].sort();

const body = [];
for (const section of sections) {
  body.push(`## ${DIAGNOSTIC_SECTIONS[section]}`, '');
  for (const code of codes.filter((each) => sectionOf(each) === section)) {
    body.push(`### ${code}`, '', DIAGNOSTIC_REFERENCE[code], '');
  }
}

const lines = [
  '# Equator diagnostics',
  '',
  'Every code `@neolorn/equator-toolkit` can report, and what it means. A diagnostic carries its own',
  'summary saying what happened at the place it happened; this says what the code is about.',
  '',
  '**Generated.** The list comes from the `ToolkitDiagnosticCode` union and the sentences from the',
  'table beside it, and the gate re-renders this file and fails when it differs. Do not edit it here:',
  'edit `packages/toolkit/src/diagnostic-reference.ts`, which the compiler checks against the union in',
  'both directions.',
  '',
  '**Severity is not listed, on purpose.** Several codes carry the severity a run decides: the',
  "completeness family and `EQ1704` are advisory or blocking depending on the command's switches and",
  "the project's own declarations, so a severity written here would be wrong for exactly the codes",
  'most worth looking up. What a run does with a finding is decided on severity, and the finding says',
  'which one it carries.',
  '',
];

const document = `${[...lines, ...body].join('\n').trimEnd()}\n`;

const eventSection = (declaration: string, key: string) => {
  const { declared } = families.find((family) => family.key === key) as Family;
  return [...declared.keys()]
    .sort()
    .flatMap((code) => [
      `### ${code}`,
      '',
      `Declared as \`${declaration}.${declared.get(code)}\`.`,
      '',
      (descriptions[key] as Readonly<Record<string, string>>)[code],
      '',
    ]);
};

const failureSection = [...runtimeFailureCodes]
  .sort()
  .flatMap((code) => [
    `### ${code}`,
    '',
    descriptions.runtimeFailures[code],
    '',
  ]);

const eventsAndFailures = [
  '## Toolkit events',
  '',
  'An operation given a `ToolkitObservabilitySink` reports `started` and then `succeeded`,',
  '`unchanged` or `failed` under one of these codes. A failure carries the code of the first',
  'diagnostic as `diagnosticCode`, unless the operation threw.',
  '',
  ...eventSection('TOOLKIT_EVENT_CODES', 'toolkitEvents'),
  '## Runtime events',
  '',
  'The sink you pass to `withObservability` receives one of these as `code`, with the same area in',
  'words as `phase`. An event that did not succeed carries its reason, one of the runtime failure',
  'codes below, where there is one.',
  '',
  ...eventSection('RUNTIME_EVENT_CODES', 'runtimeEvents'),
  '## Runtime failures',
  '',
  "A runtime diagnostic's `code`, and a runtime event's `reason`, is one of these. The diagnostic's",
  '`outcome` says what kind of thing happened. It is `operational-failure` unless the entry names',
  'another outcome.',
  '',
  ...failureSection,
];

const webDocument = `${[
  '# Diagnostics',
  '',
  'Every code Equator reports, and what it means: the diagnostics of `@neolorn/equator-toolkit`, the',
  'event codes both packages send to an observability sink, and the failure codes a runtime',
  'diagnostic carries. A diagnostic carries its own summary describing what happened where it',
  'happened; this page describes the code.',
  '',
  'This page is generated from the declarations of the codes and is not edited by hand. The toolkit',
  'diagnostics also ship inside that package as `DIAGNOSTICS.md`, readable from an install with no',
  'network.',
  '',
  'Severity is not listed. Several codes carry the severity the run decides: the completeness family',
  "and `EQ1704` are advisory or blocking depending on the command's switches and the project's own",
  'declarations. A finding states the severity it carries, and a run acts on that.',
  '',
  'What a diagnostic contains, and what it never contains, is',
  '[About diagnostics and runtime outcomes](../explanation/about-diagnostics.md).',
  '',
  ...body,
  ...eventsAndFailures,
]
  .join('\n')
  .trimEnd()}\n`;

// Formatted the way every other document here is formatted, so the formatting check and this
// one cannot want two different files.
const prettierOptions = {
  ...((await resolveConfig(webDocumentPath)) ?? {}),
  parser: 'markdown',
};

const written: [string, string][] = [
  [documentPath, document],
  [webDocumentPath, await format(webDocument, prettierOptions)],
];

if (recording) {
  for (const { key, code, area } of unrecorded) {
    if (Array.isArray(record[key])) record[key].push(code);
    else (record[key] as Record<string, unknown>)[code] = area;
  }
  const recordText = await format(JSON.stringify(record), {
    ...((await resolveConfig(recordPath)) ?? {}),
    parser: 'json',
  });
  await writeFile(recordPath, recordText, 'utf8');
  process.stdout.write(
    `${recordName}: ${unrecorded.length} code(s) recorded${unrecorded.length > 0 ? `: ${unrecorded.map(({ code }) => code).join(', ')}` : ''}. Every code recorded before is still declared where it was.\n`,
  );
} else if (check) {
  assert.deepEqual(
    unrecorded.map(({ code }) => code),
    [],
    `Declared and not in ${recordName}: ${unrecorded.map(({ declaration, code }) => `${code} (${declaration})`).join(', ')}. Recording a code is its own step: run node ./tools/generate-diagnostics-reference.ts --record.`,
  );
  for (const [target, expected] of written) {
    let current: string;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      throw new Error(
        `${relative(workspaceRoot, target)} is missing. Run pnpm run generate:diagnostics-reference.`,
      );
    }
    assert.equal(
      current.replaceAll('\r\n', '\n'),
      expected,
      `${relative(workspaceRoot, target)} does not match the diagnostics table. Run pnpm run generate:diagnostics-reference.`,
    );
  }
  process.stdout.write(
    `Equator diagnostics reference verified: ${codes.length} code(s) across ${sections.length} section(s), each raised in a src directory under packages/; ${occurrences} code reference(s) over ${scanned} file(s); ${families.map(({ declaration, declared }) => `${declared.size} ${declaration}`).join(', ')}, every one recorded and every recorded one still declared where it was; every event and failure code described in ${descriptionsName} and every description declared.\n`,
  );
} else {
  await mkdir(dirname(webDocumentPath), { recursive: true });
  for (const [target, contents] of written) {
    await writeFile(target, contents, 'utf8');
  }
  process.stdout.write(
    `Equator diagnostics reference written: ${codes.length} code(s) across ${sections.length} section(s), in ${written.length} document(s).\n`,
  );
}
