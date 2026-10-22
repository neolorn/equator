/**
 * The injections `verify:assurance:runtime` applies, kept apart from the runner so the normative
 * map can name one as the check behind a statement without importing a script that rebuilds the
 * package when it loads.
 */

export const injections = Object.freeze([
  {
    id: 'declared-numbering-system-never-reaches-a-message',
    invariant:
      'The numbering system an application declares reaches the numbers rendered inside its messages.',
    // This injection found a live defect rather than confirming one. `evaluator.ts` formatted
    // every `:number`, `:integer`, `:currency`, `:percent` and `:unit` placeholder with the bare
    // locale and never read `numberingSystem` at all, so an application declaring one through
    // `withFormattingContext()` had it honoured by the direct formatting API and dropped by every
    // number inside a message, which is where nearly all of an application's numbers are.
    //
    // It stayed invisible because the only lab context that set a numbering system asked `ar-EG`
    // for `arab`, its own default. Nothing crossed, so nothing could see it.
    //
    // This lives here rather than in the fast harness because the claim is about the channel: a
    // value written into a provider surviving composition, a locale change and the message
    // pipeline. A workspace test can build a `FormattingContext` and call a formatter; it cannot
    // ask whether the application's own declaration arrives.
    source: 'packages/runtime/src/evaluator.ts',
    find: `  const host = hostFormattingTag(
    functionName,
    'number',
    formattingTag,`,
    replace: `  const host = hostFormattingTag(
    functionName,
    'number',
    environment.formatting.locale,`,
  },
  {
    id: 'route-scopes-not-derived',
    invariant:
      'A route loads the scopes the generated table says it needs, without the application listing them.',
    source: 'packages/runtime/router/src/navigation-scopes.ts',
    // The whole body, and both parameters kept referenced. Taking the derivation out leaves the
    // lookup with no reader and the parameters with no use, and `noUnusedLocals` and
    // `noUnusedParameters` refuse to compile either, so the injected build failed rather than
    // the suite, which reports an invariant as unmeasurable rather than as unguarded. `void` is
    // what the injections below already use to say a symbol is still referenced and no longer
    // used, and it is the honest shape here too: this is the derivation switched off.
    find: [
      '  const entry = projection.generated.routes.find(({ id }) => id === routeId);',
      '  return entry?.scopes ?? NONE;',
    ].join('\n'),
    replace: ['  void projection;', '  void routeId;', '  return NONE;'].join(
      '\n',
    ),
  },
  {
    id: 'progressive-scope-left-out-of-a-first-render',
    invariant:
      'A render with no earlier view loads a scope its route names as progressive before it completes, as it loads a required one.',
    // The consumer's route-localization spec holds the scope's load open across the first
    // navigation, which lands without waiting once the scope goes back to arriving alongside it.
    source: 'packages/runtime/router/src/navigation-scopes.ts',
    find: '      alongside ? NONE : input.progressive,',
    replace: '      NONE,',
  },
  {
    id: 'not-found-abandons-the-navigation',
    invariant:
      "A not-found commits its locale and lets the application's own routing answer, rather than throwing.",
    // The anchor is the statements the invariant is made of rather than one line out of them,
    // because a bare `return undefined;` is an ordinary line: six of them are in this file, and a
    // pointer matching six places points at none of them. Assembled from an array so the anchor
    // stays readable and needs no escaping.
    source: 'packages/runtime/router/src/route-localization.ts',
    find: [
      '      await this.localization.changeLocale(resolution.presentationLocale, {',
      "        mode: this.options.mode ?? 'coordinated',",
      '      });',
      '      this.applyOutcomeDocument(resolution.status);',
      '      return undefined;',
    ].join('\n'),
    replace: '      throw new RouteLocalizationError(resolution);',
  },
  {
    id: 'document-locale-not-maintained',
    invariant:
      "The document's `lang` and `dir` follow the committed locale without being asked to.",
    source: 'packages/runtime/src/angular.ts',
    find: '          hooks.push(new DocumentLocaleCommitHook(document));',
    replace: '          void DocumentLocaleCommitHook;',
  },
  {
    id: 'interaction-not-preserved',
    invariant:
      'Focus, selection and scroll survive a locale transition without being asked to.',
    // The consumer's route-localization spec restores the reader after a locale change that no
    // navigation follows, and fails when nothing scrolls them back.
    source: 'packages/runtime/src/angular.ts',
    find: `          new InteractionPreservationCommitHook(
            document,
            isPlatformBrowser(platformId),
            inject(LocalizationInteractionRestore),
          ),`,
    replace: `          new InteractionPreservationCommitHook(
            document,
            false,
            inject(LocalizationInteractionRestore),
          ),`,
  },
  {
    id: 'locale-announcement-not-published',
    invariant:
      'A locale change is announced into a live region Equator owns, with the application rendering nothing.',
    source: 'packages/runtime/src/angular.ts',
    find: `            new LocaleAnnouncementCommitHook(
              document,
              isPlatformBrowser(platformId),`,
    replace: `            new LocaleAnnouncementCommitHook(
              document,
              false,`,
  },
  {
    id: 'post-commit-effects-never-run',
    invariant:
      'Effects that must follow a successful commit (announcement, interaction restore) actually run after it.',
    source: 'packages/runtime/src/localization.ts',
    find: '          hook.committed?.(next.publicSnapshot);',
    replace: '          void hook;',
  },
  {
    id: 'failed-commit-is-not-rolled-back',
    invariant:
      'A coherence-critical effect that fails leaves the previous locale, URL, view and document state in place.',
    source: 'packages/runtime/src/localization.ts',
    find: '          hook.rollback?.(previous?.publicSnapshot);',
    replace: '          void hook;',
  },
  {
    id: 'locale-source-order-ignored',
    invariant:
      'Locale sources are consulted in the order the application declared, and the first answer wins.',
    source: 'packages/runtime/src/locale-resolution.ts',
    // Reversed rather than emptied, because an empty list falls through to the default locale and
    // a test could pass on that by coincidence. Reversing keeps every source in play and only
    // changes which one is believed. At the one definition of the order, so every walk is reversed.
    find: '    return this.context.localeSources ?? DEFAULT_LOCALE_SOURCES;',
    replace:
      '    return [...(this.context.localeSources ?? DEFAULT_LOCALE_SOURCES)].reverse();',
  },
  {
    id: 'chosen-locale-is-not-remembered',
    invariant:
      'A committed locale change is written to the persistence stores the application configured.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '    this.persistenceHighWater = snapshot.id;',
    replace:
      '    this.persistenceHighWater = snapshot.id;\n    if (stores.length >= 0) return;',
  },
  // The seven capability areas found to have tests but no mutation-verified coverage. Every one
  // was already exercised by the consumer suite; none was guarded, which is a different claim
  // and the one this gate exists to make.
  {
    id: 'overlay-roots-do-not-follow-the-locale',
    invariant:
      'Overlay content takes its language and direction from the committed locale, with the application wiring nothing.',
    source: 'packages/runtime/src/angular.ts',
    find: `  apply(snapshot: LocalizationSnapshot): void {
    this.adapter.apply(snapshot);
  }`,
    replace: `  apply(snapshot: LocalizationSnapshot): void {
    void snapshot;
  }`,
  },
  {
    id: 'overlay-adapter-outlives-its-request',
    invariant:
      'An overlay adapter is disposed with the request that created it.',
    // Separate from the injection above because the two fail in opposite directions: one never
    // applies, one never stops. On a server the second is the unrecoverable half: an undisposed
    // adapter carries one request's overlay roots into the next.
    source: 'packages/runtime/src/angular.ts',
    find: `  dispose(): void {
    this.adapter.dispose?.();
  }`,
    replace: `  dispose(): void {
    void this.adapter;
  }`,
  },
  {
    id: 'required-participants-not-awaited',
    invariant:
      'A participant registered as required is prepared before the locale commits, not alongside it.',
    source: 'packages/runtime/src/localization.ts',
    // Emptied through `slice` rather than replaced with a literal, so the expression keeps its
    // type and the coordinator is still consulted: only its answer is discarded.
    find: `    const requiredParticipants = this.participantCoordinator.required();`,
    replace: `    const requiredParticipants = this.participantCoordinator
      .required()
      .slice(0, 0);`,
  },
  {
    id: 'progressive-participants-never-start',
    invariant:
      'In progressive mode the primary UI commits first and the independent regions still run afterwards.',
    source: 'packages/runtime/src/localization.ts',
    find: `    const progressiveParticipants = this.participantCoordinator.progressive();`,
    replace: `    const progressiveParticipants = this.participantCoordinator
      .progressive()
      .slice(0, 0);`,
  },
  {
    id: 'registered-message-function-unreachable',
    invariant:
      'A message function the application registered is reachable from a message that calls it.',
    source: 'packages/runtime/src/extensions.ts',
    // An early return rather than a deleted lookup: the condition is not statically false, so the
    // rest of the method stays type-checked and the injection cannot be undone by the compiler.
    find: `  messageFunction(id: string): RuntimeMessageFunctionBinding | undefined {`,
    replace: `  messageFunction(id: string): RuntimeMessageFunctionBinding | undefined {
    if (id.length >= 0) return undefined;`,
  },
  {
    id: 'notification-ignores-its-message-kind',
    invariant:
      "A notification's message is evaluated according to its own result kind, so a plain message arrives as text.",
    source: 'packages/runtime/src/presentation.ts',
    find: `  const content =
    notification.message.resultKind === 'plain'
      ? localization.evaluateText(
          notification.message as PlainMessageHandle,
          notification.inputs ?? {},
        )
      : localization.parts(
          notification.message as MessageHandle & {
            readonly resultKind: 'structured';
          },
          notification.inputs ?? {},
        );`,
    replace: `  const content = localization.parts(
    notification.message as unknown as MessageHandle & {
      readonly resultKind: 'structured';
    },
    notification.inputs ?? {},
  );`,
  },
  {
    id: 'recovery-text-never-published',
    invariant:
      'When localization itself is unavailable, the recovery message the application supplied is published for rendering.',
    // The toolkit gate already refuses an owner that composes no recovery root
    // (`missing-recovery-root-unreported`). That is a build-time claim about the consumer. This is
    // the runtime half: the root is present and there is nothing for it to show.
    source: 'packages/runtime/src/localization.ts',
    // The message alone. The retry label beside it keeps publishing, so what the suite sees is a
    // recovery surface that came up with nothing to read, which is what the invariant's name says
    // happens, rather than a surface that is missing altogether.
    find: `        this.recoveryValue.set(
          this.recoveryOrNothing(
            this.options.recoveryMessageIdentity,
            locale,
            transitionId,
          ),
        );`,
    replace: `        this.recoveryValue.set(undefined);`,
  },
  {
    id: 'superseded-write-overwrites-a-newer-choice',
    invariant:
      'A slow write for an abandoned locale cannot land after, and overwrite, the choice that replaced it.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '        if (snapshotId < this.persistenceHighWater) {',
    replace: '        if (false) {',
  },
  {
    id: 'document-locale-withdrawal-ignored',
    invariant:
      '`withoutDocumentLocale()` actually stops Equator writing to a document it was told it does not own.',
    // The other half of `document-locale-not-maintained`, and a separate injection because the two
    // fail in opposite directions: that one breaks the default, this one breaks the withdrawal, and
    // a suite that only asserts the default passes with the withdrawal welded shut. Withdrawal is
    // the reading a widget depends on, and a widget that rewrites its host page's `lang` is a defect
    // nothing throws for.
    source: 'packages/runtime/src/angular.ts',
    find: `        if (documentLocale === undefined) {
          hooks.push(new DocumentLocaleCommitHook(document));
        }`,
    replace: `        if (true) {
          hooks.push(new DocumentLocaleCommitHook(document));
        }`,
  },
  {
    id: 'identifier-parameter-codec-accepts-anything',
    invariant:
      'An identifier route parameter is checked against its pattern before it becomes a route parameter.',
    // A codec whose `parse` always succeeds is the shape this defect takes: nothing throws, every
    // address resolves, and `../etc` arrives as a route parameter with the application's own
    // not-found page never reached.
    //
    // It stays here rather than moving to the fast harness with its integer sibling, and the
    // difference is reachability rather than preference: the consumer's article route uses this
    // codec, so the consumer's own suite is what notices. Nothing in the consumer exercises an
    // integer parameter, so the integer codec's injection is in `verify-assurance.mjs`, named to
    // the workspace test that covers it.
    source: 'packages/runtime/core/src/routing.ts',
    find: '        pattern.test(value) ? { ok: true, value } : { ok: false },',
    replace: '        { ok: true, value },',
  },
  {
    id: 'deferred-block-keeps-the-render-locale',
    invariant:
      'Localized content inside a deferred hydration boundary, claimed after a locale commits, shows the committed locale.',
    // In the consumer rather than the runtime, and that is where the behavior is. The runtime has
    // no code path for a deferred block, and `specs/06-runtime-and-angular.spec.md` section 10
    // forbids it one: Angular's update pass writes the committed value over the DOM hydration
    // claims. What the browser stage guards is therefore a framework change that stops that
    // write, and the observable one produces is a binding whose value already equals the server's
    // text when the block is claimed. Freezing the one binding inside the block at construction
    // produces exactly that, in the page opened in en-US, and leaves every binding outside the
    // block following the commit. A staleness injected into the runtime instead would stop every
    // text in the page, and an earlier stage would refuse it first.
    //
    // A browser row stops at its first failure, so the refusal below can only come from the stage
    // that owns it.
    source: 'fixtures/package-consumer-template/src/app/app.ts',
    find: `  protected readonly incrementalText = this.localization.textSignal(
    messages.incremental.ready,
  );`,
    replace: `  protected readonly incrementalText = signal(
    this.localization.ready()
      ? this.localization.text(messages.incremental.ready)
      : '',
  );`,
    suite: 'browser',
    caughtWhen:
      /The deferred block, hydrated with ar-EG committed, kept "Incremental localization boundary ready\."/u,
  },
  {
    id: 'navigation-declaration-kept-past-commit',
    invariant:
      'A committed navigation replaces the standing parameter-spelling declaration, including when the arriving page declares nothing.',
    source: 'packages/runtime/router/src/route-parameters.ts',
    find: '          spellings === undefined\n            ? undefined\n            : { navigationId: event.id, spellings },',
    replace:
      '          spellings === undefined\n            ? this.committed()\n            : { navigationId: event.id, spellings },',
  },
  {
    id: 'late-parameter-declaration-not-projected',
    invariant:
      'A parameter-spelling declaration that arrives after its navigation committed moves the document head.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '      this.localization.ɵrestateRoute(\n        this.routeRecord(active, this.projectDocument(active)),\n      );\n    } catch {\n      // Same judgement as a failed locale commit',
    replace:
      '      void active;\n    } catch {\n      // Same judgement as a failed locale commit',
  },
  {
    id: 'router-origin-accepted-unnamed',
    invariant:
      'The router refuses an origin the locale-host policy does not name, scheme included.',
    source: 'packages/runtime/router/src/provide.ts',
    find: '  if (normalized !== undefined && policy.origins[normalized] !== undefined)\n    return;',
    replace: '  if (normalized !== undefined)\n    return;',
  },
  {
    id: 'handed-address-not-delocalized',
    invariant:
      'An address the application hands the router is delocalized through the same translation as one the browser supplies.',
    source: 'packages/runtime/router/src/url-handling-strategy.ts',
    find: '    const internal = toInternalPath(supplied, this.context);',
    replace:
      '    const internal = supplied || toInternalPath(supplied, this.context);',
  },
  {
    id: 'entry-destination-built-in-default-locale',
    invariant:
      "A locale-entry redirect's destination is spelled in the locale it resolved to.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '        unprefixedMatch.route,\n        preferred,',
    replace: '        unprefixedMatch.route,\n        policy.defaultLocale,',
  },
  {
    id: 'restored-page-never-checked',
    invariant:
      'A page shown again from the back-forward cache is checked against the remembered locale.',
    source: 'packages/runtime/src/angular.ts',
    find: '          if (!event.persisted) return;',
    replace: '          if (event.persisted || !event.persisted) return;',
  },
  {
    id: 'programmatic-locale-address-unreported',
    invariant:
      'A navigation to a localized address is reported in development, naming the address as written, the canonical address and the operation that changes locale.',
    source: 'packages/runtime/router/src/url-handling-strategy.ts',
    find: '    if (!isDevMode()) return;',
    replace: '    if (supplied.length >= 0 || !isDevMode()) return;',
  },
  {
    id: 'unprojected-address-head-not-written',
    invariant:
      'The head of a response at an address the projection does not contain is written from its outcome class.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '    this.outcomeDocument = outcomeClass;',
    replace:
      '    this.outcomeDocument = outcomeClass;\n    if (outcomeClass.length >= 0) return;',
  },
  {
    id: 'locale-committed-without-an-address',
    invariant:
      'A locale change on a page whose route has no address in the target locale ends as failed and commits nothing.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '    this.reresolve(active, locale);',
    replace: '    void locale;',
  },
  {
    id: 'locale-change-unasked-about-a-committed-destination',
    invariant:
      'A locale change made in place after a navigation committed its locale and before it landed is answered for the destination.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '    if (destination !== undefined) this.reresolve(destination, locale);',
    replace: '    void locale;',
  },
  {
    id: 'navigation-change-redirected-let-through',
    invariant:
      'A navigation whose own locale change ends as redirected fails, and does not go on as though the change had committed.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: "    if (result !== undefined && result.status !== 'committed') {",
    replace:
      "    if (\n      result !== undefined &&\n      result.status !== 'committed' &&\n      result.status !== 'redirected'\n    ) {",
  },
  {
    id: 'cancelled-navigation-undoes-a-change-made-in-place',
    invariant:
      'A navigation that ends without its page after its commit, cancelled or landed with a document that cannot be written, puts the page it left back in the locale a change made in place since has committed.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '      navigationLocale: pending.context.resolution.locale,',
    replace:
      '      navigationLocale:\n        this.localization.snapshot()?.primaryLocale ??\n        pending.context.resolution.locale,',
  },
  {
    id: 'locale-change-unasked-during-a-navigation',
    invariant:
      'A locale change made in place while a navigation is in flight is answered for the page on screen.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '      !isRecordOf(route, active)',
    replace: '      (isRecordOf(route, active) || true)',
  },
  {
    id: 'document-sent-to-an-origin-with-no-address',
    invariant:
      "A locale change to another origin, on a page with no spelling in that locale, ends as failed and does not send the document to that origin's root.",
    source: 'packages/runtime/router/src/route-localization.ts',
    // The refusing build stays in the expression, so the injected source still compiles with
    // every symbol read.
    find: '      this.addressesFor(context, spellings)[locale] ??\n      buildLocalizedRoute(',
    replace:
      '      this.addressesFor(context, spellings)[locale] ??\n      (this.options.policy.locales[locale] as string) ??\n      buildLocalizedRoute(',
  },
  {
    id: 'canonical-correction-split-into-hops',
    invariant:
      'A prefix or alias correction is combined with every other correction the address needs into a single 308.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    locale,\n    match.canonicalSegments,\n  );',
    replace:
      "    locale,\n    ownEntry(policy.prefixes, first ?? '') === undefined\n      ? routeSegments\n      : match.canonicalSegments,\n  );",
  },
  {
    id: 'variant-navigation-kept-as-written',
    invariant:
      'A client navigation to a variant arrives at the canonical address, and the page reads its canonical parameters.',
    source: 'packages/runtime/router/src/provide.ts',
    find: '    if (router.serializeUrl(canonical) !== state.url) {',
    replace:
      '    if (router.serializeUrl(canonical) !== state.url && canonical === undefined) {',
  },
  {
    id: 'locale-switch-pushes-history',
    invariant:
      "A locale switch rewrites the current history entry's address rather than adding an entry.",
    source: 'packages/runtime/router/src/address-sync.ts',
    find: "    this.location.replaceState(this.router.url, '', this.location.getState());",
    replace:
      "    this.location.go(this.router.url, '', this.location.getState());",
  },
  {
    id: 'address-bar-left-behind-by-switch',
    invariant: 'The address bar follows a committed locale switch.',
    source: 'packages/runtime/router/src/address-sync.ts',
    find: '    if (expected === `${pathname}${search}${hash}`) return;',
    replace:
      '    if (expected !== `${pathname}${search}${hash}` || expected.length >= 0) return;',
  },
  {
    id: 'scope-load-published-without-a-transaction',
    invariant:
      'A scope that finishes loading is published as its own transaction, with a new snapshot identity.',
    source: 'packages/runtime/src/localization.ts',
    find: '      id: (this.nextSnapshotId += 1),\n      loadedScopes,',
    replace: '      id: current.publicSnapshot.id,\n      loadedScopes,',
  },
  {
    id: 'locale-choice-language-not-written',
    invariant:
      'A locale choice control carries the language of the option it is bound to.',
    source: 'packages/runtime/src/locale-choice.ts',
    find: "    '[attr.lang]': 'choice().language',",
    replace: "    '[attr.lang]': 'null',",
  },
  {
    id: 'locale-choice-link-has-no-address',
    invariant:
      'A locale choice on a link carries the address of the page in that locale as its href.',
    source: 'packages/runtime/src/locale-choice.ts',
    find: "    '[attr.href]': 'address()',",
    replace: "    '[attr.href]': 'null',",
  },
  {
    id: 'non-indexable-route-keeps-its-cluster',
    invariant:
      'A route that is not indexable carries no canonical and no alternates.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (indexing !== 'indexable') {",
    replace: "  if (indexing !== 'indexable' && false) {",
  },
  {
    id: 'declared-document-overrides-the-page',
    invariant:
      'A field the page supplies replaces the same field the route declared.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '      ...declared,\n      ...(dynamic ?? {}),',
    replace: '      ...(dynamic ?? {}),\n      ...declared,',
  },
  {
    id: 'unbound-document-message-refused-only-when-visited',
    invariant:
      'An unbound document message is refused when the router is provided, before any page is visited.',
    source: 'packages/runtime/router/src/provide.ts',
    find: '  refuseUnboundDocumentMessages(options);',
    replace: '  void refuseUnboundDocumentMessages;',
  },
  {
    id: 'document-message-inputs-dropped',
    invariant:
      'A declared document message is resolved with the inputs declared beside it.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '        ? this.localization.text(field.message, field.inputs)',
    replace: '        ? this.localization.text(field.message)',
  },
  {
    id: 'previous-document-head-left-standing',
    invariant:
      'Everything written into the head for the previous document is removed before the next is written.',
    source: 'packages/runtime/src/angular.ts',
    find: '      for (const node of previousNodes) node.parentNode?.removeChild(node);',
    replace: '      for (const node of previousNodes) void node;',
  },
  {
    id: 'absent-page-keeps-its-cluster',
    invariant:
      'A page declared absent or removed carries no canonical and no alternates.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '  return WITHDRAWN_SEO;',
    replace: '  void WITHDRAWN_SEO;\n  return seo;',
  },
  {
    id: 'social-block-without-an-image',
    invariant: 'No Open Graph block is written until an image is supplied.',
    source: 'packages/runtime/src/angular.ts',
    find: "      if (social?.image !== undefined) {\n        // Order follows ogp.me's own listing of the four required properties, so a reader comparing\n        // the emitted head against the specification reads them in the same sequence.\n        if (projection.title !== undefined)\n          property('og:title', projection.title);\n        property('og:type', social.type ?? 'website');\n        property('og:image', social.image);",
    replace:
      "      if (social !== undefined) {\n        if (projection.title !== undefined)\n          property('og:title', projection.title);\n        property('og:type', social.type ?? 'website');\n        property('og:image', social.image ?? '');",
  },
  {
    id: 'robots-meta-not-written',
    invariant:
      'A page that is not to be indexed carries a robots meta element in its head.',
    source: 'packages/runtime/src/angular.ts',
    find: "      if (seo?.robots !== undefined) meta('robots', seo.robots);",
    replace: '      void seo?.robots;',
  },
  {
    id: 'unbound-slot-rendered',
    invariant:
      'A structured message whose slot has no trusted binding of the right kind is refused rather than rendered.',
    source: 'packages/runtime/src/message-template.ts',
    find: '    requireBindings(\n      result.value,\n      this.slots() as Readonly<Record<string, TrustedSlotBinding>>,\n    );',
    replace: '    void requireBindings;',
  },
  {
    id: 'structured-value-rendered-without-an-isolating-element',
    invariant:
      'The structured surface isolates an interpolated value in its own element, as the plain-text surface isolates it with characters.',
    source: 'packages/runtime/src/message-template.ts',
    find: '            <bdi\n              [attr.lang]="part.language"\n              [attr.dir]="part.contentDirection"\n              >{{ part.value }}</bdi\n            >',
    replace:
      '            <span\n              [attr.lang]="part.language"\n              [attr.dir]="part.contentDirection"\n              >{{ part.value }}</span\n            >',
  },
  {
    id: 'label-written-outside-its-attribute-set',
    invariant:
      'A localized label is written only into one of the attributes whose value is presented, never into href, src, formaction or an event attribute.',
    source: 'packages/runtime/src/label.ts',
    find: '      if (!isLabelAttribute(attribute)) {',
    replace: '      if (!isLabelAttribute(attribute) && false) {',
  },
  {
    id: 'label-clears-the-other-label-attributes',
    invariant:
      'Writing a localized label into one attribute leaves every other attribute on the element as the author wrote it.',
    source: 'packages/runtime/src/label.ts',
    find: '      this.renderer.setAttribute(this.element.nativeElement, attribute, value);',
    replace:
      '      for (const name of LABEL_ATTRIBUTES) {\n        if (name !== attribute) {\n          this.renderer.removeAttribute(this.element.nativeElement, name);\n        }\n      }\n      this.renderer.setAttribute(this.element.nativeElement, attribute, value);',
  },
  {
    id: 'replaced-wording-withdraws-the-announcement',
    invariant:
      'Supplying announcement wording replaces the words and keeps the live region and the announcement.',
    source: 'packages/runtime/src/angular.ts',
    find: '              isPlatformBrowser(platformId),\n              announcement?.format ?? defaultLocaleAnnouncement,',
    replace:
      '              isPlatformBrowser(platformId) && announcement === undefined,\n              announcement?.format ?? defaultLocaleAnnouncement,',
  },
  {
    id: 'empty-announcement-wording-treated-as-a-mistake',
    invariant:
      'An announcement format that supplies no wording is accepted, and nothing is announced in its place.',
    source: 'packages/runtime/src/angular.ts',
    find: '    if (wording === undefined) return undefined;',
    replace:
      "    if (wording === undefined) {\n      throw new LocalizationError({\n        code: 'effect-failed',\n        outcome: 'operational-failure',\n        message: 'The locale announcement is empty.',\n      });\n    }",
  },
  {
    id: 'announcement-worded-before-publication',
    invariant:
      "The announcement wording is asked for after the change is published, so a wording read from the application's messages is in the arriving locale.",
    source: 'packages/runtime/src/angular.ts',
    find: "  apply(): void {\n    // Nothing is worded inside the transaction. `specs/06-runtime-and-angular.spec.md` section 11\n    // runs the announcement after the commit it belongs to, and the wording is the application's:\n    // asked here, the catalogs it reads and the head it describes are still the locale being left.\n  }\n\n  /**\n   * Worded once the change is published, and announced a frame after that.\n   *\n   * Worded here because this is the first moment the application's function can see the page it is\n   * describing: its messages answer in the arriving locale and the head has been re-projected, the\n   * routed steps being ahead of this hook. A wording that cannot be said is the application's\n   * failure and not the change's, so it is reported and the default is said instead, which keeps\n   * the decision to announce.\n   *\n   * Published a frame later still, because the message describes a locale the page has moved to,\n   * and a screen reader given it now reads it while the controls it describes may still show the\n   * previous locale. Waiting is also what keeps it truthful when a commit is abandoned: nothing was\n   * said yet, so there is nothing to retract.\n   */\n  committed(snapshot: LocalizationSnapshot): void {\n    const previous = this.previousLocale;\n    this.previousLocale = snapshot.primaryLocale;\n    if (previous === undefined || previous === snapshot.primaryLocale) return;\n    // Moved even when nothing is said, so an announcement queued for a locale this commit has\n    // already left is dropped rather than read out after it.\n    this.sequence += 1;\n    let message: string | undefined;\n    let failure: unknown;\n    try {\n      message = this.worded(this.format(snapshot));",
    replace:
      '  private early: string | undefined;\n\n  apply(snapshot: LocalizationSnapshot): void {\n    this.early = this.format(snapshot);\n  }\n\n  committed(snapshot: LocalizationSnapshot): void {\n    const previous = this.previousLocale;\n    this.previousLocale = snapshot.primaryLocale;\n    if (previous === undefined || previous === snapshot.primaryLocale) return;\n    this.sequence += 1;\n    let message: string | undefined;\n    let failure: unknown;\n    try {\n      message = this.worded(this.early);',
  },
  {
    id: 'unannounceable-wording-silences-the-change',
    invariant:
      'Wording that cannot be announced is replaced by the default announcement rather than by silence.',
    source: 'packages/runtime/src/angular.ts',
    find: '      message = defaultLocaleAnnouncement(snapshot);',
    replace: '      message = undefined;',
  },
  {
    id: 'active-composition-rewritten-by-a-locale-change',
    invariant:
      'A locale change does not rewrite a localized field while a text composition is active in it.',
    source: 'packages/runtime/forms/src/public-api.ts',
    find: '    if (this.composing) {\n      this.pendingRender = true;\n      return;\n    }',
    replace: '    // An active composition is not waited for.',
  },
  {
    id: 'overlay-adapter-created-where-the-feature-is-declared',
    invariant:
      'The overlay adapter is created inside the injector that owns each request, not once where the feature is declared.',
    source: 'packages/runtime/src/angular.ts',
    find: "  return freezeFeature<OverlayLocaleFeature>({\n    ɵkind: 'overlay-locale',\n    create,\n  });",
    replace:
      "  const adapter = create();\n  return freezeFeature<OverlayLocaleFeature>({\n    ɵkind: 'overlay-locale',\n    create: () => adapter,\n  });",
  },
  {
    id: 'every-icon-mirrored-in-right-to-left',
    invariant:
      'Only an icon the application classified as direction-relative is mirrored in a right-to-left locale.',
    source: 'packages/runtime/src/locale-presentation.ts',
    find: "    mirror: classification === 'relative' && direction === 'rtl',",
    replace: "    mirror: direction === 'rtl',",
  },
  {
    id: 'asset-fallback-guessed-from-declared-variants',
    invariant:
      'Asset selection tries the target locale and the fallbacks the request lists, and nothing it was not given.',
    source: 'packages/runtime/src/assets.ts',
    find: '  for (const locale of attemptedLocales) {',
    replace:
      '  for (const locale of [...attemptedLocales, ...variants.keys()]) {',
  },
  {
    id: 'fixed-language-asset-reported-as-a-fallback',
    invariant:
      'A fixed-language asset served to a reader of another language is reported as itself, not as a fallback for a missing translation.',
    source: 'packages/runtime/src/assets.ts',
    find: "      status: 'ready',\n      fallback: false,\n      representation: Object.freeze({\n        kind: 'fixed-language' as const,\n        source: descriptor.source,",
    replace:
      "      status: 'ready',\n      fallback: true,\n      representation: Object.freeze({\n        kind: 'fixed-language' as const,\n        source: descriptor.source,",
  },
  {
    id: 'participant-report-carries-its-input',
    invariant:
      "A dynamic asset participant report is rebuilt from its bounded metadata and carries none of the input's other fields.",
    source: 'packages/runtime/src/assets.ts',
    find: "      return Object.freeze({\n        status: 'ready',\n        identity,\n        representation: participantRepresentation(input.representation),\n      });",
    replace:
      "      return Object.freeze({\n        ...input,\n        status: 'ready',\n        identity,\n        representation: participantRepresentation(input.representation),\n      });",
  },
  {
    id: 'decimal-keeps-trailing-zeros',
    invariant:
      'Two spellings of one decimal normalize to one canonical string, so equality, caching and identity read the invariant value.',
    source: 'packages/runtime/src/formatting.ts',
    find: '  const fraction = withoutTrailingZeros(fractionSource);',
    replace: '  void withoutTrailingZeros;\n  const fraction = fractionSource;',
  },
  {
    id: 'localized-text-committed-as-form-value',
    invariant:
      'A localized field hands the form the parsed invariant value, never the text the reader typed.',
    source: 'packages/runtime/forms/src/public-api.ts',
    find: '    this.change(result.value);',
    replace: '    this.change(result.text as never);',
  },
  {
    id: 'duration-sign-check-dropped',
    invariant:
      "The duration factory refuses a negative clock field, because a duration's direction is carried by its sign alone.",
    source: 'packages/runtime/src/formatting.ts',
    find: "  if (value.seconds.value.startsWith('-')) {",
    replace: '  if (false) {',
  },
  {
    id: 'sub-millisecond-instant-refused',
    invariant:
      'An instant carrying nanoseconds is formatted to the precision the options ask for, not refused for the precision it carries.',
    source: 'packages/runtime/src/formatting.ts',
    find: '  const remainder = ((nanoseconds % 1_000_000n) + 1_000_000n) % 1_000_000n;',
    replace:
      "  const remainder = ((nanoseconds % 1_000_000n) + 1_000_000n) % 1_000_000n;\n  if (remainder !== 0n) {\n    return unsupported('Sub-millisecond instants are not formatted.', context);\n  }",
  },
  {
    id: 'host-clock-used-over-installed-clock',
    invariant:
      "Relative time is measured against the clock the application installed, not the host's.",
    source: 'packages/runtime/src/formatting-runtime.ts',
    find: '      (this.context.clock ?? systemClock()).now(),',
    replace: '      systemClock().now(),',
  },
  {
    id: 'percent-scale-ignored-when-formatting',
    invariant:
      'A percent is formatted on the scale its value declares, so a percent-unit 25 and a fractional 0.25 both read 25%.',
    source: 'packages/runtime/src/formatting.ts',
    find: "  const fractional =\n    value.scale === 'fractional' ? value.amount : divideByHundred(value.amount);",
    replace: '  void divideByHundred;\n  const fractional = value.amount;',
  },
  {
    id: 'locale-formatting-declaration-ignored',
    invariant:
      "A locale's own declaration of how it is written overrides the application-wide context for that locale.",
    source: 'packages/runtime/src/localization.ts',
    find: '      ...(this.localeFormatting[locale] ?? {}),',
    replace:
      '      ...(this.localeFormatting[locale] === undefined ? {} : {}),',
  },
  {
    id: 'relative-time-rounds-instead-of-truncating',
    invariant:
      'Equator selects the relative-time unit by truncating toward zero, so a phrase never claims a span is larger than it is.',
    source: 'packages/runtime/src/relative-time-policy.ts',
    find: '  const truncated = Math.trunc(elapsed / MILLISECONDS[unit]);',
    replace: '  const truncated = Math.round(elapsed / MILLISECONDS[unit]);',
  },
  {
    id: 'relative-time-largest-unit-ignored',
    invariant:
      'The largest unit an application declares is honoured, and a span beyond it is handed back rather than named in a larger unit.',
    source: 'packages/runtime/src/relative-time-policy.ts',
    find: "  const largestIndex = UNIT_ORDER.indexOf(policy.largestUnit ?? 'year');",
    replace: "  const largestIndex = UNIT_ORDER.indexOf('year');",
  },
  {
    id: 'out-of-range-span-reported-as-failure',
    invariant:
      'A span beyond the policy comes back as an absolute decision carrying the elapsed span, not as a formatting failure.',
    source: 'packages/runtime/src/relative-time-policy.ts',
    find: "      kind: 'absolute',\n      elapsedMilliseconds: decision.elapsedMilliseconds,",
    replace:
      "      kind: 'unavailable',\n      diagnostic: Object.freeze({\n        code: 'unsupported-formatting-capability',\n        outcome: 'operational-failure',\n        message: 'The span is outside the relative-time policy.',\n        targetLocale: context.locale,\n      }),",
  },
  {
    id: 'ambiguous-zone-label-resolved-to-first',
    invariant:
      'A localized label that names more than one allowed zone is reported ambiguous, not resolved to the first zone that matches.',
    source: 'packages/runtime/src/localized-input.ts',
    find: '  if (exact.size === 1) {',
    replace: '  if (exact.size >= 1) {',
  },
  {
    id: 'percent-scale-ignored-when-parsing',
    invariant:
      'A percent field reverses its declared scale when read, so twenty-five percent under fractional semantics is a quarter.',
    source: 'packages/runtime/src/localized-input.ts',
    find: "      const scaled =\n        profile.scale === 'fractional' ? divideByHundred(amount) : amount;",
    replace: '      void divideByHundred;\n      const scaled = amount;',
  },
  {
    id: 'date-string-coerced-by-the-platform-parser',
    invariant:
      "A date-time message input is a Date or an epoch number; a string is refused rather than handed to the platform's date parser.",
    source: 'packages/runtime/src/evaluator.ts',
    find: "    return (contract.enum as readonly unknown[]).includes(value);\n  }\n  switch (contract.type) {\n    case 'boolean':\n      return typeof value === 'boolean';\n    case 'date-time':\n      return (\n",
    replace:
      "    return (contract.enum as readonly unknown[]).includes(value);\n  }\n  switch (contract.type) {\n    case 'boolean':\n      return typeof value === 'boolean';\n    case 'date-time':\n      return (\n        typeof value === 'string' ||\n",
  },
  {
    id: 'unknown-issue-presented-as-known',
    invariant:
      'An issue code no message answers stays an explicit unknown, with the generic message and a diagnostic.',
    source: 'packages/runtime/src/presentation.ts',
    find: "    status: 'unknown',\n    code: issue.code,\n    localized: localization.evaluateText(source.unknown, {}),\n    diagnostic: unknownDiagnostic(),",
    replace:
      "    status: 'known' as never,\n    code: issue.code,\n    localized: localization.evaluateText(source.unknown, {}),\n    diagnostic: unknownDiagnostic(),",
  },
  {
    id: 'early-form-write-not-held',
    invariant:
      "A form write that arrives before the field's profile is held and rendered once the profile lands, not rendered at once and failed.",
    source: 'packages/runtime/forms/src/public-api.ts',
    find: '    this.model = value;\n    this.result.set(undefined);\n    this.written.update((count) => count + 1);',
    replace:
      '    this.model = value;\n    this.result.set(undefined);\n    this.renderModel();',
  },
  {
    id: 'locale-change-overwrites-unparsed-entry',
    invariant:
      'A locale change leaves an entry that did not parse, and its validation result, in the field rather than rewriting it from the last value.',
    source: 'packages/runtime/forms/src/public-api.ts',
    find: "    if (currentResult !== undefined && currentResult.status !== 'valid') return;",
    replace: '    void currentResult;',
  },
  {
    id: 'issue-code-camel-case-not-split',
    invariant:
      'A camel-case issue code splits into the same words as its upper-snake spelling and reaches the same message.',
    source: 'packages/runtime/src/issue-convention.ts',
    find: '    if (boundary) {',
    replace: '    if (boundary && false) {',
  },
  {
    id: 'issue-convention-not-consulted',
    invariant:
      'A code with no binding still reaches the message its name derives, with nothing written for it.',
    source: 'packages/runtime/src/presentation.ts',
    find: '  const paired = issueMessage(source.messages, issue.code);',
    replace: '  const paired = issueMessage({}, issue.code);',
  },
  {
    id: 'refused-entry-reported-as-valid',
    invariant:
      'An entry the field could not read is reported to the form as an error, never as a valid control.',
    source: 'packages/runtime/forms/src/public-api.ts',
    find: '    this.result.set(result);',
    replace:
      "    this.result.set(result.status === 'valid' ? result : undefined);",
  },
  {
    id: 'participant-report-carries-consumer-payload',
    invariant:
      "A dynamic participant's report carries only safe identity and representation metadata, never the payload or URL it was built from.",
    source: 'packages/runtime/src/assets.ts',
    find: "        status: 'ready',\n        identity,",
    replace: "        ...input,\n        status: 'ready',\n        identity,",
  },
  {
    id: 'unavailable-representation-reported-as-failure',
    invariant:
      'Exhausting the approved representations is reported as a representation-unavailable outcome, not as an operational failure.',
    source: 'packages/runtime/src/assets.ts',
    find: "    status: 'unavailable',\n    outcome: 'localized-representation-unavailable',\n  });",
    replace:
      "    status: 'unavailable',\n    outcome: 'operational-failure' as never,\n  });",
  },
  {
    id: 'fixed-language-asset-relabelled-as-fallback',
    invariant:
      "Content fixed in one language keeps that language and is not marked a fallback because the reader's locale differs.",
    source: 'packages/runtime/src/assets.ts',
    find: "      return invalidAsset('A fixed-language asset descriptor is invalid.');\n    }\n    return Object.freeze({\n      ...common,\n      status: 'ready',\n      fallback: false,",
    replace:
      "      return invalidAsset('A fixed-language asset descriptor is invalid.');\n    }\n    return Object.freeze({\n      ...common,\n      status: 'ready',\n      fallback: languageForLocale(request.targetLocale) !== descriptor.language,",
  },
  {
    id: 'event-carries-unbounded-caller-text',
    invariant:
      'An observability event carries codes and bounded identities, and text a caller supplied is dropped rather than recorded.',
    source: 'packages/runtime/src/observability.ts',
    find: '  const targetLocale = boundedIdentity(input.targetLocale);',
    replace: '  const targetLocale = input.targetLocale;',
  },
  {
    id: 'source-fallback-reported-as-translated',
    invariant:
      'A message rendered from the source locale because its translation is missing says so, with the locale that supplied it and a message-unavailable diagnostic.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '  const fallback = supplyingLocale !== candidate.targetLocale;',
    replace: '  const fallback = false;',
  },
  {
    id: 'malformed-stored-locale-echoed-in-event',
    invariant:
      'A persisted locale value that does not parse is reported without the value, because it came from the client.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: "          reason: 'unsupported-locale',\n          correlationId: store.id,\n        });\n        continue;\n      }\n      if (!this.context.supportedLocales.has(canonical)) {",
    replace:
      "          reason: 'unsupported-locale',\n          targetLocale: stored,\n          correlationId: store.id,\n        });\n        continue;\n      }\n      if (!this.context.supportedLocales.has(canonical)) {",
  },
  {
    id: 'absent-sink-replaced-with-a-no-op',
    invariant:
      'With no sink configured, no event emitter exists, so no event is built and no clock is read.',
    source: 'packages/runtime/src/localization.ts',
    find: '    ...(options.observability === undefined\n      ? {}\n      : {\n          observability: createLocalizationEventEmitter(options.observability),\n        }),\n',
    replace:
      '    observability: createLocalizationEventEmitter(\n      options.observability ?? { emit: () => undefined },\n    ),\n',
  },
  {
    id: 'superseded-write-reported-as-failed',
    invariant:
      'A persistence write abandoned because a newer choice replaced it is reported as superseded, not as a failure.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: "            status: 'superseded',",
    replace: "            status: 'failed',",
  },
  {
    id: 'runtime-sink-exception-escapes',
    invariant:
      'A runtime sink that throws leaves initialization, locale changes, the snapshot and the lifecycle exactly as they are without it.',
    source: 'packages/runtime/src/observability.ts',
    find: '  try {\n    sink.emit(event);\n  } catch {\n    // Optional sinks cannot influence localization state or escape SSR requests.\n  }',
    replace: '  sink.emit(event);',
  },
  {
    id: 'event-identifier-keeps-control-characters',
    invariant:
      'An event identifier carrying a control or directional character is dropped from the event.',
    source: 'packages/runtime/src/observability.ts',
    find: '    /[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]/u.test(value)',
    replace: '    false',
  },
  {
    id: 'runtime-repeated-failure-emitted-again',
    invariant:
      'The runtime reports an equivalent failure once within its window.',
    source: 'packages/runtime/src/observability.ts',
    find: '      return;\n    }\n    if (failures.size >= MAXIMUM_FAILURE_IDENTITIES) {',
    replace: '    }\n    if (failures.size >= MAXIMUM_FAILURE_IDENTITIES) {',
  },
  {
    id: 'stored-locale-echoed-in-a-diagnostic',
    invariant:
      'A stored locale that does not canonicalize is excluded with a diagnostic that carries none of its text.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: "          reason: 'unsupported-locale',\n          correlationId: store.id,",
    replace:
      "          reason: 'unsupported-locale',\n          targetLocale: stored,\n          correlationId: store.id,",
  },
  {
    id: 'declining-url-source-answers-the-default',
    invariant:
      'An address that states no locale declines, so the next declared source answers rather than the default.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '      if (stated === undefined) return undefined;',
    replace:
      '      if (stated === undefined) return this.context.defaultLocale;',
  },
  {
    id: 'invalid-locale-change-throws',
    invariant:
      'An explicit change to an unsupported locale settles as a failed result rather than throwing.',
    source: 'packages/runtime/src/localization.ts',
    find: '        targetLocale: localeValue,\n        transitionId: id,\n      });\n      return Promise.resolve(result);',
    replace:
      '        targetLocale: localeValue,\n        transitionId: id,\n      });\n      throw error;',
  },
  {
    id: 'persistence-stores-read-in-reverse',
    invariant:
      'Stores are read in the order the application declared them, and the first believable answer wins.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '    for (const store of this.context.persistence ?? []) {',
    replace:
      '    for (const store of [...(this.context.persistence ?? [])].reverse()) {',
  },
  {
    id: 'initial-locale-written-back',
    invariant:
      'The locale initialization resolves is not written to the persistence stores; only a deliberate change is.',
    source: 'packages/runtime/src/localization.ts',
    find: "        if (!this.gone()) {\n          this.lifecycleValue.set('ready');\n          this.targetLocaleValue.set(undefined);\n          this.startIndependentParticipants(\n            progressiveParticipants,",
    replace:
      "        this.localeResolution.persistLocale(snapshot, undefined);\n        if (!this.gone()) {\n          this.lifecycleValue.set('ready');\n          this.targetLocaleValue.set(undefined);\n          this.startIndependentParticipants(\n            progressiveParticipants,",
  },
  {
    id: 'unremembered-change-still-recorded',
    invariant:
      'A locale change made with remember set to false moves the page and writes nothing to the stores.',
    source: 'packages/runtime/src/localization.ts',
    find: '        if (options.remember !== false) {',
    replace: '        if (true as boolean) {',
  },
  {
    id: 'restore-overrides-a-newer-choice',
    invariant:
      'A stored value read for a restored page does not move it when the reader chose or removed a locale while it was being read.',
    source: 'packages/runtime/src/localization.ts',
    find: '    if (this.requestedChanges !== requested) {',
    replace: '    if (requested < 0) {',
  },
  {
    id: 'strict-policy-accepts-source-fallback',
    invariant:
      'Under the strict policy a message the source locale supplies is refused rather than rendered.',
    source: 'packages/runtime/src/localization.ts',
    find: "      this.options.setup.fallbackPolicy === 'strict' &&\n      !activation.inheritedLocales.has(candidate.catalog.key.catalogLocale)",
    replace:
      '      (false as boolean) &&\n      !activation.inheritedLocales.has(candidate.catalog.key.catalogLocale)',
  },
  {
    id: 'language-independent-content-classified-as-known',
    invariant:
      'Content tagged as having no language is classified as language-independent, apart from known and unknown content.',
    source: 'packages/runtime/src/locale-presentation.ts',
    find: '  if (primary === LANGUAGE_INDEPENDENT) {',
    replace: '  if (primary === LANGUAGE_INDEPENDENT && language.length < 0) {',
  },
  {
    id: 'undetermined-content-assigned-a-direction',
    invariant:
      'Content of undetermined language with no script defers its direction to the renderer instead of being assigned one.',
    source: 'packages/runtime/src/locale-presentation.ts',
    find: '  if (primary === UNDETERMINED && !hasScriptSubtag(language)) {',
    replace:
      '  if (primary === UNDETERMINED && !hasScriptSubtag(language) && language.length < 0) {',
  },
  {
    id: 'recovery-region-drops-its-language',
    invariant:
      'The recovery region carries the language and direction of the recovery message it renders.',
    source: 'packages/runtime/src/recovery.ts',
    find: '        [attr.lang]="recovery.language"\n        [attr.dir]="recovery.direction"\n',
    replace: '',
  },
  {
    id: 'result-reports-the-target-as-supplier',
    invariant:
      'A result names the locale whose catalog supplied it, which may differ from the locale asked for.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    supplyingLocale,\n    language: languageForLocale(supplyingLocale),',
    replace:
      '    supplyingLocale: candidate.targetLocale,\n    language: languageForLocale(supplyingLocale),',
  },
  {
    id: 'formatting-pipe-declared-pure',
    invariant:
      'A formatting pipe re-renders when the committed locale changes under an unchanged value.',
    source: 'packages/runtime/src/formatting-pipes.ts',
    find: "@Pipe({ name: 'localizedDecimal', standalone: true, pure: false })",
    replace:
      "@Pipe({ name: 'localizedDecimal', standalone: true, pure: true })",
  },
  {
    id: 'formatting-pipe-failure-unreported',
    invariant:
      'A formatting pipe whose formatter refuses a value reports the diagnostic to the observability sink.',
    source: 'packages/runtime/src/formatting-pipes.ts',
    find: '    emitLocalizationRuntimeEvent(this.localization, {',
    replace:
      '    void emitLocalizationRuntimeEvent;\n    ((..._event: unknown[]) => undefined)(this.localization, {',
  },
  {
    id: 'participant-payload-admitted',
    invariant:
      'A participant report carrying anything beyond its status, representation and identity is refused, and none of it reaches Equator state.',
    source: 'packages/runtime/src/participant-runtime.ts',
    find: "      if (!keysWithin(value, ['status', 'representation', 'identity'])) {\n        return undefined;\n      }\n      const representation = sanitizeRepresentation(value['representation']);\n      if (representation === undefined) return undefined;\n      return Object.freeze({\n        status: 'ready',",
    replace:
      "      const representation = sanitizeRepresentation(value['representation']);\n      if (representation === undefined) return undefined;\n      return Object.freeze({\n        ...value,\n        status: 'ready',",
  },
  {
    id: 'target-locale-inferred-from-primary',
    invariant:
      'While a transition is prepared the target locale is the one requested, never the primary locale still committed.',
    source: 'packages/runtime/src/localization.ts',
    find: '        this.targetLocaleValue.set(locale);\n        const participantsToPrepare =',
    replace:
      '        this.targetLocaleValue.set(\n          this.active?.publicSnapshot.primaryLocale ?? locale,\n        );\n        const participantsToPrepare =',
  },
  {
    id: 'failed-required-scope-committed-anyway',
    invariant:
      'A snapshot is committed only when every required scope was acquired; one that failed to load stops the commit.',
    source: 'packages/runtime/src/localization.ts',
    find: '    if (failure !== undefined) {\n      releaseActivations(activations);\n      throw failure.reason;\n    }\n    let participants: readonly PreparedParticipant[];',
    replace:
      '    void failure;\n    let participants: readonly PreparedParticipant[];',
  },
  {
    id: 'first-navigation-fails-over-a-failed-start',
    invariant:
      'In a browser a navigation arriving after a failed start is held until a retry succeeds, rather than failing and moving the address.',
    source: 'packages/runtime/router/src/provide.ts',
    find: '  await new Promise<void>((settle) => {',
    replace:
      "  if (localization.snapshot() === undefined) {\n    throw new Error('The localization runtime has not started.');\n  }\n  await new Promise<void>((settle) => {",
  },
  {
    id: 'overlay-adapter-built-with-the-configuration',
    invariant:
      'The overlay adapter is built inside the injector of the context that owns it, not when the configuration is declared.',
    source: 'packages/runtime/src/angular.ts',
    find: "    ɵkind: 'overlay-locale',\n    create,\n  });",
    replace:
      "    ɵkind: 'overlay-locale',\n    create: ((adapter) => () => adapter)(create()),\n  });",
  },
  {
    id: 'equivalent-transitions-not-coalesced',
    invariant:
      'A locale change equivalent to one already in flight returns that transition rather than starting a second.',
    source: 'packages/runtime/src/localization.ts',
    find: '    if (this.pending?.key === key) return this.pending.promise;',
    replace:
      '    if (this.pending?.key === key && key.length < 0) return this.pending.promise;',
  },
  {
    id: 'participant-handed-the-previous-locale',
    invariant:
      'A participant is handed the locale the transition is preparing, not the one it last supplied.',
    source: 'packages/runtime/src/participant-runtime.ts',
    find: '    const context: LocalizationParticipantContext = Object.freeze({\n      targetLocale,',
    replace:
      '    const context: LocalizationParticipantContext = Object.freeze({\n      targetLocale: previousState.current?.targetLocale ?? targetLocale,',
  },
  {
    id: 'domain-outcome-read-as-unavailable',
    invariant:
      "A participant's domain outcome commits as that outcome and is never read as a missing translation.",
    source: 'packages/runtime/src/participant-runtime.ts',
    find: "      ({ report }) => report.status === 'unavailable',",
    replace:
      "      ({ report }) =>\n        report.status === 'unavailable' || report.status === 'domain-outcome',",
  },
  {
    id: 'participant-deadline-authorizes-commit',
    invariant:
      'A required participant whose deadline expired fails the coordinated transition rather than being left out of it.',
    source: 'packages/runtime/src/participant-runtime.ts',
    find: "      (result): result is PromiseRejectedResult => result.status === 'rejected',",
    replace:
      "      (result): result is PromiseRejectedResult =>\n        result.status === 'rejected' &&\n        (result.reason as { readonly diagnostic?: { readonly code?: string } })\n          ?.diagnostic?.code !== 'participant-timeout',",
  },
  {
    id: 'startup-scopes-left-out-of-a-switch',
    invariant:
      'A locale change loads the scopes the current view already requires in the target locale, startup scopes included, before it commits.',
    source: 'packages/runtime/src/localization.ts',
    find: '      this.active?.publicSnapshot.requiredScopes ?? this.bootstrapScopes;',
    replace: '      [] as readonly LocalizationScope[];',
  },
  {
    id: 'superseded-scope-load-published',
    invariant:
      'A scope loaded for a locale a later transaction replaced is discarded, not published into the current snapshot.',
    source: 'packages/runtime/src/localization.ts',
    find: '      if (this.committedTransitionId !== requestedAgainst) {',
    replace: '      if (requestedAgainst < 0) {',
  },
  {
    id: 'bootstrap-does-not-wait-for-localization',
    invariant:
      'Application bootstrap waits for initialization, so nothing renders before the primary locale and startup scopes are ready.',
    source: 'packages/runtime/src/angular.ts',
    find: '      return initializedForBootstrap(localization, {',
    replace: '      void initializedForBootstrap(localization, {',
  },
  {
    id: 'transferred-locale-renegotiated',
    invariant:
      'A client adopts the primary locale the server transferred instead of resolving one again.',
    source: 'packages/runtime/src/angular.ts',
    find: '          ...(transferred === undefined\n            ? {}\n            : { initialLocale: transferred.primaryLocale }),',
    replace: '          ...{},',
  },
  {
    id: 'persistence-failure-reported-as-success',
    invariant:
      'A store write that throws is reported to the observability sink as a failed persistence.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: "            status: 'failed',\n            reason: asDiagnostic(error).code,\n            targetLocale: locale,",
    replace:
      "            status: 'succeeded',\n            reason: asDiagnostic(error).code,\n            targetLocale: locale,",
  },
  {
    id: 'disposal-clears-the-consumer-store',
    invariant:
      "Disposing a context leaves what the application's persistence stores hold untouched.",
    source: 'packages/runtime/src/localization.ts',
    find: '    this.store.dispose();',
    replace:
      '    this.store.dispose();\n    void this.localeResolution.forgetPersistedLocale();',
  },
  {
    id: 'deferred-load-never-signals-start',
    invariant:
      'A load the testing controller holds says when it has started, so a test can act while it is held.',
    source: 'packages/runtime/testing/src/public-api.ts',
    find: '              plan.start();\n              await plan.gate;',
    replace: '              await plan.gate;',
  },
  {
    id: 'test-environment-reset-keeps-the-address',
    invariant:
      'The test environment reset puts the address back to the root as well as clearing cookies and storages.',
    source: 'packages/runtime/testing/src/public-api.ts',
    find: "    history.replaceState(null, '', '/');",
    replace: '    void history;',
  },
  {
    id: 'family-resolver-guesses-a-member',
    invariant:
      'A family resolves only segments that name a current member, and a well-formed segment that names none resolves to nothing.',
    source: 'packages/toolkit/src/generated-contracts.ts',
    find: '    `    return Object.prototype.hasOwnProperty.call(members, key)`,\n    `      ? members[key as keyof typeof members]`,\n    `      : undefined;`,',
    replace:
      '    `    return members[key as keyof typeof members] ?? Object.values(members)[0];`,',
  },
  {
    id: 'inert-snapshot-reads-accessors',
    invariant:
      'Admission refuses a catalog property defined by a getter instead of running the getter to read it.',
    source: 'packages/runtime/src/runtime-safety.ts',
    find: "        const descriptor = descriptors[key];\n        if (\n          descriptor === undefined ||\n          !hasOwn(descriptor, 'value') ||\n          descriptor.get !== undefined ||\n          descriptor.set !== undefined ||\n          descriptor.enumerable !== true\n        ) {\n          throw new TypeError('Inert JSON objects cannot contain accessors.');\n        }\n        Object.defineProperty(result, key, {\n          value: copy(descriptor.value, depth + 1),",
    replace:
      '        const descriptor = descriptors[key];\n        void descriptor;\n        Object.defineProperty(result, key, {\n          value: copy(value[key], depth + 1),',
  },
  {
    id: 'transfer-with-unknown-field-adopted',
    invariant:
      'A transfer carrying a key its profile does not declare is discarded whole, and the document renders from its generated defaults.',
    source: 'packages/runtime/src/angular.ts',
    find: "      !hasExactKeys(\n        admitted.value,\n        ['profile', 'primaryLocale', 'formatting', 'catalogs', 'participants'],\n        ['route'],\n      ) ||",
    replace: '',
  },
  {
    id: 'recorded-summary-not-compared',
    invariant:
      'A candidate whose resource summary differs from the one recorded for its address is refused at the comparison, before its content is measured.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '      !sameResources(received.resources, artifact.resources) ||',
    replace: '',
  },
  {
    id: 'admission-bypassed',
    invariant:
      'A loaded catalog is admitted before it is cached or committed, and a candidate that fails admission is never used.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '      .then((candidate) => admitCatalog(candidate, artifact))',
    replace: '      .then((candidate) => candidate as CompiledCatalog)',
  },
  {
    id: 'verified-address-stands-in-for-candidate',
    invariant:
      'A catalog admitted once for an address does not admit a different candidate later offered under the same address.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "const admittedCatalogs = new WeakMap<\n  object,\n  { readonly key: string; readonly catalog: CompiledCatalog }\n>();\n\nfunction admissionKey(artifact: CatalogSetArtifact): string {\n  const { address } = artifact;\n  return [\n    address.contentDigest,\n    address.generatedAbi,\n    address.standardsProfile,\n    address.applicationContractFingerprint,\n    address.semanticRegistryFingerprint,\n    address.key.providerId,\n    address.key.scopeId,\n    address.key.catalogLocale,\n  ].join('\\u0000');\n}\n\n/**\n * The candidate, checked against the address it was offered for.\n *\n * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 is the order: the inert snapshot first,\n * then the exact field set, then identity against the address, then the resource summary\n * re-measured from the content, then the digest. The cheap refusals come before the expensive ones,\n * and nothing that fails is remembered.\n */\nasync function admitCatalog(\n  candidate: unknown,\n  artifact: CatalogSetArtifact,\n): Promise<CompiledCatalog> {\n  const key = admissionKey(artifact);\n  const cacheable = typeof candidate === 'object' && candidate !== null;\n  if (cacheable) {\n    const admitted = admittedCatalogs.get(candidate as object);\n    // The address must match too: one object must never be admitted for a scope or locale other\n    // than the one it was verified against.\n    if (admitted !== undefined && admitted.key === key) return admitted.catalog;\n  }",
    replace:
      "const admittedCatalogs = new Map<\n  object,\n  { readonly key: string; readonly catalog: CompiledCatalog }\n>();\n\nfunction admissionKey(artifact: CatalogSetArtifact): string {\n  const { address } = artifact;\n  return [\n    address.contentDigest,\n    address.generatedAbi,\n    address.standardsProfile,\n    address.applicationContractFingerprint,\n    address.semanticRegistryFingerprint,\n    address.key.providerId,\n    address.key.scopeId,\n    address.key.catalogLocale,\n  ].join('\\u0000');\n}\n\nasync function admitCatalog(\n  candidate: unknown,\n  artifact: CatalogSetArtifact,\n): Promise<CompiledCatalog> {\n  const key = admissionKey(artifact);\n  const cacheable = typeof candidate === 'object' && candidate !== null;\n  if (cacheable) {\n    for (const admitted of admittedCatalogs.values()) {\n      if (admitted.key === key) return admitted.catalog;\n    }\n  }",
  },
  {
    id: 'preload-activates-scope',
    invariant:
      'Preloading a scope loads its catalogs without making the scope ready for evaluation.',
    source: 'packages/runtime/src/localization.ts',
    find: '      await Promise.all(requests);\n      this.assertActive();',
    replace:
      '      await Promise.all(requests);\n      this.assertActive();\n      await this.ensureScope(scope);',
  },
  {
    id: 'unpinned-catalogs-never-evicted',
    invariant:
      'The memory cache evicts released catalogs on its own to stay within the configured bound.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '        .filter(([, entry]) => entry.pins === 0)',
    replace: '        .filter(([, entry]) => entry.pins < 0)',
  },
  {
    id: 'failed-load-remembered',
    invariant:
      'A catalog load that failed is forgotten, so a retry loads it again.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '      .finally(() => this.inFlight.delete(key));',
    replace: '      .finally(() => undefined);',
  },
  {
    id: 'catalog-text-rendered-as-html',
    invariant:
      'A text part of a structured message is written into the page as text, so markup a catalog carries never becomes an element.',
    source: 'packages/runtime/src/message-template.ts',
    find: '            <ng-container>{{ part.value }}</ng-container>',
    replace: '            <span [innerHTML]="part.value"></span>',
  },
  {
    id: 'child-inherits-commit-hooks',
    invariant:
      "A child context runs none of its parent's commit hooks, so it neither writes the parent's document nor disposes the parent's adapters.",
    source: 'packages/runtime/src/localization.ts',
    find: '      commitHooks: [],',
    replace: '      commitHooks: this.options.commitHooks ?? [],',
  },
  {
    id: 'client-declaration-synthesizes-a-not-found',
    invariant:
      'A declaration on a client navigation governs the document and nothing else: the route and the address stay where the reader put them.',
    source: 'packages/runtime/router/src/page-outcome.ts',
    find: '    this.stamp(declaration);\n    if (this.request === null) return;',
    replace:
      "    this.stamp(declaration);\n    if (!this.onServer && declaration.outcome === 'absent') {\n      void this.router.navigateByUrl('/not-found');\n    }\n    if (this.request === null) return;",
  },
  {
    id: 'commit-waits-for-a-transition',
    invariant:
      'A locale change commits without waiting for any transition, so a page that animates nothing still changes language.',
    source: 'packages/runtime/src/localization.ts',
    find: '        const previousLocale = this.active?.publicSnapshot.primaryLocale;\n        const snapshot = this.commit(prepared);',
    replace:
      "        const previousLocale = this.active?.publicSnapshot.primaryLocale;\n        if (globalThis.document !== undefined) {\n          await new Promise<void>((resolve) => {\n            globalThis.document.documentElement.addEventListener(\n              'transitionend',\n              () => resolve(),\n              { once: true },\n            );\n          });\n        }\n        const snapshot = this.commit(prepared);",
  },
  {
    id: 'detached-page-outcome-unreported',
    invariant:
      'A declaration against a request the handler is not holding is reported during development, because its response is indistinguishable from one that declared nothing.',
    source: 'packages/runtime/router/src/page-outcome.ts',
    find: '    if (this.reportedDetachedRequest) return;',
    replace: '    if (this.reportedDetachedRequest || isDevMode()) return;',
  },
  {
    id: 'direction-change-moves-focus',
    invariant:
      'A commit that changes only the reading direction moves no focus.',
    source: 'packages/runtime/src/angular.ts',
    find: "      root.setAttribute('dir', snapshot.direction);",
    replace:
      "      root.setAttribute('dir', snapshot.direction);\n      if (previousDirection !== snapshot.direction) {\n        this.document.querySelector<HTMLElement>('button, input, [href]')?.focus();\n      }",
  },
  {
    id: 'direction-written-as-a-style',
    invariant:
      "A locale commit states direction through the document's dir attribute and writes no style, class or rule of the application's.",
    source: 'packages/runtime/src/angular.ts',
    find: "      root.setAttribute('dir', snapshot.direction);",
    replace:
      "      root.setAttribute('dir', snapshot.direction);\n      root.style.setProperty('direction', snapshot.direction);",
  },
  {
    id: 'evaluation-starts-a-catalog-load',
    invariant:
      'Evaluating a handle whose scope is not ready starts no catalog load; it refuses, and loading stays an explicit call.',
    source: 'packages/runtime/src/localization.ts',
    find: '    if (activation === undefined) {\n      throw new LocalizationError(',
    replace:
      '    if (activation === undefined) {\n      void this.ensureScope({\n        providerId: handle.providerId,\n        scopeId: handle.scopeId,\n      }).catch(() => undefined);\n      throw new LocalizationError(',
  },
  {
    id: 'failed-commit-announced-as-committed',
    invariant:
      'A locale change that fails its commit is never handed to the post-commit effects, so the announcer says nothing about a switch that did not happen.',
    source: 'packages/runtime/src/localization.ts',
    find: '          hook.rollback?.(previous?.publicSnapshot);',
    replace: '          hook.committed?.(prepared.active.publicSnapshot);',
  },
  {
    id: 'handle-stand-in-evaluated',
    invariant:
      'A value without the generated ABI stamp is refused as an invalid configuration before the runtime reads anything it claims about itself.',
    source: 'packages/runtime/src/localization.ts',
    find: '    if (handle.generatedAbi !== GENERATED_ABI) {',
    replace: '    if (false as boolean) {',
  },
  {
    id: 'language-independent-content-given-a-direction',
    invariant:
      'Content tagged as having no linguistic content is reported as language-independent and given no writing direction.',
    source: 'packages/runtime/src/locale-presentation.ts',
    find: '  if (primary === LANGUAGE_INDEPENDENT) {',
    replace: '  if (primary === LANGUAGE_INDEPENDENT && language.length < 0) {',
  },
  {
    id: 'late-page-outcome-never-reprojected',
    invariant:
      'A page outcome declared after the navigation committed re-projects the document.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '    if (outcome === this.declaredOutcome) return;',
    replace:
      '    if (outcome === this.declaredOutcome || outcome !== undefined) return;',
  },
  {
    id: 'outcome-document-read-under-another-class',
    invariant:
      'The head of a response that reached no route is read from the document declared for its own outcome class.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '    const declared = this.options.outcomeDocuments?.[outcomeClass];',
    replace:
      "    const declared = this.options.outcomeDocuments?.['not-found'];",
  },
  {
    id: 'page-outcome-survives-a-commit-that-declares-nothing',
    invariant:
      'A commit replaces the declared page outcome outright, including when the arriving page declares nothing.',
    source: 'packages/runtime/router/src/page-outcome.ts',
    find: '          declaration === undefined\n            ? undefined\n            : { navigationId: event.id, declaration },',
    replace:
      '          declaration === undefined\n            ? this.committed()\n            : { navigationId: event.id, declaration },',
  },
  {
    id: 'participant-registry-shared',
    invariant:
      'Each context owns its participant registry; a participant registered on one context is never listed, prepared or disposed by another built from the same setup.',
    source: 'packages/runtime/src/localization.ts',
    find: '    this.participantCoordinator = new ParticipantCoordinator(\n      options.transferredParticipants ?? [],\n      this.participantRefusals(),\n    );',
    replace:
      '    this.participantCoordinator = ((\n      globalThis as { sharedCoordinator?: ParticipantCoordinator }\n    ).sharedCoordinator ??= new ParticipantCoordinator(\n      options.transferredParticipants ?? [],\n      this.participantRefusals(),\n    ));',
  },
  {
    id: 'participant-transfer-carries-a-function',
    invariant:
      "The transfer a server render writes is data only: its participant records carry no function of the participant's.",
    source: 'packages/runtime/src/participant-runtime.ts',
    find: "          profile: 'equator-participant-state/1' as const,",
    replace:
      "          profile: 'equator-participant-state/1' as const,\n          prepare: adapter.prepare,",
  },
  {
    id: 'persisted-locale-is-its-display-name',
    invariant:
      'A remembered locale is written as its canonical tag, never as the name a reader is shown for it.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '          await store.write(locale);',
    replace:
      "          await store.write(\n            new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ??\n              locale,\n          );",
  },
  {
    id: 'prerendered-declaration-accepted',
    invariant:
      'A page declaring an outcome while rendering ahead of a request fails the build rather than being written.',
    source: 'packages/runtime/router/src/page-outcome.ts',
    find: "      throw new LocalizationError({\n        code: 'route-unavailable',",
    replace:
      "      void new LocalizationError({\n        code: 'route-unavailable',",
  },
  {
    id: 'prerendered-declaration-render-continues',
    invariant:
      'A prerender whose page declared an outcome ends as a failed render, rather than only refusing the call that declared.',
    source: 'packages/runtime/router/src/page-outcome.ts',
    find: '      if (!this.applicationRef.destroyed) this.applicationRef.destroy();',
    replace: '      void this.applicationRef.destroyed;',
  },
  {
    id: 'progressive-failure-rolls-back-commit',
    invariant:
      "A progressive region's failure leaves the commit it followed in place.",
    source: 'packages/runtime/src/localization.ts',
    find: '          UNINTERRUPTED,\n        ),\n      ),\n    );\n  }',
    replace:
      "          UNINTERRUPTED,\n        ),\n      ),\n    ).then((results) => {\n      if (\n        results.some(\n          (settled) =>\n            settled.status === 'fulfilled' &&\n            settled.value.attempt.status === 'failed',\n        )\n      ) {\n        this.activeValue.set(undefined);\n      }\n    });\n  }",
  },
  {
    id: 'progressive-region-holds-the-change',
    invariant:
      "A progressive region's failure is confined to that region: the locale change it runs beside commits without it.",
    source: 'packages/runtime/src/localization.ts',
    find: '        ? this.participantCoordinator.required()',
    replace: '        ? this.participantCoordinator.registrations()',
  },
  {
    id: 'progressive-region-retried-by-runtime',
    invariant:
      "A progressive region that failed is prepared again only when the application calls its registration's retry.",
    source: 'packages/runtime/src/participant-runtime.ts',
    find: '    } catch {\n      // Independent regional outcomes are exposed through participant state.\n    }',
    replace:
      '    } catch {\n      if (!signalValue.aborted) {\n        setTimeout(() => {\n          void this.runIndependent(\n            registration,\n            targetLocale,\n            formatting,\n            transitionId,\n            signalValue,\n          );\n        }, 0);\n      }\n    }',
  },
  {
    id: 'remembered-failures-never-evicted',
    invariant:
      'The set of remembered failure identities is capped and gives up the oldest first.',
    source: 'packages/runtime/src/observability.ts',
    find: '    if (failures.size >= MAXIMUM_FAILURE_IDENTITIES) {',
    replace:
      '    if (failures.size >= MAXIMUM_FAILURE_IDENTITIES && key.length < 0) {',
  },
  {
    id: 'rendered-text-keeps-template-whitespace',
    invariant:
      "renderedText collapses whitespace runs and trims, so a template's line breaks and indentation do not reach an assertion.",
    source: 'packages/runtime/testing/src/public-api.ts',
    find: "  return element.textContent.replace(/\\s+/gu, ' ').trim();",
    replace: '  return element.textContent;',
  },
  {
    id: 'required-extension-admitted-without-binding',
    invariant:
      'A context whose catalogs require an extension refuses to start when the binding is absent or its descriptor differs.',
    source: 'packages/runtime/src/extensions.ts',
    find: '        invalid(\n          `Required runtime extension ${admitted.kind}',
    replace:
      '        if (admitted.id.length < 0) invalid(\n          `Required runtime extension ${admitted.kind}',
  },
  {
    id: 'restore-takes-focus-the-visitor-moved',
    invariant:
      'A focus restore that lands after the visitor has moved focus leaves it where the visitor put it.',
    source: 'packages/runtime/src/angular.ts',
    find: '      const focusWasLost =\n        holder === null ||',
    replace: '      const focusWasLost =\n        true ||',
  },
  {
    id: 'route-addresses-not-published',
    invariant:
      'The per-locale addresses of the resolved route are published on the snapshot for every navigation.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '      ...(addresses === undefined ? {} : { addresses }),',
    replace: '      ...(addresses === undefined ? {} : {}),',
  },
  {
    id: 'routing-policy-declared-twice',
    invariant:
      'An application declares its locale URL policy once, and a second withRouting() is refused.',
    source: 'packages/runtime/src/angular.ts',
    find: '  if (matches.length > 1) {',
    replace: "  if (matches.length > 1 && kind !== 'routing') {",
  },
  {
    id: 'scope-refusal-names-no-scope',
    invariant:
      'A synchronous evaluation refused for an unready scope raises a typed error whose diagnostic names the provider and the scope.',
    source: 'packages/runtime/src/localization.ts',
    find: '          { providerId: handle.providerId, scopeId: handle.scopeId },',
    replace: '          {},',
  },
  {
    id: 'scroll-hold-ceiling-lifted',
    invariant:
      'The window holding a restored scroll position closes 150 milliseconds after it opened, whatever the frames are doing.',
    source: 'packages/runtime/src/angular.ts',
    find: 'const scrollHoldCeilingMs = 150;',
    replace: 'const scrollHoldCeilingMs = 150_000;',
  },
  {
    id: 'scroll-hold-frame-budget-lifted',
    invariant:
      'The window holding a restored scroll position re-applies it for six frames at most on a page that never settles.',
    source: 'packages/runtime/src/angular.ts',
    find: 'const scrollHoldFrames = 6;',
    replace: 'const scrollHoldFrames = 60;',
  },
  {
    id: 'scroll-hold-ignores-the-visitor',
    invariant:
      'The window holding a restored scroll position closes on the first wheel, touch, pointer or key event.',
    source: 'packages/runtime/src/angular.ts',
    find: '      view.addEventListener(intent, close, listener);',
    replace: '      void intent;',
  },
  {
    id: 'scroll-hold-outlasts-settling',
    invariant:
      'The window holding a restored scroll position closes after two consecutive frames with nothing to correct.',
    source: 'packages/runtime/src/angular.ts',
    find: 'const scrollSettledFrames = 2;',
    replace: 'const scrollSettledFrames = 20;',
  },
  {
    id: 'scroll-hold-undoes-application-scrolling',
    invariant:
      'A position the application sets once a direction change has settled stands, because the window holding the restored one has closed.',
    source: 'packages/runtime/src/angular.ts',
    find: 'const scrollSettledFrames = 2;',
    replace: 'const scrollSettledFrames = 7;',
  },
  {
    id: 'server-localization-state-not-transferred',
    invariant:
      'A server render hands its localization state to the browser, which adopts it rather than preparing the page again from its own negotiation.',
    source: 'packages/runtime/src/localization.ts',
    find: '  return internals.get(localization)?.transferSnapshot();',
    replace: '  void localization;\n  return undefined;',
  },
  {
    id: 'server-navigation-held-for-retry',
    invariant:
      'On the server a failed start fails the first navigation instead of holding it for a retry that nothing will make.',
    source: 'packages/runtime/router/src/provide.ts',
    find: '      if (server) throw error;',
    replace: '      void server;',
  },
  {
    id: 'server-render-without-origin-accepted',
    invariant:
      'A server render with no origin configured is refused rather than projecting addresses against a guessed host.',
    source: 'packages/runtime/router/src/provide.ts',
    find: '  if (options.origin !== undefined || !isPlatformServer(inject(PLATFORM_ID))) {',
    replace:
      '  if (options.origin !== undefined || isPlatformServer(inject(PLATFORM_ID)) || true) {',
  },
  {
    id: 'snapshot-admits-participant-result',
    invariant:
      'The localization snapshot carries only the fields it names, never what a participant returned.',
    source: 'packages/runtime/src/localization.ts',
    find: '      ...(route === undefined ? {} : { route: Object.freeze({ ...route }) }),',
    replace:
      '      ...(route === undefined ? {} : { route: Object.freeze({ ...route }) }),\n      ...Object.assign({}, ...participants.map(({ report }) => report)),',
  },
  {
    id: 'snapshot-left-writable',
    invariant:
      'The committed snapshot is frozen, so an application cannot change the state every reader shares.',
    source: 'packages/runtime/src/localization.ts',
    find: '    const publicSnapshot: LocalizationSnapshot = Object.freeze({\n      id: (this.nextSnapshotId += 1),',
    replace:
      '    const publicSnapshot: LocalizationSnapshot = ({\n      id: (this.nextSnapshotId += 1),',
  },
  {
    id: 'stale-offsets-restored-into-a-rewritten-value',
    invariant:
      'Selection offsets are restored only into the text they were measured against, so an application that rewrote its value and placed the caret itself keeps its placement.',
    source: 'packages/runtime/src/angular.ts',
    find: '          editable.value === selection.value',
    replace: '          editable.value.length >= 0',
  },
  {
    id: 'stores-not-read-after-hydration',
    invariant:
      'Once a server-rendered page has hydrated, the stores are read again, and a stored choice the declared order puts first moves the page.',
    source: 'packages/runtime/src/angular.ts',
    find: '          void localization.ɵrestoreAfterHydration({',
    replace: '          void localization; void Promise.resolve({',
  },
  {
    id: 'test-environment-keeps-local-storage',
    invariant:
      'resetLocalizationTestEnvironment clears the local storage a localized test wrote.',
    source: 'packages/runtime/testing/src/public-api.ts',
    find: '    localStorage.clear();',
    replace: '    void 0;',
  },
  {
    id: 'transferred-context-follows-every-locale',
    invariant:
      "The formatting context a server render transferred applies to the locale it rendered and becomes no other locale's default.",
    source: 'packages/runtime/src/localization.ts',
    find: '      ...(locale === this.options.initialLocale\n        ? (this.options.initialFormattingContext ?? {})\n        : {}),',
    replace: '      ...(this.options.initialFormattingContext ?? {}),',
  },
  {
    id: 'twitter-card-duplicates-open-graph',
    invariant:
      'The only card tag written is the one Open Graph has no equivalent for, because a card processor falls back to Open Graph for the rest.',
    source: 'packages/runtime/src/angular.ts',
    find: "        meta('twitter:card', social.card ?? 'summary');",
    replace:
      "        meta('twitter:card', social.card ?? 'summary');\n        if (projection.title !== undefined) meta('twitter:title', projection.title);",
  },
  {
    id: 'unavailable-participant-answered-from-the-previous-locale',
    invariant:
      "A required participant that reports its content unavailable in the target locale fails the transition; its previous locale's representation is never committed in its place.",
    source: 'packages/runtime/src/participant-runtime.ts',
    find: "      .map(({ value }) => value);\n    const unavailable = prepared.find(\n      ({ report }) => report.status === 'unavailable',\n    );",
    replace:
      "      .map(({ value }) =>\n        value.report.status === 'unavailable' &&\n        value.adapter.stateValue().current !== undefined\n          ? ({ ...value, report: value.adapter.stateValue().current?.report } as typeof value)\n          : value,\n      );\n    const unavailable = prepared.find(\n      ({ report }) => report.status === 'unavailable',\n    );",
  },
  {
    id: 'undeclared-outcome-document-unreported',
    invariant:
      'A response of an outcome class with no declared document is reported during development, because it is otherwise served with no title.',
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '    if (this.undeclaredOutcomes.has(outcomeClass)) return;',
    replace:
      '    if (this.undeclaredOutcomes.has(outcomeClass) || isDevMode()) return;',
  },
  {
    id: 'undetermined-language-given-a-direction',
    invariant:
      'Content tagged undetermined with no script is reported as unknown and given no writing direction.',
    source: 'packages/runtime/src/locale-presentation.ts',
    find: '  if (primary === UNDETERMINED && !hasScriptSubtag(language)) {',
    replace:
      '  if (primary === UNDETERMINED && !hasScriptSubtag(language) && language.length < 0) {',
  },
  {
    id: 'minimal-consumer-selects-testing',
    invariant:
      'The minimal consumer selects only what it uses, so an entry point it does not select stays out of its graph.',
    source: 'fixtures/minimal-package-consumer-template/src/app.config.ts',
    find: "import { withRecoveryMessage } from '@neolorn/equator';",
    replace:
      "import { withRecoveryMessage } from '@neolorn/equator';\nimport { resetLocalizationTestEnvironment } from '@neolorn/equator/testing';\n\nresetLocalizationTestEnvironment();",
    suite: 'verify:focused-consumers',
    caughtWhen:
      /Minimal consumer retained the unused Equator \.\/testing entrypoint/u,
  },
  {
    id: 'runtime-exports-every-file',
    invariant:
      'A consumer cannot import a module of the runtime package its export map does not name.',
    source: 'packages/runtime/package.json',
    find: '  "sideEffects": false,',
    replace: '  "sideEffects": false,\n  "exports": {\n    "./*": "./*"\n  },',
    suite: 'verify:focused-consumers',
    caughtWhen: /ERR_PACKAGE_PATH_NOT_EXPORTED/u,
  },
  {
    id: 'url-built-against-an-unknown-identity-compiles',
    invariant:
      'Building a URL for a route identity the projection does not declare fails compilation.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  Id extends RouteIdOf<Projection>,',
    replace: '  Id extends string,',
    suite: 'verify:consumer',
    caughtWhen: /\.negative\.ts did not report/u,
  },
  {
    id: 'context-time-zone-feature-admitted-without-a-zone',
    invariant:
      'A catalog that formats in the context time zone is refused at admission when the application configured none.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '        !contextTimeZone &&\n        Array.isArray(address.requiredFeatures) &&',
    replace:
      '        !contextTimeZone &&\n        contextTimeZone &&\n        Array.isArray(address.requiredFeatures) &&',
  },
  {
    id: 'declared-spelling-correction-status-unstated',
    invariant:
      'A redirect the runtime issues during a render, such as a parameter-spelling correction, is sent with 308.',
    source: 'packages/runtime/router/src/location-strategy.ts',
    find: '        init.status = entry ? 307 : 308;',
    replace: '        init.status = entry ? 307 : 302;',
  },
  {
    id: 'label-written-once',
    invariant:
      "An attribute label follows a locale commit through Angular's own scheduling, with no change detection asked for.",
    source: 'packages/runtime/src/label.ts',
    find: '    effect(() => {\n      const attribute = this.attribute();',
    replace:
      '    void effect;\n    queueMicrotask(() => {\n      const attribute = this.attribute();',
  },
  {
    id: 'navigation-error-loses-its-resolution',
    invariant:
      "A navigation to an address the route table cannot read ends in a RouteLocalizationError carrying the resolution, so an application's handler reads why rather than parsing a message.",
    source: 'packages/runtime/router/src/route-localization.ts',
    find: '      throw new RouteLocalizationError(resolution);',
    replace:
      '      throw new Error(`Localized route resolution failed with ${resolution.status}.`);',
  },
  {
    id: 'scroll-hold-survives-a-later-commit',
    invariant:
      'The window holding a restored scroll position closes when a later commit supersedes the one it restored.',
    source: 'packages/runtime/src/angular.ts',
    find: '        !open ||\n        sequence !== this.sequence ||',
    replace: '        !open ||\n        sequence < 0 ||',
  },
  {
    id: 'generated-composition-accepts-anything',
    invariant:
      'The generated provideLocalization() takes feature providers, and nothing else.',
    source: 'packages/toolkit/src/generated-contracts.ts',
    find: "    '  ...features: readonly LocalizationFeature[]',\n    '): EnvironmentProviders {',\n    '  return provideLocalizationSetup(localizationSetup, ...features);',",
    replace:
      "    '  ...features: readonly unknown[]',\n    '): EnvironmentProviders {',\n    '  return provideLocalizationSetup(localizationSetup, ...(features as readonly LocalizationFeature[]));',",
    suite: 'verify:consumer',
    caughtWhen:
      /did not report "Argument of type '\{ provide: string; useValue: number; \}\[\]' is not assignable/u,
  },
  {
    id: 'per-visitor-route-prerendered',
    invariant:
      'A build refuses to prerender a route that is per visitor, not stored, or private, and writes no page for it.',
    source: 'packages/runtime/router/src/provide.ts',
    find: '    if (level !== undefined) {',
    replace: "    if (level !== undefined && (level as string) === '') {",
    suite: 'verify:consumer',
    // The consumer's own specs run before its build, and one of them asks the same refusal.
    caughtWhen:
      /The build prerendered route:lazy, which it has to refuse|FAIL .*a page rendered ahead of a request > is refused for a route kept per visitor/u,
  },
  {
    id: 'primary-entry-imports-node',
    invariant:
      'A production graph that selects only the primary entry point reaches no Node built-in.',
    source: 'packages/runtime/src/public-api.ts',
    find: "export * from '@neolorn/equator/core';",
    replace:
      "// @ts-ignore\nimport 'node:fs';\nexport * from '@neolorn/equator/core';",
    suite: 'verify:focused-consumers',
    caughtWhen:
      /Minimal browser (?:graph|output) imports Node built-in|"node:fs"/u,
  },
  {
    id: 'primary-entry-loads-forms',
    invariant:
      'The primary entry point reaches nothing of Angular Forms, so an application without forms bundles none of it.',
    source: 'packages/runtime/src/angular.ts',
    find: "  const recovery = oneFeature(features, 'recovery-message') as\n",
    replace:
      "  void import('@angular/forms');\n  const recovery = oneFeature(features, 'recovery-message') as\n",
    suite: 'verify:focused-consumers',
    caughtWhen: /Minimal browser output contains unused @angular\/forms input/u,
  },
  {
    id: 'server-table-accepts-a-free-route-identity',
    invariant:
      'A server table entry naming a route identity the projection does not declare fails compilation.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  readonly routeId: RouteIdOf<Projection>;',
    replace: '  readonly routeId: RouteIdOf<Projection> | string;',
    suite: 'verify:consumer',
    caughtWhen: /\.negative\.ts did not report/u,
  },
  {
    id: 'setup-accepts-angular-providers',
    invariant:
      'provideLocalizationSetup() takes the setup and feature providers, and nothing else.',
    source: 'packages/runtime/src/angular.ts',
    find: '  ...features: readonly LocalizationFeature[]\n): EnvironmentProviders {\n',
    replace:
      '  ...widened: readonly (LocalizationFeature | EnvironmentProviders)[]\n): EnvironmentProviders {\n  const features = widened as readonly LocalizationFeature[];\n',
    suite: 'verify:consumer',
    caughtWhen:
      /did not report "Argument of type 'EnvironmentProviders' is not assignable/u,
  },
  {
    id: 'inline-scroll-restored-unsigned',
    invariant:
      'The inline scroll distance is restored signed for the direction the document is in after the switch.',
    source: 'packages/runtime/src/angular.ts',
    find: "        snapshot.direction === 'rtl' ? -logicalInline : logicalInline;",
    replace:
      "        snapshot.direction === 'rtl' ? logicalInline : logicalInline;",
    suite: 'browser',
    caughtWhen:
      /The RTL commit did not return the visitor to the position they left/u,
  },
  {
    id: 'localized-input-limited-to-one-line-fields',
    invariant:
      'A localized field works on both text elements the form system binds a value accessor to.',
    source: 'packages/runtime/forms/src/public-api.ts',
    find: '  protected handleInput(): void {\n    if (this.composing) return;',
    replace:
      "  protected handleInput(): void {\n    if (this.composing || this.element.tagName === 'TEXTAREA') return;",
  },
  {
    id: 'restored-scroll-not-held',
    invariant:
      'After a direction change with something focused, the restored scroll position is held against movement nobody asked for.',
    source: 'packages/runtime/src/angular.ts',
    find: '      if (turnsAround && focusable !== undefined) {',
    replace:
      '      if (turnsAround && focusable !== undefined && (turnsAround as unknown) === 0) {',
  },
  {
    id: 'scroll-hold-opened-without-focus',
    invariant:
      'The window that holds a restored scroll position opens only when an element had focus, because a document with nothing focused has nothing for the engine to reveal.',
    source: 'packages/runtime/src/angular.ts',
    find: '      active instanceof view.HTMLElement &&\n      active !== this.document.body &&\n      active !== this.document.documentElement &&\n',
    replace: '      active instanceof view.HTMLElement &&\n',
  },
  {
    id: 'browser-percent-differs-from-the-host',
    invariant:
      'Each engine renders the exercise sheet as its own Intl writes it, so a browser and a server show the same text.',
    source: 'fixtures/package-consumer-template/src/app/exercise-route.ts',
    find: 'text: written(formatPercent(values.percent, context, options.percent)),',
    replace:
      "text: written(formatPercent(values.percent, context, options.percent)) + '!',",
    suite: 'verify:consumer',
    caughtWhen:
      /The exercise sheet's formatPercent line is not what the host writes for its input/u,
  },
  {
    id: 'locale-neutral-shared-address-prerendered',
    invariant:
      'Under a locale-neutral policy, an address more than one locale spells is refused for prerendering.',
    source: 'packages/runtime/router/src/provide.ts',
    find: "    if (resolution.variesBy === 'locale-preference') {",
    replace: "    if ((resolution.variesBy as string) === 'none of them') {",
    suite: 'verify:locale-neutral-consumer',
    // The consumer's own specs run before its build, and one of them asks the same refusal.
    caughtWhen:
      /The build prerendered route:second, which it has to refuse|FAIL .*a page rendered ahead of a request > is refused at an address more than one locale spells/u,
  },
  {
    id: 'announcement-written-through-runtime-code-generation',
    invariant:
      'Nothing Equator runs in the browser generates code at run time, so a policy without unsafe-eval reports no violation.',
    source: 'packages/runtime/src/angular.ts',
    find: '    if (this.region !== undefined) this.region.textContent = message;',
    replace:
      "    if (this.region !== undefined)\n      this.region.textContent = new Function('m', 'return m')(message) as string;",
    suite: 'browser',
    caughtWhen:
      /Evaluating a string as JavaScript violates the following Content Security Policy directive/u,
  },
  {
    id: 'announcer-styled-through-an-inline-attribute',
    invariant:
      'The live region Equator adds is styled through the CSSOM, so a policy that denies inline style attributes reports no violation.',
    source: 'packages/runtime/src/angular.ts',
    find: "    region.setAttribute('data-equator-announcer', 'true');",
    replace:
      "    region.setAttribute('data-equator-announcer', 'true');\n    region.setAttribute('style', 'position: fixed');",
    suite: 'browser',
    caughtWhen:
      /Applying inline style violates the following Content Security Policy directive 'style-src-attr 'none''/u,
  },
  {
    id: 'structured-path-creates-a-trusted-types-policy',
    invariant:
      'Rendering a structured message creates no Trusted Types policy, so an application that serves a strict policy naming only its own inherits no dependency from Equator.',
    source: 'packages/runtime/src/message-template.ts',
    find: '    requireBindings(\n      result.value,',
    replace:
      "    try {\n      (\n        globalThis as {\n          readonly trustedTypes?: {\n            createPolicy(name: string, rules: object): unknown;\n          };\n        }\n      ).trustedTypes?.createPolicy('equator', {});\n    } catch {\n      // Swallowed so that only the policy directive can report this.\n    }\n    requireBindings(\n      result.value,",
    suite: 'browser',
    caughtWhen: /Creating a TrustedTypePolicy named 'equator' violates/u,
  },
  {
    id: 'recovery-retry-state-out-of-its-values',
    invariant:
      'What Equator renders conforms to WCAG 2.2 AA, so an ARIA state outside its allowed values on the recovery retry is refused.',
    // An attribute no spec and no earlier browser check reads, so only the audit can refuse it.
    source: 'packages/runtime/src/recovery.ts',
    find: '          <button\n            type="button"\n',
    replace:
      '          <button\n            type="button"\n            aria-pressed="maybe"\n',
    suite: 'browser',
    caughtWhen:
      /recovery in ar-EG: what Equator renders or writes violates WCAG 2\.2 AA: aria-valid-attr-value/u,
  },
  {
    id: 'document-language-contradicted-by-xml-lang',
    invariant:
      'The language Equator writes on the document root is the only one the root declares, so an xml:lang that contradicts it is refused.',
    // Beside the lang Equator writes, where only the audit over the whole document can see it.
    source: 'packages/runtime/src/angular.ts',
    find: "      root.setAttribute('dir', snapshot.direction);\n    } catch (error: unknown) {",
    replace:
      "      root.setAttribute('dir', snapshot.direction);\n      root.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'fr');\n    } catch (error: unknown) {",
    suite: 'browser',
    caughtWhen:
      /what Equator renders or writes violates WCAG 2\.2 AA: html-xml-lang-mismatch/u,
  },
  {
    id: 'label-writes-an-attribute-aria-does-not-define',
    invariant:
      'Every ARIA attribute a directive writes onto its host is one ARIA defines, whatever element the application chose as the host.',
    // On the application's element, outside everything Equator renders, so only the rules over the
    // whole document can see it.
    source: 'packages/runtime/src/label.ts',
    find: '      this.renderer.setAttribute(this.element.nativeElement, attribute, value);\n',
    replace:
      "      this.renderer.setAttribute(this.element.nativeElement, attribute, value);\n      this.renderer.setAttribute(this.element.nativeElement, 'aria-labelled', value);\n",
    suite: 'browser',
    caughtWhen:
      /what Equator renders or writes violates WCAG 2\.2 AA: aria-valid-attr \(/u,
  },
  {
    id: 'text-accepts-wording-of-its-own',
    invariant:
      "A call site cannot hand the runtime wording of its own beside a message's inputs, because the catalog is the only author of a message's words.",
    source: 'packages/runtime/core/src/contracts.ts',
    find: '  ? readonly [inputs: InputsOfEveryMember<Handle>]',
    replace:
      '  ? readonly [inputs: InputsOfEveryMember<Handle>, fallback?: string]',
    suite: 'verify:consumer',
    // Either file reports the extra argument first, depending on the order the stage reads them in;
    // both hold the call to the number of arguments the message takes.
    caughtWhen:
      /negative-(?:message-handle|handle-choice)\.negative\.ts did not report "Expected 2 arguments, but got [13]"/u,
  },
  {
    id: 'handle-choice-read-as-one-message',
    invariant:
      'A handle chosen at runtime between messages takes the inputs of every message it can select, and requires them when any of those messages does.',
    source: 'packages/runtime/core/src/contracts.ts',
    find: 'true extends (\n  Handle extends unknown\n    ? keyof MessageInputs<Handle> extends never\n      ? false\n      : true\n    : never\n)\n  ? readonly [inputs: InputsOfEveryMember<Handle>]\n  : readonly [inputs?: InputsOfEveryMember<Handle>];',
    replace:
      'keyof MessageInputs<Handle> extends never\n  ? readonly [inputs?: InputsOfEveryMember<Handle>]\n  : readonly [inputs: InputsOfEveryMember<Handle>];',
    suite: 'verify:consumer',
    caughtWhen: /negative-handle-choice\.negative\.ts did not report/u,
  },
  {
    id: 'message-signal-without-its-inputs',
    invariant:
      'A signal of a message that needs inputs cannot be made without them, given as values or as a signal.',
    source: 'packages/runtime/src/localization.ts',
    find: '    ? readonly [inputs: Inputs | Signal<Inputs>]',
    replace: '    ? readonly [inputs?: Inputs | Signal<Inputs>]',
    suite: 'verify:consumer',
    caughtWhen:
      /negative-message-handle\.negative\.ts did not report "Expected 2 arguments, but got 1" under line (?:48|51)/u,
  },
  {
    id: 'scroll-restore-clamped-to-the-range',
    invariant:
      "The inline position restored across a direction change is the captured distance, not one clamped to the document's scroll range read at restore.",
    source: 'packages/runtime/src/angular.ts',
    find: "      const inline =\n        snapshot.direction === 'rtl' ? -logicalInline : logicalInline;",
    replace:
      "      const range = Math.max(\n        0,\n        this.document.documentElement.scrollWidth - view.innerWidth,\n      );\n      const inline =\n        snapshot.direction === 'rtl'\n          ? -Math.min(logicalInline, range)\n          : Math.min(logicalInline, range);",
  },
  // One per engine the browser specs run in, each answering differently in that engine alone, so
  // an engine the stage stopped running would leave its injection uncaught.
  ...[
    { engine: 'chromium', test: '/Chrome\\//u.test(userAgent)' },
    { engine: 'firefox', test: '/Firefox\\//u.test(userAgent)' },
    {
      engine: 'webkit',
      test: '/AppleWebKit/u.test(userAgent) && !/Chrome\\/|Firefox\\/|jsdom/u.test(userAgent)',
    },
  ].map(({ engine, test }) => ({
    id: `locale-match-differs-in-${engine}`,
    invariant: `A request for a region the application does not have is matched to the same locale in ${engine} as everywhere else.`,
    source: 'packages/runtime/core/src/locale-negotiation.ts',
    find: '    if (related !== undefined) return related.locale;',
    replace: `    const userAgent =\n      (globalThis as { navigator?: { userAgent?: string } }).navigator\n        ?.userAgent ?? '';\n    if (related !== undefined && !(${test})) return related.locale;`,
    suite: 'verify:browser-specs',
    // The failure line, which names the engine; the engine's passing line names the file too.
    caughtWhen: new RegExp(
      `FAIL\\s+\\|feature-lab \\(${engine}\\)\\| src/app/locale-matching\\.spec\\.ts`,
      'u',
    ),
  })),
]);
