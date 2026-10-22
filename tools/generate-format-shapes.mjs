/**
 * The shape of every persisted or exchanged format, recorded per stamp and compared with the
 * declarations the built packages publish.
 *
 * `specs/01-standards-profile.spec.md` section 13 says which changes to such a format are
 * incompatible, and that an incompatible change moves the format's major version. A stamp is a
 * string a writer puts in the data, so nothing about it changes when the shape under it does; the
 * record is what makes a shape change visible, and the classification below is the section's rule
 * applied to the difference.
 *
 * Written, the record takes each format's current shape when every difference from what it holds
 * is compatible, and refuses otherwise: an incompatible change needs a new stamp, a new entry in
 * `FORMATS` beside the old one, and the old one marked retired, which keeps the previous major
 * version's shape on record. `--check` fails on any difference, and says which of them are
 * incompatible.
 *
 * `--replace <stamp>[,<stamp>...]` records a named format's current shape whatever the difference.
 * It is for a major version no release has carried: the section's rule protects a reader of a
 * version, and a shape that has not left the repository has none, so moving its stamp would publish
 * a second major version of a format whose first nobody received. The record's own diff is where a
 * replacement is reviewed, and `--check` is unchanged by it. A stamp a release has carried is
 * refused: `tools/released-format-stamps.json` lists them, and `--release` adds every recorded
 * stamp to it, which is a step of a release and is committed with it.
 *
 * Every stamp literal in the built code must be a recorded format, a same-build stamp, or a digest
 * label, so a format added without a record is found rather than missed.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { format, resolveConfig } from 'prettier';
import ts from 'typescript';

import { inputsRoot } from './stage-self-test.mjs';

const workspaceRoot = inputsRoot();
const check = process.argv.includes('--check');
const replaceAt = process.argv.indexOf('--replace');
const replaced = new Set(
  replaceAt === -1
    ? []
    : (process.argv[replaceAt + 1] ?? '').split(',').filter((stamp) => stamp),
);
const recordPath = resolve(workspaceRoot, 'tools/format-shapes.json');
const releasedPath = resolve(
  workspaceRoot,
  'tools/released-format-stamps.json',
);
const released = JSON.parse(readFileSync(releasedPath, 'utf8')).released;
assert.ok(
  Array.isArray(released) &&
    released.every((stamp) => typeof stamp === 'string'),
  'tools/released-format-stamps.json must hold a "released" list of stamps.',
);
for (const stamp of replaced) {
  if (released.includes(stamp)) {
    throw new Error(
      `${stamp} has been released, so its shape is not replaced. An incompatible change moves its stamp.`,
    );
  }
}
if (check && replaced.size > 0) {
  throw new Error('--replace writes the record, and --check never does.');
}
if (process.argv.includes('--release')) {
  if (check || replaced.size > 0) {
    throw new Error('--release takes no other option.');
  }
  const recorded = Object.keys(
    JSON.parse(readFileSync(recordPath, 'utf8')).formats,
  );
  const stamps = [...new Set([...released, ...recorded])].sort();
  writeFileSync(
    releasedPath,
    await format(JSON.stringify({ released: stamps }), {
      ...(await resolveConfig(releasedPath)),
      filepath: releasedPath,
    }),
  );
  console.log(
    `Released format stamps: ${stamps.length}, ${stamps.length - released.length} added.`,
  );
  process.exit(0);
}

const toolkit = (file, type) => ({ file: `dist/toolkit/${file}.d.ts`, type });
const core = (type) => ({
  file: 'dist/runtime/types/neolorn-equator-core.d.ts',
  type,
});
const schema = (name) => `dist/toolkit/schemas/${name}.v1.schema.json`;

/**
 * Every format the section covers: its stamp, whether its readers refuse unknown fields, and the
 * published declarations or schema that state its shape. A format a toolkit of one version writes
 * and a runtime of another reads is recorded from both sides, since either can move.
 *
 * `closed` is also the entry for a reader that ignores unknown fields but rewrites the data and so
 * loses them, and for a format read only by applications, whose readers Equator cannot see.
 *
 * `openValues` names the fields whose set of values is open: the section has a reader of an
 * observability event accept a code it does not know, so a value added to one of these is a
 * compatible change. The declaration still lists the values this build writes, and the record
 * holds them under `open`.
 */
