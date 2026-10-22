/**
 * Header writes onto the response a server render shares with `@angular/ssr`.
 *
 * The engine builds `RESPONSE_INIT` with a `Headers` instance and sends it with the page or the
 * redirect the render became, so a field written here reaches the response without the host
 * composing anything. A test providing the token by hand may give a plain object, and that is
 * turned into `Headers` first so both are read the same way.
 */

/** The request field a server render reads a locale preference from. */
export const LANGUAGE_FIELD = 'Accept-Language';

function headersOf(init: ResponseInit): Headers {
  if (!(init.headers instanceof Headers)) {
    init.headers = new Headers(init.headers);
  }
  return init.headers;
}

/**
 * Adds a field to `Vary`, keeping the fields already named.
 *
 * Returns the value it replaced, `null` where there was none, so the caller can put it back.
 */
export function addVaryField(init: ResponseInit, field: string): string | null {
  const headers = headersOf(init);
  const previous = headers.get('vary');
  const named = (previous ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (
    !named.some(
      (name) => name === '*' || name.toLowerCase() === field.toLowerCase(),
    )
  ) {
    headers.set('vary', [...named, field].join(', '));
  }
  return previous;
}

/** Sets a header, returning the value it replaced, `null` where there was none. */
export function setHeader(
  init: ResponseInit,
  name: string,
  value: string,
): string | null {
  const headers = headersOf(init);
  const previous = headers.get(name);
  headers.set(name, value);
  return previous;
}

/** Puts back a value `addVaryField` or `setHeader` replaced. */
export function restoreHeader(
  init: ResponseInit,
  name: string,
  previous: string | null,
): void {
  const headers = headersOf(init);
  if (previous === null) headers.delete(name);
  else headers.set(name, previous);
}
