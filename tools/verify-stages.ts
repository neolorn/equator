import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeConsumerProfiles } from './package-consumer-profiles.ts';

/**
 * The gate's stages, and what each one reads and writes.
 *
 * `tools/verify.ts` derives its graph from these declarations and checks them against a trace of
 * every run. They live here rather than in that file because the runner is not their only reader:
 * `verify:matrix` asks which stages record capability claims, so it can fail on one that recorded
 * none, and a second copy of the answer would agree with the first until a stage was added.
 */

/**
 * `format:check`, `lint:self-test`, `lint`, `typecheck`, `verify:injection-anchors:self-test` and
 * `verify:injection-anchors` are the first phase and prerequisites of everything else, applied by the runner rather than written into each stage. A tree that does not
 * typecheck is a tree nobody should be measuring, and a formatting miss found four seconds in should
 * cost four seconds, not the hour the rest of this takes to prove a change that was already
 * correct. That happened: a new test file went unformatted into a run that spent an hour on browser
 * rows and consumer installs before printing a two-line prettier warning. Applying the gate in the
 * runner means a stage added later is covered on the day it lands.
 *
 * The anchor check is there because the two stages that apply the injections reach a stale anchor
 * minutes in, one of them after a build and a consumer install, and the same reading costs under a
 * second with nothing built.
 *
 * Three of the first four are a chain rather than four peers, and the chain is the whole of what `needs`
 * says here. `lint` runs after the control that proves it can fail, for the reason
 * `verify:browser-assurance:self-test` runs before the browser gate: a broken control should make
 * what it controls report skipped, which is true, rather than pass on evidence nothing checked.
 * `typecheck` runs after `lint`: the two read the same program and cost about the same, and
 * the linter's finding is the more specific of the two.
 *
 * `processors` is how many logical processors a stage occupies at once, counting the workers its
 * runners start, and is one when a stage says nothing. The scheduler keeps the stages running within
 * the gate's budget by it, and the stage's runners are handed it as their worker count
 * (`gate-resources.ts`). The heavy stages are handed four, which is the Angular build's own
 * default ceiling on its workers.
 *
 * `minimumProcessors` is the smallest share a stage can be held within by the settings its runners
 * read, where that is more than one. The scheduler never hands it less, and a budget smaller than it
 * is refused before anything starts. An Angular application build runs its transform workers beside
 * its main thread and esbuild's, so a stage that builds one cannot be held within one processor.
 * Angular 22.0 also keeps a transform pool of at least one worker for each bundle it builds
 * (`createCompilerPlugin` in `@angular/build`), and a server-rendered application has three, so a
 * stage that builds one with it cannot be held within fewer than three.
 *
 * `claims: true` marks a stage whose checks record the capabilities they assert, and gives it the
 * artefact its claims go to. `readsClaims: true` marks the stage that reads all of them. Both are
 * expanded below rather than written out, so a stage that starts recording claims is one line
 * here and the matrix reads it on the day it lands.
 *
 * `source:tools` is expanded the same way for every stage whose command runs a program under
 * `tools/`, because the program is read from there. It is true of nearly every stage and says
 * nothing particular about any, so it is written below once rather than here forty times. A stage
 * that reads `tools/` some other way, through a test runner's configuration or a formatter, still
 * declares it.
 */
/**
 * Whether the build keeps a cache. `ng-packagr` writes one under each package's `node_modules`
 * unless the environment says it is on a build server (`CI` set to `true`, in any case, or to
 * `1`), where it writes none. The build's declaration follows the same reading, so the graph a
 * hosted run is checked against is the one that run has: a write declared and never made is
 * reported as drift, and so is one made and not declared.
 */
const buildKeepsACache = !(
  process.env['CI']?.toLowerCase() === 'true' || process.env['CI'] === '1'
);

/** A stage another stage cannot run without, and why. */
export interface StageNeed {
  readonly on: string;
  readonly why: string;
}

/** One stage as it is declared below. */
export interface StageDeclaration {
  readonly id: string;
  readonly gate?: boolean;
  readonly privateTree?: boolean;
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly needs?: readonly StageNeed[];
  readonly processors?: number;
  readonly minimumProcessors?: number;
  readonly exclusive?: boolean;
  readonly claims?: boolean;
  readonly readsClaims?: boolean;
  readonly timeoutSeconds?: number;
}

