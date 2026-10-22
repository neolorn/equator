/**
 * How much a diagnostic matters: `error` stops the operation, `warning` and `info` do not.
 *
 * A result carrying only warnings is still a success, so a caller that treats any diagnostic as a
 * failure will reject builds that are fine.
 */
export type ToolkitDiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Every diagnostic Equator can report, as its stable code.
 *
 * Grouped by the hundred: the first two digits of a code's number are its band, and each band is one
 * section of `DIAGNOSTICS.md`. A code is never reused and never changes meaning, which is what lets
 * a build script suppress one particular warning without matching on its wording.
 */
export type ToolkitDiagnosticCode =
  | 'EQ1001'
  | 'EQ1002'
  | 'EQ1003'
  | 'EQ1004'
  | 'EQ1005'
  | 'EQ1006'
  | 'EQ1007'
  | 'EQ1008'
  | 'EQ1101'
  | 'EQ1102'
  | 'EQ1103'
  | 'EQ1104'
  | 'EQ1105'
  | 'EQ1201'
  | 'EQ1202'
  | 'EQ1203'
  | 'EQ1204'
  | 'EQ1205'
  | 'EQ1206'
  | 'EQ1301'
  | 'EQ1302'
  | 'EQ1303'
  | 'EQ1304'
  | 'EQ1305'
  | 'EQ1306'
  | 'EQ1307'
  | 'EQ1308'
  | 'EQ1309'
  | 'EQ1310'
  | 'EQ1311'
  | 'EQ1401'
  | 'EQ1402'
  | 'EQ1403'
  | 'EQ1404'
  | 'EQ1405'
  | 'EQ1406'
  | 'EQ1407'
  | 'EQ1408'
  | 'EQ1409'
  | 'EQ1410'
  | 'EQ1411'
  | 'EQ1412'
  | 'EQ1413'
  | 'EQ1414'
  | 'EQ1415'
  | 'EQ1416'
  | 'EQ1417'
  | 'EQ1501'
  | 'EQ1502'
  | 'EQ1503'
  | 'EQ1601'
  | 'EQ1602'
  | 'EQ1603'
  | 'EQ1701'
  | 'EQ1702'
  | 'EQ1703'
  | 'EQ1704'
  | 'EQ1705'
  | 'EQ1706'
  | 'EQ1801'
  | 'EQ1802'
  | 'EQ1803'
  | 'EQ1804'
  | 'EQ1805'
  | 'EQ1806';

/** One point in a source file, given three ways so a caller can use whichever it needs. */
export interface SourcePosition {
  /** Characters from the start of the file, counting from zero. */
  readonly offset: number;
  /** Line number, counting from one, which is what an editor shows. */
  readonly line: number;
  /** Column within that line, counting from one. */
  readonly column: number;
}

/** The stretch of a file a diagnostic is about, from where it starts to where it ends. */
export interface SourceSpan {
  /** Which file, when the span came from one. Absent for text that was parsed out of memory. */
  readonly sourcePath?: string;
  /** Where the stretch begins. */
  readonly start: SourcePosition;
  /** Where it ends, one past the last character in it. */
  readonly end: SourcePosition;
}

/**
 * One thing Equator has to say about what it was given: what it is, how much it matters, and where.
 *
 * The text is sanitized and bounded before it reaches here, because a diagnostic is printed to a
 * terminal and read by a machine, and neither should be steerable by the file that caused it.
 */
export interface ToolkitDiagnostic {
  /** The stable code, for matching on without depending on the wording. */
  readonly code: ToolkitDiagnosticCode;
  /** Whether this stopped the operation. */
  readonly severity: ToolkitDiagnosticSeverity;
  /** What is wrong, in a sentence, for a person to read. */
  readonly summary: string;
  /**
   * Where inside the data it is, as the keys and indexes to walk from the root.
   *
   * For a diagnostic about a whole file this is empty; for one about a message in a catalog it
   * names the scope and the message.
   */
  readonly path: readonly (string | number)[];
  /** Where in the source text, when the input was text Equator parsed. */
  readonly span?: SourceSpan;
}

/** An operation that finished, with what it produced and anything it had to say along the way. */
export interface ToolkitSuccess<T> {
  readonly ok: true;
  /** What the operation produced. */
  readonly value: T;
  /** Warnings and notes. Never an error: an error would have made this a failure. */
  readonly diagnostics: readonly ToolkitDiagnostic[];
}

/** An operation that did not finish, with the reasons. There is no partial value to read. */
export interface ToolkitFailure {
  readonly ok: false;
  /** Why it failed, with at least one error among them, and possibly warnings beside it. */
  readonly diagnostics: readonly ToolkitDiagnostic[];
}

/**
 * What every toolkit operation returns: a value with its diagnostics, or diagnostics alone.
 *
 * Returned rather than thrown, because a build that produced twelve problems should report twelve
 * rather than the first. Check `ok` before reading `value`.
 */
export type ToolkitResult<T> = ToolkitSuccess<T> | ToolkitFailure;

