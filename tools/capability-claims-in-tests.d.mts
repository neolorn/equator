/** What a claim can observe, each as the live object the check holds. */
export interface CapabilityObservation {
  /** The URL policy the application runs. */
  readonly policy?: { readonly kind: string };
  /** The value of Angular's `PLATFORM_ID` in the injector the check rendered with. */
  readonly platform?: string;
  /** A document a server answered or a build wrote, as the text the check read. */
  readonly document?: string;
  /** How many server-rendered elements were still the same elements after the client booted. */
  readonly adoptedElements?: number;
  /** How many router navigations completed after the first one. */
  readonly clientNavigations?: number;
  /** The browser the driver launched. */
  readonly engine?: {
    browserType(): { name(): string };
    version(): string;
  };
}

/** States, after a test's assertions, which capability they asserted and in what context. */
export declare function claimCapability(
  capability: `${string}:${string}`,
  observed?: CapabilityObservation,
): void;
