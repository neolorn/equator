/**
 * Every closed union Equator hands a consumer, written as a switch the strict consumer compiles.
 *
 * A consumer that answers each member of a union it is given writes a `switch` with no `default`,
 * and that switch is what stops compiling when the union gains a member. One such switch in the
 * strict row proved one union. The rest were unproven from the consumer seat: a union could gain a
 * member, or lose its name, and nothing a consumer compiles would have noticed.
 *
 * So the unions are found rather than listed. The walk starts at every published function, class
 * and constant and follows what Equator hands out: return values, the members of what it returns,
 * the values it passes to a callback, and the members of those in turn. A value the consumer hands
 * in is not followed, because a member added to it breaks no consumer, except where the consumer
 * hands in a callback, whose parameters Equator fills.
 *
 * A union is closed when every member is a literal, `null` or `undefined`, and at least two members
 * are string or number literals, because that is the union a consumer enumerates case by case.
 * `boolean`, or one literal beside `undefined`, is answered with an `if`. A union of objects is
 * closed over its discriminant: the property each member carries as literals no other member uses.
 *
 * Every place the walk stands is written the way a consumer would write it, and its type is read
 * from that text in a program of the consumer's own, so the switch and what it was derived from
 * cannot disagree. A generic function is the case that needs it: `ReturnType` reads it at its
 * constraints, while its declaration names only its type parameters.
 *
 * The file this writes is two things. The strict row compiles it, so every switch in it is checked
 * against the installed packages under that row's options, and a union that has gained a member
 * fails that build on the `never` at the end of its switch. It is also the member list: `--check`
 * renders it again and fails when the two differ, so a member added or a union removed arrives as a
 * change somebody reads rather than as a switch regenerated to match.
 *
 * Reads the built declarations, so it needs `build`.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';
import ts from 'typescript';

import { resolveConsumerProfile } from './package-consumer-profiles.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeTypesRoot = resolve(workspaceRoot, 'dist/runtime/types');
const toolkitRoot = resolve(workspaceRoot, 'dist/toolkit');
const templateConfigPath = resolve(
  workspaceRoot,
  'fixtures/package-consumer-template/tsconfig.json',
);
const outputPath = resolve(
  workspaceRoot,
  'fixtures/strict-consumer-overlay/src/app/closed-unions.generated.ts',
);
const target = relative(workspaceRoot, outputPath).replaceAll('\\', '/');
const check = process.argv.includes('--check');

/**
 * The import specifier of each declaration file. The runtime's files are named after their entry
 * point, so an entry point added later is covered the day it lands.
 */
function entryFiles() {
  const runtime = readdirSync(runtimeTypesRoot)
    .filter((file) => file.endsWith('.d.ts'))
    .sort()
    .map((file) => ({
      path: resolve(runtimeTypesRoot, file),
      specifier: `@neolorn/equator${file
        .slice('neolorn-equator'.length, -'.d.ts'.length)
        .replace(/^-/u, '/')}`,
    }));
  assert.ok(
    runtime.some(({ specifier }) => specifier === '@neolorn/equator'),
    `No neolorn-equator.d.ts under ${runtimeTypesRoot}. Run pnpm run build first.`,
  );
  return [
    ...runtime,
    {
      path: resolve(toolkitRoot, 'index.d.ts'),
      specifier: '@neolorn/equator-toolkit',
    },
  ];
}

/**
 * The strict row's options: the template's with the row's own over them, as materializing the row
 * writes them. Every type is read under these, so the walk meets the types that row's application
 * meets, and the file is compiled under them before it is written.
 */
function strictRowOptions() {
  const template = JSON.parse(readFileSync(templateConfigPath, 'utf8'));
  const { options, errors } = ts.convertCompilerOptionsFromJson(
    {
      ...template.compilerOptions,
      ...resolveConsumerProfile('strict-consumer').compilerOptions,
    },
    dirname(templateConfigPath),
  );
  assert.deepEqual(
    errors.map((error) =>
      ts.flattenDiagnosticMessageText(error.messageText, '\n'),
    ),
    [],
  );
  return {
    ...options,
    noEmit: true,
    // The packages are not installed in the workspace, so their names lead to what they publish.
    paths: {
      '@neolorn/equator': [resolve(runtimeTypesRoot, 'neolorn-equator.d.ts')],
      '@neolorn/equator/*': [
        resolve(runtimeTypesRoot, 'neolorn-equator-*.d.ts'),
      ],
      '@neolorn/equator-toolkit': [resolve(toolkitRoot, 'index.d.ts')],
    },
  };
}

