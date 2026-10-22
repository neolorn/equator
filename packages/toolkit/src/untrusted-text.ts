import {
  toolkitDiagnostic,
  toolkitFailure,
  toolkitSuccess,
  type ToolkitDiagnosticCode,
  type ToolkitResult,
} from './diagnostics.js';
import { RESOURCE_LIMITS } from './resource-limits.js';

/**
 * Checking that untrusted input is text at all, before anything reads it as text.
 *
 * `parseProviderId(42)` returned success with the number `42` branded as a provider
 * identity, and `parseLocaleAlias(undefined)` returned success with `undefined` branded as
 * an alias. Neither function was broken in an interesting way: `RegExp.prototype.test`
 * coerces its argument, so `42` is tested as `"42"` and `undefined` as `"undefined"`, and both
 * happen to satisfy an identifier grammar. The validator agreed, and the caller received a value
 * that was not a string at all wearing a type that says it is.
 *
 * The same coercion has a second face. `parseConfiguration(42)` reached
 * `Buffer.byteLength(42)` and threw a raw `TypeError` out of a function whose entire contract is to
 * return a diagnostic rather than throw.
 *
 * These are validators. Their callers hold values from JSON, from a command line, from a consumer's
 * configuration, `unknown` every one of them. Declaring the parameter as `string` did not stop a
 * number arriving; it only stopped the check that would have caught it from being written. So the
 * parameter is `unknown` and the check happens here, once.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 1 is the wider rule this belongs to: nothing is
 * trusted until bounded parsing and complete validation have passed it, whatever repository it
 * was stored in.
 */

/** No Equator identity, locale, or alias approaches this. Anything that does is not one. */
const MAXIMUM_IDENTITY_CHARACTERS = 256;

export function untrustedText(
  value: unknown,
  code: ToolkitDiagnosticCode,
  label: string,
  maximumCharacters: number = MAXIMUM_IDENTITY_CHARACTERS,
): ToolkitResult<string> {
  if (typeof value !== 'string') {
    return toolkitFailure([
      toolkitDiagnostic(
        code,
        // The type is named and the value is not. A value that reached a validator by mistake is
        // exactly the kind of value that should not be echoed into a diagnostic.
        `${label} must be a string, not ${describeType(value)}.`,
      ),
    ]);
  }
  if (value.length > maximumCharacters) {
    return toolkitFailure([
      toolkitDiagnostic(
        code,
        `${label} exceeds the ${maximumCharacters}-character implementation ceiling.`,
      ),
    ]);
  }
  return toolkitSuccess(value);
}

export function untrustedSource(
  value: unknown,
  code: ToolkitDiagnosticCode,
  label: string,
): ToolkitResult<string> {
  return untrustedText(value, code, label, RESOURCE_LIMITS.configurationBytes);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  return type === 'undefined'
    ? 'undefined'
    : type === 'object'
      ? 'an object'
      : `a ${type}`;
}
