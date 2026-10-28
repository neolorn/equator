/**
 * What to do about an offline install that cannot find a package, said where the failure is read.
 *
 * The consumer gates install `--offline --frozen-lockfile` on purpose: an upstream publish must not
 * be able to change what a run means. That has a precondition: the store already holds every
 * package those committed lockfiles name, and `pnpm run stage:consumer-store` is the command
 * that establishes it. On a machine that has never run it, pnpm says `ERR_PNPM_NO_OFFLINE_TARBALL` and
 * names a package, which is what is missing rather than what puts it there. Working that out from
 * the package name cost two red runs on the first machine that was not this one.
 *
 * Detected rather than appended to every install failure. A lockfile that disagrees with a manifest,
 * a network that is not there, a disk that is full: those are different problems, and a remedy that
 * is confidently wrong is worse than no remedy at all.
 */

/**
 * The install every consumer gate runs.
 *
 * pnpm checks a lockfile against its supply-chain policy before it installs from one, and keeps a
 * record of the lockfiles it has checked. The check reads registry metadata, so an offline install
 * that does not find its lockfile in that record fails with `ERR_PNPM_NO_OFFLINE_META` while the
 * store holds every package, and installs that start together have each missed a record that was
 * there. `stage:consumer-store` fetches from these same lockfiles with the network there, which is
 * where pnpm can run the check, so the offline install is told the lockfile is one already checked
 * and does not depend on the record.
 */
export const OFFLINE_INSTALL = Object.freeze([
  'install',
  '--offline',
  '--frozen-lockfile',
  '--trust-lockfile',
]);

const OFFLINE_STORE_MISS = /ERR_PNPM_NO_OFFLINE_(?:TARBALL|META)/u;

/** The one sentence, so the four gates that can hit this do not each write their own. */
export const OFFLINE_STORE_REMEDY =
  'The pnpm store does not hold everything the committed consumer lockfiles name, which is what ' +
  'an `--offline --frozen-lockfile` install needs and what nothing else establishes. Run ' +
  '`pnpm run stage:consumer-store` and try again: it fetches every package those lockfiles name ' +
  'into the store, and asserts that it did.';

/** A child's own output, with the remedy after it when the output is that failure. */
export const withOfflineStoreRemedy = (text: string) =>
  OFFLINE_STORE_MISS.test(text) ? `${text}\n\n${OFFLINE_STORE_REMEDY}` : text;
