/**
 * Writes, or with `--check` verifies, `docs/reference/cost.md`: what each published entry point
 * costs a consumer, what the generated contracts and the compiler produce, and what the packages
 * weigh.
 *
 * `specs/12-verification.spec.md` section 10 requires those measurements published, reproducible,
 * and per entry point. They are read from the production builds the consumer stages already run
 * with the Angular CLI, because that build links the partially compiled runtime and drops what
 * nothing reaches, and a bundle made any other way measures a graph no application ships. Each
 * published entry point is measured separately by the bytes its own module contributes to each
 * output, which the build's own metafile records per input.
 *
 * The figures are compared exactly. Compressed sizes depend on the zlib Node bundles, so the page
 * is written and checked only on the Node this repository develops on, and refused elsewhere.
 * Writing it is how a change to a cost is recorded; a check never writes.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { format, resolveConfig } from 'prettier';

import { readBuildStats } from './build-stats.mjs';
import { inputsRoot } from './stage-self-test.mjs';
import { developmentNode } from './supported-versions.mjs';

const workspaceRoot = inputsRoot();
const check = process.argv.includes('--check');
const pagePath = resolve(workspaceRoot, 'docs/reference/cost.md');

assert.equal(
  process.versions.node,
  developmentNode,
  `The cost page is measured on Node ${developmentNode}, whose zlib the compressed sizes depend on, and this is Node ${process.versions.node}.`,
);

/** The two consumers whose production builds are measured, and the stages that build them. */
const CONSUMERS = Object.freeze([
  {
    id: 'minimal',
    name: 'Minimal consumer',
    about:
      'selects the setup, one locale switcher and the recovery message, and nothing else',
    root: 'tmp/focused-package-consumer-verification/minimal-runtime-consumer',
    output: 'dist/minimal',
    stage: 'verify:focused-consumers',
  },
  {
    id: 'full',
    name: 'Full consumer',
    about:
      'selects routing, forms, server rendering, hydration and the request handler',
    root: 'tmp/package-consumer-verification/package-consumer',
    output: 'dist/feature-lab',
    stage: 'verify:consumer',
  },
]);

const runtimeRoot = resolve(workspaceRoot, 'dist/runtime');
const toolkitRoot = resolve(workspaceRoot, 'dist/toolkit');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const runtimeManifest = readJson(resolve(runtimeRoot, 'package.json'));

// Every published JavaScript entry point, read from the exports map so an entry added later is
// measured on the day it lands.
const ENTRY_POINTS = Object.entries(runtimeManifest.exports)
  .filter(
    ([, target]) =>
      typeof target === 'object' && /\.m?js$/u.test(target.default ?? ''),
  )
  .map(([subpath, target]) => ({
    specifier: `${runtimeManifest.name}${subpath.slice(1)}`,
    target: target.default.slice(2),
    file: resolve(runtimeRoot, target.default),
  }));
// How an input from the installed runtime ends, whichever store layout the package manager chose.
const installedAs = (target) =>
  `node_modules/${runtimeManifest.name}/${target}`;
assert.ok(
  ENTRY_POINTS.length > 1,
  'The runtime exports map names no JavaScript entry point. Run pnpm run build.',
);

const compressed = (bytes) => ({
  bytes: bytes.length,
  gzip: gzipSync(bytes, { level: 9 }).length,
  brotli: brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }).length,
});
const sum = (sizes) =>
  sizes.reduce(
    (total, size) => ({
      bytes: total.bytes + size.bytes,
      gzip: total.gzip + size.gzip,
      brotli: total.brotli + size.brotli,
    }),
    { bytes: 0, gzip: 0, brotli: 0 },
  );

