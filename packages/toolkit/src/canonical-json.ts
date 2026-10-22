/**
 * One value, one serialization, so a fingerprint over it means something.
 *
 * `specs/01-standards-profile.spec.md` section 13 states the restriction and the reason for it: the
 * values refused here are the ones two readers would serialize differently, so a fingerprint over
 * one would not be stable. The domain label and the null byte between
 * it and the payload are what stop two kinds of value with the same shape from sharing a
 * fingerprint.
 */
import { createHash } from 'node:crypto';
import { compareCodeUnit } from './sorted-records.js';

export interface CanonicalJsonArray extends ReadonlyArray<CanonicalJsonValue> {}

export interface CanonicalJsonObject {
  readonly [key: string]: CanonicalJsonValue;
}

/**
 * Anything that can survive being written as JSON and read back: plain data and nothing else.
 *
 * A function, an accessor, a class instance and a cycle are all excluded by construction. Compiled
 * bodies and digest inputs are this type, so nothing downstream has to decide whether a value is
 * safe to read.
 */
export type CanonicalJsonValue =
  null | boolean | number | string | CanonicalJsonArray | CanonicalJsonObject;

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) {
        throw new TypeError(
          'Equator canonical JSON rejects an unpaired high surrogate.',
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(
        'Equator canonical JSON rejects an unpaired low surrogate.',
      );
    }
  }
}

function canonicalize(value: CanonicalJsonValue): string {
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(
        'Equator canonical JSON requires finite numbers without negative zero.',
      );
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError(
        'Equator canonical JSON requires safe integer numbers.',
      );
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  const record = value as Readonly<Record<string, CanonicalJsonValue>>;
  return `{${Object.keys(record)
    .sort(compareCodeUnit)
    .map((key) => {
      assertValidUnicode(key);
      return `${JSON.stringify(key)}:${canonicalize(record[key] as CanonicalJsonValue)}`;
    })
    .join(',')}}`;
}

export function stringifyCanonicalJson(value: CanonicalJsonValue): string {
  return canonicalize(value);
}

export function digestCanonicalJson(
  domain: string,
  value: CanonicalJsonValue,
): string {
  if (domain.length === 0 || /[\u0000\r\n]/u.test(domain)) {
    throw new TypeError(
      'An Equator fingerprint domain must be a nonempty single-line identifier.',
    );
  }
  assertValidUnicode(domain);

  return `sha256-${createHash('sha256')
    .update(`${domain}\u0000`, 'utf8')
    .update(stringifyCanonicalJson(value), 'utf8')
    .digest('base64url')}`;
}