const files = entryFiles();
const options = strictRowOptions();

/** Parsed once. Every program below differs from the last only in the file written here. */
const parsed = new Map();

/** The declarations and one file of the consumer's, `text`, at the place the output goes. */
function programWith(text) {
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const isOwn = (path) => resolve(path) === outputPath;
  host.readFile = (path) => (isOwn(path) ? text : readFile(path));
  host.fileExists = (path) => isOwn(path) || fileExists(path);
  host.getSourceFile = (path, language, ...rest) => {
    if (isOwn(path)) return ts.createSourceFile(path, text, language, true);
    if (!parsed.has(path))
      parsed.set(path, getSourceFile(path, language, ...rest));
    return parsed.get(path);
  };
  return ts.createProgram(
    [outputPath, ...files.map(({ path }) => path)],
    options,
    host,
  );
}

/** What the file written for `program` fails to compile with, each at its line. */
function compileErrors(program) {
  const own = program.getSourceFile(outputPath);
  const lines = own.text.split('\n');
  return ts.getPreEmitDiagnostics(program, own).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      '\n',
    );
    if (diagnostic.file === undefined || diagnostic.start === undefined)
      return message;
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    );
    return `${target}:${line + 1}: ${message}\n    ${lines[line].trim()}`;
  });
}

const isOurs = (declaration) => {
  const file = resolve(declaration.getSourceFile().fileName);
  return file.startsWith(runtimeTypesRoot) || file.startsWith(toolkitRoot);
};

/** Every published type by its symbol, and every published value, as `program` reads them. */
function exportsOf(program) {
  const checker = program.getTypeChecker();
  const types = new Map();
  const values = new Map();
  for (const { path, specifier } of files) {
    const moduleSymbol = checker.getSymbolAtLocation(
      program.getSourceFile(path),
    );
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      const published = { name: exported.name, specifier };
      if (
        symbol.flags &
          (ts.SymbolFlags.TypeAlias |
            ts.SymbolFlags.Interface |
            ts.SymbolFlags.Class) &&
        !types.has(symbol)
      ) {
        types.set(symbol, published);
      }
      if (
        symbol.flags &
          (ts.SymbolFlags.Function |
            ts.SymbolFlags.Variable |
            ts.SymbolFlags.Class) &&
        !values.has(symbol)
      ) {
        values.set(symbol, { symbol, ...published });
      }
    }
  }
  return { types, values: [...values.values()] };
}

/**
 * The import declarations for texts starting at `froms`. A name several entry points export is one
 * declaration, imported from the first.
 */
function importLines(froms) {
  const specifiers = new Map();
  for (const { name, specifier } of froms) {
    specifiers.set(name, specifiers.get(name) ?? specifier);
  }
  const bySpecifier = new Map();
  for (const [name, specifier] of specifiers) {
    bySpecifier.set(specifier, [...(bySpecifier.get(specifier) ?? []), name]);
  }
  return [...bySpecifier.keys()]
    .sort()
    .map(
      (specifier) =>
        `import type { ${bySpecifier.get(specifier).sort().join(', ')} } from '${specifier}';`,
    );
}

const NULLISH = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;
const OBJECT = ts.TypeFlags.Object | ts.TypeFlags.Intersection;
const NAMED_LITERAL = ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral;
const isLiteral = (type) =>
  (type.flags & (NAMED_LITERAL | ts.TypeFlags.BooleanLiteral)) !== 0;
const isNamedLiteral = (type) => (type.flags & NAMED_LITERAL) !== 0;
const DEPTH = 16;

/**
 * Where the walk stands, written the way a consumer writes it. `from` is the published name the text
 * starts at, which is what a file using it imports. `named` marks text that is that name alone, and
 * `stripped` a name that leaves out the `null` or `undefined` the position also carries. `reached`
 * is false where no type a consumer can write names the position.
 */
const step = (here, text, reached = here.reached) => ({
  text,
  from: here.from,
  named: false,
  stripped: false,
  reached,
});

const found = new Map();
const unreached = new Map();

function compareValues(left, right) {
  const order = ['number', 'string', 'boolean'];
  return typeof left === typeof right
    ? left < right
      ? -1
      : left > right
        ? 1
        : 0
    : order.indexOf(typeof left) - order.indexOf(typeof right);
}