function filesUnder(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/* ------------------------------------------------------------------ *
 * One consumer's build.                                              *
 * ------------------------------------------------------------------ */

function measureConsumer(consumer) {
  const root = resolve(workspaceRoot, consumer.root);
  const stats = readBuildStats(resolve(root, consumer.output));
  assert.ok(
    stats !== undefined,
    `${relative(workspaceRoot, resolve(root, consumer.output))} holds no build stats. Run pnpm run ${consumer.stage} first.`,
  );
  const builder = readJson(
    resolve(root, 'node_modules/@angular/build/package.json'),
  ).version;

  const resolved = (input) =>
    ENTRY_POINTS.find(({ target }) => input.endsWith(installedAs(target)))
      ?.specifier;

  const outputs = Object.entries(stats.outputs).filter(([name]) =>
    /\.m?js$/u.test(name),
  );
  const browserEntry = outputs.find(
    ([, output]) => output.entryPoint === 'src/main.ts',
  );
  assert.ok(browserEntry, `${consumer.name}: the build has no browser entry.`);
  const initial = new Set();
  const pending = [browserEntry[0]];
  while (pending.length > 0) {
    const name = pending.pop();
    if (initial.has(name)) continue;
    initial.add(name);
    for (const { path, kind } of stats.outputs[name].imports ?? []) {
      if (kind === 'import-statement' && stats.outputs[path])
        pending.push(path);
    }
  }
  const groupOf = (name) =>
    name.endsWith('.mjs') ? 'server' : initial.has(name) ? 'initial' : 'lazy';
  const fileOf = (name) =>
    resolve(
      root,
      consumer.output,
      name.endsWith('.mjs') ? 'server' : 'browser',
      name,
    );

  const groups = { initial: [], lazy: [], server: [] };
  const perEntry = Object.fromEntries(
    ENTRY_POINTS.map(({ specifier }) => [
      specifier,
      { initial: 0, lazy: 0, server: 0 },
    ]),
  );
  const generated = { initial: 0, catalogs: [] };
  for (const [name, output] of outputs) {
    const group = groupOf(name);
    groups[group].push(compressed(readFileSync(fileOf(name))));
    for (const [input, { bytesInOutput }] of Object.entries(
      output.inputs ?? {},
    )) {
      const entry = resolved(input);
      if (entry !== undefined) perEntry[entry][group] += bytesInOutput;
      if (group === 'initial' && input.startsWith('src/generated/')) {
        generated.initial += bytesInOutput;
      }
    }
    // A catalog chunk is one scope in one locale; the path segment before the scope is the
    // configuration's digest, which says nothing a reader needs.
    const catalog =
      /^src\/generated\/i18n\/catalogs\/[^/]+\/([^/]+)\/([^/]+)\.ts$/u.exec(
        output.entryPoint ?? '',
      );
    if (group === 'lazy' && catalog) {
      generated.catalogs.push({
        scope: catalog[1],
        locale: catalog[2],
        size: compressed(readFileSync(fileOf(name))),
      });
    }
  }
  generated.catalogs.sort((a, b) =>
    `${a.scope} ${a.locale}` < `${b.scope} ${b.locale}` ? -1 : 1,
  );

  const generatedFiles = filesUnder(resolve(root, 'src/generated/i18n'));
  return {
    ...consumer,
    builder,
    totals: Object.fromEntries(
      Object.entries(groups).map(([group, sizes]) => [
        group,
        { files: sizes.length, ...sum(sizes) },
      ]),
    ),
    perEntry,
    generated,
    compiler: {
      files: generatedFiles.length,
      bytes: generatedFiles.reduce(
        (total, file) => total + readFileSync(file).length,
        0,
      ),
    },
  };
}

const consumers = CONSUMERS.map(measureConsumer);
// Both consumers bootstrap through the primary entry point, so a build in which it contributes
// nothing is an attribution that matched no input, and every figure beside it would be zero too.
for (const { name, perEntry } of consumers) {
  assert.ok(
    perEntry[runtimeManifest.name].initial > 0,
    `${name}: no input of the build was attributed to ${runtimeManifest.name}.`,
  );
}
const builders = new Set(consumers.map(({ builder }) => builder));
assert.equal(
  builders.size,
  1,
  `The consumers were built with different Angular CLI versions: ${[...builders].join(', ')}.`,
);

/* ------------------------------------------------------------------ *
 * The page.                                                          *
 * ------------------------------------------------------------------ */

const number = (value) => value.toLocaleString('en-US');
const triple = ({ bytes, gzip, brotli }) =>
  `${number(bytes)} | ${number(gzip)} | ${number(brotli)}`;
const lines = [];
const line = (text = '') => lines.push(text);

line('# Cost');
line();
line(
  'What each entry point adds to an application, what the generated contracts and the compiler produce, and what the packages weigh. Every figure is in bytes.',
);
line();
line('This page is generated from the packages and is not edited by hand.');
line();
line('## How it is measured');
line();
line(
  `Two applications install the built packages and are built for production with the Angular CLI (\`@angular/build\` ${[...builders][0]}), which links the partially compiled runtime and removes what nothing reaches. Compressed sizes are gzip at level 9 and Brotli at quality 11, per file, on Node ${developmentNode}.`,
);
line();
for (const consumer of consumers) {
  line(`- ${consumer.name}: ${consumer.about}.`);
}
line();
line(
  'The initial files are the browser entry and every file it imports statically. Lazy files are the other browser files, and server files are the server build.',
);
line();
line('## Entry points');
line();
line(
  "The bytes of each entry point's own module in each build, before compression, as the build's metafile attributes them. An entry point that reaches another counts only its own bytes.",
);
line();
line(
  `| Entry point | ${consumers
    .flatMap(({ name }) => [
      `${name}, initial`,
      `${name}, lazy`,
      `${name}, server`,
    ])
    .join(' | ')} |`,
);
line(
  `| --- | ${consumers.flatMap(() => ['---:', '---:', '---:']).join(' | ')} |`,
);
for (const { specifier } of ENTRY_POINTS) {
  line(
    `| \`${specifier}\` | ${consumers
      .flatMap(({ perEntry }) => [
        perEntry[specifier].initial,
        perEntry[specifier].lazy,
        perEntry[specifier].server,
      ])
      .map(number)
      .join(' | ')} |`,
  );
}
line();
// Read from the published bundle rather than the generated sources, so the figure is what an
// application receives and the stage reads nothing it does not already read.
const runtimeBundle = readFileSync(
  resolve(workspaceRoot, 'dist/runtime/fesm2022/neolorn-equator.mjs'),
  'utf8',
);
const tableLiteral = (name) => {
  const head = `const ${name} = Object.freeze(`;
  const start = runtimeBundle.indexOf(head);
  assert.ok(start !== -1, `${name} is not in the runtime bundle.`);
  let depth = 0;
  for (
    let index = start + head.length;
    index < runtimeBundle.length;
    index += 1
  ) {
    const character = runtimeBundle[index];
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return runtimeBundle.slice(start, index + 1);
  }
  throw new Error(`${name} does not close in the runtime bundle.`);
};
const LOCALE_TABLES = [
  {
    names: [
      'PARENT_LOCALES',
      'COLLATION_PARENT_LOCALES',
      'PLURAL_PARENT_LOCALES',
      'SEGMENTATION_PARENT_LOCALES',
    ],
    about: 'The parent locales of the pinned CLDR release, for each component',
  },
  {
    names: ['LIKELY_SCRIPTS'],
    about: 'The likely script of each language the host may have data for',
  },
];

line('## Locale data in the runtime');
line();
line(
  "The tables the formatters walk where a context names a locale the host has no data for, generated from the pinned CLDR release and measured as they stand in the primary entry point's module. They are why such a locale is written the same way on every host, and they count toward that entry point.",
);
line();
line('| Table | Bytes | gzip | Brotli |');
line('| --- | ---: | ---: | ---: |');
for (const { names, about } of LOCALE_TABLES) {
  line(
    `| ${about} | ${triple(compressed(Buffer.from(names.map(tableLiteral).join('\n'))))} |`,
  );
}
line();
line('## Applications');
line();
line(
  'Everything each build emits, including Angular and the application itself.',
);
line();
line('| Application | Part | Files | Bytes | gzip | Brotli |');
line('| --- | --- | ---: | ---: | ---: | ---: |');
for (const consumer of consumers) {
  for (const group of ['initial', 'lazy', 'server']) {
    const total = consumer.totals[group];
    line(
      `| ${consumer.name} | ${group} | ${number(total.files)} | ${triple(total)} |`,
    );
  }
}
line();
line('## Generated contracts');
line();
line(
  'The generated code in the initial files, and each lazily loaded catalog: one scope in one locale.',
);
line();
for (const consumer of consumers) {
  line(`### ${consumer.name}`);
  line();
  line(
    `Generated code in the initial files: ${number(consumer.generated.initial)} bytes.`,
  );
  line();
  line('| Scope | Locale | Bytes | gzip | Brotli |');
  line('| --- | --- | ---: | ---: | ---: |');
  for (const { scope, locale, size } of consumer.generated.catalogs) {
    line(`| ${scope} | ${locale} | ${triple(size)} |`);
  }
  line();
}
line('## Compiler output');
line();
line(
  'What `equator generate` writes for each application. A second run over unchanged inputs writes nothing, which the consumer stages assert.',
);
line();
line('| Application | Files | Bytes |');
line('| --- | ---: | ---: |');
for (const consumer of consumers) {
  line(
    `| ${consumer.name} | ${number(consumer.compiler.files)} | ${number(consumer.compiler.bytes)} |`,
  );
}
line();
line('## Packages');
line();
line(
  'Each entry point as published, unminified, and each package as installed, source maps and declarations included.',
);
line();
line('| Entry point | Bytes | gzip | Brotli |');
line('| --- | ---: | ---: | ---: |');
for (const { specifier, file } of ENTRY_POINTS) {
  line(`| \`${specifier}\` | ${triple(compressed(readFileSync(file)))} |`);
}
line();
line('| Package | Files | Bytes |');
line('| --- | ---: | ---: |');
for (const packageRoot of [runtimeRoot, toolkitRoot]) {
  const files = filesUnder(packageRoot);
  line(
    `| \`${readJson(resolve(packageRoot, 'package.json')).name}\` | ${number(files.length)} | ${number(
      files.reduce((total, file) => total + readFileSync(file).length, 0),
    )} |`,
  );
}

const page = await format(`${lines.join('\n')}\n`, {
  ...((await resolveConfig(pagePath)) ?? {}),
  parser: 'markdown',
});

if (check) {
  assert.ok(
    existsSync(pagePath),
    'docs/reference/cost.md is missing. Run pnpm run generate:cost-reference.',
  );
  assert.equal(
    readFileSync(pagePath, 'utf8').replaceAll('\r\n', '\n'),
    page,
    'docs/reference/cost.md is not what the builds measure now. Run pnpm run generate:cost-reference.',
  );
  process.stdout.write(
    `Equator cost reference verified: ${ENTRY_POINTS.length} entry point(s) measured in ${consumers.length} production build(s).\n`,
  );
} else {
  await writeFile(pagePath, page, 'utf8');
  process.stdout.write(
    `Equator cost reference written: ${ENTRY_POINTS.length} entry point(s) measured in ${consumers.length} production build(s).\n`,
  );
}
