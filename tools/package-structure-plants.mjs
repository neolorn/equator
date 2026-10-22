/**
 * The defects `verify:packages` exists to refuse, each planted into a copy of what it reads.
 *
 * A plant edits the built packages, the workspace manifests or the entry point sources in that
 * copy, the way the defect would arrive there, and names the words the stage's refusal must carry.
 * `verify-stage-self-test.mjs` runs the stage over each one; the normative map names
 * a plant as `plant:verify:packages:<id>`.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { editJson, editText, replaceOnce } from './stage-self-test.mjs';

const runtimeManifest = 'dist/runtime/package.json';
const toolkitManifest = 'dist/toolkit/package.json';
const standardsLock = 'standards/sources.lock.json';

export const plants = Object.freeze([
  {
    id: 'toolkit-runs-work-on-install',
    plant: editJson(toolkitManifest, (manifest) => {
      manifest.scripts = { postinstall: 'equator generate' };
    }),
    refusal: /toolkit manifest runs postinstall on install/u,
  },
  {
    id: 'runtime-carries-a-private-rxjs',
    plant: editJson(runtimeManifest, (manifest) => {
      manifest.optionalDependencies = { rxjs: '7.8.1' };
    }),
    refusal: /runtime manifest carries optionalDependencies/u,
  },
  {
    id: 'toolkit-depends-on-a-workspace-tool',
    plant: editJson(toolkitManifest, (manifest) => {
      manifest.dependencies['@nx/devkit'] = '22.0.0';
    }),
    refusal: /@nx\/devkit/u,
  },
  {
    id: 'toolkit-exports-an-internal-module',
    plant: editJson(toolkitManifest, (manifest) => {
      manifest.exports['./static-analysis'] = './static-analysis.js';
    }),
    refusal: /\.\/static-analysis/u,
  },
  {
    id: 'toolkit-exports-every-module',
    plant: editJson(toolkitManifest, (manifest) => {
      manifest.exports['./*'] = './*.js';
    }),
    refusal: /'\.\/\*'/u,
  },
  {
    id: 'toolkit-dependency-left-to-float',
    plant: editJson(toolkitManifest, (manifest) => {
      manifest.dependencies.messageformat = '^4.0.0';
    }),
    refusal: /\^4\.0\.0/u,
  },
  {
    id: 'toolkit-dependency-left-for-the-consumer',
    plant: editJson(toolkitManifest, (manifest) => {
      delete manifest.dependencies.messageformat;
    }),
    refusal: /messageformat/u,
  },
  {
    id: 'runtime-depends-on-an-overlay-framework',
    plant: editJson(runtimeManifest, (manifest) => {
      manifest.dependencies['@angular/cdk'] = '^22.0.0';
    }),
    refusal: /@angular\/cdk/u,
  },
  {
    id: 'runtime-depends-on-a-locale-database',
    plant: editJson(runtimeManifest, (manifest) => {
      manifest.dependencies['cldr-core'] = '48.2.0';
    }),
    refusal: /cldr-core/u,
  },
  {
    id: 'runtime-depends-on-a-telemetry-library',
    plant: editJson(runtimeManifest, (manifest) => {
      manifest.dependencies['@opentelemetry/api'] = '1.9.0';
    }),
    refusal: /@opentelemetry\/api/u,
  },
  {
    id: 'runtime-dependency-moved-from-peer',
    plant: editJson(runtimeManifest, (manifest) => {
      manifest.dependencies.rxjs = '7.8.2';
    }),
    refusal: /rxjs/u,
  },
  {
    id: 'runtime-optional-peer-made-required',
    plant: editJson(runtimeManifest, (manifest) => {
      manifest.peerDependenciesMeta['@angular/ssr'].optional = false;
    }),
    refusal: /optional/u,
  },
  {
    id: 'runtime-primary-subdivided',
    plant: editJson(runtimeManifest, (manifest) => {
      manifest.exports['./extra'] = {
        default: './fesm2022/neolorn-equator.mjs',
      };
    }),
    refusal: /\.\/extra/u,
  },
  {
    id: 'runtime-declares-side-effects',
    plant: editJson(runtimeManifest, (manifest) => {
      manifest.sideEffects = true;
    }),
    refusal: /true !== false|sideEffects/u,
  },
  {
    id: 'standards-source-unpinned',
    plant: (root) =>
      editText(
        root,
        standardsLock,
        replaceOnce('cldr-core-48.2.0.tgz', 'cldr-core-latest.tgz'),
      ),
    refusal: /cldr-core-latest\.tgz/u,
  },
  {
    id: 'standards-edition-moved',
    plant: (root) =>
      editText(
        root,
        standardsLock,
        replaceOnce('"unicode": "17.0.0"', '"unicode": "16.0.0"'),
      ),
    refusal: /'16\.0\.0' !== '17\.0\.0'/u,
  },
  {
    id: 'standards-digest-not-the-installed-one',
    plant: editJson(standardsLock, (lock) => {
      const { value } = lock.dataSources.cldrJsonCore.digest;
      lock.dataSources.cldrJsonCore.digest.value = `${value.slice(0, 85)}${value[85] === 'A' ? 'Q' : 'A'}==`;
    }),
    refusal: /cldr-core@48\.2\.0 hashes to/u,
  },
  {
    id: 'runtime-bundle-carries-the-pseudo-transform',
    plant: (root) =>
      editText(
        root,
        'dist/runtime/fesm2022/neolorn-equator-testing.mjs',
        (text) =>
          `${text}\nexport const pseudoLocalizeMessage = (text) => text;\n`,
      ),
    refusal: /pseudo-localization marker "pseudoLocalizeMessage"/u,
  },
  {
    // Written the way a bundler may escape it, which is the form a literal comparison missed once.
    id: 'runtime-bundle-carries-a-pseudo-marker',
    plant: (root) =>
      editText(
        root,
        'dist/runtime/fesm2022/neolorn-equator-core.mjs',
        (text) => `${text}\nconst plantedMarker = '\\u27E6';\n`,
      ),
    refusal: /pseudo-localization marker "\u27e6"/u,
  },
  {
    id: 'runtime-ships-a-font',
    plant: async (root) => {
      await mkdir(resolve(root, 'dist/runtime/fonts'), { recursive: true });
      await writeFile(resolve(root, 'dist/runtime/fonts/plant.woff2'), 'wOF2');
    },
    refusal: /plant\.woff2 is a font/u,
  },
  {
    id: 'runtime-fetches-a-font',
    plant: (root) =>
      editText(
        root,
        'dist/runtime/fesm2022/neolorn-equator.mjs',
        (text) =>
          `${text}\nconst plantedFace = () => new FontFace('Planted', 'url(planted.woff2)');\n`,
      ),
    refusal: /neolorn-equator\.mjs loads a font through new FontFace/u,
  },
  {
    id: 'runtime-compiled-in-full',
    plant: (root) =>
      editText(root, 'dist/runtime/fesm2022/neolorn-equator.mjs', (text) =>
        text.replace('.ɵɵngDeclarePipe(', '.ɵɵdefinePipe('),
      ),
    refusal: /contains full-Ivy declarations/u,
  },
  {
    id: 'runtime-declaration-map-missing',
    plant: (root) =>
      rm(resolve(root, 'dist/runtime/types/neolorn-equator-core.d.ts.map')),
    refusal: /neolorn-equator-core\.d\.ts\.map/u,
  },
  {
    id: 'core-imports-node',
    plant: (root) =>
      editText(
        root,
        'dist/runtime/fesm2022/neolorn-equator-core.mjs',
        (text) => `import { readFileSync } from 'node:fs';\n${text}`,
      ),
    refusal: /imports Node built-in node:fs/u,
  },
  {
    id: 'server-entry-imports-the-toolkit',
    plant: (root) =>
      editText(
        root,
        'dist/runtime/fesm2022/neolorn-equator-ssr.mjs',
        (text) =>
          `${text}\nexport { generate } from '@neolorn/equator-toolkit';\n`,
      ),
    refusal: /imports toolkit module @neolorn\/equator-toolkit/u,
  },
  {
    id: 'core-declarations-import-angular',
    plant: (root) =>
      editText(
        root,
        'dist/runtime/types/neolorn-equator-core.d.ts',
        (text) => `export type { Signal } from '@angular/core';\n${text}`,
      ),
    refusal: /\.\/core is not Angular-free/u,
  },
  {
    id: 'http-declarations-import-the-primary',
    plant: (root) =>
      editText(
        root,
        'dist/runtime/types/neolorn-equator-http.d.ts',
        (text) =>
          `export type { Localization } from '@neolorn/equator';\n${text}`,
      ),
    refusal: /\.\/http imports the primary/u,
  },
  {
    id: 'core-published-twice',
    // In a block, because the bundle imports the name: a second declaration beside the import is
    // a syntax error, and the stage would then stop on loading the bundle and name no defect.
    plant: (root) =>
      editText(
        root,
        'dist/runtime/fesm2022/neolorn-equator-http.mjs',
        (text) => `${text}\n{\n  class LocalizationError extends Error {}\n}\n`,
      ),
    refusal: /LocalizationError must be defined in exactly one bundle/u,
  },
  {
    id: 'entry-point-reaches-into-another',
    plant: (root) =>
      editText(
        root,
        'packages/runtime/http/src/handler.ts',
        replaceOnce(
          "} from '@neolorn/equator/core';",
          "} from '../../core/src/public-api';",
        ),
      ),
    refusal:
      /reaches outside its entry point: \.\.\/\.\.\/core\/src\/public-api/u,
  },
  {
    id: 'host-profile-drifts-from-the-manifests',
    plant: (root) =>
      editText(
        root,
        'dist/toolkit/host-compatibility.js',
        replaceOnce(
          "angularCompiler: '>=22.0.0 <23.0.0',",
          "angularCompiler: '>=22.0.0 <24.0.0',",
        ),
      ),
    refusal: /toolkit host-admission profile disagrees/u,
  },
  {
    id: 'map-reference-machine-absolute',
    plant: (root) =>
      editText(
        root,
        'dist/toolkit/untrusted-text.js',
        replaceOnce(
          '//# sourceMappingURL=untrusted-text.js.map',
          '//# sourceMappingURL=/home/builder/untrusted-text.js.map',
        ),
      ),
    refusal: /machine-absolute: \/home\/builder\/untrusted-text\.js\.map/u,
  },
  {
    id: 'map-source-root-machine-absolute',
    plant: editJson('dist/toolkit/untrusted-text.js.map', (map) => {
      map.sourceRoot = '/';
    }),
    refusal: /sourceRoot is machine-absolute/u,
  },
  {
    id: 'map-embeds-no-sources',
    plant: editJson('dist/toolkit/untrusted-text.js.map', (map) => {
      delete map.sourcesContent;
    }),
    refusal:
      /names sources the package does not carry and embeds none of them/u,
  },
  {
    id: 'declaration-carries-a-local-path',
    plant: (root) =>
      editText(
        root,
        'dist/toolkit/untrusted-text.d.ts',
        (text) =>
          `/// ${root.replaceAll('\\', '/')}/packages/toolkit/src/untrusted-text.ts\n${text}`,
      ),
    refusal: /leaks machine-private path/u,
  },
]);
