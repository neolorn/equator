import {
  developmentNode,
  floorOf,
  nodeFloors,
  peerRange,
} from './supported-versions.ts';

/** The versions and settings a row of its own installs and compiles with. */
export interface RowProfile {
  readonly angular: string;
  readonly angularTooling?: string;
  readonly typescript: string;
  readonly rxjs: string;
  readonly label: string;
  readonly compilerOptions?: Readonly<Record<string, boolean>>;
  readonly overlay?: string;
}

/** A consumer that installs another row's versions and lock, with what it changes. */
export interface VariantProfile {
  readonly row: string;
  readonly label: string;
  readonly overlay?: string;
  readonly node?: string;
}

/** A consumer's profile, resolved: the row it installs, and everything that row and it declare. */
export interface ConsumerProfile extends RowProfile {
  readonly row: string;
  readonly node?: string;
}

/** The manifest fields a row's versions are read from. */
export interface DependencyManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

// Angular ships its framework and its tooling on separate patch trains, so the two can sit at
// different versions on the same day. A profile that says nothing about tooling gets the framework
// version for both, which is how every row behaved before the trains diverged.
export const angularToolingPackages = new Set([
  '@angular/build',
  '@angular/cli',
  '@angular/ssr',
]);

export const consumerProfiles = new Map<string, RowProfile>([
  [
    'package-consumer',
    {
      angular: '22.2.1',
      angularTooling: '22.2.1',
      typescript: '6.0.3',
      rxjs: '7.8.2',
      label: 'Equator development row',
    },
  ],
  [
    'angular-22.0.4-consumer',
    {
      angular: '22.0.4',
      typescript: '6.0.3',
      rxjs: '7.8.2',
      label: 'Angular patch compatibility row',
    },
  ],
  // The versions of the development row, so the one thing this row varies is the compiler.
  //
  // What the other rows vary is the versions an application pins; what none of them varied is how
  // strictly it compiles, and a consumer's own options are the options analysis adopts, so every
  // row exercised one setting of them. The set below is what a demanding application turns on and
  // is the set the library holds itself to, minus two.
  //
  // `isolatedModules` and `verbatimModuleSyntax` are absent from this list for two different
  // reasons, and neither is an oversight.
  //
  // `isolatedModules` is already on. The fixture template sets it, so every row compiles under it
  // and this one inherits it; repeating it here would name a setting the list does not vary.
  //
  // `verbatimModuleSyntax` is left out because it cannot change an Equator diagnostic. TypeScript
  // 6.0 describes it as not transforming or eliding imports and exports that are not marked
  // type-only, so that they are written in the output file's format, which is a rule about emit.
  // What a name resolves to, and therefore what analysis sees, is the same with it and without it.
  // A row carrying it would be testing the fixture's import style. Adding it later needs a reason
  // of that kind, not the observation that the library sets it.
  [
    'strict-consumer',
    {
      angular: '22.2.1',
      angularTooling: '22.2.1',
      typescript: '6.0.3',
      rxjs: '7.8.2',
      label: 'Demanding compiler options',
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        useUnknownInCatchVariables: true,
        noImplicitOverride: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        noPropertyAccessFromIndexSignature: true,
        skipLibCheck: false,
      },
      overlay: 'fixtures/strict-consumer-overlay',
    },
  ],
  // Read from the peer ranges rather than written out. The floor of a range is what the range
  // claims to support, so a floor raised in a manifest moves this row with it, and there is no
  // window where the row proves a version the packages no longer admit.
  [
    'lower-bounds-consumer',
    {
      angular: floorOf(peerRange('@angular/core')),
      typescript: floorOf(peerRange('typescript')),
      rxjs: floorOf(peerRange('rxjs')),
      label: 'Lowest supported versions',
    },
  ],
]);

// The development row under each URL policy it does not declare. A policy is application source, so
// each of these is that row's consumer with the policy and its address table replaced, installed
// from that row's lock. They vary no version, so they are not rows of their own: a claim names the
// row whose versions are installed, and the policy it ran under is read from the policy object it
// observes.
export const policyConsumerProfiles = new Map<string, VariantProfile>([
  [
    'default-locale-prefix-consumer',
    {
      row: 'package-consumer',
      label: 'Default locale without a prefix',
      overlay: 'fixtures/default-locale-prefix-overlay',
    },
  ],
  [
    'locale-neutral-consumer',
    {
      row: 'package-consumer',
      label: 'Locale-neutral addresses',
      overlay: 'fixtures/locale-neutral-overlay',
    },
  ],
  [
    'locale-host-consumer',
    {
      row: 'package-consumer',
      label: 'A locale on each origin',
      overlay: 'fixtures/locale-host-overlay',
    },
  ],
]);

const lineOf = (version: string) => version.split('.')[0];

// The development row on every Node line the packages admit other than the one this repository
// develops on, at the lowest version of that line. Read from the engines range, so a line added or a
// floor raised moves these rows with it. The development line has no row here because every other
// row already runs on it. Like the policy rows they vary no package, so a claim names the
// development row and carries the Node it ran on.
export const nodeConsumerProfiles = new Map<string, VariantProfile>(
  nodeFloors
    .filter((version) => lineOf(version) !== lineOf(developmentNode))
    .map((version): [string, VariantProfile] => [
      `node-${lineOf(version)}-consumer`,
      {
        row: 'package-consumer',
        label: `Equator development row on Node ${version}`,
        node: version,
      },
    ]),
);

/** A consumer's profile, with `row` naming the row whose versions and lock it installs. */
export const resolveConsumerProfile = (
  consumerName: string,
): ConsumerProfile => {
  const consumerProfile = consumerProfiles.get(consumerName);
  if (consumerProfile !== undefined) {
    return { ...consumerProfile, row: consumerName };
  }
  for (const variants of [policyConsumerProfiles, nodeConsumerProfiles]) {
    const variant = variants.get(consumerName);
    if (variant !== undefined) {
      return { ...resolveConsumerProfile(variant.row), ...variant };
    }
  }
  throw new Error(`Unknown package-consumer profile: ${consumerName}`);
};

export const resolveAngularVersion = (
  consumerProfile: RowProfile,
  packageName: string,
) =>
  angularToolingPackages.has(packageName)
    ? (consumerProfile.angularTooling ?? consumerProfile.angular)
    : consumerProfile.angular;

/**
 * The version a row installs of one package, or `undefined` where the row names no such package.
 *
 * The profile decides where it names the package and the consumer template's manifest decides
 * otherwise, because those are the two sources the materializer writes a row's manifest from and
 * the row's lock is resolved against. Anything proven "on a row" has to read the same two.
 */
export const resolveRowVersion = (
  consumerProfile: RowProfile,
  templateManifest: DependencyManifest,
  name: string,
) => {
  if (name.startsWith('@angular/')) {
    return resolveAngularVersion(consumerProfile, name);
  }
  if (name === 'rxjs') return consumerProfile.rxjs;
  if (name === 'typescript') return consumerProfile.typescript;
  return (
    templateManifest.dependencies?.[name] ??
    templateManifest.devDependencies?.[name]
  );
};
