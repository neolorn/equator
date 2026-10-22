/**
 * The shape of what a caller passes a programmatic entry point, checked before anything reads it.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 2 separates two mistakes. A call whose arguments
 * are not the documented shape is a mistake in the calling program, and it is thrown as a
 * `TypeError` that names the function and the argument, because no result could tell the caller
 * more than the line it was thrown from. What a well-shaped call carries, a catalog's scope or a
 * configuration's locale, is content, and content is judged and reported as a diagnostic.
 *
 * The shape is the kind of each argument and of each member an entry point reads from it: text, a
 * list, a record. Whether a text is a valid identity or a list holds what it should is content,
 * and is not asked here. Two things are asked of the values themselves, because no digest can be
 * taken over a value that fails them: a text is well-formed Unicode, and `data` is what canonical
 * JSON can carry. The type received is named and the value never is, as section 2 asks of every
 * report about a value that is not what was expected.
 */

/** The kind of one argument or member. A record shape names the members read from it. */
export type ArgumentShape =
  | 'text'
  | 'flag'
  | 'number'
  | 'record'
  | 'list'
  | 'function'
  | 'data'
  | readonly ArgumentShape[]
  | ArgumentMembers;

/**
 * The members of a record argument. A one-element array is a list whose elements have that shape.
 */
export interface ArgumentMembers {
  readonly required?: Readonly<Record<string, ArgumentShape>>;
  readonly optional?: Readonly<Record<string, ArgumentShape>>;
}

function describeReceived(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  return type === 'undefined'
    ? 'undefined'
    : type === 'object'
      ? 'an object'
      : type === 'bigint'
        ? 'a bigint'
        : `a ${type}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const KINDS = {
  text: ['a string', (value: unknown) => typeof value === 'string'],
  flag: ['a boolean', (value: unknown) => typeof value === 'boolean'],
  number: ['a number', (value: unknown) => typeof value === 'number'],
  record: ['an object', isRecord],
  list: ['an array', (value: unknown) => Array.isArray(value)],
  function: ['a function', (value: unknown) => typeof value === 'function'],
} as const;

/**
 * Throws a `TypeError` naming `entry` and the first argument or member that is not its shape.
 *
 * `name` is the argument as the function's signature writes it, and a member is named by its path
 * from there: `request.analysis.rootNames[2]`.
 */
export function requireArgument(
  entry: string,
  name: string,
  value: unknown,
  shape: ArgumentShape,
): void {
  const refuse = (expected: string): never => {
    throw new TypeError(
      `${entry}: ${name} must be ${expected}, not ${describeReceived(value)}.`,
    );
  };
  if (shape === 'data') {
    requireData(entry, name, value);
    return;
  }
  if (typeof shape === 'string') {
    const [expected, matches] = KINDS[shape];
    if (!matches(value)) refuse(expected);
    if (typeof value === 'string' && /\p{Cs}/u.test(value)) {
      throw new TypeError(
        `${entry}: ${name} must be well-formed Unicode, and holds an unpaired surrogate.`,
      );
    }
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return refuse('an array');
    const [element] = shape as readonly ArgumentShape[];
    if (element === undefined) return;
    for (const [index, item] of (value as readonly unknown[]).entries()) {
      requireArgument(entry, `${name}[${index}]`, item, element);
    }
    return;
  }
  if (!isRecord(value)) return refuse('an object');
  const members = shape as ArgumentMembers;
  for (const [member, memberShape] of Object.entries(members.required ?? {})) {
    requireArgument(entry, `${name}.${member}`, value[member], memberShape);
  }
  for (const [member, memberShape] of Object.entries(members.optional ?? {})) {
    if (value[member] === undefined) continue;
    requireArgument(entry, `${name}.${member}`, value[member], memberShape);
  }
}

function requireData(entry: string, name: string, value: unknown): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    requireArgument(entry, name, value, 'text');
    return;
  }
  if (typeof value === 'number') {
    if (
      Number.isFinite(value) &&
      !Object.is(value, -0) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    ) {
      return;
    }
    throw new TypeError(
      `${entry}: ${name} must be a finite number that is not negative zero, and a safe integer where it is whole.`,
    );
  }
  if (Array.isArray(value)) {
    for (const [index, item] of (value as readonly unknown[]).entries()) {
      requireData(entry, `${name}[${index}]`, item);
    }
    return;
  }
  if (!isRecord(value)) {
    throw new TypeError(
      `${entry}: ${name} must be JSON data, not ${describeReceived(value)}.`,
    );
  }
  for (const [member, item] of Object.entries(value)) {
    requireArgument(entry, `${name} member name`, member, 'text');
    requireData(entry, `${name}.${member}`, item);
  }
}

/** The observability option every request that reports its work carries. */
export const OBSERVABILITY_ARGUMENT: ArgumentShape = {
  required: { emit: 'function' },
};

/** An extension registry, as far as an entry point reads it before any descriptor is looked up. */
export const EXTENSION_REGISTRY_ARGUMENT: ArgumentShape = {
  required: { descriptors: ['record'] },
};

/** The members every project verb reads to find the project it works on. */
const PROJECT_SELECTION = {
  cwd: 'text',
  project: 'text',
  pseudoLocales: 'flag',
  dryRun: 'flag',
  observability: OBSERVABILITY_ARGUMENT,
} as const;

/**
 * The options of a project verb: where the project is, and the members this verb adds.
 */
export function projectOptions(
  optional: Readonly<Record<string, ArgumentShape>> = {},
  required: Readonly<Record<string, ArgumentShape>> = {},
): ArgumentShape {
  return { required, optional: { ...PROJECT_SELECTION, ...optional } };
}

/** One file of an authored change, as a plan and a migration request both carry it. */
export const AUTHORED_CHANGE_ARGUMENT: ArgumentShape = {
  required: { path: 'text' },
  optional: {
    before: 'text',
    after: 'text',
    beforeDigest: 'text',
    afterDigest: 'text',
  },
};
