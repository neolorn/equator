import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, REQUEST, inject } from '@angular/core';
import { ɵassertStorableCookie } from '@neolorn/equator/core';

/**
 * Where a locale choice is remembered between visits.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 8 provides typed opt-in stores for
 * memory, a cookie, browser storage and an authenticated profile, and leaves their order, names,
 * attributes, lifetimes, scope, endpoints, credentials and synchronization to the consumer. A
 * description of how to write a store, in place of the stores, gets written once per application,
 * differently, in a multi-application workspace. The shared wrapper that normally prevents that
 * duplication is not always available: a workspace whose architecture forbids one application's
 * code reaching another's has nowhere to put it, which is the ordinary shape of a multi-application
 * repository rather than an unusual constraint.
 *
 * The port is deliberately two methods. Everything that needs to be identical across stores
 * (when a write happens, which writes may overwrite which, what a read has to look like before
 * it is believed, what happens when a store fails) belongs to the runtime, in one place, rather than
 * being repeated in each store and drifting.
 */
export interface LocalizationPersistenceStore {
  /** Names the store in diagnostics. Never used as a storage key. */
  readonly id: string;
  /**
   * The remembered locale, or `undefined` when there is none *or* when this store cannot be read
   * in the current environment. A store that cannot read where it is asked reports nothing rather
   * than failing: `localStorage` during server rendering is absent, not broken.
   */
  read(): string | undefined | Promise<string | undefined>;
  /**
   * Remembers a locale that has already been validated and committed.
   *
   * Called after the change succeeds, never during it, so a store never holds a locale the
   * application did not end up on. A store that cannot write where it is asked returns without
   * writing rather than throwing.
   */
  write(locale: string): void | Promise<void>;
  /**
   * Drops the remembered locale, leaving the page in whatever language it is already in.
   *
   * Optional, and that is part of the port rather than an omission:
   * `specs/03-locale-identity-and-resolution.spec.md` section 8 requires the port to stay
   * implementable without it, so a store written against the two-method version keeps compiling.
   * A store that offers none is reported as a store the removal did not reach, because a choice
   * dropped from one store and still held by another is read back at the next visit.
   *
   * A store that cannot act where it is asked returns without acting, as `write` does.
   */
  forget?(): void | Promise<void>;
}

/** One store a removal did not reach, and why it did not. */
export interface UnreachedLocaleStore {
  /** The store's own id, as it names itself in diagnostics. */
  readonly storeId: string;
  /** `no-removal` for a store that implements none, `failed` for one whose removal threw. */
  readonly reason: 'no-removal' | 'failed';
}

/**
 * What forgetting a remembered locale managed to do.
 *
 * Returned rather than thrown, because a removal that reached three stores of four is neither a
 * success nor an error: the choice is still in force and the application has to be able to say so.
 */
export interface LocaleRemovalReport {
  /** Whether every configured store dropped the value. */
  readonly complete: boolean;
  /** The stores still holding one, empty when the removal reached all of them. */
  readonly unreached: readonly UnreachedLocaleStore[];
}

/**
 * Stores are created per injector, not per configuration.
 *
 * An Angular application config is usually a module-level constant, so a store object created
 * there would be shared by every server-rendered request in the process.
 * `specs/06-runtime-and-angular.spec.md` section 6 makes persistence state context-local and
 * requires an adapter holding request state to be created by the context that owns it; a factory
 * is what makes that true by construction rather than by asking consumers to remember it.
 */
export type LocalizationPersistenceStoreFactory =
  () => LocalizationPersistenceStore;

/** Longest locale text any store will hand back. A BCP 47 tag is far shorter. */
const MAXIMUM_STORED_LENGTH = 64;

/**
 * Stored text is untrusted: a cookie is whatever the client sent.
 *
 * Rejected rather than repaired. `specs/03-locale-identity-and-resolution.spec.md` section 3 bounds
 * untrusted locale text and forbids using it directly as an identity or a protocol field, and a
 * value that needed repairing was not the value Equator wrote.
 */
function storedLocaleText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length === 0 ||
    value.length > MAXIMUM_STORED_LENGTH ||
    !/^[A-Za-z0-9-]+$/u.test(value)
    ? undefined
    : value;
}

