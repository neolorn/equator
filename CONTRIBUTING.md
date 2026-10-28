# Contributing to Equator

Thank you for your interest in contributing to Equator. This document explains how the project is organized, how to set up a development environment, and what a contribution needs to look like to be merged.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Reporting bugs and requesting features](#reporting-bugs-and-requesting-features)
- [Development setup](#development-setup)
- [Running the checks](#running-the-checks)
- [Making a change](#making-a-change)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Documentation](#documentation)
- [Dependencies](#dependencies)
- [Releases](#releases)

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/neolorn/equator/issues/new/choose). For a bug, include the versions of `@neolorn/equator` and `@neolorn/equator-toolkit`, the Angular version, and the smallest reproduction you can provide: the catalog, the configuration, or the route involved.

For a feature, open an issue before writing code. Equator covers localization in general; a capability that only one application needs belongs in that application, and the issue is where that question is settled.

Do not report security vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## Development setup

Equator is a pnpm workspace with two packages, `packages/runtime` and `packages/toolkit`, and a set of consumer applications under `fixtures/` used for verification.

Requirements:

- Node.js on one of the supported lines listed in [Compatibility](docs/reference/compatibility.md)
- pnpm at the version declared in the `packageManager` field of `package.json`

Install and build:

```sh
pnpm install
pnpm run build
```

The verification suite drives real applications in Chromium, Firefox, and WebKit. Install the browser engines once:

```sh
pnpm exec playwright install chromium firefox webkit
```

## Running the checks

The quick checks take about a minute and a half on a machine with 32 logical processors, and cover formatting, linting, types, the anchors of the verification suite's injections, and the unit suites of both packages:

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run verify:injection-anchors
pnpm run test:toolkit
pnpm run test:runtime
```

The full verification suite builds both packages, installs them into consumer applications with pnpm and their packed tarballs into one with npm, runs those applications on three Angular versions and three browser engines, executes every code example in the documentation, and checks the generated reference pages against the packages:

```sh
pnpm run verify
```

It runs on Windows and Linux, and takes about two and a half hours on a machine with 32 logical processors, most of it in `verify:assurance:runtime`, which rebuilds the runtime once for each behavior it removes. Run it on the finished change before opening a pull request. If a stage cannot run in your environment, say so in the pull request.

To run some of its stages the way the suite runs them, name them:

```sh
node tools/verify.ts --only verify:consumer,verify:cost-reference
```

This runs the named stages and the stages they need, on the committed tree, in fresh work trees of its own. `node tools/verify.ts --plan` lists the stages. A stage that passes when its script is run in your checkout can still fail in the suite, which runs it in a fresh work tree without a terminal; this shows that before the full run does.

The suite runs below normal priority, except for the stages that run alone (the browser rows, `verify:browser-specs`, and `verify:cost-budget` with its self-test), which run at normal priority. It schedules at most two thirds of the machine's logical processors: the stages that run at once take shares that fit in that number, and each stage's test runners and builds are handed worker counts from its share. A stage that builds an Angular application cannot be held within fewer than two processors, or three with Angular 22.0: where two thirds of the machine is less than three, the suite schedules three, and a smaller setting is refused. Every Node process also runs helper threads beside its JavaScript that no setting holds, so the suite can use more processor time than it schedules; the summary reports each window where it does, by stage, and on Linux by thread. Set `EQUATOR_VERIFY_PROCESSORS` to a number of logical processors to give it a different share. Set `EQUATOR_VERIFY_PRIORITY_FILE` to a file to change the level while the suite runs: while the file holds the word `normal`, every stage runs at normal priority. On Linux, a process without privilege cannot raise a priority it has lowered, so there the word raises only the stages that start while the file holds it: a stage already below normal stays there, and a stage started at normal is lowered when the word is removed. It does not start a stage while less than a quarter of the machine's memory is free. Only one heavy job goes at a time: the suite, a run of named stages, and a mutation run (`pnpm run mutation`, `pnpm run mutation:toolkit`) take the same lock, and the second to start stops with the name of the first.

When a browser engine never finishes closing a page in a browser row, the suite closes that page's browser context instead and carries on. When the context does not close either, the suite closes that browser, ends its process if the browser's own close does not finish, and runs the rest of the row in a fresh one. The verdict line and the attempt ledger count each time it did either, so a rising rate shows there.

Three commands are maintenance rather than checks:

```sh
pnpm run clean
pnpm run refresh:consumer
pnpm run refresh:consumer-locks
```

`clean` deletes `dist/` and empties `tmp/`. Run it when a build output from an earlier state of the tree is being read by something that should be reading a fresh one, or to discard the work trees and consumer installs the verification suite leaves behind. The suite's attempt ledger stays, because nothing can rebuild it. `pnpm run clean dist` removes the build output alone.

`refresh:consumer` hands the consumer fixtures the packages that are in `dist/` right now. A fixture takes Equator as a `file:` dependency, which pnpm copies into its store, so a fixture that is already installed goes on running the build it was installed with until this runs.

`refresh:consumer-locks` regenerates the committed lockfiles of the consumer fixtures. It reaches the network, so run it when a fixture manifest or a dependency range changes and commit what it writes.

The suite fetches nothing while it runs, so what it installs and the Node releases it runs on have to be on the machine first. Three commands fetch them, and each reaches the network:

```sh
pnpm run stage:node-runtimes
pnpm run stage:consumer-store
pnpm run stage:npm-cache
```

`stage:node-runtimes` downloads, and checks against their published digests, the lowest release of each Node line the packages support and the release the repository develops on, into `.runtimes/node`. `stage:consumer-store` puts the packages of every committed `pnpm-lock.yaml` under `fixtures/` in the pnpm store. `stage:npm-cache` puts the packages of the npm consumer's `package-lock.json` in `.runtimes/npm-cache`, where the suite's npm install reads them. Run all three on a new machine, and the last two again after `refresh:consumer-locks`. `stage:consumer-store` reads the built packages, because the fixtures' lockfiles name them, so run `pnpm run build` before it.

## Making a change

The [specifications](specs/README.md) describe what Equator accepts, produces, and guarantees. Read the specification that owns the area you are changing before you change its behavior. If the specification is wrong, open an issue; the specification is corrected in the same change as the code.

A change is one coherent unit of work. Keep unrelated changes in separate commits and separate pull requests.

Do not commit:

- secrets, credentials, tokens, or local environment values;
- build output, caches, logs, or dependency directories;
- editor or operating system files.

Generated files are committed only where the repository treats them as source, and they are regenerated by the build; do not edit them by hand.

## Commit messages

Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<scope>): <description>

<body>
```

- `type` is one of `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`.
- `scope` is optional and names the area, for example `routing`, `toolkit`, or `specs`.
- The description is imperative, lowercase, and has no trailing period.
- The body explains what changed and why when the subject is not enough. A breaking change is described in the body, with the migration.

Examples:

```text
feat(routing): derive locale-neutral roots from the URL policy
fix(toolkit): report the parent scope when a message pointer does not resolve
docs: add the sitemap how-to
chore(release): 1.0.0
```

## Pull requests

- One purpose per pull request.
- The title is a valid commit subject; it becomes the subject of the squash commit.
- The description says what changed, why, how it was verified, and any migration a user needs.
- Link the related issue when there is one.

Pull requests are squash-merged onto `main`, which is the only long-lived branch and stays linear. Name topic branches `<type>/<short-description>`, for example `feat/parent-locale-fallback`. A maintainer commits to `main` directly under the same checks and the same commit convention, and the pull request path is how a change from outside the maintainers reaches it.

## Documentation

Documentation lives under `docs/` and follows the [Diátaxis](https://diataxis.fr) structure: a tutorial, how-to guides, reference pages, and explanation pages. Reference pages are generated from the packages and are not edited by hand.

Every code block in the documentation and in the READMEs is executed by the verification suite. A block that names a file is written into a real application; a page that writes a file carries a spec that must pass. Label every block with its destination.

For style, follow the [Google developer documentation style guide](https://developers.google.com/style): second person, present tense, active voice, American spelling.

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html): one section per version, newest first, entries grouped under Added, Changed, Deprecated, Removed, Fixed and Security, and each entry stating what a reader of the library meets.

## Dependencies

Equator's runtime has no dependencies beyond `tslib`, and the toolkit's dependencies are pinned to exact versions. Adding a dependency, a polyfill, or a use of an undocumented platform or compiler API is a project decision. Open an issue before proposing one.

## Releases

Releases are cut by the maintainers following [RELEASING.md](RELEASING.md). Version numbers follow [Semantic Versioning](https://semver.org); what a version promises is described in [Versioning and compatibility](docs/versioning.md).