/** One stage with its derived reads and writes expanded. */
export interface Stage extends StageDeclaration {
  readonly reads: readonly string[];
}

const declared: readonly StageDeclaration[] = Object.freeze([
  {
    id: 'format:check',
    gate: true,
    reads: ['source:docs', 'source:packages', 'source:specs', 'source:tools'],
  },
  // Seeds a floating promise and an import cycle into its own copy of the source and requires the
  // lint stage to go red naming both rules. Its own tree, because it writes tracked source; a gate
  // stage, because what it controls is one.
  {
    id: 'lint:self-test',
    gate: true,
    privateTree: true,
    // The same program `typecheck` loads, so the same installed type dependencies under
    // `packages/*/node_modules`: a type-aware rule cannot answer without them. It plants a file
    // among the tools as well, because `lint` reads them.
    reads: ['cache:build', 'source:packages', 'source:tools'],
    writes: ['source:packages', 'source:tools'],
  },
  // `source:tools` because a test that claims a capability imports the claim, and a type-aware rule
  // reads its declaration there.
  {
    id: 'lint',
    gate: true,
    reads: ['cache:build', 'source:packages', 'source:tools'],
    needs: [
      {
        on: 'lint:self-test',
        why: 'A linter nobody has seen fail is indistinguishable from one whose rules are off.',
      },
    ],
  },
  // The only stage that reads a test file's types at all: vitest transpiles with esbuild, which
  // strips types without checking them, and `ngc` only compiles what an entry point imports.
  {
    id: 'typecheck',
    gate: true,
    reads: ['cache:build', 'source:packages'],
    needs: [
      {
        on: 'lint',
        why: 'The same program, about the same cost, and the more specific finding first.',
      },
    ],
  },
  // The stage below, shown refusing an anchor that has left its file, one that is there twice and
  // a file that is gone.
  {
    id: 'verify:injection-anchors:self-test',
    gate: true,
    reads: ['source:packages', 'source:tools'],
  },
  // Every injection the two assurance stages apply, held to the file it patches: its text there
  // exactly once. It builds nothing, which is why it can run with the formatter and the linter.
  {
    id: 'verify:injection-anchors',
    gate: true,
    reads: ['source:packages', 'source:tools'],
    needs: [
      {
        on: 'verify:injection-anchors:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:locale-profile:self-test',
    reads: ['source:packages'],
  },
  {
    id: 'verify:locale-profile',
    reads: ['source:packages'],
    needs: [
      {
        on: 'verify:locale-profile:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:standards-sources:self-test',
    reads: ['source:packages'],
  },
  // Cheap, and it runs before anything derives from a vendored file: a source that no longer matches
  // its recorded digest makes every downstream result meaningless rather than wrong. The empty list
  // is deliberate: it reads `standards/`, the vendored sources and their lock, which no stage
  // produces. The one ordering that matters is declared as an edge below, where a reason can be
  // written next to it.
  {
    id: 'verify:standards-sources',
    reads: [],
    needs: [
      {
        on: 'verify:standards-sources:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // Every tracked file, so every source artefact, plus the commit log, which is not an artefact any
  // stage writes. Nothing depends on it: it is cheap, and a hit is a writing fault rather than a
  // broken build, so there is no reason to hold any other stage behind it.
  {
    id: 'verify:sterilize',
    reads: ['source:docs', 'source:packages', 'source:specs', 'source:tools'],
  },
  // Reads the specifications and every file that can cite one. Cheap, depends on nothing, and
  // holds nothing behind it: a citation that leads nowhere is a writing fault in the same way a
  // dash is, and neither breaks a build.
  {
    id: 'verify:spec-links',
    reads: ['source:docs', 'source:packages', 'source:specs', 'source:tools'],
  },
  // Reads every tracked document and the paths they name. Cheap, depends on nothing, and holds
  // nothing behind it, for the same reason as the two above: a link that arrives nowhere costs a
  // reader their click rather than costing a build.
  {
    id: 'verify:doc-links',
    reads: ['source:docs', 'source:packages', 'source:specs', 'source:tools'],
  },
  // Drives the scheduler this gate runs on over a planted graph and requires it to keep the
  // processor budget, the memory floor and exclusivity at every start, and to start everything in
  // the end. It proves the limits of a run that has already begun, so it cannot hold that run back;
  // what it holds back is the next change that loosens them. `source:packages` because the stage
  // list it drives reads the runtime's manifest for the supported versions.
  {
    id: 'verify:gate-limits:self-test',
    reads: ['source:packages', 'source:tools'],
  },
  // Drives the browser rows' call bound and page teardown with objects of its own in place of a
  // browser: a page whose close never settles is closed with its context and recorded where this
  // gate reads occurrences, and a browser whose context does not close either is ended, recorded
  // there too, and replaced by a fresh one that the rest of the row runs in.
  { id: 'verify:browser-teardown:self-test', reads: ['source:tools'] },
  // Drives the browser rows' script gate with a page of its own in place of a browser: a script is
  // held for the caller during a gated navigation and handed on at any other time, and the page's
  // route is never removed, because a script asked for while a route is going away is left paused.
  { id: 'verify:browser-script-gate:self-test', reads: ['source:tools'] },
  // Drives the exports-map reader every entry-point list is taken from with manifests of its own,
  // because the built packages close no subpath and the stages that read them never meet one.
  { id: 'verify:exports-map:self-test', reads: ['source:tools'] },
  // Plants a document and a map beside it and requires the reader to find each planted statement
  // and the map to refuse each planted defect, so the stage below cannot pass by reading nothing.
  { id: 'verify:normative-map:self-test', reads: ['source:tools'] },
  // Reads the specifications and the injection lists, and holds nothing behind it: a statement
  // without its proof is a gap in the evidence, not a broken build. The injections it names are
  // proven able to fail by the assurance stages in the same run.
  {
    id: 'verify:normative-map',
    reads: ['source:packages', 'source:specs', 'source:tools'],
    needs: [
      {
        on: 'verify:normative-map:self-test',
        why: 'A map nobody has seen refuse an unmapped statement is indistinguishable from one that reads no statements at all.',
      },
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name.
  {
    id: 'verify:mutation-reasons:self-test',
    reads: ['source:packages', 'source:tools'],
  },
  // The mutants recorded as ones no test could notice, held to the source they describe. It reads
  // no mutation report, which is produced on request and outside this gate, so what it refuses is
  // a record whose text has left the file it names.
  {
    id: 'verify:mutation-reasons',
    reads: ['source:packages', 'source:tools'],
    needs: [
      {
        on: 'verify:mutation-reasons:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  { id: 'verify:person-names', reads: ['source:packages'] },
  // The two suites run at the same time, and with a shared vitest results cache both would hash the
  // empty project name and overwrite each other's record. Each has its own `cacheDir`, so the
  // artefacts below are genuinely separate rather than separated by schedule. `source:tools`
  // because a test that claims a capability imports the claim from there.
  {
    id: 'test:toolkit',
    processors: 4,
    reads: ['source:packages', 'source:tools'],
    writes: ['cache:vitest:toolkit'],
    claims: true,
  },
  // The runtime's pure modules: the ones whose import graph reaches no Angular symbol at runtime.
  // Everything else the runtime does is proven in the feature lab, against the built package,
  // because that is the only place a claim about wiring can be made at all. An invariant is
  // asserted here or there, never in both, so this does not become a second copy of the lab.
  // `source:tools` because the twin drift test reads `tools/twin-sources.json`, the one list of
  // files the two packages each keep a copy of, which the mutation configuration reads too.
  {
    id: 'test:runtime',
    processors: 4,
    reads: ['source:packages', 'source:tools'],
    writes: ['cache:vitest:runtime'],
    claims: true,
  },
  // The stages that mutate tracked source in place and restore it. Each gets a tree of its own, so
  // the mutation has no reader to be protected from and no barrier is derived for it: they still
  // write `source:packages`, but not the copy anything else is reading. Restoring on the way out,
  // including when it throws, remains the stage's own contract and is checked there rather than
  // here: a private tree makes a failure to restore harmless to everyone else, which is not the
  // same as making it correct. Plants a real injection, an inert one, one whose module cannot load
  // and one naming a test that does not exist, and requires the runner to tell a catch from the
  // three that only exit like one.
  {
    id: 'verify:assurance:self-test',
    processors: 4,
    privateTree: true,
    writes: ['cache:vitest:unnamed', 'source:packages'],
  },
  {
    id: 'verify:assurance',
    processors: 4,
    privateTree: true,
    writes: ['cache:vitest:unnamed', 'source:packages'],
    needs: [
      {
        on: 'verify:assurance:self-test',
        why: 'A runner nobody has seen refuse a false catch would report a guard that never ran as caught.',
      },
    ],
    // The 435 injections took 1,702s between them when the stage was measured on its own, so the
    // bound is a little over three times that.
    timeoutSeconds: 5_400,
  },
  {
    id: 'build',
    processors: 2,
    reads: [...(buildKeepsACache ? [] : ['cache:build']), 'source:packages'],
    writes: [
      ...(buildKeepsACache ? ['cache:build'] : []),
      'dist:other',
      'dist:runtime',
      'dist:toolkit',
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:packages:self-test',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
  },
  {
    id: 'verify:packages',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
    needs: [
      {
        on: 'verify:packages:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // What gets published is a tarball, and the tarball can be wrong while the build output on disk
  // is correct: a type declaration can carry the runtime module's JavaScript.
  {
    id: 'verify:tarballs',
    reads: ['dist:runtime', 'dist:toolkit'],
    writes: ['release:packages'],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:npm-consumer:self-test',
    reads: ['release:packages', 'source:packages'],
  },
  // The tarballs `verify:tarballs` packed, installed with npm from the staged cache. It reads
  // `source:packages` for the version whose tarballs it installs, and installs into a folder of its
  // own under `tmp`.
  {
    id: 'verify:npm-consumer',
    reads: ['release:packages', 'source:packages'],
    needs: [
      {
        on: 'verify:npm-consumer:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that installs nothing.',
      },
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:export-surface:self-test',
    reads: [
      'dist:runtime',
      'dist:toolkit',
      'source:docs',
      'source:packages',
      'source:tools',
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:format-shapes:self-test',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
  },
  // The declarations a consumer of the built packages sees are the shapes a stamp promises, so the
  // record is compared with them rather than with the source they were emitted from.
  {
    id: 'verify:format-shapes',
    reads: ['dist:runtime', 'dist:toolkit'],
    needs: [
      {
        on: 'verify:format-shapes:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // A scan that counts a scratch directory as its corpus holds exports "used" on files that are
  // about to be cleaned away, so this one reads the built declaration files instead.
  {
    id: 'verify:export-surface',
    reads: [
      'dist:runtime',
      'dist:toolkit',
      'source:docs',
      'source:packages',
      'source:tools',
    ],
    needs: [
      {
        on: 'verify:export-surface:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:cli-options:self-test',
    reads: ['dist:toolkit', 'source:packages'],
  },
  // Reads the built schema rather than the source, so it waits for `build`, and it is the stage
  // that fails when a settable configuration key has no `equator init` flag. `dist:toolkit` is the
  // input; `source:packages` is the checked-in table it compares against.
  {
    id: 'verify:cli-options',
    reads: ['dist:toolkit', 'source:packages'],
    needs: [
      {
        on: 'verify:cli-options:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:diagnostics-reference:self-test',
    reads: ['dist:runtime', 'dist:toolkit', 'source:docs', 'source:packages'],
  },
  // Same shape and the same reason: the built table is the input, and the two checked-in copies
  // are what it re-renders. It also reads every `src` under `packages/`, to fail a documented code
  // that nothing raises.
  {
    id: 'verify:diagnostics-reference',
    reads: ['dist:runtime', 'dist:toolkit', 'source:docs', 'source:packages'],
    needs: [
      {
        on: 'verify:diagnostics-reference:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:docs-reference:self-test',
    reads: ['dist:runtime', 'dist:toolkit', 'source:docs', 'source:packages'],
  },
  // The command line page is the built CLI's own help and the configuration page is the schema
  // staged beside it, so both wait for `build`. `source:docs` is what they are compared against,
  // and `dist:runtime` is where the entry point page reads what each entry publishes.
  {
    id: 'verify:docs-reference',
    reads: ['dist:runtime', 'dist:toolkit', 'source:docs', 'source:packages'],
    needs: [
      {
        on: 'verify:docs-reference:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // The closed unions the strict row compiles a switch for, found in the built declarations, so it
  // waits for `build`. What it compares against is the strict row's overlay under `fixtures/`, which
  // is not an artefact any stage writes. `source:packages` is the two package manifests, which the
  // rows' profiles, where the strict row's options come from, read their versions from.
  {
    id: 'verify:closed-unions',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
  },
  // Reads the composable exports out of the built declarations and the guides out of `docs/`, so
  // it fails when a feature ships with no page telling a reader it exists.
  {
    id: 'verify:guide-coverage',
    reads: ['dist:runtime', 'source:docs'],
  },
  // Reads the built declaration files through the TypeScript checker, so it waits for `build`.
  // `source:tools` is the baseline it compares against, which lives beside it in `tools/`.
  {
    id: 'verify:doc-coverage',
    reads: ['dist:runtime', 'dist:toolkit', 'source:tools'],
  },
  {
    id: 'verify:angular-free-consumer',
    reads: ['dist:runtime'],
  },
  {
    id: 'verify:handler-derivation',
    processors: 4,
    privateTree: true,
    writes: ['cache:vitest:unnamed', 'source:packages'],
  },
  // Empty on purpose: it reads `fixtures/semantic-analysis/`, which no stage produces.
  { id: 'verify:angular-analysis', reads: [] },
  {
    id: 'verify:node-compatibility',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
  },
  // Runs the stage below over a copy of the built toolkit and the compatibility page, once
  // unchanged and once per defect `stage-plants.ts` plants: a toolkit that canonicalizes a tag
  // differently from Node, and a page that omits or invents a capability a host lacks.
  {
    id: 'verify:platform:self-test',
    reads: ['dist:toolkit', 'source:docs', 'source:packages'],
  },
  // Probes the installed engines, every Node row the suites run on and the three Playwright
  // browsers, and holds the built toolkit's canonicalization and the published compatibility page
  // to what they answer.
  {
    id: 'verify:platform',
    reads: ['dist:toolkit', 'source:docs', 'source:packages'],
    needs: [
      {
        on: 'verify:platform:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // The consumer rows read `source:tools` because the materializer copies the claim and its
  // recorder into each consumer, whose specs claim what they assert.
  {
    id: 'verify:consumer',
    processors: 4,
    minimumProcessors: 2,
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    writes: ['consumer:package'],
    claims: true,
  },
  {
    id: 'verify:focused-consumers',
    processors: 4,
    minimumProcessors: 2,
    reads: ['dist:runtime', 'dist:toolkit'],
    writes: ['consumer:focused'],
  },
  {
    id: 'verify:angular-22.0.4',
    processors: 4,
    minimumProcessors: 3,
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    writes: ['consumer:angular-22.0.4'],
    claims: true,
  },
  {
    id: 'verify:lower-bounds',
    processors: 4,
    minimumProcessors: 3,
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    writes: ['consumer:lower-bounds'],
    claims: true,
  },
  // The row that varies the compiler rather than the versions. Analysis adopts a consumer's own
  // options, so every other row exercises one setting of them, and this one reads the generated
  // route table from application source, which is the shape none of the others performs.
  {
    id: 'verify:strict-consumer',
    processors: 4,
    minimumProcessors: 2,
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    writes: ['consumer:strict'],
    claims: true,
  },
  // The development row under each URL policy it does not declare: the same application with the
  // policy and its address table replaced, so where the locale sits in an address is all that
  // differs from `verify:consumer`. The host row builds once for each origin.
  {
    id: 'verify:default-locale-prefix-consumer',
    processors: 4,
    minimumProcessors: 2,
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    writes: ['consumer:default-locale-prefix'],
    claims: true,
  },
  {
    id: 'verify:locale-neutral-consumer',
    processors: 4,
    minimumProcessors: 2,
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    writes: ['consumer:locale-neutral'],
    claims: true,
  },
  {
    id: 'verify:locale-host-consumer',
    processors: 4,
    minimumProcessors: 2,
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    writes: ['consumer:locale-host'],
    claims: true,
  },
  // The development row on each other Node line the packages admit: install, the command steps,
  // the specs, the build and prerender, and the server bundle's answers, all on that line's Node.
  ...[...nodeConsumerProfiles.keys()].map((name) => ({
    id: `verify:${name}`,
    processors: 4,
    minimumProcessors: 2,
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    writes: [`consumer:${name.replace(/-consumer$/u, '')}`],
    claims: true,
  })),
  // Edits the materialized consumer in place and restores it, asserting the restore was exact. It
  // declares the write, so everything that reads that tree is ordered around it.
  {
    id: 'verify:edit-cost',
    processors: 4,
    writes: ['consumer:package'],
  },
  // Runs the stage below over a copy of the built runtime, once unchanged and once per defect
  // `stage-plants.ts` plants for it: a heap check that cannot be measured, and a catalog admitted
  // again on every request. Each has to be refused by name.
  //
  // Both run alone. Several of the budgets are growth ratios of wall-clock medians, and a median
  // taken while other stages hold the processors measures them as well: the planted quadratic
  // `variants-rescanned` reads 14.1x against a limit of 9x with nothing beside it, and passed with
  // twelve stages running. A reading the load can move is evidence only of the load.
  {
    id: 'verify:cost-budget:self-test',
    reads: ['consumer:package', 'dist:runtime', 'source:packages'],
    exclusive: true,
  },
  {
    id: 'verify:cost-budget',
    reads: ['consumer:package', 'dist:runtime'],
    exclusive: true,
    needs: [
      {
        on: 'verify:cost-budget:self-test',
        why: 'A budget nobody has seen refuse an unmeasured check or a regressed cost is indistinguishable from one that measures nothing.',
      },
    ],
  },
  // What a new project costs Equator between `equator init` and its second scope, run cold against
  // the installed toolkit rather than against the workspace. It reads that consumer and writes
  // nothing it does not create itself, under `tmp/cold-start`, which is nested and so is not an
  // artefact any other stage can see.
  //
  // Its own stage rather than a case inside `verify:packages`: that stage reads `dist/toolkit`, and
  // a staged package cannot run its own CLI. Nothing resolves its dependencies in place. The only
  // toolkit that can execute the six commands is the installed one, and that is a different input.
  { id: 'verify:cold-start', reads: ['consumer:package'] },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:cost-reference:self-test',
    reads: [
      'consumer:focused',
      'consumer:package',
      'dist:runtime',
      'dist:toolkit',
      'source:docs',
      'source:packages',
    ],
  },
  // The production builds the two consumer stages leave behind are what the page measures, so it
  // waits for both rather than building a third application of its own.
  {
    id: 'verify:cost-reference',
    reads: [
      'consumer:focused',
      'consumer:package',
      'dist:runtime',
      'dist:toolkit',
      'source:docs',
      'source:packages',
    ],
    needs: [
      {
        on: 'verify:cost-reference:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
    ],
  },
  // The published documents, assembled into applications and run. Every fenced block names the file
  // it is, and the READMEs' files are one consumer: the providers, the route table, the switcher,
  // both catalogs and the spec. It ends at the spec, so a README whose blocks compile into an
  // application that renders nothing is still red.
  //
  // Every page under `docs/` is its own consumer on a copy of that one, because a guide shows the
  // configuration its reader would have rather than one carrying every capability. That is the
  // stage's cost: the base installs and runs once, and the pages are built and tested four at a
  // time on copies of it.
  //
  // It reads the two distributables because the consumers install from them, and `docs` and
  // `packages` because the documents are the thing under test. Its own tree under `tmp` is nested,
  // so it is not an artefact any other stage can see.
  {
    id: 'verify:document-blocks',
    processors: 4,
    reads: ['dist:runtime', 'dist:toolkit', 'source:docs', 'source:packages'],
  },
  // The one check in this list whose cases Equator did not write. It compiles each of the working
  // group's MessageFormat 2 cases with the installed toolkit and evaluates it through the built
  // runtime.
  // "What compiles, renders", as an invariant rather than as cases. Every option in the built-in
  // table, at every declared value, compiled by the installed toolkit and rendered by the built
  // runtime: nothing accepted may throw, and nothing accepted may render exactly as it would
  // without the option. Its cases are generated from the table both halves read, so a function that
  // gains an option contributes its cases on the day it lands.
  {
    id: 'verify:message-function-space',
    reads: ['consumer:package', 'dist:runtime', 'source:tools'],
  },
  // Runs the stage below over a copy of what it reads, once unchanged and once per defect
  // `stage-plants.ts` plants for it, and requires each to be refused by name. The copy is a folder
  // of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:message-format-conformance:self-test',
    reads: [
      'consumer:package',
      'dist:runtime',
      'source:packages',
      'source:tools',
    ],
    writes: ['report:temp'],
  },
  {
    id: 'verify:message-format-conformance',
    reads: ['consumer:package', 'dist:runtime', 'source:tools'],
    writes: ['report:temp'],
    needs: [
      {
        on: 'verify:message-format-conformance:self-test',
        why: 'A stage nobody has seen refuse the defects it exists for is indistinguishable from one that reads nothing.',
      },
      {
        on: 'verify:standards-sources',
        why: 'A suite from another revision tests another specification and reports the difference as a defect. No artefact passes between them, so no measurement can find this edge.',
      },
    ],
  },
  // Before the browser rows rather than beside them, and a prerequisite of every one rather than a
  // peer. It watches the assurance verifier die on a deliberate escape, which is the only way
  // to know that file reports anything at all: importing the consumer's server bundle installs
  // Angular's log-only global error handlers, and for as long as they were the last word every
  // assertion outside that file's own `try` printed and exited 0. The gate ran green over a consumer
  // built with the wrong locale set, twice, and looked no different from a real pass.
  {
    id: 'verify:browser-assurance:self-test',
    reads: ['consumer:package', 'source:packages', 'source:tools'],
  },
  // The browser rows run alone: serial among themselves and not overlapped with anything else
  // either. Like the cost budget's, this exclusion is declared rather than derived: they share no
  // artefact, and what they contend for is the machine's browsers, which no read or write records.
  //
  // Alone rather than merely serial, because that is what the evidence covers. The Firefox row's
  // arming failure measures 3 in 40, [0.026, 0.199], on the row run by itself, and a rate measured
  // under one load says nothing about the same row under another. A browser row that started
  // failing because six consumer installs were running beside it would look exactly like the flake
  // already being chased, and would be attributed to it. Letting these overlap non-browser work
  // costs a re-measured 40-set, not a change to this line.
  {
    id: 'verify:browser-assurance',
    reads: ['consumer:package', 'source:packages'],
    exclusive: true,
    claims: true,
    needs: [
      {
        on: 'verify:browser-assurance:self-test',
        why: 'If the control stops proving what it proves, this reports skipped, the truth, rather than passing on evidence nothing has checked.',
      },
    ],
  },
  {
    id: 'verify:browser-assurance:angular-22.0.4',
    reads: ['consumer:angular-22.0.4', 'source:packages'],
    exclusive: true,
    claims: true,
    needs: [
      {
        on: 'verify:browser-assurance:self-test',
        why: 'Every row shares the listeners the self-test exercises, so one run covers them.',
      },
    ],
  },
  {
    id: 'verify:browser-assurance:lower-bounds',
    reads: ['consumer:lower-bounds', 'source:packages'],
    exclusive: true,
    claims: true,
    needs: [
      {
        on: 'verify:browser-assurance:self-test',
        why: 'Every row shares the listeners the self-test exercises, so one run covers them.',
      },
    ],
  },
  {
    id: 'verify:browser-assurance:strict',
    reads: ['consumer:strict', 'source:packages'],
    exclusive: true,
    claims: true,
    needs: [
      {
        on: 'verify:browser-assurance:self-test',
        why: 'Every row shares the listeners the self-test exercises, so one run covers them.',
      },
    ],
  },
  ...['default-locale-prefix', 'locale-neutral', 'locale-host'].map(
    (policy) => ({
      id: `verify:browser-assurance:${policy}`,
      reads: [`consumer:${policy}`, 'source:packages'],
      exclusive: true,
      claims: true,
      needs: [
        {
          on: 'verify:browser-assurance:self-test',
          why: 'Every row shares the listeners the self-test exercises, so one run covers them.',
        },
      ],
    }),
  ),
  // The specs that claim a testing helper or call the locale matcher, run in each engine through the
  // test builder's browser mode. Alone for the reason the browser rows are. A writer of the
  // development seat, because the pseudo-locale spec reads what `equator generate --pseudo` writes
  // there, and the stage generates the production output again after the run.
  {
    id: 'verify:browser-specs',
    writes: ['consumer:package'],
    exclusive: true,
    claims: true,
  },
  // Before `verify:matrix` for the reason `verify:browser-assurance:self-test` is before the browser
  // rows. It plants each thing the matrix must refuse (a claim taken away, a reason over an
  // exercised cell, a claim for a capability its check never names, a stage's evidence missing, a
  // claim from a test that failed) and requires the matrix to go red naming it. Its planted suite
  // runs in a folder of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:matrix:self-test',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
  },
  // Every capability against every context, filled only by claims the stages above recorded. It
  // reads every stage's claims, so it runs after the last of them, and a stage that failed leaves it
  // skipped, which is the truth, rather than green on a matrix missing that stage's evidence.
  // `dist` because the rows are what the built packages publish; `source:packages` and
  // `source:tools` because each claim is read again in the check that made it.
  {
    id: 'verify:matrix',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    readsClaims: true,
    needs: [
      {
        on: 'verify:matrix:self-test',
        why: 'A matrix nobody has seen refuse a missing claim is indistinguishable from one that reads no claims at all.',
      },
    ],
  },
  // Rewrites the built packages with `.package-refresh` siblings and re-hands them to the
  // consumer. Under the list it declared only `verify:consumer` and worked solely because it was
  // written second to last; the three writes below are why that placement was load-bearing.
  {
    id: 'verify:consumer-refresh',
    processors: 2,
    writes: ['consumer:package', 'dist:runtime', 'dist:toolkit'],
  },
  // Last, and now derivably so: it writes source, `dist` and the consumers, so every stage above
  // reads something it replaces. It rebuilds the package and re-hands it once per injection, which
  // makes it most of the gate on its own. An injection that names a consumer stage runs that stage,
  // so the consumers those stages write are written here too.
  {
    id: 'verify:assurance:runtime',
    processors: 4,
    minimumProcessors: 2,
    privateTree: true,
    reads: ['cache:build'],
    writes: [
      'consumer:focused',
      'consumer:locale-neutral',
      'consumer:package',
      'dist:other',
      'dist:runtime',
      'dist:toolkit',
      'source:packages',
    ],
    // The 203 injections took about 8,200s between them when each was measured on its own, so the
    // bound is a little over three times that.
    timeoutSeconds: 26_000,
  },
]);

/** A stage id as a file name. Colons are not allowed in one on Windows. */
export const safeName = (id: string): string => id.replace(/:/gu, '-');

/** The artefact a claiming stage writes its claims to, one per stage so no two stages share one. */
export const claimsArtefact = (id: string): string => `claims:${safeName(id)}`;

/** Where that artefact is, in the tree the stage runs in. */
export const claimsFile = (root: string, id: string): string =>
  resolve(root, 'tmp', 'capability-claims', `${safeName(id)}.jsonl`);

const { scripts } = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    'utf8',
  ),
) as { readonly scripts: Readonly<Record<string, string>> };

/** Whether a script runs a program under `tools/`, itself or through a `pnpm run` it chains. */
const runsTools = (name: string, trail: readonly string[] = []): boolean => {
  const script = scripts[name];
  if (script === undefined) {
    throw new Error(
      `${[...trail, name].join(' -> ')} is not a script in package.json, so the gate cannot run it.`,
    );
  }
  if (/(?:^|\s)(?:\.\/)?tools\//u.test(script)) return true;
  return [...script.matchAll(/\bpnpm run (\S+)/gu)].some(
    ([, next]) => !trail.includes(next!) && runsTools(next!, [...trail, name]),
  );
};

const claiming = declared.filter(({ claims }) => claims === true);
const position = new Map(declared.map(({ id }, index) => [id, index]));

for (const reader of declared.filter(({ readsClaims }) => readsClaims)) {
  for (const producer of claiming) {
    // Edges only point backwards in the written order, so a producer written after its reader would
    // be ordered after it too, and the reader would read a file that did not exist yet.
    if (position.get(producer.id)! > position.get(reader.id)!) {
      throw new Error(
        `${producer.id} records claims and is written after ${reader.id}, which reads them. Move it above.`,
      );
    }
  }
}
for (const producer of claiming) {
  // A private tree is removed with its files, and the reader runs in the shared one.
  if (producer.privateTree === true) {
    throw new Error(
      `${producer.id} records claims in a private tree, where ${claimsArtefact(producer.id)} is never read.`,
    );
  }
}

export const steps: readonly Stage[] = Object.freeze(
  declared.map((step): Stage => {
    const reads = new Set(step.reads ?? []);
    if (runsTools(step.id)) reads.add('source:tools');
    if (step.readsClaims === true) {
      for (const { id } of claiming) reads.add(claimsArtefact(id));
    }
    return Object.freeze({
      ...step,
      reads: [...reads],
      ...(step.claims === true
        ? { writes: [...(step.writes ?? []), claimsArtefact(step.id)] }
        : {}),
    });
  }),
);