/**
 * Whether `here` is the better way to write a place than `previous`: a published name, or else the
 * shortest text, or else the first in code unit order, and between two packages that publish one
 * name the first specifier. One order for every choice between two paths, so the file depends on
 * what the declarations say and not on the order they say it in.
 */
function preferred(here, previous) {
  if (previous === undefined) return true;
  if (here.named !== previous.named) return here.named;
  if (here.text.length !== previous.text.length)
    return here.text.length < previous.text.length;
  if (here.text !== previous.text) return here.text < previous.text;
  return here.from.specifier < previous.from.specifier;
}

function record(values, nullish, here) {
  values.sort(compareValues);
  const key = values.map((value) => JSON.stringify(value)).join('|');
  if (!here.reached) {
    unreached.set(key, values);
    return;
  }
  // One union reached by several paths is kept under its published name, or else its shortest path,
  // so the file does not move when a longer way to the same union is added.
  if (preferred(here, found.get(key)?.written)) {
    const carried = here.stripped ? [] : nullish;
    found.set(key, {
      written: here,
      values,
      undefined: carried.some(
        (member) => member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void),
      ),
      null: carried.some((member) => member.flags & ts.TypeFlags.Null),
    });
  }
}

/**
 * Read each position's type from its text, walk from there, and return the positions whose type has
 * to be read from their own text in turn: what a generic signature returns and is called with.
 */