const FORMATS = Object.freeze([
  {
    stamp: 'equator-compiled-ir/1',
    readers: 'closed',
    declarations: [toolkit('compiled-artifacts', 'CompiledCatalog')],
  },
  {
    stamp: 'equator-compiled-catalog/1',
    readers: 'open',
    declarations: [
      toolkit('compiled-artifacts', 'ArtifactAddress'),
      core('ArtifactAddress'),
    ],
  },
  {
    stamp: 'equator-catalog-set/1',
    readers: 'open',
    declarations: [
      toolkit('compiled-artifacts', 'CatalogSetDescriptor'),
      core('CatalogSetDescriptor'),
    ],
  },
  {
    stamp: 'equator-resource-summary/1',
    readers: 'closed',
    declarations: [
      toolkit('compiled-artifacts', 'CatalogResourceSummary'),
      core('CatalogResourceSummary'),
    ],
  },
  {
    // The top level is read openly, each scope closed, so the format is as strict as its scopes.
    stamp: 'equator-generated/1',
    readers: 'closed',
    declarations: [core('GeneratedConfiguration'), core('MessageHandle')],
  },
  {
    stamp: 'equator-route-projection/1',
    readers: 'open',
    declarations: [core('GeneratedRouteProjection')],
  },
  {
    stamp: 'equator-extension-descriptor/1',
    readers: 'closed',
    declarations: [
      toolkit('extensions', 'ExtensionDescriptor'),
      core('RuntimeExtensionDescriptor'),
    ],
  },
  {
    // The file an application writes, which the schema states; the parsed registry adds a
    // fingerprint the file does not carry.
    stamp: 'equator-extension-registry/1',
    readers: 'closed',
    schemas: [schema('extension-registry')],
  },
  {
    stamp: 'equator-runtime-observability-event/1',
    readers: 'closed',
    openValues: ['code'],
    declarations: [
      {
        file: 'dist/runtime/types/neolorn-equator.d.ts',
        type: 'LocalizationObservabilityEvent',
      },
    ],
  },
  {
    stamp: 'equator-toolkit-observability-event/1',
    readers: 'closed',
    openValues: ['code', 'diagnosticCode'],
    declarations: [toolkit('observability', 'ToolkitObservabilityEvent')],
  },
  {
    stamp: 'equator-compiler-state/1',
    readers: 'closed',
    declarations: [toolkit('compiler', 'CompilerState')],
  },
  {
    stamp: 'equator-compiler-cache/1',
    readers: 'closed',
    declarations: [toolkit('project-host', 'CompilerCacheEnvelope')],
  },
  {
    stamp: 'equator-output-transaction/1',
    readers: 'open',
    declarations: [toolkit('output-host', 'TransactionJournal')],
  },
  {
    stamp: 'equator-work-owner/1',
    readers: 'closed',
    declarations: [toolkit('output-host', 'WorkOwnerMarker')],
  },
  {
    stamp: 'equator-completion-manifest/1',
    readers: 'closed',
    declarations: [toolkit('output-plan', 'CompletionManifest')],
  },
  {
    stamp: 'equator-authored-change-plan/1',
    readers: 'closed',
    declarations: [toolkit('authoring-transaction', 'AuthoredChangePlan')],
  },
  {
    stamp: 'equator-semantic-catalog-diff/1',
    readers: 'closed',
    declarations: [toolkit('catalog-diff', 'CatalogDiff')],
  },
  {
    // Read openly, but rewritten from what was read, so a field it does not know is lost.
    stamp: 'equator-translation-state/1',
    readers: 'closed',
    declarations: [toolkit('translation-state', 'TranslationState')],
  },
  {
    stamp: 'equator-xliff-2.2/1',
    readers: 'closed',
    declarations: [toolkit('xliff', 'XliffUnitContract')],
  },
  {
    stamp: 'equator-cli-result/1',
    readers: 'closed',
    schemas: [schema('cli-result')],
  },
  {
    stamp: 'equator-cli-watch-event/1',
    readers: 'closed',
    schemas: [schema('cli-watch-event')],
  },
  {
    // Stamped by `schemaVersion: 1` rather than a string, so the census below does not see it.
    stamp: 'configuration schemaVersion 1',
    readers: 'closed',
    schemas: [schema('configuration')],
  },
]);

