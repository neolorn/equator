import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONFIGURATION_SCHEMA, parseConfiguration } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';
// Direct, because the flag parser is beside the CLI rather than published from it: widening the
// package's API so a test can reach it would trade the thing being protected for the protection.
import {
  INIT_HELP,
  INIT_INVOCATION,
  INIT_OPTIONS,
} from '../src/cli-options.generated.js';
import {
  applyInitOption,
  initOptionForFlag,
  InvocationError,
} from '../src/init-options.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

/**
 * Can `equator init` state everything `equator.config.json` accepts?
 *
 * An option `equator init` does not accept is unreachable from the install line, and the project
 * produced without it is *valid*, so nothing fails and nothing says anything; a consumer meets the
 * field by reading Equator's source or by failing at runtime.
 *
 * A hand-written option list goes stale on the next key the schema gains, so the option set is not
 * a list that agrees with `CONFIGURATION_SCHEMA`; it is generated from it, and `verify:cli-options`
 * fails when the checked-in table and the schema have drifted apart. **The first two tests below
 * are the ones that cannot go stale**, they are written against the schema rather than against six
 * names, and everything after them is about the conventions that turn a key into something a person
 * can type.
 */

const option = (key: string) => {
  const found = INIT_OPTIONS.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`no init option for ${key}`);
  return found;
};

function collect(...pairs: readonly (readonly [string, string])[]) {
  const target: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const [flag, text] of pairs) {
    const descriptor = initOptionForFlag(flag);
    if (descriptor === undefined) throw new Error(`no init flag ${flag}`);
    applyInitOption(target, descriptor, text);
  }
  return target;
}

describe('the option set is the configuration schema', () => {
  it('offers a flag for every settable key, and for nothing else', () => {
    // Read from the schema, not listed here. A key added to the parser makes this fail until it has
    // a flag, which is the whole mechanism: six names written out below would agree today and go
    // quiet on the seventh.
    const settable = Object.entries(CONFIGURATION_SCHEMA.properties)
      .filter(
        ([, property]) =>
          (property as { readonly const?: unknown }).const === undefined,
      )
      .map(([key]) => key)
      .sort();
    expect(settable.length).toBeGreaterThan(0);
    expect([...INIT_OPTIONS].map(({ key }) => key).sort()).toEqual(settable);
  });

  it('names every one of them in --help and in the complete invocation', () => {
    // The two places a person finds out a field exists. Both were written by hand beside a parser
    // that had moved on, and both named four fields while the file accepted six.
    for (const { flag, description } of INIT_OPTIONS) {
      expect(INIT_HELP).toContain(flag);
      expect(INIT_HELP).toContain(description);
      expect(INIT_INVOCATION).toContain(flag);
    }
    // The control for the two assertions above: a flag that is not offered must not appear, or
    // `toContain` would be passing on a string that says everything.
    expect(INIT_HELP).not.toContain('--invented-locale');
    expect(INIT_INVOCATION).not.toContain('--invented-locale');
  });

  it('writes all six fields into a project, through one serializer', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'init-options-'));
    await writeFile(
      resolve(root, 'package.json'),
      `${JSON.stringify({ name: 'init-options-lab', private: true }, null, 2)}\n`,
      'utf8',
    );
    const initialized = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
        personNameLocales: ['ja'],
        pseudoLocales: { 'en-Latn-XA': { lengthFactor: 0.3, markers: true } },
        aliases: { eg: 'ar-EG' },
      },
    });
    expect(initialized.ok, JSON.stringify(initialized, null, 2)).toBe(true);
    if (!initialized.ok) return;

    // Read back off disk rather than off the result, because what matters is what gets written.
    const written = await readFile(
      resolve(root, 'equator.config.json'),
      'utf8',
    );
    const reparsed = parseConfiguration(written);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.value.personNameLocales).toEqual(['ja']);
    expect(reparsed.value.pseudoLocales).toEqual({
      'en-Latn-XA': { lengthFactor: 0.3, markers: true },
    });
    expect(reparsed.value.aliases).toEqual({ eg: 'ar-EG' });
    claimCapability('cli:init');
  });

  it('says what to type when a required field is missing', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'init-options-'));
    await writeFile(
      resolve(root, 'package.json'),
      `${JSON.stringify({ name: 'init-options-lab', private: true }, null, 2)}\n`,
      'utf8',
    );
    const attempted = await initializeProject({
      project: root,
      configuration: { sourceLocale: 'en-US' },
    });
    expect(attempted.ok).toBe(false);
    if (attempted.ok) return;
    const refusal = attempted.diagnostics.find(({ code }) => code === 'EQ1701');
    expect(refusal?.summary).toContain('--default-locale <locale>');
    expect(refusal?.summary).toContain('--locale <locale> (repeat for each)');
    // The one that was supplied is not asked for again.
    expect(refusal?.summary).not.toContain('--source-locale');
    claimCapability('cli:init');
  });

  it("adds its entries to package.json in the application's own indentation", async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'init-options-'));
    await writeFile(
      resolve(root, 'package.json'),
      `${JSON.stringify({ name: 'init-options-lab', private: true }, null, 4)}\n`,
      'utf8',
    );
    const initialized = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
    });
    expect(initialized.ok, JSON.stringify(initialized, null, 2)).toBe(true);

    const written = await readFile(resolve(root, 'package.json'), 'utf8');
    expect(written).toMatch(/^\{\n {4}"name": "init-options-lab",\n/u);
    expect(written).toMatch(/^ {8}"#i18n": /mu);
    expect(written).not.toMatch(/^ {2}"/mu);
    claimCapability('cli:init');
  });
});