// A diagnostic is printed to a terminal and read by a machine, and
// `specs/11-diagnostics-and-observability.spec.md` section 2 says neither should be steerable
// by the input that produced it. A control character, a directional override or an isolate
// reaching diagnostic text is replaced rather than passed through, and the summary, the path
// and the number of diagnostics one operation produces are bounded beside it.
const unsafeDiagnosticControl =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function boundedDiagnosticText(
  value: string,
  maximumCodePoints: number,
): string {
  let result = '';
  let codePoints = 0;
  for (const character of value) {
    if (codePoints >= maximumCodePoints) break;
    result += unsafeDiagnosticControl.test(character) ? '\ufffd' : character;
    codePoints += 1;
  }
  return result;
}

function boundedPosition(position: SourcePosition): SourcePosition {
  const safe = (value: number) =>
    Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return Object.freeze({
    offset: safe(position.offset),
    line: safe(position.line),
    column: safe(position.column),
  });
}

function boundedSpan(span: SourceSpan): SourceSpan {
  const sourcePath =
    span.sourcePath === undefined
      ? undefined
      : boundedDiagnosticText(span.sourcePath, 4_096);
  return Object.freeze({
    ...(sourcePath === undefined ? {} : { sourcePath }),
    start: boundedPosition(span.start),
    end: boundedPosition(span.end),
  });
}

function boundedDiagnostics(
  diagnostics: readonly ToolkitDiagnostic[],
): readonly ToolkitDiagnostic[] {
  return Object.freeze(
    diagnostics.slice(0, RESOURCE_LIMITS.diagnostics).map((diagnostic) =>
      toolkitDiagnostic(diagnostic.code, diagnostic.summary, {
        severity: diagnostic.severity,
        path: diagnostic.path,
        ...(diagnostic.span === undefined
          ? {}
          : { span: boundedSpan(diagnostic.span) }),
      }),
    ),
  );
}

export function toolkitSuccess<T>(
  value: T,
  diagnostics: readonly ToolkitDiagnostic[] = [],
): ToolkitSuccess<T> {
  return Object.freeze({
    ok: true,
    value,
    diagnostics: boundedDiagnostics(diagnostics),
  });
}

export function toolkitFailure(
  diagnostics: readonly ToolkitDiagnostic[],
): ToolkitFailure {
  if (diagnostics.length === 0) {
    throw new TypeError('An Equator failure requires at least one diagnostic.');
  }

  return Object.freeze({
    ok: false,
    diagnostics: boundedDiagnostics(diagnostics),
  });
}

/**
 * Whether a set of diagnostics is allowed to pass.
 *
 * The single place that question is answered, and it is answered on **severity**.
 * `specs/10-compiler-and-tooling.spec.md` section 12 says a bare check fails only on an error,
 * and every opt-in policy expresses itself by raising a finding to that severity rather than by
 * joining a list somewhere else.
 *
 * A hardcoded blocking-codes list is a second register that every new error-severity diagnostic has
 * to be added to, and the one nobody remembers to add passes silently: `equator check
 * --require-complete` would report `"status": "success"` and exit 0 while carrying an error.
 */
export function diagnosticsBlock(
  diagnostics: readonly ToolkitDiagnostic[],
): boolean {
  return diagnostics.some(({ severity }) => severity === 'error');
}

export function toolkitDiagnostic(
  code: ToolkitDiagnosticCode,
  summary: string,
  options: {
    readonly path?: readonly (string | number)[];
    readonly span?: SourceSpan;
    readonly severity?: ToolkitDiagnosticSeverity;
  } = {},
): ToolkitDiagnostic {
  const safeSummary = boundedDiagnosticText(
    summary,
    RESOURCE_LIMITS.diagnosticSummaryCharacters,
  );
  const safePath = options.path
    ?.slice(0, RESOURCE_LIMITS.diagnosticPathSegments)
    .map((segment) =>
      typeof segment === 'string'
        ? boundedDiagnosticText(segment, 128)
        : Number.isSafeInteger(segment) && segment >= 0
          ? segment
          : 0,
    );
  return Object.freeze({
    code,
    severity: options.severity ?? 'error',
    summary: safeSummary.length === 0 ? 'Equator diagnostic.' : safeSummary,
    path: Object.freeze([...(safePath ?? [])]),
    ...(options.span === undefined ? {} : { span: boundedSpan(options.span) }),
  });
}

function positionAt(source: string, offset: number): SourcePosition {
  const boundedOffset = Math.max(0, Math.min(offset, source.length));
  let line = 0;
  let column = 0;

  for (let index = 0; index < boundedOffset; index += 1) {
    const character = source.charCodeAt(index);
    if (character === 0x0a) {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }

  return Object.freeze({ offset: boundedOffset, line, column });
}

export function spanAt(
  source: string,
  offset: number,
  length: number,
  sourcePath?: string,
): SourceSpan {
  const start = positionAt(source, offset);
  const end = positionAt(source, offset + Math.max(0, length));
  return Object.freeze({
    ...(sourcePath === undefined ? {} : { sourcePath }),
    start,
    end,
  });
}
import { RESOURCE_LIMITS } from './resource-limits.js';