/** Written and read by one build, in data that does not outlive the run or render that wrote it. */
const SAME_BUILD = Object.freeze([
  'equator-transfer-state/1',
  'equator-participant-state/1',
  'equator-output-plan/1',
  'equator-host-compatibility/1',
]);

/** Domain labels of fingerprints (section 13), which name a digest's input and are not formats. */
const DIGEST_LABELS = Object.freeze([
  'equator-application-contract/1',
  'equator-compiler-analysis-graph/1',
  'equator-compiler-cache-state/1',
  'equator-compiler-catalog-input/1',
  'equator-compiler-configuration-input/1',
  'equator-compiler-input-set/1',
  'equator-compiler-recovery-input/1',
  'equator-compiler-static-source-input/1',
  'equator-generated-owner/1',
  'equator-message-contract/1',
  'equator-provider-catalog-set/1',
  'equator-provider-output-path/1',
  'equator-scope-application-contract/1',
  'equator-scope-semantic-registry/1',
  'equator-semantic-registry/1',
  'equator-source-message/1',
  'equator-translation-view/1',
  'equator-xliff-source-message/1',
]);

/* ------------------------------------------------------------------ *
 * Shapes, read from the built declarations.                          *
 * ------------------------------------------------------------------ */

const declarationFiles = [
  ...new Set(
    FORMATS.flatMap(({ declarations = [] }) =>
      declarations.map(({ file }) => resolve(workspaceRoot, file)),
    ),
  ),
];
const program = ts.createProgram(declarationFiles, {
  noEmit: true,
  strict: true,
  skipLibCheck: true,
  types: [],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  // The runtime's declarations import each other by package name, which resolves to the built files
  // being read rather than to whatever copy an installed package would hold.
  paths: {
    '@neolorn/equator': [
      resolve(workspaceRoot, 'dist/runtime/types/neolorn-equator.d.ts'),
    ],
    '@neolorn/equator/core': [
      resolve(workspaceRoot, 'dist/runtime/types/neolorn-equator-core.d.ts'),
    ],
  },
});
const checker = program.getTypeChecker();

