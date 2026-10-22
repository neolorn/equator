/**
 * The locale cookie's configuration, checked where it is written down.
 *
 * The browser's cookie store and the server's request handler write the same cookie, so they
 * refuse the same configurations. A cookie a browser will not keep, or one no header can carry,
 * fails on the first response that writes it, so it is refused when the application's
 * configuration is evaluated instead.
 */

import { LocalizationError } from './contracts';

/** The attributes of the locale cookie, with the defaults already applied. */
export interface ɵCookieAttributes {
  /** The cookie's name, which a `Set-Cookie` header carries only when it is a token. */
  readonly name: string;
  /** The `Path` attribute. */
  readonly path: string;
  /** The `Domain` attribute, or `undefined` for a cookie sent back only to the host that set it. */
  readonly domain: string | undefined;
  /** The `Max-Age` attribute, in seconds. */
  readonly maxAgeSeconds: number;
  /** The `SameSite` attribute. */
  readonly sameSite: 'Lax' | 'Strict' | 'None';
  /** Whether the `Secure` attribute is written. */
  readonly secure: boolean;
}

/** RFC 6265 section 4.1.1 makes a cookie name a token, and RFC 9110 section 5.6.2 lists its characters. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

/** RFC 6265 section 4.1.1 allows a path or a domain any printable ASCII character except `;`. */
const ATTRIBUTE_VALUE = /^[ -:<-~]+$/u;

/**
 * Refuses a cookie configuration that cannot be written, or that a browser would discard.
 *
 * `draft-ietf-httpbis-rfc6265bis-22` section 5.7 ignores a newly created cookie entirely in four
 * cases a configuration can reach: `SameSite=None` without `Secure` (step 19), a `__Secure-` name
 * without `Secure` (step 20), and a `__Host-` name that is not `Secure`, or carries a `Domain`, or
 * has a `Path` other than `/` (step 21). Each writes a header the browser drops, so the server
 * renders the default language on every first visit, which is what the cookie exists to prevent.
 *
 * It refuses rather than repairs. Turning `Secure` on because `SameSite` is `None` would replace
 * what the application wrote with something else, which is the same silence one layer in.
 *
 * `owner` names the function the configuration was given to, so the message points at it. The
 * refusal is the typed configuration failure every other refused option ends as, so one handler
 * reads all of them.
 */
export function ɵassertStorableCookie(
  owner: string,
  cookie: ɵCookieAttributes,
): void {
  const refuse = (rule: string): never => {
    throw new LocalizationError(
      Object.freeze({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: `Equator ${owner}: ${rule}`,
        reason: 'malformed-input',
      }),
    );
  };
  const discarded = (rule: string): never =>
    refuse(
      `${rule} A browser ignores such a cookie entirely, so nothing would ever be stored or read.`,
    );
  const { name, path, domain, maxAgeSeconds, sameSite, secure } = cookie;
  if (!TOKEN.test(name)) {
    refuse(
      `the cookie name ${JSON.stringify(name)} is not a token (RFC 6265 section 4.1.1), so no Set-Cookie header can carry it.`,
    );
  }
  for (const [attribute, value] of [
    ['Path', path],
    ['Domain', domain],
  ] as const) {
    if (value !== undefined && !ATTRIBUTE_VALUE.test(value)) {
      refuse(
        `${attribute} ${JSON.stringify(value)} carries a control character or a ";" (RFC 6265 section 4.1.1), so no Set-Cookie header can carry it.`,
      );
    }
  }
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    refuse(
      `maxAgeSeconds is ${String(maxAgeSeconds)}, and Max-Age is a positive whole number of seconds (RFC 6265 section 4.1.1).`,
    );
  }
  if (sameSite === 'None' && !secure) {
    discarded(
      'SameSite=None requires Secure (rfc6265bis section 5.7 step 19).',
    );
  }
  const prefix = name.toLowerCase();
  if (prefix.startsWith('__secure-') && !secure) {
    discarded(
      'a __Secure- name requires Secure (rfc6265bis section 5.7 step 20).',
    );
  }
  if (prefix.startsWith('__host-')) {
    if (!secure) {
      discarded(
        'a __Host- name requires Secure (rfc6265bis section 5.7 step 21).',
      );
    }
    if (domain !== undefined) {
      discarded(
        'a __Host- name must not set Domain (rfc6265bis section 5.7 step 21).',
      );
    }
    if (path !== '/') {
      discarded(
        `a __Host- name requires Path=/ , not ${JSON.stringify(path)} (rfc6265bis section 5.7 step 21).`,
      );
    }
  }
}
