// Drives the exports-map reader with manifests of its own. The built packages close no subpath, so
// the tools that list entry points meet no `null` target in the gate, and a reader that took one
// for an entry point would pass there until a package closed one.

import assert from 'node:assert/strict';

import { openSubpaths } from './exports-map.ts';

const listed = (exports: unknown) =>
  openSubpaths({ name: '@scope/pkg', exports }).map(
    ({ subpath, specifier, json }) => ({ subpath, specifier, json }),
  );

assert.deepEqual(
  listed({
    '.': { types: './index.d.ts', default: './index.mjs' },
    './internal': null,
    './forms': './forms.mjs',
    './hidden': { types: null, default: null },
    './nested': { node: { default: null }, default: null },
    './package.json': './package.json',
  }),
  [
    { subpath: '.', specifier: '@scope/pkg', json: false },
    { subpath: './forms', specifier: '@scope/pkg/forms', json: false },
    {
      subpath: './package.json',
      specifier: '@scope/pkg/package.json',
      json: true,
    },
  ],
  'a closed subpath was listed, or an open one was left out or reordered',
);

assert.deepEqual(
  listed({ './partly': { browser: null, default: './partly.mjs' } }),
  [{ subpath: './partly', specifier: '@scope/pkg/partly', json: false }],
  'a subpath closed under one condition and open under another was left out',
);

for (const name of [undefined, '', 3]) {
  assert.throws(
    () => openSubpaths({ name, exports: { '.': './index.mjs' } }),
    /names no package/u,
  );
}

for (const [exports, refusal] of [
  [undefined, /declares no exports map of subpaths/u],
  ['./index.mjs', /declares no exports map of subpaths/u],
  [{ import: './index.mjs' }, /"import", which is a condition/u],
  [{ './features/*': './features/*.mjs' }, /the pattern \.\/features\/\*/u],
  [{ './list': ['./a.mjs', './b.mjs'] }, /neither a path nor conditions/u],
  [{ './count': 3 }, /neither a path nor conditions/u],
] as const) {
  assert.throws(() => listed(exports), refusal);
}

console.log(
  'exports map self-test: closed subpaths skipped, open ones listed in order, every unreadable map refused',
);