function declaredType({ file, type }) {
  const source = program.getSourceFile(resolve(workspaceRoot, file));
  assert.ok(source, `${file} is not in the program. Run pnpm run build.`);
  const module = checker.getSymbolAtLocation(source);
  assert.ok(module, `${file} is not a module.`);
  let symbol = checker
    .getExportsOfModule(module)
    .find(({ name }) => name === type);
  assert.ok(symbol, `${file} does not export ${type}.`);
  if (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return checker.getDeclaredTypeOfSymbol(symbol);
}

const sortedUnique = (shapes) => {
  const byText = new Map(shapes.map((shape) => [JSON.stringify(shape), shape]));
  return [...byText.keys()].sort().map((text) => byText.get(text));
};

/**
 * A type as data: what a reader can meet at each place. `readonly` is left out because it does not
 * change what the data holds, and so is every name a type goes by.
 */
function shapeOf(type, path, open = new Set()) {
  const flags = type.flags;
  const F = ts.TypeFlags;
  assert.ok(
    !(flags & F.Any),
    `${path} is any, which records nothing: a declaration it depends on did not resolve.`,
  );
  if (flags & F.Unknown) return 'unknown';
  if (flags & F.Never) return 'never';
  if (flags & F.Boolean) return 'boolean';
  if (flags & F.String) return 'string';
  if (flags & F.Number) return 'number';
  if (flags & F.BigInt) return 'bigint';
  if (flags & F.Null) return 'null';
  if (flags & (F.Undefined | F.Void)) return 'undefined';
  if (flags & (F.StringLiteral | F.NumberLiteral)) {
    return { literal: type.value };
  }
  if (flags & F.BooleanLiteral) {
    return { literal: type.intrinsicName === 'true' };
  }
  if (flags & F.TemplateLiteral) {
    return { template: checker.typeToString(type) };
  }
  if (type.isUnion()) {
    let members = sortedUnique(
      type.types.map((member) => shapeOf(member, path, open)),
    );
    // `boolean | undefined` arrives as its two literals and `undefined`.
    const literalTrue = JSON.stringify({ literal: true });
    const literalFalse = JSON.stringify({ literal: false });
    const texts = members.map((member) => JSON.stringify(member));
    if (texts.includes(literalTrue) && texts.includes(literalFalse)) {
      members = sortedUnique([
        'boolean',
        ...members.filter(
          (member) =>
            ![literalTrue, literalFalse].includes(JSON.stringify(member)),
        ),
      ]);
    }
    return members.length === 1 ? members[0] : { union: members };
  }
  if (checker.isTupleType(type)) {
    return {
      tuple: checker
        .getTypeArguments(type)
        .map((element, index) => shapeOf(element, `${path}[${index}]`, open)),
    };
  }
  if (checker.isArrayType(type)) {
    return {
      array: shapeOf(checker.getTypeArguments(type)[0], `${path}[]`, open),
    };
  }
  if (flags & F.Object || type.isIntersection()) {
    if (type.getCallSignatures().length > 0) return 'function';
    // A type that contains itself, which the IR does: the second visit names the first.
    if (open.has(type)) return { recursive: checker.typeToString(type) };
    // An interface that extends an array type holds what an array holds. `isArrayType` above sees
    // only the array types themselves, and reading one of these as an object would record the
    // array's methods, keyed by symbol names the compiler numbers per program.
    const elements = checker
      .getIndexInfosOfType(type)
      .find(({ keyType }) => keyType.flags & F.Number);
    if (
      elements !== undefined &&
      checker.getPropertyOfType(type, 'length') !== undefined
    ) {
      open.add(type);
      const array = { array: shapeOf(elements.type, `${path}[]`, open) };
      open.delete(type);
      return array;
    }
    open.add(type);
    const fields = {};
    for (const property of checker
      .getPropertiesOfType(type)
      // A member keyed by a symbol is never data a serialized format carries.
      .filter(({ name }) => !name.startsWith('__@'))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
      let value = shapeOf(
        checker.getTypeOfSymbol(property),
        `${path}.${property.name}`,
        open,
      );
      // An optional field's type carries `undefined` for its absence, which `optional` states.
      if (optional && value.union) {
        const present = value.union.filter((member) => member !== 'undefined');
        value = present.length === 1 ? present[0] : { union: present };
      }
      fields[property.name] = optional
        ? { optional, type: value }
        : { type: value };
    }
    const shape = { object: fields };
    const index = checker
      .getIndexInfosOfType(type)
      .find(({ keyType }) => keyType.flags & F.String);
    if (index !== undefined) {
      shape.index = shapeOf(index.type, `${path}[string]`, open);
    }
    open.delete(type);
    return shape;
  }
  assert.fail(
    `${path} is a ${checker.typeToString(type)}, which the shape reader does not know.`,
  );
}

/* ------------------------------------------------------------------ *
 * The rule of section 13, applied to a difference.                   *
 * ------------------------------------------------------------------ */

const summary = (shape) => {
  const text = JSON.stringify(shape);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

// The field whose literal value tells a union's object members apart, so a member is compared with
// its own previous shape rather than the whole union being called changed.
function discriminant(members) {
  const objects = members.filter((member) => member.object);
  if (objects.length < 2) return undefined;
  const names = Object.keys(objects[0].object).sort();
  return names.find((name) => {
    const values = objects.map(
      (member) => member.object[name]?.type?.literal ?? undefined,
    );
    return (
      values.every((value) => value !== undefined) &&
      new Set(values).size === values.length
    );
  });
}

/** A recorded shape with the named top-level fields marked as open sets of literal values. */
function withOpenValues(shape, names, path) {
  for (const name of names) {
    const field = shape.object?.[name];
    assert.ok(
      field,
      `${path}.${name} is named as an open set and is not a field.`,
    );
    const values = field.type.union ?? [field.type];
    assert.ok(
      values.every((value) => typeof value.literal === 'string'),
      `${path}.${name} is named as an open set and is not a set of string literals.`,
    );
    field.type = { open: values.map(({ literal }) => literal) };
  }
  return shape;
}

function differences(before, after, readers, path, out) {
  if (JSON.stringify(before) === JSON.stringify(after)) return out;
  if (before.open && after.open) {
    for (const value of after.open) {
      if (before.open.includes(value)) continue;
      out.push({
        path,
        change: `value ${JSON.stringify(value)} added to an open set`,
        incompatible: false,
      });
    }
    // A reader may still be handed data an earlier writer made, so a value is never withdrawn.
    for (const value of before.open) {
      if (after.open.includes(value)) continue;
      out.push({
        path,
        change: `value ${JSON.stringify(value)} removed from an open set`,
        incompatible: true,
      });
    }
    return out;
  }
  if (before.object && after.object) {
    for (const [name, field] of Object.entries(before.object)) {
      const now = after.object[name];
      const at = `${path}.${name}`;
      if (now === undefined) {
        out.push({ path: at, change: 'removed', incompatible: true });
        continue;
      }
      if (Boolean(field.optional) !== Boolean(now.optional)) {
        out.push({
          path: at,
          change: now.optional ? 'made optional' : 'made required',
          incompatible: true,
        });
      }
      differences(field.type, now.type, readers, at, out);
    }
    for (const [name, field] of Object.entries(after.object)) {
      if (name in before.object) continue;
      out.push({
        path: `${path}.${name}`,
        change: field.optional ? 'added as optional' : 'added as required',
        incompatible: readers === 'closed' || !field.optional,
      });
    }
    if (JSON.stringify(before.index) !== JSON.stringify(after.index)) {
      out.push({
        path: `${path}[string]`,
        change: `index changed from ${summary(before.index)} to ${summary(after.index)}`,
        incompatible: true,
      });
    }
    return out;
  }
  if (before.array && after.array) {
    return differences(before.array, after.array, readers, `${path}[]`, out);
  }
  if (before.union && after.union) {
    const key = discriminant(before.union);
    if (key !== undefined && key === discriminant(after.union)) {
      const tagged = (members) =>
        new Map(
          members
            .filter((member) => member.object)
            .map((member) => [member.object[key].type.literal, member]),
        );
      const was = tagged(before.union);
      const is = tagged(after.union);
      for (const [tag, member] of was) {
        const at = `${path}<${key}=${tag}>`;
        if (is.has(tag)) differences(member, is.get(tag), readers, at, out);
        else out.push({ path: at, change: 'removed', incompatible: true });
      }
      for (const tag of is.keys()) {
        if (!was.has(tag)) {
          out.push({
            path: `${path}<${key}=${tag}>`,
            change: 'added',
            incompatible: true,
          });
        }
      }
      const rest = (members) =>
        JSON.stringify(members.filter((member) => !member.object));
      if (rest(before.union) !== rest(after.union)) {
        out.push({
          path,
          change: `values changed from ${summary(before)} to ${summary(after)}`,
          incompatible: true,
        });
      }
      return out;
    }
  }
  out.push({
    path,
    change: `type changed from ${summary(before)} to ${summary(after)}`,
    incompatible: true,
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Schemas, and the census of stamps.                                 *
 * ------------------------------------------------------------------ */

// Documentation keys are left out: a schema whose descriptions change admits the same data.
const DOCUMENTATION = new Set(['$comment', 'description', 'examples', 'title']);
function canonicalSchema(value) {
  if (Array.isArray(value)) return value.map(canonicalSchema);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !DOCUMENTATION.has(key))
      .sort()
      .map((key) => [key, canonicalSchema(value[key])]),
  );
}
const schemaDigest = (file) =>
  `sha256-${createHash('sha256')
    .update(
      JSON.stringify(
        canonicalSchema(
          JSON.parse(readFileSync(resolve(workspaceRoot, file), 'utf8')),
        ),
      ),
    )
    .digest('base64url')}`;

function builtCode(directory) {
  return readdirSync(resolve(workspaceRoot, directory), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(({ name }) => /\.m?js$/u.test(name))
    .map((entry) => join(entry.parentPath, entry.name));
}

function stampsInBuiltCode() {
  const found = new Map();
  const files = [
    ...builtCode('dist/toolkit'),
    ...builtCode('dist/runtime/fesm2022'),
  ];
  assert.ok(files.length > 0, 'No built code was found. Run pnpm run build.');
  for (const file of files) {
    for (const [, stamp] of readFileSync(file, 'utf8').matchAll(
      /["'`](equator-[a-z0-9.-]+\/\d+)["'`]/gu,
    )) {
      if (!found.has(stamp)) {
        found.set(stamp, relative(workspaceRoot, file).replaceAll('\\', '/'));
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Recorded, or checked.                                              *
 * ------------------------------------------------------------------ */

const current = Object.fromEntries(
  FORMATS.map(
    ({ stamp, readers, declarations = [], schemas = [], openValues = [] }) => {
      const entry = { readers };
      if (declarations.length > 0) {
        entry.declarations = Object.fromEntries(
          declarations.map((declaration) => [
            `${declaration.file}#${declaration.type}`,
            withOpenValues(
              shapeOf(declaredType(declaration), declaration.type),
              openValues,
              declaration.type,
            ),
          ]),
        );
        // The record is of the format the stamp names only if one of its declarations carries it.
        assert.ok(
          JSON.stringify(entry.declarations).includes(
            JSON.stringify({ literal: stamp }),
          ),
          `${stamp}: none of its declarations carries the stamp, so they are not its shape.`,
        );
      }
      if (schemas.length > 0) {
        entry.schemas = Object.fromEntries(
          schemas.map((file) => [file, schemaDigest(file)]),
        );
      }
      return [stamp, entry];
    },
  ),
);

const recorded = JSON.parse(readFileSync(recordPath, 'utf8')).formats;
for (const stamp of replaced) {
  assert.ok(
    stamp in recorded && stamp in current,
    `--replace names ${stamp}, which is not a format both recorded and built.`,
  );
}
const findings = [];
const next = {};

for (const [stamp, entry] of Object.entries(recorded)) {
  if (!(stamp in current)) {
    if (entry.retired) next[stamp] = entry;
    else {
      findings.push({
        incompatible: true,
        text: `${stamp}: recorded, but no longer a format here. Mark it retired, beside the stamp that replaced it.`,
      });
    }
  }
}

for (const [stamp, entry] of Object.entries(current)) {
  const was = recorded[stamp];
  if (was === undefined) {
    findings.push({
      incompatible: false,
      text: `${stamp}: not recorded yet.`,
    });
    next[stamp] = entry;
    continue;
  }
  const found = [];
  if (was.readers !== entry.readers) {
    found.push({
      path: 'readers',
      change: `changed from ${was.readers} to ${entry.readers}`,
      incompatible: false,
    });
  }
  for (const [key, shape] of Object.entries(entry.declarations ?? {})) {
    const before = was.declarations?.[key];
    if (before === undefined) {
      found.push({
        path: key,
        change: 'not recorded yet',
        incompatible: false,
      });
    } else differences(before, shape, entry.readers, key, found);
  }
  for (const key of Object.keys(was.declarations ?? {})) {
    if (!(key in (entry.declarations ?? {}))) {
      found.push({ path: key, change: 'no longer read', incompatible: false });
    }
  }
  for (const [file, digest] of Object.entries(entry.schemas ?? {})) {
    const before = was.schemas?.[file];
    if (before === undefined) {
      found.push({
        path: file,
        change: 'not recorded yet',
        incompatible: false,
      });
    } else if (before !== digest) {
      found.push({
        path: file,
        change: 'the published schema admits different data',
        incompatible: true,
      });
    }
  }
  const replacing = replaced.has(stamp);
  for (const { path, change, incompatible } of found) {
    findings.push({
      incompatible: incompatible && !replacing,
      text: `${stamp}: ${path}: ${change} (${incompatible ? (replacing ? 'incompatible, replaced' : 'incompatible') : 'compatible'})`,
    });
  }
  next[stamp] =
    found.some(({ incompatible }) => incompatible) && !replacing ? was : entry;
}

const accounted = new Set([
  ...Object.keys(current),
  ...Object.entries(recorded)
    .filter(([, entry]) => entry.retired)
    .map(([stamp]) => stamp),
  ...SAME_BUILD,
  ...DIGEST_LABELS,
]);
const census = stampsInBuiltCode();
for (const [stamp, file] of census) {
  if (!accounted.has(stamp)) {
    findings.push({
      incompatible: true,
      text: `${stamp} (in ${file}): not a recorded format, a same-build stamp, or a digest label.`,
    });
  }
}
for (const stamp of [...SAME_BUILD, ...DIGEST_LABELS]) {
  if (!census.has(stamp)) {
    findings.push({
      incompatible: true,
      text: `${stamp}: listed here, but the built code does not carry it.`,
    });
  }
}

const out = (line = '') => process.stdout.write(`${line}\n`);
const incompatible = findings.filter((finding) => finding.incompatible);

if (check) {
  if (findings.length === 0) {
    out(
      `verify:format-shapes GREEN: ${Object.keys(current).length} format(s) match their records, and ${census.size} stamp(s) in the built code are accounted for.`,
    );
  } else {
    out(`verify:format-shapes RED: ${findings.length} finding(s).`);
    for (const { text } of findings) out(`  ${text}`);
    if (incompatible.length > 0) {
      out(
        'An incompatible change moves the stamp: see specs/01-standards-profile.spec.md section 13.',
      );
    } else {
      out(
        'Every difference is compatible. Run pnpm run generate:format-shapes.',
      );
    }
    process.exitCode = 1;
  }
} else if (incompatible.length > 0) {
  out(
    `Format shapes not written: ${incompatible.length} incompatible change(s).`,
  );
  for (const { text } of incompatible) out(`  ${text}`);
  out(
    'An incompatible change moves the stamp: see specs/01-standards-profile.spec.md section 13.',
  );
  process.exitCode = 1;
} else {
  const text = await format(JSON.stringify({ formats: next }, null, 2), {
    ...((await resolveConfig(recordPath)) ?? {}),
    parser: 'json',
  });
  writeFileSync(recordPath, text, 'utf8');
  for (const { text: line } of findings) out(`  ${line}`);
  out(
    `Format shapes written: ${Object.keys(next).length} format(s), ${findings.length} change(s) recorded.`,
  );
}