describe('one convention, at every depth a value has', () => {
  it('takes a scalar once and a list as often as it is given', () => {
    expect(
      collect(
        ['--source-locale', 'en-US'],
        ['--locale', 'en-US'],
        ['--locale', 'ar-EG'],
        ['--person-name-locale', 'ja'],
      ),
    ).toEqual({
      sourceLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
      personNameLocales: ['ja'],
    });
    expect(() =>
      collect(['--source-locale', 'en-US'], ['--source-locale', 'ar-EG']),
    ).toThrow(InvocationError);
  });

  it('reads one path segment beneath a map of scalars', () => {
    expect(collect(['--alias', 'eg=ar-EG'], ['--alias', 'us=en-US'])).toEqual({
      aliases: { eg: 'ar-EG', us: 'en-US' },
    });
    expect(() =>
      collect(['--alias', 'eg=ar-EG'], ['--alias', 'eg=en-US']),
    ).toThrow(/sets "eg" more than once/u);
    expect(() => collect(['--alias', 'ar-EG'])).toThrow(
      /--alias takes <alias>=<locale>/u,
    );
  });

  it('reads two beneath a map of objects, and the entry on its own', () => {
    expect(
      collect(
        ['--pseudo-locale', 'en-Latn-XA.lengthFactor=0.3'],
        ['--pseudo-locale', 'en-Latn-XA.markers=true'],
        ['--pseudo-locale', 'en-Arab-XB'],
      ),
    ).toEqual({
      pseudoLocales: {
        'en-Latn-XA': { lengthFactor: 0.3, markers: true },
        // Both options are optional, so an entry with none is a thing to ask for rather than an
        // incomplete invocation. The transform's own defaults then apply, which is what the
        // absent keys mean.
        'en-Arab-XB': {},
      },
    });
  });

  it('refuses a value the schema would have refused later', () => {
    // The point of converting here rather than in the configuration parser. `Number("")` is `0`,
    // `Number("x")` is `NaN`, and `Boolean("false")` is `true`: all three would reach the file as
    // a plausible-looking value, and the last one switches on the setting it was asked to switch
    // off.
    expect(() =>
      collect(['--pseudo-locale', 'en-Latn-XA.markers=yes']),
    ).toThrow(/takes true or false, and received "yes"/u);
    expect(() =>
      collect(['--pseudo-locale', 'en-Latn-XA.lengthFactor=abc']),
    ).toThrow(/takes a number, and received "abc"/u);
    expect(() =>
      collect(['--pseudo-locale', 'en-Latn-XA.lengthFactor= ']),
    ).toThrow(/takes a number/u);
    // A number that is a number still gets through, or the three refusals above would be a rule
    // that refuses everything.
    expect(collect(['--pseudo-locale', 'en-Latn-XA.lengthFactor=-1'])).toEqual({
      pseudoLocales: { 'en-Latn-XA': { lengthFactor: -1 } },
    });
  });

  it('names the options an entry has when given one it does not', () => {
    expect(() => collect(['--pseudo-locale', 'en-Latn-XA.invented=1'])).toThrow(
      /has no option "invented"\. It takes lengthFactor, markers/u,
    );
    expect(() => collect(['--pseudo-locale', 'en-Latn-XA.markers'])).toThrow(
      InvocationError,
    );
    expect(() => collect(['--pseudo-locale', '.markers=true'])).toThrow(
      InvocationError,
    );
  });

  it('is not a flag when it is not one', () => {
    expect(initOptionForFlag('--invented-flag')).toBeUndefined();
    // The lookup that returns nothing above has to be shown returning something, or its empty
    // answer is not evidence.
    expect(initOptionForFlag(option('pseudoLocales').flag)?.key).toBe(
      'pseudoLocales',
    );
  });
});