function walk(positions) {
  const program = programWith(
    [
      ...importLines(positions.map(({ from }) => from)),
      ...positions.map(
        (position, index) => `declare const at${index}: ${position.text};`,
      ),
    ].join('\n'),
  );
  const errors = compileErrors(program);
  assert.deepEqual(
    errors,
    [],
    `The walk wrote a type a consumer cannot:\n${errors.join('\n')}`,
  );
  const checker = program.getTypeChecker();
  const published = exportsOf(program).types;
  const visited = new Map();
  const next = [];

  const valueOf = (type) =>
    type.flags & ts.TypeFlags.BooleanLiteral
      ? checker.typeToString(type) === 'true'
      : type.value;
  const literalText = (type) => JSON.stringify(valueOf(type));

  /** The published name a type is known by, where it has one. */
  function publishedName(type) {
    const bare =
      type.isUnion() && type.types.some((member) => member.flags & NULLISH)
        ? checker.getNonNullableType(type)
        : type;
    // A generic's name alone is not a type a consumer can write.
    const generic =
      (bare.aliasTypeArguments?.length ?? 0) > 0 ||
      ((bare.flags & ts.TypeFlags.Object) !== 0 &&
        (bare.objectFlags & ts.ObjectFlags.Reference) !== 0 &&
        checker.getTypeArguments(bare).length > 0);
    const symbol = generic ? undefined : (bare.aliasSymbol ?? bare.getSymbol());
    const name = symbol === undefined ? undefined : published.get(symbol);
    // A class's name is its instance. The class itself carries the same symbol and is `typeof` it.
    if (
      name === undefined ||
      (symbol.flags & ts.SymbolFlags.Class &&
        checker.getDeclaredTypeOfSymbol(symbol) !== bare)
    ) {
      return undefined;
    }
    return {
      text: name.name,
      from: name,
      named: true,
      stripped: bare !== type,
      reached: true,
    };
  }

  /**
   * The public properties Equator declares on a type a consumer holds. One another library
   * declares, such as a field of an `Intl` options object carried inside Equator's, is that
   * library's contract.
   */
  function propertiesOf(type) {
    return checker.getPropertiesOfType(type).filter((property) => {
      if (property.name.startsWith('__@') || property.name.startsWith('#')) {
        return false;
      }
      const declaration =
        property.valueDeclaration ?? property.declarations?.[0];
      return (
        declaration !== undefined &&
        (property.declarations ?? []).some(isOurs) &&
        !(
          ts.getCombinedModifierFlags(declaration) &
          (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
        )
      );
    });
  }

  /**
   * The property a union of objects is told apart by: one each member carries as a literal or a
   * union of literals, with no literal carried by two members. Each member is then the one `Extract`
   * finds with its own literals, even where they are several.
   */
  function discriminantOf(objects) {
    for (const property of propertiesOf(objects[0])) {
      const tags = objects.map((member) => {
        const own = checker.getPropertyOfType(member, property.name);
        if (own === undefined) return undefined;
        const type = checker.getTypeOfSymbol(own);
        const units = type.isUnion() ? type.types : [type];
        // In value order. The checker lists a union's members in the order it first met them, which
        // follows the order of the declarations.
        return units.every(isLiteral)
          ? [...units].sort((left, right) =>
              compareValues(valueOf(left), valueOf(right)),
            )
          : undefined;
      });
      if (tags.includes(undefined)) continue;
      const all = tags.flat().map(literalText);
      if (new Set(all).size === all.length)
        return { name: property.name, tags };
    }
    return undefined;
  }

  /**
   * Follow one type from where a consumer meets it. `out` is a value Equator hands the consumer;
   * `in` is one the consumer hands Equator, which matters only for the callbacks inside it.
   */
  function visit(type, direction, written, depth) {
    const named = publishedName(type);
    const here = named ?? written;
    // A published name without arguments is one type and is walked once, so the count starts again
    // there. Only a type that grows as it recurses gets past the bound, and a union below it would
    // otherwise be missed without a word.
    const steps = named === undefined ? depth : 0;
    assert.ok(
      steps <= DEPTH,
      `${written.text} is ${steps} steps below a published name, more than the ${DEPTH} the walk follows.`,
    );
    // Walked again when a better way to write it arrives. The packager chooses the order of the
    // declarations, and a type walked only from whichever export came first would name the unions
    // below it after that export.
    const seen = visited.get(type) ?? new Map();
    const key = `${direction}:${here.reached}`;
    if (!preferred(here, seen.get(key))) return;
    visited.set(type, seen.set(key, here));
    if (type.isUnion()) {
      visitUnion(type, direction, here, steps);
    } else if (type.flags & OBJECT) {
      visitObject(type, direction, here, steps);
    }
  }

  function visitUnion(type, direction, here, depth) {
    const nullish = type.types.filter((member) => member.flags & NULLISH);
    const members = type.types.filter((member) => !(member.flags & NULLISH));
    if (members.every(isLiteral)) {
      if (direction === 'out' && members.filter(isNamedLiteral).length >= 2) {
        record(members.map(valueOf), nullish, here);
      }
      return;
    }
    const objects = members.filter((member) => member.flags & OBJECT);
    if (objects.length === 0) return;
    const whole = here.stripped ? members.length : type.types.length;
    const base =
      objects.length === whole
        ? here
        : step(
            here,
            objects.length === members.length
              ? `NonNullable<${here.text}>`
              : `Extract<${here.text}, object>`,
          );
    if (objects.length === 1) {
      visit(objects[0], direction, base, depth + 1);
      return;
    }
    const discriminant = discriminantOf(objects);
    if (discriminant !== undefined) {
      const property = JSON.stringify(discriminant.name);
      objects.forEach((member, index) => {
        const tags = discriminant.tags[index].map(literalText).join(' | ');
        visit(
          member,
          direction,
          step(
            here,
            `Extract<${here.text}, { readonly ${property}: ${tags} }>`,
          ),
          depth + 1,
        );
      });
      const tags = discriminant.tags.flat();
      if (direction === 'out' && tags.filter(isNamedLiteral).length >= 2) {
        record(tags.map(valueOf), [], step(base, `${base.text}[${property}]`));
      }
      return;
    }
    // Without a discriminant a consumer reaches what every member shares through the union, and a
    // member by its published name. What only an unnamed member carries it cannot write at all, and
    // the walk goes there only to find out whether a union is hidden in it.
    if (objects.length === members.length) {
      visitObject(checker.getNonNullableType(type), direction, base, depth + 1);
    }
    for (const member of objects) {
      visit(member, direction, step(base, base.text, false), depth + 1);
    }
  }

  function visitObject(type, direction, here, depth) {
    if (checker.isArrayType(type)) {
      for (const element of checker.getTypeArguments(type)) {
        visit(
          element,
          direction,
          step(here, `${here.text}[number]`),
          depth + 1,
        );
      }
      return;
    }
    if (checker.isTupleType(type)) {
      checker.getTypeArguments(type).forEach((element, index) => {
        visit(
          element,
          direction,
          step(here, `${here.text}[${index}]`),
          depth + 1,
        );
      });
      return;
    }
    // What calling it gives back is handed out; what it is called with comes from the other side.
    // `ReturnType` and `Parameters` read the last overload, so the others cannot be written, and a
    // rest parameter is not the element at its position. A generic signature is read again from
    // those texts, at the constraints a consumer's `ReturnType` reads it at.
    const signatures = type.getCallSignatures();
    signatures.forEach((signature, index) => {
      const last = here.reached && index === signatures.length - 1;
      const generic = (signature.getTypeParameters()?.length ?? 0) > 0;
      const returned = step(here, `ReturnType<${here.text}>`, last);
      if (generic && last) {
        next.push({ ...returned, direction, depth: depth + 1 });
      } else {
        visit(signature.getReturnType(), direction, returned, depth + 1);
      }
      signature.getParameters().forEach((parameter, position) => {
        const declaration = parameter.valueDeclaration;
        const rest =
          declaration !== undefined &&
          ts.isParameter(declaration) &&
          declaration.dotDotDotToken !== undefined;
        const called = step(
          here,
          `Parameters<${here.text}>[${position}]`,
          last && !rest,
        );
        const flipped = direction === 'out' ? 'in' : 'out';
        if (generic && called.reached) {
          next.push({ ...called, direction: flipped, depth: depth + 1 });
        } else {
          visit(checker.getTypeOfSymbol(parameter), flipped, called, depth + 1);
        }
      });
    });
    const symbol = type.getSymbol();
    const declarations = symbol?.declarations ?? [];
    // A class or interface of another library is its own contract. A promise is followed to what it
    // settles to. What another generic carries cannot be written, and the walk goes there only to
    // find out whether a union is hidden in it.
    if (
      symbol !== undefined &&
      symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface) &&
      declarations.length > 0 &&
      !declarations.some(isOurs)
    ) {
      const promise =
        symbol.name === 'Promise' || symbol.name === 'PromiseLike';
      const carried =
        type.aliasTypeArguments ??
        (type.objectFlags & ts.ObjectFlags.Reference
          ? checker.getTypeArguments(type)
          : []);
      for (const argument of carried) {
        visit(
          argument,
          direction,
          promise
            ? step(here, `Awaited<${here.text}>`)
            : step(here, here.text, false),
          depth + 1,
        );
      }
      return;
    }
    for (const [kind, index] of [
      [ts.IndexKind.String, 'string'],
      [ts.IndexKind.Number, 'number'],
    ]) {
      const info = checker.getIndexInfoOfType(type, kind);
      if (info !== undefined) {
        visit(
          info.type,
          direction,
          step(here, `${here.text}[${index}]`),
          depth + 1,
        );
      }
    }
    for (const property of propertiesOf(type)) {
      visit(
        checker.getTypeOfSymbol(property),
        direction,
        step(here, `${here.text}[${JSON.stringify(property.name)}]`),
        depth + 1,
      );
    }
  }

  const declared = program
    .getSourceFile(outputPath)
    .statements.filter(ts.isVariableStatement);
  positions.forEach((position, index) => {
    const [variable] = declared[index].declarationList.declarations;
    visit(
      checker.getTypeOfSymbol(checker.getSymbolAtLocation(variable.name)),
      position.direction,
      position,
      position.depth,
    );
  });
  return next;
}