/**
 * Remembers the choice for as long as the page is open, and no longer.
 *
 * The store to reach for when a preference must not outlive the session, and the one to use in
 * tests, where a real cookie or a real `localStorage` would leak between cases.
 */
export function memoryStore(): LocalizationPersistenceStoreFactory {
  return () => {
    let remembered: string | undefined;
    return Object.freeze({
      id: 'memory',
      read: () => remembered,
      write: (locale: string) => {
        remembered = locale;
      },
      forget: () => {
        remembered = undefined;
      },
    });
  };
}

/**
 * The cookie's name and attributes, all optional and all defaulted to something a browser keeps.
 *
 * A combination a browser would discard is refused when the store is built rather than ignored when
 * it is written, so a misconfiguration surfaces before the first render instead of as a language
 * that never sticks.
 */
export interface CookieStoreOptions {
  /** What the cookie is called. Defaults to `equator-locale`. */
  readonly name?: string;
  /** Which paths it is sent for. Defaults to `/`, and a `__Host-` name allows nothing else. */
  readonly path?: string;
  /**
   * Which hosts it is sent to, defaulting to the exact host that set it.
   *
   * Set it to share one choice across subdomains. A `__Host-` name may not carry it at all.
   */
  readonly domain?: string;
  /** How long it lives, in seconds. Defaults to a year. */
  readonly maxAgeSeconds?: number;
  /**
   * How it behaves on cross-site requests. Defaults to `Lax`.
   *
   * `None` requires `secure`, which is checked rather than corrected.
   */
  readonly sameSite?: 'Lax' | 'Strict' | 'None';
  /**
   * Whether it is sent over HTTPS only. Defaults to true.
   *
   * Turning it off is what local development over plain HTTP sometimes needs, and is what a
   * `__Secure-` or `__Host-` name forbids.
   */
  readonly secure?: boolean;
}

const DEFAULT_COOKIE_NAME = 'equator-locale';
const ONE_YEAR_SECONDS = 31_536_000;

function cookieValue(header: string, name: string): string | undefined {
  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    const raw = entry.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape is not a locale. Reporting nothing is the whole response:
      // the value came from the client and has no claim on being repaired.
      return undefined;
    }
  }
  return undefined;
}

/**
 * The store that fixes the language of the first render with nothing to build.
 *
 * A server render happens before any script runs in the browser, so `localStorage` is unavailable
 * to it; a cookie arrives with the request. That is the reason a server-rendered application needs
 * a store the server can read, this one or a profile the server can reach: without one the server
 * renders what the other sources decide and the browser corrects it after hydration, which is a
 * visible flash of the wrong language on every visit.
 *
 * Writing happens only in the browser. Setting a cookie on the server means setting a response
 * header, and Equator does not own the response; the consumer's server does. Nothing is lost: the
 * browser writes the same cookie as soon as it takes over.
 */
export function cookieStore(
  options: CookieStoreOptions = {},
): LocalizationPersistenceStoreFactory {
  const name = options.name ?? DEFAULT_COOKIE_NAME;
  const path = options.path ?? '/';
  const maxAge = options.maxAgeSeconds ?? ONE_YEAR_SECONDS;
  const sameSite = options.sameSite ?? 'Lax';
  const secure = options.secure ?? true;
  ɵassertStorableCookie('cookieStore', {
    name,
    path,
    domain: options.domain,
    maxAgeSeconds: maxAge,
    sameSite,
    secure,
  });
  return () => {
    const platformId = inject(PLATFORM_ID);
    const browser = isPlatformBrowser(platformId);
    const document = inject(DOCUMENT);
    const request = inject(REQUEST, { optional: true });
    return Object.freeze({
      id: 'cookie',
      read: () => {
        const header = browser
          ? document.cookie
          : (request?.headers.get('cookie') ?? undefined);
        return header === undefined || header.length === 0
          ? undefined
          : storedLocaleText(cookieValue(header, name));
      },
      write: (locale: string) => {
        if (!browser) return;
        document.cookie = [
          `${name}=${encodeURIComponent(locale)}`,
          `Path=${path}`,
          `Max-Age=${maxAge}`,
          `SameSite=${sameSite}`,
          ...(options.domain === undefined ? [] : [`Domain=${options.domain}`]),
          ...(secure ? ['Secure'] : []),
        ].join('; ');
      },
      forget: () => {
        if (!browser) return;
        // The same name, path and domain the write used. A browser matches a cookie on all three,
        // so an expiry written with any of them different leaves the original where it was and
        // adds a second one beside it.
        document.cookie = [
          `${name}=`,
          `Path=${path}`,
          'Max-Age=0',
          `SameSite=${sameSite}`,
          ...(options.domain === undefined ? [] : [`Domain=${options.domain}`]),
          ...(secure ? ['Secure'] : []),
        ].join('; ');
      },
    });
  };
}

