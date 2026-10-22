/**
 * A pseudo-locale is an ordinary generated locale, and it is absent unless asked for.
 *
 * Three of the five claims are proved here; the two that need a rendered page live in the
 * consumer fixture. What this file is responsible for:
 *
 * - **enabling requires no source change** (the project's TypeScript is written once, before any
 *   pseudo-locale exists, and never touched again;
 * - **a production build contains no pseudo-locale catalog**) asserted against the files
 *   `generate` actually wrote, with a control, not against the configuration that produced them;
 * - **the three behaviours combine freely**. Covered at the transform level in
 *   `interchange.test.ts`; what is added here is that configuration carries them through.
 *
 * The shape being defended is that nothing downstream knows the concept exists. A pseudo-locale
 * reaches the compiler as a target catalog with a provider, a scope and a locale, and every stage
 * after that treats it as a translation, which is what makes the production guarantee an absence
 * rather than a guard that could be flipped.
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PSEUDO_LOCALE_BIDI,
  PSEUDO_LOCALE_ACCENTED,
  generateProject,
  parseConfiguration,
  type PseudoLocaleTransform,
} from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}

/** Every file under the generated root, keyed by file name. */
async function generatedFiles(
  root: string,
): Promise<ReadonlyMap<string, string>> {
  const generatedRoot = resolve(root, 'src/generated/i18n');
  const entries = await readdir(generatedRoot, {
    recursive: true,
    withFileTypes: true,
  });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    files.set(
      entry.name,
      await readFile(resolve(entry.parentPath, entry.name), 'utf8'),
    );
  }
  return files;
}

/** Every generated file as one string, for presence and absence assertions. */
async function generatedText(root: string): Promise<string> {
  return [...(await generatedFiles(root)).values()].join('\n');
}

interface CompiledMessage {
  readonly messageId: string;
  readonly inputs: readonly unknown[];
}

interface CompiledCatalog {
  readonly key: { readonly catalogLocale: string };
  readonly applicationContractFingerprint: string;
  readonly messages: readonly CompiledMessage[];
}

/**
 * The compiled catalog module Equator wrote for one locale, read back as data.
 *
 * Read from the published artifact rather than from the compiler's return value, because the
 * question these tests ask is what a build produces, and a value returned in memory is not that.
 */
async function compiledCatalog(
  root: string,
  locale: string,
): Promise<CompiledCatalog> {
  const contents = (await generatedFiles(root)).get(`${locale}.ts`);
  expect(contents).toBeDefined();
  const body = (contents ?? '').slice(
    (contents ?? '').indexOf('{'),
    (contents ?? '').lastIndexOf('}') + 1,
  );
  return JSON.parse(body) as CompiledCatalog;
}

/**
 * A project whose source is written once and never edited again.
 *
 * `app.ts` is created here, before any pseudo-locale is configured, and no test below writes to it.
 * That is the no-source-change criterion made structural rather than asserted: a test that had to
 * edit the application to enable a pseudo-locale could not be written against this helper at all.
 */