// The first program reads what is published, and checks that the declarations resolve: an import
// that does not is read as `any`, and every union behind it would be missed without a word.
const first = programWith('');
const firstChecker = first.getTypeChecker();
for (const { path } of files) {
  for (const statement of first.getSourceFile(path).statements) {
    const specifier =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
    assert.ok(
      specifier === undefined ||
        firstChecker.getSymbolAtLocation(specifier) !== undefined,
      `${relative(workspaceRoot, path)} imports ${specifier?.getText()}, which does not resolve from the workspace, so the walk cannot see what it declares.`,
    );
  }
}
const roots = exportsOf(first).values;
assert.ok(
  roots.length > 100,
  `Only ${roots.length} published value(s) resolved, fewer than Equator is known to publish. This is reading the wrong files.`,
);

let positions = roots.flatMap((root) => {
  const from = { name: root.name, specifier: root.specifier };
  const start = {
    text: `typeof ${root.name}`,
    from,
    named: false,
    stripped: false,
    reached: true,
    direction: 'out',
    depth: 0,
  };
  if (!(root.symbol.flags & ts.SymbolFlags.Class)) return [start];
  // A generic class's name needs its arguments, and `InstanceType` supplies its constraints.
  const generic =
    (firstChecker.getDeclaredTypeOfSymbol(root.symbol).typeParameters?.length ??
      0) > 0;
  return [
    {
      ...start,
      text: generic ? `InstanceType<typeof ${root.name}>` : root.name,
    },
    start,
  ];
});
// Each round reads what the last found behind a generic signature. One inside that is read in the
// next, and a chain longer than this is a type that refers to itself through its own signature.
const ROUNDS = 8;
const read = new Set();
for (let round = 1; positions.length > 0; round += 1) {
  assert.ok(
    round <= ROUNDS,
    `Generic signatures still unread after ${ROUNDS} rounds: ${positions.map(({ text }) => text).join(', ')}`,
  );
  positions.forEach(({ text }) => read.add(text));
  positions = walk(positions).filter(({ text }) => !read.has(text));
}