/** Which key the choice is kept under. */
export interface LocalStorageStoreOptions {
  /** The storage key. Defaults to the same name the cookie store uses. */
  readonly key?: string;
}

/**
 * Remembers the choice on the device, and is invisible to the server.
 *
 * Correct for an application that renders in the browser, wrong on its own for one that renders on
 * the server: nothing here reaches the first response, so the server picks a language and the
 * browser changes it once the page has hydrated. Pair it with the cookie store, or use the cookie
 * store instead.
 */
export function localStorageStore(
  options: LocalStorageStoreOptions = {},
): LocalizationPersistenceStoreFactory {
  const key = options.key ?? DEFAULT_COOKIE_NAME;
  return () => {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    return Object.freeze({
      id: 'local-storage',
      read: () => {
        if (!browser) return undefined;
        try {
          return storedLocaleText(localStorage.getItem(key) ?? undefined);
        } catch {
          // Storage can be disabled or full, and reading it can throw outright. A preference
          // nobody can read is a preference that is absent, which the chain already handles.
          return undefined;
        }
      },
      write: (locale: string) => {
        if (!browser) return;
        localStorage.setItem(key, locale);
      },
      forget: () => {
        if (!browser) return;
        localStorage.removeItem(key);
      },
    });
  };
}

/**
 * The consumer's own transport to an authenticated preference.
 *
 * Deliberately thin. `specs/03-locale-identity-and-resolution.spec.md` section 8 gives the consumer
 * the endpoints, the credentials, the antiforgery and the synchronization, so a store that added
 * any of those would be taking back what the specification handed over. What it adds is uniformity: the
 * signed-in preference becomes one more ordered source, subject to the same commit ordering,
 * validation and failure handling as the cookie beside it, instead of a bespoke integration each
 * application wires differently.
 */
export interface LocalizationProfileTransport {
  /**
   * Fetches the signed-in reader's remembered locale, or nothing when there is none.
   *
   * Anything that is not a usable locale tag is treated as nothing, so a transport may answer with
   * whatever the endpoint returned without screening it first.
   */
  read(): string | undefined | Promise<string | undefined>;
  /** Sends a committed locale to wherever the application keeps the reader's preferences. */
  write(locale: string): void | Promise<void>;
  /**
   * Clears the reader's remembered preference, where the application offers that.
   *
   * Optional. A transport without one makes a store without one, which a removal reports as a
   * store it did not reach rather than quietly counting as done.
   */
  forget?(): void | Promise<void>;
}

/**
 * Turns an application's own preference endpoint into one more ordered source.
 *
 * Takes the two-method transport and returns a store factory to list among the others. The
 * preference is then subject to the same ordering, validation and failure handling as the cookie
 * beside it.
 *
 * A server render waits for the read, so a transport that can reach the reader's account from the
 * server fixes the language of the first response. One that can only ask from the browser answers
 * once the page has hydrated, and the page moves then; pair it with the cookie store where that
 * matters.
 */
export function profileStore(
  transport: LocalizationProfileTransport,
): LocalizationPersistenceStoreFactory {
  return () =>
    Object.freeze({
      id: 'profile',
      read: async () => storedLocaleText(await transport.read()),
      write: (locale: string) => transport.write(locale),
      // Present only where the transport has one, so a store built on a transport that cannot
      // clear the preference says so by not offering the method.
      ...(transport.forget === undefined
        ? {}
        : { forget: () => transport.forget?.() }),
    });
}