async function createProject(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryRoots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@example/pseudo-fixture',
        version: '0.0.0',
        private: true,
        type: 'module',
        imports: {
          '#i18n': './src/generated/i18n/index.ts',
          '#i18n/*': './src/generated/i18n/*.ts',
        },
      },
      null,
      2,
    )}\n`,
  );
  const initialized = await initializeProject({
    project: root,
    configuration: {
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    },
  });
  expect(initialized.ok).toBe(true);
  await write(
    root,
    'i18n/shell/en-US.yaml',
    [
      'messages:',
      '  app-title: Notifications are unavailable right now',
      '  greeting: "Welcome, {$name}!"',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'i18n/shell/ar-EG.yaml',
    [
      'messages:',
      '  app-title: الإشعارات غير متاحة حاليا',
      '  greeting: "أهلا، {$name}!"',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'preserve',
          moduleResolution: 'bundler',
          resolvePackageJsonImports: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      '',
      'export const title = messages.appTitle.messageId;',
      '',
    ].join('\n'),
  );
  return root;
}

/** Declare the two shipped pseudo-locales. Configuration only; no source file is touched. */
async function declarePseudoLocales(root: string): Promise<void> {
  const path = resolve(root, 'equator.config.json');
  const existing = JSON.parse(await readFile(path, 'utf8')) as Record<
    string,
    unknown
  >;
  await writeFile(
    path,
    `${JSON.stringify(
      {
        ...existing,
        pseudoLocales: {
          [PSEUDO_LOCALE_ACCENTED]: { lengthFactor: 0.4, markers: true },
          [PSEUDO_LOCALE_BIDI]: {
            lengthFactor: -0.4,
            markers: true,
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

describe('pseudo-locales are generated rather than authored', () => {
  it('adds them to the locale table from configuration alone', async () => {
    const root = await createProject('pseudo-on-');
    await declarePseudoLocales(root);

    const generated = await generateProject({
      project: root,
      pseudoLocales: true,
    });
    if (!generated.ok) {
      console.log(JSON.stringify(generated.diagnostics, null, 2));
    }
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    const output = await generatedText(root);
    expect(output).toContain(PSEUDO_LOCALE_ACCENTED);
    expect(output).toContain(PSEUDO_LOCALE_BIDI);

    // What "ordinary catalog" has to mean, checked rather than asserted in prose: the derived
    // catalog compiles to the same contract as the authored one. Same messages, same message ids,
    // and the same inputs on each, so the placeholder is still a structured node the renderer
    // can resolve, not text that happened to survive. A transform that accented the inside of
    // `{$name}` would produce a different input list here and fail this.
    const source = await compiledCatalog(root, 'en-US');
    for (const locale of [PSEUDO_LOCALE_ACCENTED, PSEUDO_LOCALE_BIDI]) {
      const pseudo = await compiledCatalog(root, locale);
      expect(pseudo.key.catalogLocale).toBe(locale);
      expect(pseudo.applicationContractFingerprint).toBe(
        source.applicationContractFingerprint,
      );
      expect(pseudo.messages.map(({ messageId }) => messageId)).toEqual(
        source.messages.map(({ messageId }) => messageId),
      );
      for (const [index, message] of pseudo.messages.entries()) {
        expect(message.inputs).toEqual(source.messages[index]?.inputs);
      }
    }

    // And the text did change, which is the other half: identical structure with identical text
    // would mean the transform never ran.
    const expanded = await compiledCatalog(root, PSEUDO_LOCALE_ACCENTED);
    expect(JSON.stringify(expanded.messages)).toContain('⟦');
    expect(JSON.stringify(expanded.messages)).not.toBe(
      JSON.stringify(source.messages),
    );
    claimCapability('cli:generate');
    claimCapability('capability:pseudo-locale');
  });

  it('names them in the generated configuration, for the server route table', async () => {
    const root = await createProject('pseudo-listed-');
    await declarePseudoLocales(root);

    const generated = await generateProject({
      project: root,
      pseudoLocales: true,
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    // In the order the locale table lists them.
    expect(await generatedText(root)).toContain(
      `  pseudoLocales: Object.freeze([${JSON.stringify(PSEUDO_LOCALE_BIDI)}, ${JSON.stringify(PSEUDO_LOCALE_ACCENTED)}]),`,
    );
    claimCapability('cli:generate');
    claimCapability('capability:pseudo-locale');
  });

  it('leaves no trace of them when the flag is absent', async () => {
    const root = await createProject('pseudo-off-');
    await declarePseudoLocales(root);

    // Same configuration, same sources, no flag. This is the production build.
    const generated = await generateProject({ project: root });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    const output = await generatedText(root);
    expect(output).not.toContain(PSEUDO_LOCALE_ACCENTED);
    expect(output).not.toContain(PSEUDO_LOCALE_BIDI);
    expect(output).not.toContain('⟦');
    // No list at all rather than an empty one, which the runtime refuses as one no build writes.
    expect(output).not.toContain('pseudoLocales');

    // The control, without which the three absences above prove only that the file was read. An
    // authored locale from the same configuration must be present in the same text.
    expect(output).toContain('ar-EG');
    claimCapability('cli:generate');
  });

  it('refuses a pseudo-locale that is also an authored locale', () => {
    const parsed = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
        pseudoLocales: { 'ar-EG': { lengthFactor: 0.4 } },
      }),
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.map(({ code }) => code)).toContain('EQ1004');
    claimCapability('capability:pseudo-locale');
  });

  it('refuses a pseudo-locale tag that is not a catalog locale identity', () => {
    const parsed = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
        pseudoLocales: { 'en-Arab-x-pscontr': { lengthFactor: -0.4 } },
      }),
    );
    expect(parsed.ok).toBe(false);

    // The control: the same configuration under a tag that is a catalog locale identity parses.
    // Without it this only shows that some part of the object was rejected.
    const accepted = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
        pseudoLocales: {
          [PSEUDO_LOCALE_BIDI]: { lengthFactor: -0.4 },
        },
      }),
    );
    expect(accepted.ok).toBe(true);
    claimCapability('capability:pseudo-locale');
  });

  /**
   * A tag that parses and still cannot be a pseudo-locale.
   *
   * `specs/10-compiler-and-tooling.spec.md` section 16. Each case is refused for one reason, and
   * the accepted tag in the case above is the control for all three.
   */
  const pseudoLocaleDeclaration = (
    tag: string,
    transform: PseudoLocaleTransform = { lengthFactor: 0.4 },
    sourceLocale = 'en-US',
  ) =>
    parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale,
        defaultLocale: sourceLocale,
        locales: [sourceLocale],
        pseudoLocales: { [tag]: transform },
      }),
    );

  const pseudoLocaleRefusal = (
    tag: string,
    transform?: PseudoLocaleTransform,
    sourceLocale?: string,
  ) => {
    const parsed = pseudoLocaleDeclaration(tag, transform, sourceLocale);
    return parsed.diagnostics
      .filter(({ code }) => code === 'EQ1008')
      .map(({ path, summary }) => ({ path, summary }));
  };

  it('refuses a pseudo-locale tag that names no script', () => {
    // The script is what carries the direction, so leaving it to be inferred leaves the direction
    // to whatever a platform infers for the language.
    const [refusal, ...rest] = pseudoLocaleRefusal('en-XA');
    expect(rest).toEqual([]);
    expect(refusal?.path).toEqual(['pseudoLocales', 'en-XA']);
    expect(refusal?.summary).toMatch(/names no script/u);
    claimCapability('capability:pseudo-locale');
  });

  it('refuses a pseudo-locale tag whose region is a real one', () => {
    // `GB` is a country, so this tag reads as British English to everything outside the build.
    // `XK` is private use and still has a meaning: CLDR gives it to Kosovo.
    for (const tag of ['en-Latn-GB', 'en-Latn-XK']) {
      const [refusal, ...rest] = pseudoLocaleRefusal(tag);
      expect(rest).toEqual([]);
      expect(refusal?.path).toEqual(['pseudoLocales', tag]);
      expect(refusal?.summary).toContain('XC to XJ or XL to XZ');
      expect(refusal?.summary).toContain('PSEUDO_LOCALE_ACCENTED');
    }
    claimCapability('capability:pseudo-locale');
  });

  it('refuses XB on a script written left to right', () => {
    // UTS #35 gives XB to English forced right to left, so this tag claims a direction it lacks.
    const [refusal, ...rest] = pseudoLocaleRefusal('en-Latn-XB');
    expect(rest).toEqual([]);
    expect(refusal?.path).toEqual(['pseudoLocales', 'en-Latn-XB']);
    expect(refusal?.summary).toMatch(/its script is written left to right/u);
    claimCapability('capability:pseudo-locale');
  });

  it('refuses XA on a script written right to left', () => {
    const [refusal, ...rest] = pseudoLocaleRefusal('en-Arab-XA');
    expect(rest).toEqual([]);
    expect(refusal?.path).toEqual(['pseudoLocales', 'en-Arab-XA']);
    expect(refusal?.summary).toMatch(/its script is written right to left/u);
    claimCapability('capability:pseudo-locale');
  });

  it('refuses XA where the text is not lengthened', () => {
    for (const transform of [{ markers: true }, { lengthFactor: -0.4 }]) {
      const [refusal, ...rest] = pseudoLocaleRefusal(
        PSEUDO_LOCALE_ACCENTED,
        transform,
      );
      expect(rest).toEqual([]);
      expect(refusal?.path).toEqual(['pseudoLocales', PSEUDO_LOCALE_ACCENTED]);
      expect(refusal?.summary).toMatch(/lengthFactor does not lengthen it/u);
    }
    claimCapability('capability:pseudo-locale');
  });

  it('refuses XA and XB where the source is not English', () => {
    // Both are defined as English, so a German pseudo-locale takes a region that claims nothing.
    for (const tag of ['de-Latn-XA', 'de-Arab-XB']) {
      const [refusal, ...rest] = pseudoLocaleRefusal(
        tag,
        { lengthFactor: 0.4 },
        'de-DE',
      );
      expect(rest).toEqual([]);
      expect(refusal?.path).toEqual(['pseudoLocales', tag]);
      expect(refusal?.summary).toMatch(/and it is in de\./u);
    }
    claimCapability('capability:pseudo-locale');
  });

  it('accepts any other combination under a region UTS #35 leaves free', () => {
    for (const [tag, transform, sourceLocale] of [
      ['en-Latn-XC', { lengthFactor: -0.4 }, 'en-US'],
      ['en-Latn-XZ', { markers: true }, 'en-US'],
      ['de-Latn-XJ', { lengthFactor: 0.4 }, 'de-DE'],
      ['de-Arab-XL', { lengthFactor: -0.4 }, 'de-DE'],
    ] as const) {
      const parsed = pseudoLocaleDeclaration(tag, transform, sourceLocale);
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.ok && parsed.value.pseudoLocales).toEqual({
        [tag]: transform,
      });
    }
    claimCapability('capability:pseudo-locale');
  });

  it('refuses a pseudo-locale tag in a language other than the source', () => {
    const [refusal, ...rest] = pseudoLocaleRefusal('ar-Arab-XB');
    expect(rest).toEqual([]);
    expect(refusal?.path).toEqual(['pseudoLocales', 'ar-Arab-XB']);
    expect(refusal?.summary).toMatch(/source locale is in en/u);
    claimCapability('capability:pseudo-locale');
  });

  it('round-trips the declaration through the configuration formatter', () => {
    const parsed = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
        pseudoLocales: {
          [PSEUDO_LOCALE_ACCENTED]: { lengthFactor: 0.4, markers: true },
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.pseudoLocales[PSEUDO_LOCALE_ACCENTED]).toEqual({
      lengthFactor: 0.4,
      markers: true,
    });
    claimCapability('capability:pseudo-locale');
  });
});