const unions = [...found.values()].sort((left, right) =>
  left.written.text < right.written.text
    ? -1
    : left.written.text > right.written.text
      ? 1
      : 0,
);

// Two unions that have to be here. Without them the walk has stopped reaching what it exists for,
// and a file of zero switches would compile and match itself.
for (const anchor of ['LocalizationFailureCode', 'ToolkitDiagnosticCode']) {
  assert.ok(
    unions.some(({ written }) => written.text === anchor),
    `${anchor} was not found among the unions Equator hands out, so the walk has stopped reaching what it is for.`,
  );
}

const hidden = [...unreached]
  .filter(([key]) => !found.has(key))
  .map(([, values]) =>
    values.map((value) => JSON.stringify(value)).join(' | '),
  );
assert.deepEqual(
  hidden,
  [],
  "These closed unions are handed out only where no type a consumer can write reaches them: an earlier overload, a rest parameter, a member of a union with no discriminant and no name, or an argument of another library's generic. No switch can prove them until the type that carries each one is written another way.",
);

// ---------------------------------------------------------------------------------------------
// Writing the file
// ---------------------------------------------------------------------------------------------

const functionName = (text) =>
  text
    .replace(/typeof /gu, '')
    .split(/[^A-Za-z0-9]+/u)
    .filter(
      (word) =>
        word.length > 0 && !['readonly', 'number', 'string'].includes(word),
    )
    .map((word, index) =>
      index === 0
        ? `${word.charAt(0).toLowerCase()}${word.slice(1)}`
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join('');

const names = new Set();
const bodies = [];
for (const union of unions) {
  const { text } = union.written;
  let name = functionName(text);
  for (let suffix = 2; names.has(name); suffix += 1) {
    name = `${functionName(text)}${suffix}`;
  }
  names.add(name);
  const cases = [
    ...union.values.map((value) => `    case ${JSON.stringify(value)}:`),
    ...(union.undefined ? ['    case undefined:'] : []),
    ...(union.null ? ['    case null:'] : []),
  ];
  bodies.push(
    [
      `export function ${name}(value: ${text}): void {`,
      '  switch (value) {',
      ...cases,
      '      return;',
      '    default: {',
      '      const unhandled: never = value;',
      '      throw new Error(`Unhandled member ${String(unhandled)}`);',
      '    }',
      '  }',
      '}',
    ].join('\n'),
  );
}

const header = [
  '// Generated by tools/generate-closed-unions.mjs from the built declarations. Do not edit it here:',
  '// the gate renders it again and fails when it differs.',
  '//',
  '// One switch per closed union Equator hands a consumer, each with a case per member and a `never`',
  '// at the end, which the strict row compiles. A union that gains a member fails that build, and',
  '// a member added or a union removed shows here as a change.',
  '',
];
const source = [
  ...header,
  ...importLines(unions.map(({ written }) => written.from)),
  '',
  ...bodies.flatMap((body) => [body, '']),
].join('\n');

const rendered = await format(source, {
  ...((await resolveConfig(outputPath)) ?? {}),
  parser: 'typescript',
});

// Compiled where it will live, against the declarations it came from and under the strict row's
// options, so a switch this walk cannot write is found here rather than in a consumer install.
const errors = compileErrors(programWith(rendered));
assert.deepEqual(
  errors,
  [],
  `The switches do not compile against the declarations they were read from:\n${errors.join('\n')}`,
);

const memberCount = unions.reduce(
  (total, union) => total + union.values.length,
  0,
);
if (check) {
  let current;
  try {
    current = readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n');
  } catch {
    throw new Error(
      `${target} is missing. Run pnpm run generate:closed-unions.`,
    );
  }
  assert.equal(
    current,
    rendered,
    `${target} no longer matches the unions Equator hands out. Read the difference, then run pnpm run generate:closed-unions.`,
  );
  process.stdout.write(
    `Equator closed unions verified: ${unions.length} union(s), ${memberCount} member(s), from ${roots.length} published value(s).\n`,
  );
} else {
  await writeFile(outputPath, rendered, 'utf8');
  process.stdout.write(
    `Equator closed unions written to ${target}: ${unions.length} union(s), ${memberCount} member(s).\n`,
  );
}
