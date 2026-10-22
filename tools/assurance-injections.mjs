/**
 * The injections `verify:assurance` applies, kept apart from the runner so the normative map can
 * name one as the check behind a statement without importing a script that patches source when it
 * loads.
 */

const PATHS_OVERLAY = `    paths: {
      ...(request.compilerOptions?.paths ?? {}),
      ...Object.fromEntries(virtualPathEntries),
    },`;

export const injections = Object.freeze([
  {
    id: 'consumer-paths-discarded',
    invariant:
      "Equator overlays its #i18n specifiers on the consumer's own paths instead of replacing them.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: PATHS_OVERLAY,
    replace: `    paths: {
      ...Object.fromEntries(virtualPathEntries),
    },`,
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'consumer-paths-discarded-through-the-cli',
    invariant:
      "A project compiled the way the CLI compiles it still resolves the consumer's own path aliases.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: PATHS_OVERLAY,
    replace: `    paths: {
      ...Object.fromEntries(virtualPathEntries),
    },`,
    caughtBy: 'packages/toolkit/test/consumer-source-diagnostics.test.ts',
  },
  {
    id: 'strictness-imposed',
    invariant:
      "Equator analyzes under the consumer's compiler options and never adds strictness of its own.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: PATHS_OVERLAY,
    replace: `${PATHS_OVERLAY}
    noUncheckedIndexedAccess: true,`,
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'missing-plural-categories-unreported',
    invariant:
      'A target locale that omits a plural category its rules require is reported (EQ1308).',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    if (missing.length === 0) continue;',
    replace: '    if (missing.length >= 0) continue;',
    caughtBy: 'packages/toolkit/test/plural-coverage.test.ts',
  },
  {
    id: 'omitted-target-message-unreported',
    invariant:
      'A target catalog that omits a required message is reported (EQ1307).',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: `        'EQ1307',`,
    replace: `        'EQ1306',`,
    caughtBy: 'packages/toolkit/test/target-completeness.test.ts',
  },
  {
    id: 'authored-bidi-admitted',
    invariant:
      'A bidirectional control that can reorder surrounding text is refused when a catalog is parsed.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '      const violation = inspectAuthoredBidi(value);',
    replace: '      const violation = undefined as undefined;',
    caughtBy: 'packages/toolkit/test/bidi-policy.test.ts',
  },
  {
    id: 'stale-translation-restamped',
    invariant:
      'A translation whose source moved underneath it keeps its prior stamp and is reported stale.',
    source: 'packages/toolkit/src/translation-state.ts',
    find: '        if (prior === undefined || prior.target !== digest) {',
    replace: '        if (true) {',
    caughtBy: 'packages/toolkit/test/translation-state.test.ts',
  },
  {
    id: 'untrusted-input-coerced',
    invariant:
      'A validator checks that untrusted input is a string before any grammar reads it.',
    source: 'packages/toolkit/src/untrusted-text.ts',
    find: "  if (typeof value !== 'string') {",
    replace: '  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/untrusted-input.test.ts',
  },
  {
    id: 'call-argument-shape-unchecked',
    invariant:
      'A call whose argument is not its documented shape throws a TypeError naming the function and the argument.',
    source: 'packages/toolkit/src/call-arguments.ts',
    find: '    if (!matches(value)) refuse(expected);',
    replace: '    if (false as boolean) refuse(expected);',
    caughtBy: 'packages/toolkit/test/call-argument-shapes.test.ts',
  },
  {
    id: 'handed-over-catalog-unjudged',
    invariant:
      'A catalog a caller assembles is judged as parseCatalog judges the same content.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '  if (catalogSourceText.has(catalog) || admittedCatalogs.has(catalog)) {',
    replace: '  if (true as boolean) {',
    caughtBy: 'packages/toolkit/test/handed-over-catalogs.test.ts',
  },
  {
    id: 'handed-over-configuration-unjudged',
    invariant:
      'A configuration a caller assembles is judged as parseConfiguration judges the same content.',
    source: 'packages/toolkit/src/configuration.ts',
    find: '  if (parsedConfigurations.has(configuration)) {\n    return toolkitSuccess(configuration);',
    replace:
      '  if (true as boolean) {\n    return toolkitSuccess(configuration);',
    caughtBy:
      'packages/toolkit/test/compile-project-handed-over-content.test.ts',
  },
  {
    id: 'owner-provider-identity-unjudged',
    invariant:
      'An owner identity whose provider is outside the provider grammar is refused, with or without catalogs.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '  const provider = parseProviderId(request.owner.providerId);',
    replace: "  const provider = parseProviderId('equator');",
    caughtBy: 'packages/toolkit/test/compile-project-owner-identity.test.ts',
  },
  {
    id: 'linked-analysis-source-read',
    invariant:
      'A TypeScript source behind a link inside the owner is reported and not read.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    const linked = await linkedSegment(location.ownerRoot, path);',
    replace: '    const linked = undefined as string | undefined;',
    caughtBy: 'packages/toolkit/test/host-environment-failures.test.ts',
  },
  {
    id: 'generation-lock-kept-after-a-refused-inventory',
    invariant:
      'A generation refused for what its generated root holds gives its lock back.',
    source: 'packages/toolkit/src/output-host.ts',
    find: "    // throwing, so the refusal is reported as the root's and the lock is given back.\n    await releaseLock();",
    replace:
      "    // throwing, so the refusal is reported as the root's and the lock is given back.",
    caughtBy: 'packages/toolkit/test/output-host-linked-content.test.ts',
  },
  {
    id: 'translator-notes-dropped',
    invariant:
      'Authored description and context reach the translator as XLIFF notes.',
    source: 'packages/toolkit/src/xliff.ts',
    find: `  return notes.length === 0
    ? []
    : ['      <notes>', ...notes, '      </notes>'];`,
    replace: '  return [];',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'missing-recovery-root-unreported',
    invariant:
      'An owner that composes the application runtime without a recovery root is an error in generate and check.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '    analysis?.selectsApplicationRuntime === true &&',
    replace: '    false &&',
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'unused-source-messages-unreported',
    invariant:
      'Source messages nothing reaches are reported as a grouped advisory.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '    diagnostics.push(...unusedSourceMessages(graph.value, analysis));',
    replace: '    void unusedSourceMessages(graph.value, analysis);',
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'build-command-authors-manifest',
    invariant:
      'Only equator init creates an owner manifest; build commands never author files.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  const packageManifest = await readPackageManifest(location.value);',
    replace:
      '  const packageManifest = await readPackageManifest(location.value, true);',
    caughtBy: 'packages/toolkit/test/multi-owner-workspace.test.ts',
  },
  {
    id: 'unknowable-route-subtree-named-from-the-root',
    invariant:
      'Routes below an address Equator cannot know are left unnamed, never named as if they sat at the top of the application.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: `    parentPath: string | undefined,
    parentLazyEntries: readonly string[],`,
    replace: `    parentPath: string | undefined = '',
    parentLazyEntries: readonly string[] = [],`,
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'pathless-route-subtree-invisible',
    invariant:
      'A pathless layout route is descended through, so the routes and lazy boundaries beneath it are still read.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: `      const ownPath =
        declared.kind === 'literal' ? declared.path.text : undefined;
`,
    replace: `      const ownPath =
        declared.kind === 'literal' ? declared.path.text : undefined;
      if (ownPath === '') continue;
`,
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'route-identity-collision-unreported',
    invariant:
      'Two addresses resolving to one identity are reported, and neither is projected.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    if (group.length > 1) {',
    replace: '    if (false && group.length > 1) {',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'generated-provider-unrecognized',
    invariant:
      'An application that composes the runtime through the generated provideLocalization() is recognized as one.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: `    resolved.name === 'provideLocalization' &&
    declaredIn(resolved, generatedRoot)`,
    replace: `    false &&
    declaredIn(resolved, generatedRoot)`,
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'provisional-overlay-omits-the-provider',
    invariant:
      'The overlay that resolves #i18n during analysis carries the provider an application composes through.',
    source: 'packages/toolkit/src/compiler.ts',
    find: "    provider: 'declaration',",
    replace: '    provider: false,',
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'consumer-route-field-ignored',
    invariant:
      "Route indexing reads the field the consumer named through withRouting, not one of Equator's invention.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '  const field = policy?.field ?? DEFAULT_ROUTE_INDEXING_FIELD;',
    replace: '  const field = DEFAULT_ROUTE_INDEXING_FIELD;',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'selected-message-group-unreachable',
    invariant:
      'A message group handed to a call counts as a use of every message in it, so messages a running program selects are not reported unused.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '        } else if (identity === undefined && !isPropertyName && handedOff) {',
    replace: '        } else if (false) {',
    caughtBy: 'packages/toolkit/test/issue-pairing.test.ts',
  },
  {
    id: 'message-group-receiver-counts-as-use',
    invariant:
      'Walking through a group to reach one message is not a use of the rest of it; otherwise the unused-message advisory could never fire.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '          ts.isShorthandPropertyAssignment(node.parent) ||',
    replace: '          true ||',
    caughtBy: 'packages/toolkit/test/issue-pairing.test.ts',
  },
  {
    id: 'formatting-regenerates-authored-catalogs',
    invariant:
      'Formatting edits the authored document; regenerating it from the semantic model deletes every comment in it.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    const formatted = formatCatalogSource(file.source, catalogOptions);',
    replace: `    const formatted = formatCatalogSource(
      formatCatalog(file.catalog),
      catalogOptions,
    );`,
    caughtBy: 'packages/toolkit/test/lossless-format.test.ts',
  },
  {
    id: 'success-path-never-inspects-severity',
    invariant:
      'A command that did what it was asked still fails when it found something at error severity.',
    // The success path returned 0 unconditionally, so `equator check --require-complete` reported
    // `"status": "success"` while carrying EQ1310 at `severity: error`, and every later change
    // was verified by a gate that could not fail on the things it depended on.
    //
    // Returning false is the mutation because it is the shape the defect actually had: not a wrong
    // answer, an unasked question.
    source: 'packages/toolkit/src/diagnostics.ts',
    find: "  return diagnostics.some(({ severity }) => severity === 'error');",
    replace: '  return false;',
    caughtBy: 'packages/toolkit/test/gate-exit-code.test.ts',
  },
  {
    id: 'strict-freshness-opt-in-ignored',
    invariant:
      'The strict-freshness opt-in actually escalates the staleness advisory, rather than being parsed and dropped.',
    // The injection is the failure the invariant above names: a flag that is read but never
    // consulted. Pinning the severity to `warning` leaves the option, the flag and the plumbing all
    // present and makes the policy do nothing, which a test asserting only the on-case would pass.
    source: 'packages/toolkit/src/project-host.ts',
    find: "          severity: options.requireFreshOutput === true ? 'error' : 'warning',",
    replace: "          severity: 'warning',",
    caughtBy: 'packages/toolkit/test/strict-freshness.test.ts',
  },
  {
    id: 'numbering-system-dropped-when-formatting',
    invariant:
      'A number is rendered in the numbering system the context asked for, not in the locale default.',
    // `formatting.ts` and `parsing.ts` are the largest correctness surface in the runtime and
    // where every numbering-system finding has lived, and for a long time neither harness carried
    // a single injection naming either: every `source:` was `routing.ts`, `angular.ts`,
    // `localization.ts` or the router's public API.
    //
    // Dropping the numbering system is the regression that would actually happen, and it is
    // invisible to a self-consistent round trip: Equator would render `1234` where `١٢٣٤` was asked
    // for, parse it back to 1234, and be wrong for every reader.
    source: 'packages/runtime/src/formatting.ts',
    //
    // Pointed at a call site rather than at the helper, and worth an injection of its own for
    // that reason. The *helper* is already covered by
    // `numbering-system-passed-as-an-option-again`, but that proves the helper, not that each of the
    // nine call sites in this file actually uses what the helper returns. This drops the tag at one
    // site while leaving the validation above it intact, which is exactly the defect found in
    // `evaluator.ts`: a site that validates the numbering system and then formats without it.
    find: `    const formatter = cache.number(host.tag, {
      ...options,
    });
    return success(
      semantic,
      formatter.format(number),`,
    replace: `    const formatter = cache.number(context.locale, {
      ...options,
    });
    return success(
      semantic,
      formatter.format(number),`,
    caughtBy: 'packages/runtime/test/numeric-formatting.test.ts',
  },
  {
    id: 'numbering-system-passed-as-an-option-again',
    invariant:
      'A number range and a duration are rendered in the numbering system the context asked for.',
    // `NumberFormat.formatRange`, `formatRangeToParts` and `DurationFormat.format` accept
    // a `numberingSystem` option, ignore it, and then report through `resolvedOptions()` that they
    // honoured it. Equator builds a `-u-nu-` tag instead; this mutation hands back the bare locale,
    // which is what passing the option amounted to.
    //
    // The validation is deliberately left intact, so what this removes is only the delivery. A test
    // that checked for the refusal alone would stay green.
    source: 'packages/runtime/src/evaluator.ts',
    find: `    return new Intl.Locale(context.locale, { numberingSystem }).toString();`,
    replace: `    return context.locale;`,
    caughtBy: 'packages/runtime/test/numeric-formatting.test.ts',
  },
  {
    id: 'unsupported-numbering-system-renders-anyway',
    invariant:
      'A numbering system this runtime has no data for is refused, not quietly replaced with the locale default.',
    // Neither the option form nor the extension form reports an unsupported
    // but well-formed value, both fall back and render, so without this check the caller asks
    // for digits that do not exist, is told nothing, and is shown different ones. Removing the
    // check restores exactly that silence. A formatter also meets the host chain, which refuses a
    // context whose numbering system the host drops, so a field read under one is where this check
    // is the only refusal.
    source: 'packages/runtime/src/evaluator.ts',
    find: `  if (!supportedNumberingSystems().has(numberingSystem)) return undefined;`,
    replace: `  if (false) return undefined;`,
    caughtBy: 'packages/runtime/test/localized-input-numbering-system.test.ts',
  },
  {
    id: 'sign-marks-not-learned-from-the-locale',
    invariant:
      'A signed number can be read back in the locales whose sign the platform decorates with a formatting control.',
    // `Intl` writes U+061C, U+200E or U+200F next to the sign in 27 of the 162 locales this ICU
    // build has data for, so comparing the front of the string against a bare minus refuses to
    // render a negative decimal in every one of them.
    //
    // Emptying the learned set is the mutation because it is the regression that would actually
    // happen: someone deciding the marks are noise, or the derivation moving to a formatter that
    // does not emit them.
    //
    // The first runtime injection in this file rather than the runtime one. Nothing about it needs
    // Angular, so nothing about it needs a package build and a materialized consumer: it patches a
    // pure module and runs one vitest file.
    //
    // What that buys is not total gate time: placing it here rather than in the runtime gate is
    // -3s there and +4s here, a wash within the run-to-run noise. What it buys is that this
    // injection can be run *alone*, in about a second, against a package build plus a consumer
    // materialize plus the consumer suite for one over there. The reason is reachability rather
    // than throughput.
    source: 'packages/runtime/src/localized-input.ts',
    find: '        if (/\\p{Cf}/u.test(scalar)) signMarks.add(scalar);',
    replace: '        if (false) signMarks.add(scalar);',
    caughtBy: 'packages/runtime/test/numeric-differential.test.ts',
  },
  {
    id: 'integer-parameter-codec-reads-any-number',
    invariant:
      'An integer route parameter is a decimal spelling, not whatever `Number` will accept.',
    // The sibling of `identifier-parameter-codec-accepts-anything`, which lives in the slow harness
    // because the consumer's own article route exercises it. This one had no route and no test at
    // all: the first mutation run reported 56 mutants in `createIntegerParameterCodec` that nothing
    // reached, in a function exported from the primary entry point.
    //
    // Taking the pattern out does not make the codec accept everything, which is what makes this
    // the honest injection rather than a strawman. `Number.isSafeInteger` still holds, so what gets
    // through is narrower and worse: `1e3`, ` 1`, `0x10` and `''` become valid spellings of 1000,
    // 1, 16 and 0. Each is a second address for a record that already has one, and Equator's own
    // canonicalizer will not redirect them: the codec it asks says they are correct.
    source: 'packages/runtime/core/src/routing.ts',
    find: [
      '      if (!/^-?[0-9]{1,64}$/u.test(value)) {',
      '        return Object.freeze({ ok: false });',
      '      }',
    ].join('\n'),
    replace: '      // The decimal spelling is not checked.',
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'catalog-locale-accepts-an-extension',
    invariant:
      'A catalog locale identity carries no extension or private-use subtag, so one locale cannot become two catalogs.',
    // `en-US` and `en-US-u-ca-islamic` name the same language to every reader and different
    // catalogs to Equator. The check is one line and nothing had ever watched it fail; the property
    // file that now does generates the tags rather than listing four of them, because the failure
    // is a class, any singleton subtag, and not a spelling.
    source: 'packages/toolkit/src/locales.ts',
    find: '  if (parts.slice(1).some((part) => part.length === 1)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/round-trip-properties.test.ts',
  },
  {
    id: 'uninstall-reverts-an-edited-entry',
    invariant:
      'Uninstall takes back only what Equator wrote; an edited script or a repointed #i18n specifier is left alone and named.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '      if (entries[specifier] === target) delete entries[specifier];',
    replace: '      if (true) delete entries[specifier];',
    caughtBy: 'packages/toolkit/test/uninstall.test.ts',
  },
  {
    id: 'uninstall-removes-authored-catalogs',
    invariant:
      "Authored catalogs survive an uninstall unless their removal is asked for by name; they are the consumer's content.",
    source: 'packages/toolkit/src/project-host.ts',
    find: '    options.catalogs === true ? await loadProject(options) : undefined;',
    replace: '    true ? await loadProject(options) : undefined;',
    caughtBy: 'packages/toolkit/test/uninstall.test.ts',
  },
  {
    id: 'template-usage-never-deferred',
    invariant:
      "A message used only in a component's template is deferred with the component that owns the template, rather than reading as eager because no module imports a .html file.",
    source: 'packages/toolkit/src/compiler.ts',
    find: `    const path = owningSource.get(usage.sourcePath) ?? usage.sourcePath;
    if (!deferredPaths.has(path)) eager.add(scopeId);`,
    replace: `    const path = usage.sourcePath;
    if (!deferredPaths.has(path)) eager.add(scopeId);`,
    caughtBy: 'packages/toolkit/test/template-reachability.test.ts',
  },
  {
    id: 'lazy-route-carries-no-scopes',
    invariant:
      'A route behind a lazy boundary carries the scopes it must have ready, so deferring a scope does not mean rendering a page whose text never arrives.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '  const deferred = new Set(deferredSourcePaths);',
    replace: '  const deferred = new Set<string>();',
    caughtBy: 'packages/toolkit/test/template-reachability.test.ts',
  },
  {
    id: 'hidden-route-address-unreported',
    invariant:
      'A route whose path or matcher the build cannot read is named in a warning, with the addresses below it that it hides.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      if (parentPath !== undefined && declared.kind === 'hidden') {",
    replace: '      if (false) {',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'hidden-route-address-fails-the-build',
    invariant:
      'A route that hides addresses from the projection is reported as a warning, and the analysis still succeeds.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "            { path: ['routes', portableSourcePath], severity: 'warning' },\n          ),\n        );\n      }\n      // A route in a named outlet",
    replace:
      "            { path: ['routes', portableSourcePath], severity: 'error' },\n          ),\n        );\n      }\n      // A route in a named outlet",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'route-parameter-name-in-identity',
    invariant:
      "A route's identity collapses every parameter segment to one mark, so renaming a parameter changes no identity.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '      marks.push(ROUTE_PARAMETER_MARK);',
    replace: '      marks.push(segment.slice(1));',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'unnameable-route-projected-under-its-raw-path',
    invariant:
      'An address that cannot be named within the identity grammar is reported and left out of the projection.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    const identity = routeIdentity(draft.path);',
    replace:
      '    const identity = routeIdentity(draft.path) ?? `route:${draft.path}`;',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'codec-round-trip-unchecked',
    invariant:
      'A URL is built only where the parameter codec reads its own spelling back to the same text in the locale being built.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (\n      !read.ok ||\n      read.value === undefined ||\n      askCodec(context, () => codec.serialize(read.value, context)) !==\n        serialized\n    ) {',
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'codec-throw-left-untyped',
    invariant:
      'A route parameter codec that throws while an address is read fails the resolution with a typed failure naming the route, the parameter and the locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      const parsed = askCodec(context, () => codec.parse(actual, context));',
    replace: '      const parsed = codec.parse(actual, context);',
    caughtBy: 'packages/runtime/test/route-codec-that-throws.test.ts',
  },
  {
    id: 'codec-throw-left-untyped-while-an-address-is-built',
    invariant:
      'A route parameter codec that throws while an address is built fails the call with a typed failure naming the route, the parameter and the locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    const read = askCodec(context, () => codec.parse(serialized, context));',
    replace: '    const read = codec.parse(serialized, context);',
    caughtBy: 'packages/runtime/test/route-codec-that-throws-building.test.ts',
  },
  {
    id: 'codec-failure-answered-as-not-found',
    invariant:
      'The request handler answers a codec that threw as a render that failed, never as an address that is missing.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '        status: failed.status,\n        headers: {\n          ...routeCacheHeaders(\n            { ...UNRESOLVED, cache: failed.cache },',
    replace:
      '        status: 404,\n        headers: {\n          ...routeCacheHeaders(\n            { ...UNRESOLVED, cache: failed.cache },',
    caughtBy: 'packages/runtime/test/route-codec-that-throws.test.ts',
  },
  {
    id: 'declined-parameter-matched-anyway',
    invariant:
      'An address whose parameter the codec declines to parse does not match the route.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!parsed.ok || parsed.value === undefined) {',
    replace:
      '      if (!parsed.ok || parsed.value === undefined) {\n        parameters[name] = actual;\n        canonicalSegments.push(actual);\n        continue;\n      }\n      if (false) {',
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'unplaced-address-rewritten',
    invariant:
      'An address the resolver cannot place is handed back to the application unchanged.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (resolution.status !== 'success') return external;",
    replace: "  if (resolution.status !== 'success') return '/';",
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'declared-spelling-borrowed-across-locales',
    invariant:
      "A locale a parameter-spelling declaration omits is spelled by the route's codec, never by another locale's declared spelling.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    const declared = spellings?.[name]?.[locale];',
    replace:
      '    const declared =\n      spellings?.[name]?.[locale] ??\n      Object.values(spellings?.[name] ?? {})[0];',
    caughtBy: 'packages/runtime/test/declared-parameter-spellings.test.ts',
  },
  {
    id: 'declared-spelling-parse-unchecked',
    invariant:
      "A declared parameter spelling is emitted only where the route's own codec parses it.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!askCodec(context, () => codec.parse(declared, context)).ok) {',
    replace: '      if (false) {',
    caughtBy: 'packages/runtime/test/declared-parameter-spellings.test.ts',
  },
  {
    id: 'declared-spelling-safety-unchecked',
    invariant:
      'A declared parameter spelling is emitted only where it is a safe path segment.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!safeParameterSegment(declared)) {',
    replace: '      if (false) {',
    caughtBy: 'packages/runtime/test/declared-parameter-spellings.test.ts',
  },
  {
    id: 'declared-spelling-held-to-round-trip',
    invariant:
      'A declared parameter spelling is not required to parse back to the value the page was addressed with.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!askCodec(context, () => codec.parse(declared, context)).ok) {',
    replace:
      '      if (codec.parse(declared, context).value !== parameters[name]) {',
    caughtBy: 'packages/runtime/test/declared-parameter-spellings.test.ts',
  },
  {
    id: 'built-policy-keeps-unbuilt-aliases',
    invariant:
      'The narrowed policy drops a locale the build did not generate from every one of its tables, aliases included.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    aliases: retain(policy.aliases, valued),',
    replace: '    aliases: policy.aliases,',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'unbuilt-locale-left-in-policy',
    invariant:
      'A locale the build did not generate is removed from the policy, so its prefix is unsupported locale intent and a preference naming it is ignored.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    locales: retain(policy.locales, keyed),\n    prefixes: retain(policy.prefixes, valued),',
    replace: '    locales: policy.locales,\n    prefixes: policy.prefixes,',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'configuration-without-default-locale-accepted',
    invariant:
      "A generated configuration that omits the policy's default locale is refused.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (!built.has(policy.defaultLocale)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'partly-written-locale-table-compared',
    invariant:
      'A locale table with an entry the build cannot read is not compared with the configuration.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    table.properties.every((item) => propertyName(item) !== undefined)',
    replace: '    table.properties.length >= 0',
    caughtBy: 'packages/toolkit/test/derived-locale-policy.test.ts',
  },
  {
    id: 'unread-policy-options-unreported',
    invariant:
      'A policy option the build did not read is named in an advisory, with the two comparisons it was left out of.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '  if (policyLocales !== undefined && policyLocales.unreadOptions.length > 0) {',
    replace:
      '  if (policyLocales !== undefined && policyLocales.unreadOptions.length < 0) {',
    caughtBy: 'packages/toolkit/test/derived-locale-policy.test.ts',
  },
  {
    id: 'undeclared-router-mode-left-to-a-navigation',
    invariant:
      'A Router integration configured with a mode other than coordinated or progressive is refused where the configuration is given.',
    source: 'packages/runtime/router/src/navigation-scopes.ts',
    find: "  if (mode === undefined || mode === 'coordinated' || mode === 'progressive') {",
    replace: "  if (mode !== '') {",
    caughtBy: 'packages/runtime/test/router-undeclared-mode.test.ts',
  },
  {
    id: 'undeclared-change-mode-run-as-progressive',
    invariant:
      'A locale change that names a mode other than coordinated or progressive is refused as a configuration fault.',
    source: 'packages/runtime/src/localization.ts',
    find: "      stated !== 'progressive'\n",
    replace: "      stated !== 'progressive' &&\n      stated === ''\n",
    caughtBy: 'packages/runtime/test/change-locale-undeclared-mode.test.ts',
  },
  {
    id: 'restore-that-found-nothing-reported-as-superseded',
    invariant:
      'A restore that found nothing stored to move the page reports a status no other ending of a restore has.',
    source: 'packages/runtime/src/localization.ts',
    find: "      report('unavailable', { snapshotId });",
    replace:
      "      report('superseded', { reason: 'superseded', snapshotId });",
    caughtBy: 'packages/runtime/test/remembered-locale-requests.test.ts',
  },
  {
    id: 'restore-not-owed-left-unreported',
    invariant:
      'A page the browser drew itself reports that no restore is owed, rather than ending in silence.',
    source: 'packages/runtime/src/localization.ts',
    find: "        phase: 'ssr-hydration',\n        status: 'unavailable',",
    replace: "        phase: 'ssr-hydration',\n        status: 'cancelled',",
    caughtBy: 'packages/runtime/test/remembered-locale-requests.test.ts',
  },
  {
    id: 'restore-of-a-destroyed-application-left-unreported',
    invariant:
      'An application destroyed before hydration ended reports that its restore was cancelled, and reads no store.',
    source: 'packages/runtime/src/localization.ts',
    find: '    if (page.destroyed()) {\n      this.observability?.emit({',
    replace: '    if (page.destroyed()) {\n      void ({',
    caughtBy: 'packages/runtime/test/remembered-locale-requests.test.ts',
  },
  {
    id: 'build-origin-not-required',
    invariant:
      'A build under a locale-host policy is refused unless it is told which origin it answers at.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (origin === undefined) {\n    routeError(\n      `A "locale-host" policy carries the locale in the origin, so localizedServerRoutes()',
    replace:
      '  if (false) {\n    routeError(\n      `A "locale-host" policy carries the locale in the origin, so localizedServerRoutes()',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'alternate-advertised-without-arrival-check',
    invariant:
      'An alternate names a locale only where arriving at its address with no stated preference yields that locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (!addressSelectsLocale(address, locale, policy, projection)) continue;',
    replace: '    void addressSelectsLocale;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'raw-target-discarded',
    invariant:
      'The request handler classifies the target as it arrived, before a URL parser has repaired it.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '      rawTargetOf(request) ?? `${url.pathname}${url.search}`,',
    replace: '      `${url.pathname}${url.search}`,',
    caughtBy: 'packages/runtime/test/http-node-adapter.test.ts',
  },
  {
    id: 'declined-address-rendered',
    invariant:
      "An address the locale policy declines goes to the deployment's own handling and is never rendered.",
    source: 'packages/runtime/http/src/handler.ts',
    find: "    if (resolution.status !== 'malformed' && bypasses(url, policy)) {",
    replace:
      "    if (false && resolution.status !== 'malformed' && bypasses(url, policy)) {",
    caughtBy: 'packages/runtime/test/http-handler.test.ts',
  },
  {
    id: 'refused-target-rendered',
    invariant:
      'A structurally unsafe target is answered without a renderer being asked.',
    source: 'packages/runtime/http/src/handler.ts',
    find: "  return resolution.status !== 'redirect' && resolution.status !== 'malformed';",
    replace: "  return resolution.status !== 'redirect';",
    caughtBy: 'packages/runtime/test/http-handler.test.ts',
  },
  {
    id: 'renderer-304-sent-as-address-status',
    invariant:
      "A 304 or a redirect from the renderer keeps the renderer's status.",
    source: 'packages/runtime/http/src/handler.ts',
    find: '      return new Response(null, { status: rendered.status, headers: merged });',
    replace:
      '      return new Response(null, { status: effective.status, headers: merged });',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'renderer-redirect-body-forwarded',
    invariant: 'A 304 or a redirect from the renderer is sent with no content.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '      void rendered.body?.cancel();\n      return new Response(null, { status: rendered.status, headers: merged });',
    replace:
      '      return new Response(rendered.body, { status: rendered.status, headers: merged });',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'renderer-redirect-without-release-fields',
    invariant:
      'A 304 or a redirect from the renderer carries the fields the release composes onto a page.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '    for (const [name, value] of own) {',
    replace:
      '    for (const [name, value] of answeredWithoutContent ? [] : own) {',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'not-modified-given-representation-fields',
    invariant:
      'A 304 carries the cache directives and varying fields of the 200 it stands for, and no other representation metadata.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '        ? cacheHeaders(effective, rendered.headers)',
    replace: '        ? responseHeaders(effective, rendered.headers)',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'empty-render-answered-200',
    invariant:
      'A render asked for a page that returned no content is not answered 200.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '      rendered.body === null;',
    replace: '      false;',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'undeclared-error-keeps-address-classification',
    invariant:
      "An error status a renderer sent without declaring it is sent private, not stored and not indexed, whatever the address's own classification.",
    source: 'packages/runtime/http/src/handler.ts',
    find: "    robots: 'noindex',\n    cache: 'private-no-store',\n  });\n}\n\nfunction withoutPreconditions(",
    replace:
      '    ...(resolved.robots === undefined ? {} : { robots: resolved.robots }),\n    cache: resolved.cache,\n  });\n}\n\nfunction withoutPreconditions(',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'undeclared-error-read-as-declaration',
    invariant:
      'An error status a renderer returned without declaring it is not read as a declared outcome.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '    let declared: PageOutcomeDeclaration | undefined = fromRender;',
    replace:
      "    let declared: PageOutcomeDeclaration | undefined =\n      fromRender ??\n      (!isDeclaration(result) && result.status >= 400\n        ? { outcome: 'operational-failure', status: result.status }\n        : undefined);",
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'preconditions-handed-to-every-render',
    invariant:
      "A renderer is handed the request's preconditions only where the address resolved to a page.",
    source: 'packages/runtime/http/src/handler.ts',
    find: "      resolution.status === 'success' ? request : withoutPreconditions(request);",
    replace: "      resolution.status === 'success' ? request : request;",
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'malformed-target-answered-404',
    invariant: 'A structurally unsafe target is answered 400.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    case 'malformed':\n      return Object.freeze({\n        status: 400,",
    replace:
      "    case 'malformed':\n      return Object.freeze({\n        status: 404,",
    caughtBy: 'packages/runtime/test/http-handler.test.ts',
  },
  {
    id: 'locale-entry-answered-302',
    invariant: 'Locale entry is answered 307.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      httpStatus: 307,\n      cache,\n      locale: policy.defaultLocale,',
    replace:
      '      httpStatus: 302,\n      cache,\n      locale: policy.defaultLocale,',
    caughtBy: 'packages/runtime/test/http-handler.test.ts',
  },
  {
    id: 'unsupported-locale-intent-redirected',
    invariant:
      'An address that names a locale the site does not serve is answered as unsupported locale intent, never in another locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (first !== undefined && localeIntent(first)) {',
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'declared-removal-answered-as-absence',
    invariant:
      'A declared absence is answered 404 and a declared permanent removal 410.',
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: "    status: declaration.outcome === 'absent' ? 404 : 410,",
    replace: '    status: 404,',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'renderer-declaration-ignored',
    invariant:
      "A renderer's own declared outcome is carried, as a page's declaration from inside the render is.",
    source: 'packages/runtime/http/src/handler.ts',
    find: '      declared = result.pageOutcome;',
    replace: '      declared = fromRender;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'declared-document-not-sent-as-given',
    invariant:
      'The document a renderer sends with a declared outcome reaches the response as the renderer gave it.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '    return new Response(rendered.body, {\n      status: effective.status,',
    replace:
      '    return new Response(carriesDeclaration ? null : rendered.body, {\n      status: effective.status,',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'page-outcome-channel-unread',
    invariant:
      "A page's declared outcome reaches the response over the channel the render shares with the handler.",
    source: 'packages/runtime/http/src/handler.ts',
    find: '    const fromRender = ɵtakePageOutcome(handed);',
    replace: '    const fromRender = void ɵtakePageOutcome(handed);',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'page-outcome-channel-left-open',
    invariant:
      'A declared page outcome is read once and closed, so no second read at the same address finds it.',
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: '  channels().delete(request);',
    replace: '  void channels;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'declaration-carried-at-refused-address',
    invariant:
      'A declared outcome is carried only where the address resolved to a route the release serves.',
    source: 'packages/runtime/http/src/handler.ts',
    find: "      declared !== undefined && resolution.status === 'success';",
    replace: '      declared !== undefined;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'overridden-declaration-reported-every-time',
    invariant:
      'A declaration the release did not carry is reported once for each pair of resolution and declaration, not once per address.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '  if (reported.has(identity)) return;',
    replace: '  if (reported.size < 0) return;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'operational-failure-cached-as-address',
    invariant:
      "A carried operational failure is sent private and not stored, whatever the address's own classification.",
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: "      ...(resolved.robots === undefined ? {} : { robots: resolved.robots }),\n      cache: 'private-no-store',",
    replace:
      '      ...(resolved.robots === undefined ? {} : { robots: resolved.robots }),\n      cache: resolved.cache,',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'restored-preference-overrides-stated-locale',
    invariant:
      'A remembered preference never overrides the locale an address states.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '        return resolved === stored ? stored : undefined;',
    replace: '        return stored;',
    caughtBy: 'packages/runtime/test/restoring-a-cached-page.test.ts',
  },
  {
    id: 'entry-redirect-public-without-preference',
    invariant:
      'A locale-entry redirect is private and revalidated whether or not a preference was consulted.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  const cache = 'private-no-cache' as const;",
    replace:
      "  const cache = preferred === undefined ? 'public' : 'private-no-cache';",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'neutral-success-varies-only-when-consulted',
    invariant:
      'Under a locale-neutral policy a success at an address several locales spell varies by locale preference, including one that consulted none.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    ...(spelling.length > 1 ? { variesBy: 'locale-preference' as const } : {}),",
    replace:
      "    ...(preferred !== undefined && spelling.length > 1 ? { variesBy: 'locale-preference' as const } : {}),",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'varying-answer-without-declared-source-accepted',
    invariant:
      'A response that varied by locale preference is refused cache headers when the declared preference source is none.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "        case 'none':",
    replace: "        case 'none':\n          return 'shared';",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'cookie-preference-answer-shared',
    invariant:
      'A response whose locale a cookie chose is private and revalidated before every reuse.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "        case 'cookie':\n          return 'per-visitor';",
    replace: "        case 'cookie':\n          return 'shared';",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'restored-page-left-in-its-old-locale',
    invariant:
      'A restored page whose address states no locale moves to the remembered locale where the configured sources would choose it.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '    if (stored === undefined || stored === committed) return undefined;',
    replace: '    if (stored !== null) return undefined;',
    caughtBy: 'packages/runtime/test/restoring-a-cached-page.test.ts',
  },
  {
    id: 'negotiated-answer-not-named-in-vary',
    invariant:
      'A response whose locale Accept-Language chose names Accept-Language in Vary.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  const names: string[] = negotiated ? ['Accept-Language'] : [];",
    replace: '  const names: string[] = [];',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'private-negotiated-answer-loses-vary',
    invariant:
      'A private response or entry redirect whose locale Accept-Language chose still names Accept-Language in Vary.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    (descriptor.variesBy === 'locale-preference' ||",
    replace: '    (false ||',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'cookie-named-in-vary',
    invariant:
      'No response names a cookie in Vary, including one whose page asked for it.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "      lower !== 'cookie' &&",
    replace: '      true &&',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'variant-internal-address-written-as-given',
    invariant:
      'An internal address that is a variant of a canonical one is written as the canonical address, not as the variant.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  const resolution = followPermanentRedirect(\n    resolveLocalizedRoute(\n      `${prefix}',
    replace:
      '  const resolution = ((value: RouteResolution) => value)(\n    resolveLocalizedRoute(\n      `${prefix}',
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'crossed-spellings-corrected-anyway',
    invariant:
      "An address that two locales' spellings read as two different addresses is not found, rather than corrected to either.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (corrections.size !== 1) return undefined;',
    replace: '  if (corrections.size === 0) return undefined;',
    caughtBy: 'packages/runtime/test/another-locale-spelling.test.ts',
  },
  {
    id: 'correction-drops-the-query',
    invariant:
      "A correction from another locale's spelling keeps the request's query.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    corrections.set(`${path}${parsed.canonicalSuffix}`, match.route.id);',
    replace: '    corrections.set(path, match.route.id);',
    caughtBy: 'packages/runtime/test/another-locale-spelling.test.ts',
  },
  {
    id: 'hardcoded-template-locale-only-warned',
    invariant:
      'A locale spelled out as a literal in a template is reported as an error, not a warning.',
    source: 'packages/toolkit/src/compiler.ts',
    find: "            ...(literal ? {} : { severity: 'warning' as const }),",
    replace: "            severity: 'warning' as const,",
    caughtBy: 'packages/toolkit/test/hardcoded-locale-template.test.ts',
  },
  {
    id: 'route-render-mode-overridden',
    invariant:
      'Each localized server route carries the render mode its declaration gave, unchanged.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '          renderMode: declaration.renderMode,',
    replace:
      '          renderMode: options.canonicalRenderMode ?? declaration.renderMode,',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'server-routes-expanded-to-unbuilt-locales',
    invariant:
      'Localized server routes are expanded only to the locales the build narrowed the policy to.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '          .filter(([locale]) => built.has(canonicalLocale(locale)))',
    replace: '          .filter(([locale]) => (void locale, true))',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'unspellable-prerender-value-omitted',
    invariant:
      'A prerender parameter value that some locale cannot spell fails the build.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (text === undefined) {',
    replace: '      if (text === undefined && false) {',
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'prerender-spelling-not-read-back',
    invariant:
      'A prerender parameter value whose spelling the codec does not read back as that spelling fails the build.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '        !read.ok ||\n        read.value === undefined ||\n        askCodec(context, () => codec.serialize(read.value, context)) !== text\n',
    replace: '        false\n',
    caughtBy: 'packages/runtime/test/prerender-parameter-segments.test.ts',
  },
  {
    id: 'unsafe-prerender-spelling-enumerated',
    invariant:
      'A prerender parameter value some locale spells as anything but one safe path segment fails the build.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!safeParameterSegment(text)) {',
    replace: '      if (!safeParameterSegment(text) && false) {',
    caughtBy: 'packages/runtime/test/prerender-parameter-segments.test.ts',
  },
  {
    id: 'prerender-value-function-ignored',
    invariant:
      'Prerender parameter values supplied by a function are rendered like values written in place.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  return () => (asked ??= Promise.resolve(declared()));',
    replace: '  return () => Promise.resolve([]);',
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'canonical-render-mode-forced-from-a-route',
    invariant:
      'The canonical address takes the render mode the application declared for it, never one borrowed from a route.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    const canonicalRenderMode = options.canonicalRenderMode;',
    replace: '    const canonicalRenderMode = declarations[0]!.renderMode;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'published-url-ignores-the-mount-point',
    invariant:
      'Every published URL is the origin, the mount point and the localized path together.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  return new URL(withBasePath(location, baseHref), origin).href;',
    replace: '  return new URL(location, origin).href;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'alternate-for-an-unbuilt-locale',
    invariant:
      'An alternate is published only for a locale this build produced.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (!built.has(locale)) continue;',
    replace: '    if (!built.has(locale) && false) continue;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'alternate-for-an-address-that-selects-no-locale',
    invariant:
      'An alternate is published only where its address selects that locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (!addressSelectsLocale(address, locale, policy, projection)) continue;',
    replace:
      '    if (!addressSelectsLocale(address, locale, policy, projection) && false) continue;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'sitemap-file-size-not-reported',
    invariant:
      'Each sitemap file reports its size in the bytes it will be served as.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      bytes: utf8Length(page.contents),',
    replace: '      bytes: 0,',
    caughtBy: 'packages/runtime/test/sitemap-projection.test.ts',
  },
  {
    id: 'sitemap-not-split-by-size',
    invariant:
      "A sitemap set is split before a file would exceed the protocol's byte limit.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '        bytes + size > SITEMAP_BYTE_LIMIT)',
    replace: '        false)',
    caughtBy: 'packages/runtime/test/sitemap-projection.test.ts',
  },
  {
    id: 'sitemap-not-split-by-count',
    invariant:
      "A sitemap set is split before a file would exceed the protocol's URL limit.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '      (current.length + 1 > SITEMAP_URL_LIMIT ||',
    replace: '      (false ||',
    caughtBy: 'packages/runtime/test/sitemap-projection.test.ts',
  },
  {
    id: 'sitemap-lastmod-from-the-build-date',
    invariant:
      'A route that declares no last-modified date has none in its sitemap claim.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      dated?.reading.kind === 'string' ? dated.reading.value : undefined;",
    replace:
      "      dated?.reading.kind === 'string' ? dated.reading.value : new Date().toISOString().slice(0, 10);",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'sitemap-elements-out-of-schema-order',
    invariant: 'Sitemap entries validate against the pinned sitemap schema.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    lines.push(`    <priority>${sitemapPriority(claim.priority)}</priority>`);',
    replace:
      '    lines.splice(2, 0, `    <priority>${sitemapPriority(claim.priority)}</priority>`);',
    caughtBy: 'packages/runtime/test/sitemap-schema.test.ts',
  },
  {
    id: 'unbound-document-message-accepted',
    invariant:
      'A document declaration naming a message that takes inputs, with none bound, is refused.',
    source: 'packages/runtime/router/src/document-messages.ts',
    find: '  if (missing.length === 0) return;',
    replace: '  if (missing.length >= 0) return;',
    caughtBy: 'packages/runtime/test/document-message-binding.test.ts',
  },
  {
    id: 'progressive-scope-left-out-of-a-coordinated-navigation',
    invariant:
      'In coordinated mode a navigation waits for a scope its route names as progressive, as it waits for a required one.',
    source: 'packages/runtime/router/src/navigation-scopes.ts',
    find: "  const alongside = input.landed && input.mode === 'progressive';",
    replace: '  const alongside = input.landed;',
    caughtBy: 'packages/runtime/test/coordinated-progressive-scopes.test.ts',
  },
  {
    id: 'progressive-scope-left-out-of-a-coordinated-change',
    invariant:
      'A coordinated locale change loads a scope it names as progressive before it commits, as it loads a required one.',
    source: 'packages/runtime/src/localization.ts',
    find: '              (scope) => !carriedIdentities.has(scopeIdentity(scope)),',
    replace:
      '              (scope) => carriedIdentities.has(scopeIdentity(scope)),',
    caughtBy: 'packages/runtime/test/coordinated-progressive-scopes.test.ts',
  },
  {
    id: 'abandoned-bootstrap-rejects-with-the-disposal',
    invariant:
      'An application start waiting on a context whose injector is destroyed settles, and does not reject with the disposal.',
    source: 'packages/runtime/src/localization.ts',
    find: '      if (abandoned()) return;',
    replace: '      void abandoned;',
    caughtBy:
      'packages/runtime/test/bootstrap-initialization-abandoned.test.ts',
  },
  {
    id: 'scope-named-as-both-accepted',
    invariant:
      'A locale change that names one scope as both required and progressive is refused.',
    source: 'packages/runtime/src/localization.ts',
    find: "      this.normalizeScopes(named, 'requiredScopes').map(scopeIdentity),",
    replace:
      "      this.normalizeScopes([], 'requiredScopes').map(scopeIdentity),",
    caughtBy: 'packages/runtime/test/coordinated-progressive-scopes.test.ts',
  },
  {
    id: 'standing-scope-refused-as-progressive',
    invariant:
      'A locale change may name as progressive a scope that is already required.',
    source: 'packages/runtime/src/localization.ts',
    find: "      this.normalizeScopes(named, 'requiredScopes').map(scopeIdentity),",
    replace: '      carried.map(scopeIdentity),',
    caughtBy: 'packages/runtime/test/coordinated-progressive-scopes.test.ts',
  },
  {
    id: 'standing-scope-held-by-a-progressive-change',
    invariant:
      'A progressive locale change does not wait for a scope it names as progressive, though the snapshot requires it.',
    source: 'packages/runtime/src/localization.ts',
    find: '                (scope) => !progressiveIdentities.has(scopeIdentity(scope)),',
    replace: '                () => true,',
    caughtBy: 'packages/runtime/test/coordinated-progressive-scopes.test.ts',
  },
  {
    id: 'server-render-answers-with-recovery',
    invariant:
      'A server bootstrap whose initial snapshot cannot be built rejects instead of rendering the recovery.',
    source: 'packages/runtime/src/localization.ts',
    find: '      if (server || localization.recovery() === undefined) throw error;',
    replace: '      if (localization.recovery() === undefined) throw error;',
    caughtBy:
      'packages/runtime/test/bootstrap-initialization-abandoned.test.ts',
  },
  {
    id: 'page-put-back-in-the-locale-from-before-a-change-in-place',
    invariant:
      'The page a navigation left is put back in the locale a change made in place has committed since the navigation committed its own.',
    source: 'packages/runtime/router/src/navigation-scopes.ts',
    find: '    committed === undefined || committed === left.navigationLocale\n      ? snapshot.primaryLocale\n      : committed,',
    replace: '    snapshot.primaryLocale,',
    caughtBy: 'packages/runtime/test/navigation-page-put-back.test.ts',
  },
  {
    id: 'social-locale-written-as-a-language-tag',
    invariant: 'The social locale is written in the language_TERRITORY form.',
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: '    : `${profile.language}_${profile.region}`;',
    replace: '    : `${profile.language}-${profile.region}`;',
    caughtBy: 'packages/runtime/test/open-graph-locale.test.ts',
  },
  {
    id: 'social-locale-keeps-the-script',
    invariant: 'The social locale carries no script subtag.',
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: '    : `${profile.language}_${profile.region}`;',
    replace: '    : `${profile.language}_${profile.script}_${profile.region}`;',
    caughtBy: 'packages/runtime/test/open-graph-locale.test.ts',
  },
  {
    id: 'own-locale-listed-as-a-social-alternate',
    invariant: "A page's own locale is not among its social alternates.",
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: '    if (value === undefined || value === own) continue;',
    replace: '    if (value === undefined) continue;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'unlisted-indexing-value-read-as-private',
    invariant:
      'A route whose indexing value the declaration does not list is indexable.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "    return values.get(found.reading.value) ?? 'indexable';",
    replace: "    return values.get(found.reading.value) ?? 'private';",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'default-indexing-field-renamed',
    invariant:
      'A project that names no indexing field has its routes read under the documented default field.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "const DEFAULT_ROUTE_INDEXING_FIELD = 'equatorIndexing';",
    replace: "const DEFAULT_ROUTE_INDEXING_FIELD = 'indexing';",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'const-binding-not-followed',
    invariant:
      'An indexing value written through a const binding is read as the literal it is bound to.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    if (declaration === undefined || seen.has(declaration)) return current;',
    replace: '    if (true) return current;',
    caughtBy: 'packages/toolkit/test/route-data-reading.test.ts',
  },
  {
    id: 'earlier-route-data-key-wins',
    invariant: 'In route data, a later key overrides an earlier one.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    if (key !== name) continue;',
    replace: "    if (key !== name || found.kind !== 'absent') continue;",
    caughtBy: 'packages/toolkit/test/route-data-reading.test.ts',
  },
  {
    id: 'unreadable-indexing-value-read-as-indexable',
    invariant:
      'A route whose indexing value cannot be read is answered as private.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      return 'private';\n    }\n    if (policy !== undefined && !policy.readable) return 'private';",
    replace:
      "      return 'indexable';\n    }\n    if (policy !== undefined && !policy.readable) return 'private';",
    caughtBy: 'packages/toolkit/test/route-data-reading.test.ts',
  },
  {
    id: 'parent-route-class-not-inherited',
    invariant:
      'A class declared on a parent route reaches every child the router gives its data to.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '          ? node.parent\n          : undefined;',
    replace: '          ? undefined\n          : undefined;',
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'empty-path-child-does-not-inherit',
    invariant:
      "Under emptyOnly, a child with an empty path or a componentless parent still inherits its parent's data.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "        strategy === 'always' || node.inheritsUnderEitherStrategy",
    replace: "        strategy === 'always'",
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'inheritance-default-is-empty-only',
    invariant:
      'Where no inheritance strategy is declared, child routes inherit always.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "  let strategy: 'always' | 'emptyOnly' = 'always';",
    replace: "  let strategy: 'always' | 'emptyOnly' = 'emptyOnly';",
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'declared-inheritance-strategy-ignored',
    invariant:
      'A router configured with emptyOnly has its routes read under emptyOnly.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "  } else if (firstConfiguration?.strategy === 'emptyOnly') {\n    strategy = 'emptyOnly';\n  }",
    replace:
      "  } else if (firstConfiguration?.strategy === 'emptyOnly') {\n    strategy = 'always';\n  }",
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'unreadable-inheritance-strategy-unreported',
    invariant:
      'A router inheritance strategy the build cannot read is reported.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "  } else if (firstConfiguration?.strategy === 'unreadable') {",
    replace: '  } else if (false) {',
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'repeated-router-configuration-unreported',
    invariant:
      'A router configured in more than one place, with a strategy set in one of them, is reported.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    if (strategyDeclared) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'runtime-decided-address-keeps-its-class',
    invariant:
      'An address whose route the router decides at run time is answered as private.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "        indexing: certain ? indexing : 'private',",
    replace: '        indexing,',
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'invalid-changefreq-accepted',
    invariant:
      'A sitemap change frequency the protocol does not define is refused when the owner is compiled.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '        changefreq !== undefined &&\n        SITEMAP_CHANGE_FREQUENCIES.has(changefreq)\n      ) {',
    replace: '        changefreq !== undefined\n      ) {',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'robots-header-not-sent',
    invariant:
      'A response that is not to be indexed carries the X-Robots-Tag header.',
    source: 'packages/runtime/http/src/handler.ts',
    find: "        headers.set('x-robots-tag', effective.robots);",
    replace: '        void effective.robots;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'missing-page-redirected-home',
    invariant:
      'A missing page under a supported locale is a 404 in that locale, not a redirect.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "losing the locale.\n    return Object.freeze({\n      status: 'not-found',\n      httpStatus: 404,\n      presentationLocale: locale,",
    replace:
      "losing the locale.\n    return Object.freeze({\n      status: 'redirect',\n      reason: 'replacement',\n      httpStatus: 308,\n      location: '/',\n      locale,\n      presentationLocale: locale,",
    caughtBy: 'packages/runtime/test/locale-of-an-unprojected-address.test.ts',
  },
  {
    id: 'shared-lifetime-chosen-by-the-release',
    invariant:
      'The shared lifetime of a page is the one the deployment supplies.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    : wholeSeconds(freshness.successMaxAge, 'successMaxAge');",
    replace: '    : 600;',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'vary-left-out-of-the-header-set',
    invariant:
      'The Vary field is returned as its own entry in the set of cache headers.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    ...(vary === undefined ? {} : { vary }),',
    replace: '    ...(vary === undefined ? {} : {}),',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'cache-declaration-lowers-the-level',
    invariant:
      'A caching declaration can raise who may keep a response and never lower it.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    CACHE_LEVEL_RANK[floor] > CACHE_LEVEL_RANK[level]',
    replace: '    CACHE_LEVEL_RANK[floor] !== CACHE_LEVEL_RANK[level]',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'unusable-caching-value-read-as-absent',
    invariant:
      'A route caching value the build cannot read or use is answered as not-stored.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      return 'not-stored';\n    };\n    if (found.reading.kind === 'unreadable') {",
    replace:
      "      return undefined as unknown as RouteCachingClass;\n    };\n    if (found.reading.kind === 'unreadable') {",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'unusable-caching-value-unreported',
    invariant:
      'A route caching value the build cannot read or use is reported when the owner is compiled.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '      if (firstReport(found.node, cachingField)) {',
    replace: '      if (false) {',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'host-page-floor-raises-a-redirect',
    invariant: "The host's least caching level is not applied to a redirect.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '        redirect ? undefined : freshness.pageCaching,',
    replace: '        freshness.pageCaching,',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'host-page-floor-ignored',
    invariant:
      "The host's least caching level is applied to every response that carries a page.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '        redirect ? undefined : freshness.pageCaching,',
    replace: '        redirect ? undefined : undefined,',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'page-cache-directives-ignored',
    invariant:
      "A page's own no-store, private or no-cache raises the level of its response.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '      stated.level,',
    replace: '      undefined,',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'page-lifetime-lengthens-reuse',
    invariant:
      "A page's max-age can shorten the shared lifetime and never lengthen it.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    stated.maxAge === undefined ? lifetime : Math.min(lifetime, stated.maxAge);',
    replace: '    stated.maxAge === undefined ? lifetime : stated.maxAge;',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'repeated-lifetime-trusted',
    invariant: 'A lifetime given more than once is read as stale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "      : values.length === 1 && /^\\d+$/u.test(values[0] ?? '')",
    replace: "      : /^\\d+$/u.test(values[0] ?? '')",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'page-vary-fields-dropped',
    invariant:
      "A page's own Vary fields are added to the ones the release names.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '      names.push(name);',
    replace: '      void name;',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'cookie-vary-leaves-the-page-shared',
    invariant: 'A page that varies by cookie is kept out of shared caches.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    cookieVaried ? 'per-visitor' : undefined,",
    replace: '    undefined,',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'untrusted-text-length-unbounded',
    invariant:
      'A validator refuses untrusted text longer than any identity is before its grammar reads it.',
    source: 'packages/toolkit/src/untrusted-text.ts',
    find: '  if (value.length > maximumCharacters) {',
    replace: '  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/untrusted-input.test.ts',
  },
  {
    id: 'provisional-overlay-published-as-output',
    invariant:
      'The contracts a compilation publishes are the ones computed after analysis, never the provisional overlay the analysis ran against.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '    contractFiles: contracts.value,',
    replace: '    contractFiles: provisionalContracts.value,',
    caughtBy: 'packages/toolkit/test/provisional-scope-startup.test.ts',
  },
  {
    id: 'first-generation-overlay-misses-a-module',
    invariant:
      'A generation run with the generated root deleted resolves every generated module the application imports through the analysis overlay.',
    source: 'packages/toolkit/src/compiler.ts',
    find: "      specifier: '#i18n/recovery-payload',",
    replace: "      specifier: '#i18n/recovery-payload-overlay',",
    caughtBy: 'packages/toolkit/test/first-generation-overlay.test.ts',
  },
  {
    id: 'absent-extension-registry-required',
    invariant:
      'An owner with no extension registry file generates as one with an empty registry.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  if (metadata === undefined) return toolkitSuccess(undefined);',
    replace:
      '  if (metadata === undefined)\n    return toolkitFailure([\n      projectDiagnostic(`${EXTENSION_REGISTRY_NAME} is required.`),\n    ]);',
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'several-application-graphs-merged',
    invariant:
      'An owner whose workspace declares several Angular applications is refused with their TypeScript graphs named, rather than analysed as one of them.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  if (unique.length > 1) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/multi-owner-workspace.test.ts',
  },
  {
    id: 'configuration-above-package-selected',
    invariant:
      'Owner discovery stops at the nearest package manifest, and a configuration above it is named and declined rather than selected.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '      boundary = current;\n      break;',
    replace: '      boundary = current;',
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'configuration-schema-open',
    invariant:
      'The project configuration is closed: a property outside the declared set, such as a remote catalog source, is refused.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "  title: 'Equator project configuration',\n  type: 'object',\n  additionalProperties: false,",
    replace:
      "  title: 'Equator project configuration',\n  type: 'object',\n  additionalProperties: true,",
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'component-template-url-not-followed',
    invariant:
      "An external component template is found through the component's templateUrl and analysed.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      const templateUrl = metadataString(metadataNode, 'templateUrl');",
    replace:
      '      const templateUrl = undefined as ReturnType<typeof metadataString>;',
    caughtBy: 'packages/toolkit/test/hardcoded-locale-template.test.ts',
  },
  {
    id: 'consumer-withrouting-read-as-equator',
    invariant:
      'A routing declaration is read only from the withRouting the package exports, never from a consumer function spelled the same.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "    resolved.name !== 'withRouting' ||\n    !declaredIn(resolved, '/@neolorn/equator/')",
    replace: "    resolved.name !== 'withRouting'",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'unused-message-advisory-blocks',
    invariant:
      'Source messages nothing reaches are reported at info severity and never fail generate or check.',
    source: 'packages/toolkit/src/compiler.ts',
    find: "        { severity: 'info' },",
    replace: "        { severity: 'error' },",
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'generated-root-beside-the-application',
    invariant:
      'An owner at a workspace root generates into the nested Angular application it analysed, not into a source directory of its own.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "  const path = root === '' ? GENERATED_ROOT : `${root}/${GENERATED_ROOT}`;",
    replace: '  const path = GENERATED_ROOT;',
    caughtBy: 'packages/toolkit/test/multi-owner-workspace.test.ts',
  },
  {
    id: 'owner-without-typescript-graph-skipped',
    invariant:
      'An owner with no discoverable TypeScript graph fails generation and says so, rather than generating with nothing analysed.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  if (selected.value === undefined) {',
    replace:
      '  if (selected.value === undefined) {\n    if (selected.ok) return toolkitSuccess(undefined);',
    caughtBy: 'packages/toolkit/test/multi-owner-workspace.test.ts',
  },
  {
    id: 'deleted-message-kept-in-translation-state',
    invariant:
      'Reconciling the translation state drops the entry of a message or locale that no longer exists.',
    source: 'packages/toolkit/src/translation-state.ts',
    find: '  const entries: Record<string, TranslationStateEntry> = {};\n  const stale: StaleTranslation[] = [];',
    replace:
      '  const entries: Record<string, TranslationStateEntry> = { ...previous.entries };\n  const stale: StaleTranslation[] = [];',
    caughtBy: 'packages/toolkit/test/translation-state.test.ts',
  },
  {
    id: 'input-fingerprint-not-revalidated',
    invariant:
      'Output is not published when the inputs changed between compilation and publication.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '      request.expectedInputFingerprint !== undefined &&',
    replace:
      '      false &&\n      request.expectedInputFingerprint !== undefined &&',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'interrupted-transaction-not-recovered',
    invariant:
      'An interrupted output transaction is rolled back to the previous generation before the next one starts.',
    source: 'packages/toolkit/src/output-host.ts',
    find: "      lockHandle = await open(lockPath, 'wx');",
    replace: "      lockHandle = await open(lockPath, 'wx');\n      if (false)",
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'unchanged-output-rewritten',
    invariant:
      'Publishing a plan leaves every generated file whose bytes are unchanged untouched.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '    else if (existing.digest !== file.digest || existing.bytes !== file.bytes) {',
    replace: '    else {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'stale-generated-file-kept',
    invariant:
      'A generated file the new output plan no longer produces is removed when that output plan is published.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '    if (!desired.has(file.path)) stale.push(file.path);',
    replace: '    if (!desired.has(file.path)) void file;',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'unowned-file-in-generated-root-admitted',
    invariant:
      'A generated root holding a file its manifest does not list is refused, and the file is left alone.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '    if (!expected.has(path)) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'output-path-traversal-admitted',
    invariant:
      'An output path with a parent segment or a trailing dot is refused before anything is planned.',
    source: 'packages/toolkit/src/output-plan.ts',
    find: "      segment === '..' ||\n      segment.endsWith('.') ||",
    replace: "      segment === '.' ||",
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'case-insensitive-output-collision-admitted',
    invariant:
      'Two output paths that differ only in case are refused as one collision.',
    source: 'packages/toolkit/src/output-plan.ts',
    find: '    if (exact.has(input.path) || existing !== undefined) {',
    replace: '    if (exact.has(input.path)) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'scope-named-as-a-generated-module-admitted',
    invariant:
      'A scope whose name is that of a generated module is refused, and neither module is written over the other.',
    source: 'packages/toolkit/src/output-plan.ts',
    find: '    if (exact.has(input.path) || existing !== undefined) {',
    replace: '    if (input.path.length === 0) {',
    caughtBy: 'packages/toolkit/test/scope-names-reserved.test.ts',
  },
  {
    id: 'scope-named-as-a-device-admitted',
    invariant:
      'A scope whose name a platform reserves for a device is refused, because that platform gives the name to no file.',
    source: 'packages/toolkit/src/output-plan.ts',
    find: "      segment.normalize('NFC') !== segment ||\n      windowsReservedName.test(segment)",
    replace: "      segment.normalize('NFC') !== segment",
    caughtBy: 'packages/toolkit/test/scope-names-reserved.test.ts',
  },
  {
    id: 'recovery-payload-not-minimal',
    invariant:
      'The recovery payload carries the selected recovery messages in each locale and nothing else.',
    source: 'packages/toolkit/src/compiled-artifacts.ts',
    find: '      if (!selected.has(identity)) continue;',
    replace: '      if (false) continue;',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'missing-init-field-not-named',
    invariant:
      'An initialization missing a required field is refused with the flags that supply it.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    if (!option.required) return false;',
    replace: '    if (!option.required || true) return false;',
    caughtBy: 'packages/toolkit/test/init-options.test.ts',
  },
  {
    id: 'block-scalar-flattened-by-format',
    invariant: 'Formatting keeps a block scalar written as one.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '        node.type === Scalar.BLOCK_LITERAL ||',
    replace: '        false &&\n        node.type === Scalar.BLOCK_LITERAL ||',
    caughtBy: 'packages/toolkit/test/lossless-format.test.ts',
  },
  {
    id: 'manifest-indentation-not-kept',
    invariant:
      'A package.json Equator rewrites keeps the indentation it was written in.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "    style !== null ? (style[2] ?? '') : source.trim() === '{}' ? '  ' : '';",
    replace: "    '  ';",
    caughtBy: 'packages/toolkit/test/uninstall.test.ts',
  },
  {
    id: 'dry-run-creates-the-work-root',
    invariant:
      'A dry-run publication writes nothing, not even the work root or its lock.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '  if (request.dryRun !== true) {',
    replace: '  if (true) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'warning-blocks-a-bare-check',
    invariant:
      'Only an error-severity diagnostic fails a run; a warning does not.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: "  return diagnostics.some(({ severity }) => severity === 'error');",
    replace:
      "  return diagnostics.some(({ severity }) => severity !== 'info');",
    caughtBy: 'packages/toolkit/test/gate-exit-code.test.ts',
  },
  {
    id: 'missing-locale-catalog-escapes-the-completeness-policy',
    invariant:
      'A locale with no catalog for a scope is escalated by the completeness policy exactly as a missing message is.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '        const policy = completenessPolicy(\n          request.configuration,\n          request.requireCompleteTargets === true,',
    replace:
      '        const policy = completenessPolicy(\n          request.configuration,\n          false,',
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'inherited-catalog-counted-missing',
    invariant:
      'A locale that inherits a catalog from its parent chain is not reported as having none.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '        (inheritedCatalogs.get(locale) ?? noInheritance).length === 0',
    replace: '        true',
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'in-progress-declaration-ignored-under-the-gate',
    invariant:
      'A locale declared still in progress keeps its completeness findings at warning under the release gate.',
    source: 'packages/toolkit/src/configuration.ts',
    find: '  const declared = configuration.inProgress[locale];',
    replace:
      '  const declared = configuration.inProgress[locale];\n  if (declared !== undefined) return BLOCKING;',
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'in-progress-reason-not-carried',
    invariant:
      'A finding downgraded by an in-progress declaration quotes the declared reason.',
    source: 'packages/toolkit/src/configuration.ts',
    find: '    suffix: ` ${locale} is declared still in progress: ${declared.note}`,',
    replace: "    suffix: '',",
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'parser-code-frame-carried-into-diagnostic',
    invariant:
      "A YAML parser failure reaches the diagnostic as its sentence, without the parser's code frame.",
    source: 'packages/toolkit/src/catalog.ts',
    find: '        `Equator catalog YAML is invalid: ${yamlErrorSentence(error.message)}`,',
    replace: '        `Equator catalog YAML is invalid: ${error.message}`,',
    caughtBy: 'packages/toolkit/test/diagnostic-wording.test.ts',
  },
  {
    id: 'corrupt-compiler-cache-fails-the-run',
    invariant:
      'A corrupt incremental cache is ignored with an info note and recomputed, never a failure.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "    if (error instanceof SyntaxError) return ignoredCompilerCache('a corrupt');",
    replace:
      "    if (false as boolean) return ignoredCompilerCache('a corrupt');",
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'empty-first-run-reported-as-error',
    invariant:
      'A project with no catalogs yet is told where the first one goes at info severity, and the run does not fail.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "for example i18n/shell/${configuration.sourceLocale}.yaml.`,\n            'info',",
    replace:
      "for example i18n/shell/${configuration.sourceLocale}.yaml.`,\n            'error',",
    caughtBy: 'packages/toolkit/test/diagnostic-wording.test.ts',
  },
  {
    id: 'stale-xliff-unit-imported',
    invariant:
      'A unit translated against an older source is left out of an import with a warning while the current units are accepted.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '      contract.sourceFingerprint !==',
    replace: '      false &&\n      contract.sourceFingerprint !==',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'initial-xliff-target-imported',
    invariant:
      'A target still in its initial state is not imported as a translation.',
    source: 'packages/toolkit/src/xliff.ts',
    find: "    if (state === 'initial') {",
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'pseudo-locale-accents-a-url',
    invariant:
      'A pseudo-locale leaves a URL in message text exactly as written.',
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '    result += match[0];',
    replace: '    result += transform(match[0]);',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'negative-length-factor-ignored',
    invariant: 'A negative pseudo-locale length factor contracts the text.',
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '  if (lengthFactor < 0) return elide(substituted, -lengthFactor);',
    replace: '  if (lengthFactor < 0) return substituted;',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'boundary-markers-always-on',
    invariant:
      'Boundary markers appear only when a pseudo-locale asks for them.',
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '  if (transform.markers === true) {',
    replace: '  if (true) {',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'pseudo-locale-length-factor-defaulted',
    invariant:
      'A pseudo-locale that declares no length factor is treated as unlengthened.',
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '    lengthened: (transform.lengthFactor ?? 0) > 0,',
    replace: '    lengthened: (transform.lengthFactor ?? 0.35) > 0,',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'xb-admitted-left-to-right',
    invariant:
      'XB is refused on a pseudo-locale whose script is written left to right.',
    source: 'packages/toolkit/src/pseudo-locale-tags.ts',
    find: "  if (region === 'XB' && direction !== 'rtl') {",
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'xa-admitted-outside-english',
    invariant: 'XA and XB are refused on a pseudo-locale that is not English.',
    source: 'packages/toolkit/src/pseudo-locale-tags.ts',
    find: "  if (language !== 'en') {",
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'pseudo-locale-language-differs-from-source',
    invariant:
      "A pseudo-locale whose language differs from the source locale's is refused.",
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '  if (locale.language !== source) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'pseudo-locales-generated-without-the-flag',
    invariant:
      'A generation run without the pseudo-locale request emits no pseudo-locale, whatever the configuration declares.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    selection.pseudoLocales === true',
    replace: '    selection.pseudoLocales !== false',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'generated-pseudo-locale-list-admits-a-repeat',
    invariant:
      'The runtime refuses a generated pseudo-locale list that names one locale twice.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (new Set(entries).size !== entries.length) return false;',
    replace: '  if (false) return false;',
    caughtBy: 'packages/runtime/test/locale-neutral-addresses.test.ts',
  },
  {
    id: 'catalog-noncharacter-admitted',
    invariant:
      'Catalog text carrying a Unicode noncharacter is refused when the catalog is parsed.',
    source: 'packages/toolkit/src/unicode-safety.ts',
    find: '    if (isNoncharacter(codePoint)) return false;',
    replace: '    if (false && isNoncharacter(codePoint)) return false;',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'balanced-isolate-refused',
    invariant:
      'A balanced directional isolate in an authored value is accepted, so a translator can contain a left-to-right name inside right-to-left prose.',
    source: 'packages/toolkit/src/unicode-safety.ts',
    find: 'const DIRECTIONAL_OVERRIDE = /[\\u202a-\\u202e]/u;',
    replace:
      'const DIRECTIONAL_OVERRIDE = /[\\u202a-\\u202e\\u2066-\\u2069]/u;',
    caughtBy: 'packages/toolkit/test/bidi-policy.test.ts',
  },
  {
    id: 'directional-marks-refused',
    invariant:
      'Directional marks, the zero-width space and the word joiner are accepted in authored values.',
    source: 'packages/toolkit/src/unicode-safety.ts',
    find: "  if (value.includes('\\ufeff')) return 'byte-order-mark';",
    replace:
      "  if (/[\\ufeff\\u200b\\u200e\\u200f\\u061c\\u2060]/u.test(value)) return 'byte-order-mark';",
    caughtBy: 'packages/toolkit/test/bidi-policy.test.ts',
  },
  {
    id: 'refused-bidi-control-unexplained',
    invariant:
      'Refusing an invisible control says what the character does to the text around it.',
    source: 'packages/toolkit/src/unicode-safety.ts',
    find: "      'Equator catalog text contains a directional override or embedding (U+202A-U+202E), which reorders the text around it and cannot be seen while reading the file.',",
    replace: "      'Equator catalog text contains a forbidden character.',",
    caughtBy: 'packages/toolkit/test/bidi-policy.test.ts',
  },
  {
    id: 'interpolated-value-projected-bare',
    invariant:
      'The formatter isolates an interpolated value in the projected text, so no call site has to.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '          append(isolatedValueText(part, messageDirection));',
    replace: '          append(part.value);',
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'unknown-direction-value-left-bare',
    invariant:
      'A value of unknown direction is wrapped in a first-strong isolate.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "  if (part.contentDirection === 'auto') return `${FSI}${part.value}${PDI}`;",
    replace: "  if (part.contentDirection === 'auto') return part.value;",
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'right-to-left-value-isolated-as-left-to-right',
    invariant:
      'A right-to-left value is wrapped in a right-to-left isolate in a message of either direction.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "  if (part.contentDirection === 'rtl') return `${RLI}${part.value}${PDI}`;",
    replace:
      "  if (part.contentDirection === 'rtl') return `${LRI}${part.value}${PDI}`;",
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'left-to-right-value-isolated-in-a-left-to-right-message',
    invariant:
      'A left-to-right value in a left-to-right message is left bare unless the author asked for isolation.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "  return messageDirection === 'ltr' && !part.isolate",
    replace: "  return false && messageDirection === 'ltr' && !part.isolate",
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'author-direction-declaration-ignored',
    invariant:
      'A direction the author declared with u:dir takes the place of the content check.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '  if (unicode.direction === undefined && unicode.id === undefined) return value;',
    replace: '  if (unicode.id === undefined) return value;',
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'slot-part-direction-not-taken-from-its-catalog',
    invariant:
      'A slot part carries the language and direction of the catalog that supplied it, not a fixed direction.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    language: languageForLocale(environment.supplyingLocale),\n    direction: environment.supplyingDirection,\n    supplyingLocale: environment.supplyingLocale,\n  });\n}\n\nfunction evaluatePattern(',
    replace:
      "    language: languageForLocale(environment.supplyingLocale),\n    direction: 'ltr' as const,\n    supplyingLocale: environment.supplyingLocale,\n  });\n}\n\nfunction evaluatePattern(",
    caughtBy: 'packages/runtime/test/message-local-slot-parts.test.ts',
  },
  {
    id: 'required-extension-binding-not-checked',
    invariant:
      'A catalog that requires an extension is refused where the matching binding is absent or its descriptor differs.',
    source: 'packages/runtime/src/extensions.ts',
    find: '      if (\n        binding === undefined ||\n        descriptorSnapshot(binding.descriptor).canonical !==\n          descriptorSnapshot(admitted).canonical\n      ) {',
    replace: '      if (false) {',
    caughtBy: 'packages/runtime/test/identifier-segment-binding.test.ts',
  },
  {
    id: 'refused-input-echoed-into-its-diagnostic',
    invariant:
      'A validator that refuses untrusted input names its type in the diagnostic and never its value.',
    source: 'packages/toolkit/src/untrusted-text.ts',
    find: '        `${label} must be a string, not ${describeType(value)}.`,',
    replace:
      '        `${label} must be a string, not ${JSON.stringify(value)}.`,',
    caughtBy: 'packages/toolkit/test/untrusted-input.test.ts',
  },
  {
    id: 'person-name-parts-lose-language',
    invariant:
      "Each field of a formatted name carries the name's own language and direction as part metadata.",
    source: 'packages/runtime/src/formatting.ts',
    find: '          language: value.language,\n          direction: nameDirection,',
    replace: '',
    caughtBy: 'packages/runtime/test/person-names.test.ts',
  },
  {
    id: 'time-zone-identity-taken-from-the-host',
    invariant:
      "A time zone's stored identity is the pinned time-zone database's primary identifier, whatever spelling the host prefers.",
    source: 'packages/runtime/src/formatting.ts',
    find: "  return Object.freeze({ kind: 'time-zone', id: primary });",
    replace: "  return Object.freeze({ kind: 'time-zone', id });",
    caughtBy: 'packages/runtime/test/time-zone-identity.test.ts',
  },
  {
    id: 'zoned-calendar-the-host-lacks-formatted-in-another',
    invariant:
      'A zoned date-time whose calendar the host resolves to another is reported as an unsupported formatting capability, and is not written in the calendar the host fell back to.',
    source: 'packages/runtime/src/formatting.ts',
    find: "  return hostAnswer(formatter)['calendar'] === calendar",
    replace: '  return calendar === calendar',
    caughtBy: 'packages/runtime/test/zoned-date-time-host-capability.test.ts',
  },
  {
    id: 'zone-the-host-has-no-rules-for-thrown',
    invariant:
      'A zoned date-time in a zone the host has no rules for is reported as an unsupported formatting capability, and the host error does not leave the formatter.',
    source: 'packages/runtime/src/formatting.ts',
    find: "  } catch {\n    return unsupported(\n      'The native date-time capability rejected this profile.',",
    replace:
      "  } catch (cause) {\n    if (cause instanceof RangeError) throw cause;\n    return unsupported(\n      'The native date-time capability rejected this profile.',",
    caughtBy: 'packages/runtime/test/zoned-date-time-host-capability.test.ts',
  },
  {
    id: 'context-calendar-the-host-lacks-written-in-another',
    invariant:
      'A calendar of the formatting context the host answers with another is reported by every date formatter as an unsupported formatting capability, and no date is written in the calendar the host fell back to.',
    source: 'packages/runtime/src/formatting.ts',
    find: "  return hostAnswer(formatter)['calendar'] === calendar",
    replace: '  return calendar === calendar',
    caughtBy:
      'packages/runtime/test/date-formatter-calendar-capability.test.ts',
  },
  {
    id: 'calendar-name-left-to-the-host',
    invariant:
      "A calendar that is not written as a calendar's name is refused before the host is asked, so an upper-case spelling the host would read is not a calendar on one engine and a refusal on another.",
    source: 'packages/runtime/src/formatting.ts',
    find: '  if (!isCalendarName(calendar)) {\n    return unsupported(',
    replace: '  if (false) {\n    return unsupported(',
    caughtBy:
      'packages/runtime/test/date-formatter-calendar-capability.test.ts',
  },
  {
    id: 'message-date-calendar-the-host-lacks-written-in-another',
    invariant:
      'A date a message writes under a calendar the host answers with another is reported as an unsupported formatting capability.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "    hostAnswer(formatter)['calendar'] !== options.calendar",
    replace: '    false',
    caughtBy:
      'packages/runtime/test/date-formatter-calendar-capability.test.ts',
  },
  {
    id: 'host-answer-asked-for-every-value',
    invariant:
      'What the host says a cached formatter counts in is asked once for the formatter and kept, so a table of dates under one calendar does not ask once for each date.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    hostAnswers.set(formatter, answer);',
    replace: '    void answer;',
    caughtBy:
      'packages/runtime/test/date-formatter-calendar-capability.test.ts',
  },
  {
    id: 'collation-the-host-lacks-ordered-by-the-default',
    invariant:
      'A collation a call names that the host answers with another is reported as an unsupported formatting capability, and nothing is ordered by the default of the locale in its place.',
    source: 'packages/runtime/src/formatting.ts',
    find: "      hostAnswer(collator)['collation'] !== collation",
    replace: '      false',
    caughtBy: 'packages/runtime/test/named-collation.test.ts',
  },
  {
    id: 'collation-name-left-to-the-host',
    invariant:
      "A collation that is not written as a collation's name is refused before the host is asked, so an upper-case spelling the host would read is not a collation on one engine and a refusal on another.",
    source: 'packages/runtime/src/formatting.ts',
    find: '  if (collation !== undefined && !isUnicodeKeywordType(collation)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/runtime/test/named-collation.test.ts',
  },
  {
    id: 'message-date-written-in-a-context-calendar-of-iso8601',
    invariant:
      'A date a message writes under a context whose calendar is iso8601 is written in the calendar of the locale, as the direct formatting API writes it.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "    ...(environment.formatting.calendar === undefined ||\n    environment.formatting.calendar === 'iso8601'",
    replace: '    ...(environment.formatting.calendar === undefined',
    caughtBy:
      'packages/runtime/test/date-formatter-calendar-capability.test.ts',
  },
  {
    id: 'call-numbering-system-not-held-to-the-rule',
    invariant:
      "A numbering system a call names is held to the rule the context's is, so a well-formed name the host has no digits for is reported by every formatter that writes digits and nothing is written in the digits of the locale.",
    source: 'packages/runtime/src/evaluator.ts',
    find: '  const numberingSystem = named ?? context.numberingSystem;\n  if (numberingSystem === undefined) return context.locale;',
    replace:
      '  const numberingSystem = context.numberingSystem ?? (named === undefined ? undefined : undefined);\n  if (numberingSystem === undefined) return context.locale;',
    caughtBy: 'packages/runtime/test/named-numbering-system.test.ts',
  },
  {
    id: 'numbering-system-name-judged-by-the-host-list',
    invariant:
      "Whether a numbering system's name is written as one is decided before the host is asked for the systems it has.",
    source: 'packages/runtime/src/evaluator.ts',
    find: '  if (!isUnicodeKeywordType(numberingSystem)) return undefined;',
    replace: '',
    caughtBy: 'packages/runtime/test/named-numbering-system.test.ts',
  },
  {
    id: 'malformed-numbering-system-reported-as-a-capability',
    invariant:
      'A numbering system whose name is not written as one is refused as malformed input, and not reported as digits the host lacks.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "  return isUnicodeKeywordType(numberingSystem)\n    ? 'native-capability-rejected'",
    replace:
      "  return typeof numberingSystem !== 'object'\n    ? 'native-capability-rejected'",
    caughtBy: 'packages/runtime/test/named-numbering-system.test.ts',
  },
  {
    id: 'field-numbering-system-name-left-to-the-host',
    invariant:
      'A field under a numbering system whose name is not written as one is refused as an invalid configuration without the host being asked, so an upper-case spelling a host reads is not a capability the host lacks.',
    source: 'packages/runtime/src/localized-input.ts',
    find: "  if (!isUnicodeKeywordType(numberingSystem)) return 'malformed';",
    replace:
      "  if (typeof numberingSystem !== 'string') return 'malformed';\n  try {\n    new Intl.Locale('und', { numberingSystem });\n  } catch {\n    return 'malformed';\n  }",
    caughtBy: 'packages/runtime/test/localized-input-numbering-system.test.ts',
  },
  {
    id: 'plain-date-calendar-name-looser-than-a-zoned-one',
    invariant:
      "A plain date's calendar is held to the name syntax a zoned date-time's is, so an upper-case spelling, one character, or a subtag of nine is refused where the date is created.",
    source: 'packages/runtime/src/formatting.ts',
    find: '    day > 31 ||\n    !isCalendarName(calendar)',
    replace: '    day > 31 ||\n    !/^[A-Za-z0-9-]{1,64}$/u.test(calendar)',
    caughtBy: 'packages/runtime/test/canonical-value-admission.test.ts',
  },
  {
    id: 'date-field-calendar-name-looser-than-a-value',
    invariant:
      "A date field's profile names its calendar in the syntax a value's calendar has, and a name written any other way makes the profile invalid.",
    source: 'packages/runtime/src/localized-input.ts',
    find: '    isCalendarName(calendar) &&',
    replace: '    /^[A-Za-z0-9-]{1,64}$/u.test(calendar) &&',
    caughtBy: 'packages/runtime/test/plain-date-input-profile.test.ts',
  },
  {
    id: 'message-calendar-option-judged-by-a-looser-rule',
    invariant:
      "A message's calendar option is judged by how a calendar's name is written, the syntax a value's calendar has, so an upper-case spelling a host would read is refused where the message is compiled.",
    source: 'packages/toolkit/src/message-function-options.ts',
    find: '      pattern: UNICODE_KEYWORD_TYPE,',
    replace: '      pattern: /^[A-Za-z0-9-]{1,64}$/u,',
    caughtBy: 'packages/toolkit/test/function-option-vocabulary.test.ts',
  },
  {
    id: 'message-time-zone-option-left-to-the-host',
    invariant:
      "A message's time zone option is judged against the pinned time-zone database and not by building a formatter, so a clock offset the compiling host reads as a zone is refused on every machine.",
    source: 'packages/toolkit/src/message-format.ts',
    find: '    if (value === undefined || isPinnedTimeZoneName(value)) continue;',
    replace:
      "    if (value === undefined) continue;\n    try {\n      new Intl.DateTimeFormat('en', { timeZone: value });\n      continue;\n    } catch {\n      // Refused below.\n    }",
    caughtBy: 'packages/toolkit/test/function-option-vocabulary.test.ts',
  },
  {
    id: 'message-number-options-left-to-the-host',
    invariant:
      "A message's number options are judged by the pinned ECMA-402 edition's rules and not by building a formatter, so a host that refuses or accepts every option set compiles every message to the same answer.",
    source: 'packages/toolkit/src/message-format.ts',
    find: '        numberFormatRefusal(formatting) !== undefined ||',
    replace:
      "        (() => {\n          try {\n            new Intl.NumberFormat('en', formatting as Intl.NumberFormatOptions);\n            return false;\n          } catch {\n            return true;\n          }\n        })() ||",
    caughtBy: 'packages/toolkit/test/number-options-without-the-host.test.ts',
  },
  {
    id: 'unit-judged-as-any-core-unit-identifier',
    invariant:
      "A message's unit is one the pinned ECMA-402 edition sanctions, alone or as one quotient of two, and a well-formed core unit identifier the edition does not sanction is refused.",
    source: 'packages/toolkit/src/number-format-rules.ts',
    find: '  SANCTIONED.has(unit);',
    replace: '  /^[a-z]+(?:-[a-z]+)*$/u.test(unit);',
    caughtBy: 'packages/toolkit/test/number-options-without-the-host.test.ts',
  },
  {
    id: 'currency-digits-not-the-pinned-ones',
    invariant:
      'The fraction digits a currency is written with come from the pinned CLDR release where the ECMA-402 rules read them, so a rounding increment beside one inherited fraction-digit bound is judged by the currency.',
    source: 'packages/toolkit/src/number-format-rules.ts',
    find: '  CURRENCY_DIGITS[currency] ?? 2;',
    replace: '  2;',
    caughtBy: 'packages/toolkit/test/number-options-without-the-host.test.ts',
  },
  {
    id: 'rounding-increment-only-the-edition-accepts-compiled',
    invariant:
      'An option set the pinned ECMA-402 edition accepts only by lowering the default maximum fraction digits, and V8 refuses, is refused where the message is compiled.',
    source: 'packages/toolkit/src/message-format.ts',
    find: '        unsupportedNumberFormatCombination(formatting) !== undefined',
    replace: '        false',
    caughtBy: 'packages/toolkit/test/number-options-without-the-host.test.ts',
  },
  {
    id: 'pseudo-locale-subtags-read-by-the-host',
    invariant:
      "A pseudo-locale's language, script and region are read from its canonical tag and not through the host's Intl.Locale, so the host's alias data does not decide which language it is in.",
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '  const locale = canonicalSubtags(tag);',
    replace: '  const locale = new Intl.Locale(tag);',
    caughtBy: 'packages/toolkit/test/pseudo-locale-without-the-host.test.ts',
  },
  {
    id: 'declared-keyword-type-stated-a-second-time',
    invariant:
      'The numbering system and the calendar an application declares for a locale are held by the configuration schema to the pattern a name is held to wherever else it is given, so a declaration is not a name to the schema and something else to the formatters.',
    source: 'packages/toolkit/src/schemas.ts',
    find: '  pattern: UNICODE_KEYWORD_TYPE.source,',
    replace: "  pattern: '^[A-Za-z0-9-]{1,64}$',",
    caughtBy: 'packages/toolkit/test/keyword-type-one-definition.test.ts',
  },
  {
    id: 'formatter-cache-key-omits-locale',
    invariant:
      "A cached number formatter is keyed on its full locale tag, so a request for other digits is never handed another locale's formatter.",
    source: 'packages/runtime/src/evaluator.ts',
    find: '    const key = `number\\u0000${locale}\\u0000${stableOptions(options as Readonly<Record<string, unknown>>)}`;',
    replace:
      '    const key = `number\\u0000${stableOptions(options as Readonly<Record<string, unknown>>)}`;',
    caughtBy: 'packages/runtime/test/shared-formatter-cache.test.ts',
  },
  {
    id: 'formatter-cache-never-evicts',
    invariant:
      'The formatter cache holds at most its ceiling and evicts the least recently used entry past it.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    while (this.values.size > this.maximumEntries) {',
    replace: '    while (false && this.values.size > this.maximumEntries) {',
    caughtBy: 'packages/runtime/test/shared-formatter-cache.test.ts',
  },
  {
    id: 'locale-formatting-admits-time-zone',
    invariant:
      'A per-locale formatting entry admits a numbering system, a calendar and an hour cycle, and refuses a time zone.',
    source: 'packages/toolkit/src/schemas.ts',
    find: '        additionalProperties: false,\n        // An entry that sets nothing states nothing, and would read as a decision that was made.',
    replace:
      '        additionalProperties: true,\n        // An entry that sets nothing states nothing, and would read as a decision that was made.',
    caughtBy: 'packages/toolkit/test/locale-formatting-declaration.test.ts',
  },
  {
    id: 'person-name-order-from-the-reader-locale',
    invariant:
      'A name is ordered by its own language, not by the locale of the page it appears on.',
    source: 'packages/runtime/src/formatting.ts',
    find: '  const order = personNameOrder(profile, value.language, options.order);',
    replace:
      '  const order = personNameOrder(profile, context.locale, options.order);',
    caughtBy: 'packages/runtime/test/person-names.test.ts',
  },
  {
    id: 'script-difference-matched-as-same-language',
    invariant:
      'A request is answered with a same-language locale only when both are written in the same script, so a script difference is never bridged as a near match.',
    source: 'packages/runtime/core/src/locale-negotiation.ts',
    find: '      (profile) => profile.language === language && profile.script === script,',
    replace: '      (profile) => profile.language === language,',
    caughtBy: 'packages/runtime/test/locale-negotiation.test.ts',
  },
  {
    id: 'unknown-function-option-accepted',
    invariant:
      'An option a built-in function does not take is refused when the message is compiled, rather than accepted and ignored.',
    source: 'packages/toolkit/src/message-function-options.ts',
    find: '  if (!profile.accepts.includes(optionName)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/function-option-vocabulary.test.ts',
  },
  {
    id: 'unknown-message-function-accepted',
    invariant:
      'A message that calls a function outside the standard set and the registered extensions is refused when it is compiled (EQ1203).',
    source: 'packages/toolkit/src/message-format.ts',
    find: '  if (unsupportedFunctions.length > 0) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/message-format.test.ts',
  },
  {
    id: 'descriptor-binding-accepts-extra-code',
    invariant:
      'A runtime binding carries exactly its descriptor and the one handler its kind calls, and a binding that carries anything else is refused.',
    source: 'packages/runtime/src/extensions.ts',
    find: "    if (!hasExactKeys(candidate, ['descriptor'])) {",
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/identifier-segment-binding.test.ts',
  },
  {
    id: 'missing-extension-binding-admitted',
    invariant:
      'A catalog that requires an extension the application did not bind, or bound under a different descriptor, is refused when the runtime is composed.',
    source: 'packages/runtime/src/extensions.ts',
    find: '        binding === undefined ||\n        descriptorSnapshot(binding.descriptor).canonical !==',
    replace:
      '        false &&\n        descriptorSnapshot(binding.descriptor).canonical !==',
    caughtBy: 'packages/runtime/test/identifier-segment-binding.test.ts',
  },
  {
    id: 'xliff-export-writes-an-earlier-version',
    invariant:
      'An exported interchange document declares XLIFF version 2.2, the pinned edition.',
    source: 'packages/toolkit/src/xliff.ts',
    find: 'xmlns:mda="${XLIFF_METADATA_NAMESPACE}" version="2.2" srcLang=',
    replace: 'xmlns:mda="${XLIFF_METADATA_NAMESPACE}" version="2.1" srcLang=',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'xliff-unit-children-out-of-schema-order',
    invariant:
      'An exported unit puts module metadata before its notes, in the order the pinned XLIFF 2.2 schema requires, so the document validates.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '        unitMetadata(contract),\n        ...unitNotes(sourceMessage, targetMessage),',
    replace:
      '        ...unitNotes(sourceMessage, targetMessage),\n        unitMetadata(contract),',
    caughtBy: 'packages/toolkit/test/xliff-schema.test.ts',
  },
  {
    id: 'xliff-elements-matched-by-local-name',
    invariant:
      "Interchange elements are recognised by namespace as well as name, so content from another module or vendor is never read as Equator's own.",
    source: 'packages/toolkit/src/xliff.ts',
    find: '      child.namespace === namespace &&\n      child.localName === localName,',
    replace: '      child.localName === localName,',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'foreign-note-absorbed-into-catalog',
    invariant:
      "Only notes in Equator's own categories are read back into a catalog; a translator's or tool's note is reported instead.",
    source: 'packages/toolkit/src/xliff.ts',
    find: '    if (category !== NOTE_DESCRIPTION && category !== NOTE_CONTEXT) {',
    replace: '    if (category === undefined) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'changed-source-guidance-unreported',
    invariant:
      'Source guidance that comes back edited in an interchange document is reported and not applied.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    for (const [field, value] of Object.entries(notes.source)) {',
    replace:
      '    for (const [field, value] of Object.entries({} as typeof notes.source)) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'foreign-note-dropped-silently',
    invariant:
      'A note Equator does not store is reported by its category, never passed over without a word.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    if (notes.foreign.length > 0) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'initial-segment-imported-as-translation',
    invariant:
      'A target in the initial state is reported and not imported as translated work.',
    source: 'packages/toolkit/src/xliff.ts',
    find: "    if (state === 'initial') {",
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'undefined-segment-state-imported',
    invariant:
      'A segment state outside the four XLIFF 2.2 defines fails the import and is named in the diagnostic.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    if (!XLIFF_SEGMENT_STATES.has(state)) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'invented-placeholder-imported',
    invariant:
      'A translation that carries a placeholder its source message does not have is refused and the placeholder is named.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '      const extra = pattern.codes.filter((key) => !expected.includes(key));',
    replace: '      const extra: typeof expected = [];',
    caughtBy: 'packages/toolkit/test/xliff-schema.test.ts',
  },
  {
    id: 'dropped-placeholder-imported',
    invariant:
      'A translation that lost a placeholder its source message has is refused, and the diagnostic names the missing placeholder.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '      const missing = expected.filter((key) => !pattern.codes.includes(key));',
    replace: '      const missing: typeof expected = [];',
    caughtBy: 'packages/toolkit/test/xliff-schema.test.ts',
  },
  {
    id: 'canonical-json-admits-unpaired-surrogate',
    invariant:
      'Canonical JSON refuses an unpaired surrogate rather than serializing a string two readers decode differently.',
    source: 'packages/toolkit/src/canonical-json.ts',
    find: '      if (!(following >= 0xdc00 && following <= 0xdfff)) {',
    replace: '      if (false) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'diagnostic-summary-unbounded',
    invariant: 'A diagnostic summary is cut to its code-point ceiling.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: '    if (codePoints >= maximumCodePoints) break;',
    replace: '    if (false) break;',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'diagnostic-path-unbounded',
    invariant: 'A diagnostic path is cut to its segment ceiling.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: '    ?.slice(0, RESOURCE_LIMITS.diagnosticPathSegments)',
    replace: '    ?.slice(0)',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'diagnostic-count-unbounded',
    invariant: 'One operation reports no more diagnostics than its ceiling.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: '    diagnostics.slice(0, RESOURCE_LIMITS.diagnostics).map((diagnostic) =>',
    replace: '    diagnostics.map((diagnostic) =>',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'diagnostic-span-discarded',
    invariant:
      'A diagnostic keeps the source span it was raised with, so it names the file and line of what it reports.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: '    ...(options.span === undefined ? {} : { span: boundedSpan(options.span) }),',
    replace: '    ...{},',
    caughtBy: 'packages/toolkit/test/diagnostic-location.test.ts',
  },
  {
    id: 'unavailable-representation-reported-as-operational-failure',
    invariant:
      'A route parameter with no spelling in a locale is reported as a representation that is unavailable, not as an operational failure.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "            outcome: 'localized-representation-unavailable',",
    replace: "            outcome: 'operational-failure',",
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'route-refusal-drops-its-cause',
    invariant:
      "A route configuration refusal keeps the platform error that decided it as the raised error's cause.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    cause === undefined ? undefined : { cause },',
    replace: '    undefined,',
    caughtBy: 'packages/runtime/test/refusal-reason-and-cause.test.ts',
  },
  {
    id: 'destination-refusal-drops-its-cause',
    invariant:
      "A rich-message destination refusal keeps the URL parser's error as the raised error's cause.",
    source: 'packages/runtime/src/destinations.ts',
    find: '    cause === undefined ? undefined : { cause },',
    replace: '    undefined,',
    caughtBy: 'packages/runtime/test/refusal-reason-and-cause.test.ts',
  },
  {
    id: 'toolkit-event-carries-an-extra-field',
    invariant:
      'A toolkit event carries only its profile, code, phase, status and the bounded fields its shape declares.',
    source: 'packages/toolkit/src/observability.ts',
    find: '    profile: TOOLKIT_OBSERVABILITY_PROFILE,',
    replace:
      '    profile: TOOLKIT_OBSERVABILITY_PROFILE,\n    timestamp: Date.now(),',
    caughtBy: 'packages/toolkit/test/observability.test.ts',
  },
  {
    id: 'toolkit-sink-exception-escapes',
    invariant:
      'A toolkit sink that throws changes nothing about the operation that raised the event.',
    source: 'packages/toolkit/src/observability.ts',
    find: '  try {\n    sink.emit(event);\n  } catch {\n    // Observability is optional and cannot affect compiler or authoring work.\n  }',
    replace: '  sink.emit(event);',
    caughtBy: 'packages/toolkit/test/observability.test.ts',
  },
  {
    id: 'toolkit-repeated-failure-emitted-again',
    invariant:
      'The toolkit reports an equivalent failure once within its window.',
    source: 'packages/toolkit/src/observability.ts',
    find: '    if (previous !== undefined && now - previous < 1_000) return;',
    replace: '    if (false) return;',
    caughtBy: 'packages/toolkit/test/observability.test.ts',
  },
  {
    id: 'toolkit-canonicalization-skips-the-platform',
    invariant:
      'The toolkit canonicalizes a locale tag through the same pinned algorithm the runtime uses, so both write one spelling for one locale.',
    source: 'packages/toolkit/src/locales.ts',
    find: '  const canonical = canonicalizeLanguageTag(locale);',
    replace: '  const canonical: string | undefined = locale;',
    caughtBy: 'packages/toolkit/test/round-trip-properties.test.ts',
  },
  {
    id: 'negotiation-answers-the-maximized-tag',
    invariant:
      'Negotiation compares maximized scripts but answers with the supported locale exactly as declared.',
    source: 'packages/runtime/core/src/locale-negotiation.ts',
    find: '    if (related !== undefined) return related.locale;',
    replace:
      '    if (related !== undefined)\n      return new Intl.Locale(related.locale).maximize().toString();',
    caughtBy: 'packages/runtime/test/locale-negotiation.test.ts',
  },
  {
    id: 'cross-language-parent-narrowed',
    invariant:
      'A parent the pinned CLDR data declares in another language is followed, not dropped.',
    source: 'packages/toolkit/src/locales.ts',
    find: '    return declared === ROOT_LOCALE ? undefined : declared;',
    replace:
      "    return declared === ROOT_LOCALE ||\n      declared.split('-')[0] !== locale.split('-')[0]\n      ? undefined\n      : declared;",
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'shadowing-alias-admitted',
    invariant:
      'An alias spelled as a supported locale is refused (EQ1006) rather than read as one of the two.',
    source: 'packages/toolkit/src/configuration.ts',
    find: '    if (aliasAsLocale.ok && localeSet.has(aliasAsLocale.value)) {',
    replace: '    if (false && aliasAsLocale.ok) {',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'alias-to-unsupported-locale-admitted',
    invariant:
      'An alias that names a locale the configuration does not support is refused (EQ1006).',
    source: 'packages/toolkit/src/configuration.ts',
    find: '    } else if (!localeSet.has(canonicalTarget.value)) {',
    replace: '    } else if (false) {',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'same-language-match-ignores-script',
    invariant:
      'The same-language step matches a supported locale only when its maximized script is the one the request is written in.',
    source: 'packages/runtime/core/src/locale-negotiation.ts',
    find: '      (profile) => profile.language === language && profile.script === script,',
    replace: '      (profile) => profile.language === language,',
    caughtBy: 'packages/runtime/test/locale-negotiation.test.ts',
  },
  {
    id: 'accept-language-weights-ignored',
    invariant:
      'Language ranges are tried in the order of their quality values, with header order breaking a tie.',
    source: 'packages/runtime/core/src/locale-negotiation.ts',
    find: '      .sort((left, right) => right.quality - left.quality)',
    replace: '',
    caughtBy: 'packages/runtime/test/locale-negotiation.test.ts',
  },
  {
    id: 'partial-removal-reported-complete',
    invariant:
      'A removal that did not reach every configured store is reported as incomplete.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '        complete: unreached.length === 0,',
    replace: '        complete: true,',
    caughtBy: 'packages/runtime/test/forgetting-a-remembered-locale.test.ts',
  },
  {
    id: 'store-without-removal-counted-as-reached',
    invariant:
      'A store that offers no removal is named as one the removal did not reach.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: "          unreached.push(\n            Object.freeze({ storeId: store.id, reason: 'no-removal' as const }),\n          );",
    replace: '          // The store offers no removal and is not counted.',
    caughtBy: 'packages/runtime/test/forgetting-a-remembered-locale.test.ts',
  },
  {
    id: 'seat-hides-the-declared-outcome',
    invariant:
      'The server seat reports the page outcome a render declared and whether the handler carried it.',
    source: 'packages/runtime/testing/src/server-seat.ts',
    find: '      pageOutcome:\n        observed.declared === undefined',
    replace: '      pageOutcome:\n        true',
    caughtBy: 'packages/runtime/test/server-seat.test.ts',
  },
  {
    id: 'executable-yaml-tag-admitted',
    invariant:
      'A catalog that names a YAML tag the restricted profile does not know is refused rather than read as a plain value.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '  const parserDiagnostics = [...document.errors, ...document.warnings].map(',
    replace: '  const parserDiagnostics = [...document.errors].map(',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'catalog-identity-carries-locale',
    invariant:
      "A message identity is its provider, scope and message alone, so every locale's catalog names the same message.",
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      const identity = `${sourceCatalog.providerId}:${sourceCatalog.scopeId}:${messageId}`;',
    replace:
      '      const identity = `${sourceCatalog.providerId}:${sourceCatalog.scopeId}:${sourceCatalog.locale}:${messageId}`;',
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'translator-context-written-as-description',
    invariant:
      'Context and description reach the translator as two notes of different categories, never one standing in for the other.',
    source: 'packages/toolkit/src/xliff.ts',
    find: "            'equator-source-context',\n            NOTE_CONTEXT,",
    replace:
      "            'equator-source-context',\n            NOTE_DESCRIPTION,",
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'target-guidance-dropped',
    invariant:
      'Guidance a target entry carries for its own locale reaches the translator beside the source guidance.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    ...(target?.description === undefined',
    replace: '    ...(true',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'target-entry-declares-inputs',
    invariant:
      'A target entry that declares inputs is refused, because a translation inherits its contract from the source.',
    source: 'packages/toolkit/src/schemas.ts',
    find: '              context: nonemptyTextSchema,',
    replace:
      '              context: nonemptyTextSchema,\n              inputs: messageRecordSchema.properties.inputs,',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'unannotated-input-made-optional',
    invariant:
      'An unannotated external variable is inferred as a required, non-nullable string.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '        optional: refinement?.optional ?? inheritedContract?.optional ?? false,',
    replace:
      '        optional: refinement?.optional ?? inheritedContract?.optional ?? true,',
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'function-operand-type-ignored',
    invariant:
      "A variable annotated by a function takes that function's operand type rather than defaulting to a string.",
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "      explicitTypes[0] ?? inheritedContract?.type ?? ('string' as const);",
    replace: "      inheritedContract?.type ?? ('string' as const);",
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'formatting-selector-deferred-to-render',
    invariant:
      'A .match over a function that formats but does not select is refused when the message is compiled, not left to fall back to the catch-all when it renders.',
    source: 'packages/toolkit/src/message-format.ts',
    find: '      if (name === undefined || selectorNames.has(name)) continue;',
    replace: '      if (name === undefined || name.length >= 0) continue;',
    caughtBy: 'packages/toolkit/test/message-format.test.ts',
  },
  {
    id: 'inherited-options-bypass-descriptor',
    invariant:
      'A registered function is called with only the options its own descriptor declares, whatever its operand carried.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '        options: declaredOptionsOnly(resolvedOptions, binding.descriptor),',
    replace: '        options: resolvedOptions,',
    caughtBy: 'packages/runtime/test/message-function-extensions.test.ts',
  },
  {
    id: 'contradicting-refinement-accepted',
    invariant:
      'A source refinement that contradicts the operand type a function gives its variable is refused.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '  if (!compatibleRefinement(inferred, refined)) {',
    replace: '  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'target-entry-declares-slots',
    invariant:
      'A target entry that declares slots is refused, because a translation inherits its rich-slot contract from the source.',
    source: 'packages/toolkit/src/schemas.ts',
    find: '              context: nonemptyTextSchema,',
    replace:
      '              context: nonemptyTextSchema,\n              slots: messageRecordSchema.properties.slots,',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'target-invents-slot',
    invariant:
      'A target message that uses a rich slot its source does not have is reported.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    const source = sourceSlots.find(({ name }) => name === target.name);',
    replace:
      '    const source = sourceSlots.find(({ name }) => name === target.name);\n    if (source === undefined) continue;',
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'heterogeneous-family-accepted',
    invariant:
      'An open family whose current members do not share one input and rich-slot contract is refused.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      memberMessages.some((message) => commonContractJson(message) !== common)',
    replace: '      false',
    caughtBy: 'packages/toolkit/test/extensions-and-families.test.ts',
  },
  {
    id: 'family-membership-not-derived',
    invariant:
      "Every source message that satisfies a family's template becomes a member without being listed anywhere.",
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '        const segments = familyMatch(message.messageId, parsed, extensions);',
    replace:
      '        const segments =\n          message.messageId.length < 0\n            ? familyMatch(message.messageId, parsed, extensions)\n            : undefined;',
    caughtBy: 'packages/toolkit/test/extensions-and-families.test.ts',
  },
  {
    id: 'stale-translation-blocks-by-default',
    invariant:
      'A translation written against an older source is an advisory unless the run asks for the release gate.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '        requireComplete,\n        entry.locale,',
    replace: '        true,\n        entry.locale,',
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'stale-translation-gate-ignored',
    invariant:
      'The release gate escalates a translation written against an older source to an error.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '        requireComplete,\n        entry.locale,',
    replace: '        false,\n        entry.locale,',
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'projection-identity-shape-unchecked',
    invariant:
      'A route projection whose identity is not a sha256 digest in unpadded base64url is refused.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    !/^sha256-[A-Za-z0-9_-]{43}$/u.test(projection.generated.identity)',
    replace: '    false',
    caughtBy: 'packages/runtime/test/routing-refusals.test.ts',
  },
  {
    id: 'input-change-published-anyway',
    invariant:
      'Generation whose inputs changed after compilation reports a failure and leaves the output as it was.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '      request.expectedInputFingerprint !== undefined &&',
    replace: '      false &&',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'required-extension-unbound',
    invariant:
      'A descriptor a catalog requires with no registered implementation is refused before any catalog is used.',
    source: 'packages/runtime/src/extensions.ts',
    find: '        binding === undefined ||\n        descriptorSnapshot(binding.descriptor).canonical !==',
    replace:
      '        binding !== undefined &&\n        descriptorSnapshot(binding.descriptor).canonical !==',
    caughtBy: 'packages/runtime/test/identifier-segment-binding.test.ts',
  },
  {
    id: 'message-ceiling-lifted',
    invariant:
      'A MessageFormat source past the byte ceiling is refused before it is parsed.',
    source: 'packages/toolkit/src/message-format.ts',
    find: "    RESOURCE_LIMITS.messageBytes,\n  );\n  if (!sourceText.ok) return sourceText;\n  const source = sourceText.value;\n  if (Buffer.byteLength(source, 'utf8') > RESOURCE_LIMITS.messageBytes) {",
    replace:
      '    Number.MAX_SAFE_INTEGER,\n  );\n  if (!sourceText.ok) return sourceText;\n  const source = sourceText.value;\n  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'failing-value-echoed',
    invariant:
      'A diagnostic names the type of a value it refused and never repeats the value.',
    source: 'packages/toolkit/src/untrusted-text.ts',
    find: '        `${label} must be a string, not ${describeType(value)}.`,',
    replace:
      '        `${label} must be a string, not ${describeType(value)}: ${JSON.stringify(value)}.`,',
    caughtBy: 'packages/toolkit/test/untrusted-input.test.ts',
  },
  {
    id: 'unsupported-angular-host-admitted',
    invariant:
      'An Angular compiler outside the supported major is refused with EQ1806 rather than admitted.',
    source: 'packages/toolkit/src/host-compatibility.ts',
    find: '  return !version.prerelease && version.major === 22;',
    replace: '  return !version.prerelease;',
    caughtBy: 'packages/toolkit/test/host-compatibility.test.ts',
  },
  {
    id: 'number-formatter-rebuilt-on-every-call',
    invariant:
      'The shared formatter store hands back the number formatter it already built, so a hundred identical calls construct one.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    if (cached instanceof Intl.NumberFormat) {',
    replace:
      '    if (false as boolean && cached instanceof Intl.NumberFormat) {',
    caughtBy: 'packages/runtime/test/shared-formatter-cache.test.ts',
  },
  {
    id: 'duplicate-xliff-catalog-matched-by-file-order',
    invariant:
      'An interchange document carrying the same catalog twice is refused rather than read from whichever file comes first.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '  if (matching.length !== 1) {',
    replace: '  if (matching.length === 0) {',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'xliff-doctype-skipped',
    invariant:
      'An XLIFF document carrying a document type declaration or an entity is refused rather than read past.',
    source: 'packages/toolkit/src/xliff.ts',
    find: "    if (document.startsWith('<!', index) || document.startsWith('<?', index)) {",
    replace:
      "    if (document.startsWith('<!DOCTYPE', index)) {\n      const end = document.indexOf(']>', index);\n      index = end < 0 ? document.length : end + 2;\n      continue;\n    }\n    if (document.startsWith('<!', index) || document.startsWith('<?', index)) {",
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'diagnostic-text-carries-controls',
    invariant:
      'A control character, directional override or isolate in diagnostic text is replaced before the diagnostic exists.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: "    result += unsafeDiagnosticControl.test(character) ? '\\ufffd' : character;",
    replace: '    result += character;',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'authored-text-ceiling-unchecked',
    invariant: 'An authored file past its byte ceiling is refused.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  if (position > input.maximumBytes) return oversized();',
    replace: '  if (false) return oversized();',
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'authored-text-decoded-with-replacement',
    invariant:
      'An authored file that is not UTF-8 is refused rather than decoded with replacement.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    return toolkitSuccess(STRICT_UTF8.decode(contents));',
    replace: "    return toolkitSuccess(contents.toString('utf8'));",
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'cookie-attribute-value-unchecked',
    invariant:
      'A cookie attribute value carrying a character a cookie cannot hold is refused.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: '    if (value !== undefined && !ATTRIBUTE_VALUE.test(value)) {',
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'cookie-host-prefix-domain',
    invariant: 'A __Host- cookie with a Domain attribute is refused.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: '    if (domain !== undefined) {',
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'cookie-host-prefix-insecure',
    invariant: 'A __Host- cookie without Secure is refused.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: '    if (!secure) {',
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'cookie-host-prefix-path',
    invariant: 'A __Host- cookie whose path is not / is refused.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: "    if (path !== '/') {",
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'cookie-max-age-unchecked',
    invariant:
      'A cookie lifetime that is not a positive safe integer is refused.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: '  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {',
    replace: '  if (false) {',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'cookie-refused-with-a-plain-error',
    invariant:
      'A cookie configuration that is refused is refused as an invalid-configuration failure.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: "    throw new LocalizationError(\n      Object.freeze({\n        code: 'invalid-configuration',\n        outcome: 'operational-failure',\n        message: `Equator ${owner}: ${rule}`,\n        reason: 'malformed-input',\n      }),\n    );",
    replace: '    throw new Error(`Equator ${owner}: ${rule}`);',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'locale-profile-without-a-script-let-through',
    invariant:
      'A tag that names no script and has none in the likely subtags data is refused as an invalid-configuration failure.',
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: '  if (script === undefined) {',
    replace: '  if (script === null) {',
    caughtBy: 'packages/runtime/test/core-entry-point.test.ts',
  },
  {
    id: 'locale-tag-refused-with-the-platform-error',
    invariant:
      'A tag the platform does not parse is refused as an invalid-configuration failure whose cause is the platform error.',
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: "    throw new LocalizationError(\n      malformedTag('A locale tag the platform does not parse has no profile.'),\n      { cause },\n    );",
    replace: '    throw cause;',
    caughtBy: 'packages/runtime/test/locale-tag-refusal.test.ts',
  },
  {
    id: 'locale-profile-takes-a-value-that-is-not-text',
    invariant:
      'A locale handed to localeProfile that is not text is refused as a tag that is not one.',
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: "  if (typeof locale !== 'string') {",
    replace: '  if (false) {',
    caughtBy: 'packages/runtime/test/locale-tag-refusal.test.ts',
  },
  {
    id: 'declared-status-out-of-range-let-through',
    invariant:
      'A declared operational failure whose status is not a whole number from 200 to 599 is refused as an invalid-configuration failure.',
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: '  if (!Number.isInteger(given) || status < 200 || status > 599) {',
    replace: '  if (given === null) {',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'cookie-name-not-token',
    invariant: 'A cookie name that is not an RFC 6265 token is refused.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: '  if (!TOKEN.test(name)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'cookie-samesite-none-insecure',
    invariant:
      'A SameSite=None cookie without Secure, which a browser discards, is refused.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: "  if (sameSite === 'None' && !secure) {",
    replace: '  if (false) {',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'cookie-secure-prefix-insecure',
    invariant:
      'A __Secure- cookie without Secure, which a browser discards, is refused.',
    source: 'packages/runtime/core/src/cookie-attributes.ts',
    find: "  if (prefix.startsWith('__secure-') && !secure) {",
    replace: '  if (false) {',
    caughtBy: 'packages/runtime/test/locale-cookie-defaults.test.ts',
  },
  {
    id: 'instant-options-override-caller',
    invariant:
      'The options a call passes narrow the context rather than being overridden by it.',
    source: 'packages/runtime/src/formatting.ts',
    find: '    ...options,\n  };\n}',
    replace: '  };\n}',
    caughtBy: 'packages/runtime/test/instant-time-zone.test.ts',
  },
  {
    id: 'json-byte-order-mark-refused',
    invariant:
      'A JSON file with one leading byte-order mark is read as the JSON after it.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  return source.startsWith(BYTE_ORDER_MARK) ? source.slice(1) : source;',
    replace: '  return source;',
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'plain-date-context-calendar-ignored',
    invariant:
      "An ISO plain date is written in the calendar the formatting context names, under the call's own.",
    source: 'packages/runtime/src/formatting.ts',
    find: '      ...displayCalendar(context.calendar),\n      ...displayCalendar(value.calendar),',
    replace: '      ...displayCalendar(value.calendar),',
    caughtBy: 'packages/runtime/test/plain-date-context-calendar.test.ts',
  },
  {
    id: 'gregorian-plain-date-refused-by-the-formatter',
    invariant:
      'A plain date counted in gregory, which a date field of that calendar reads, is a date the formatter writes.',
    source: 'packages/runtime/src/formatting.ts',
    find: "  return calendar === 'iso8601' || calendar === 'gregory';",
    replace: "  return calendar === 'iso8601';",
    caughtBy: 'packages/runtime/test/plain-date-calendar.test.ts',
  },
  {
    id: 'gregorian-plain-date-written-in-the-context-calendar',
    invariant:
      "A plain date counted in gregory is written in the Gregorian calendar over the formatting context's.",
    source: 'packages/runtime/src/formatting.ts',
    find: '      ...displayCalendar(context.calendar),\n      ...displayCalendar(value.calendar),',
    replace: '      ...displayCalendar(context.calendar),',
    caughtBy: 'packages/runtime/test/plain-date-calendar.test.ts',
  },
  {
    id: 'plain-date-time-context-calendar-ignored',
    invariant:
      "An ISO plain date-time is written in the calendar the formatting context names, under the call's own.",
    source: 'packages/runtime/src/formatting.ts',
    find: '      ...displayCalendar(context.calendar),\n      ...displayCalendar(value.date.calendar),',
    replace: '      ...displayCalendar(value.date.calendar),',
    caughtBy: 'packages/runtime/test/plain-date-context-calendar.test.ts',
  },
  {
    id: 'plain-time-context-hour-cycle-over-the-call',
    invariant:
      "A plain time is written in the hour cycle the call names over the formatting context's.",
    source: 'packages/runtime/src/formatting.ts',
    find: '    const dateOptions: Intl.DateTimeFormatOptions = {\n      ...(context.hourCycle === undefined\n        ? {}\n        : { hourCycle: context.hourCycle }),\n      ...options,',
    replace:
      '    const dateOptions: Intl.DateTimeFormatOptions = {\n      ...options,\n      ...(context.hourCycle === undefined\n        ? {}\n        : { hourCycle: context.hourCycle }),',
    caughtBy: 'packages/runtime/test/call-named-hour-cycle.test.ts',
  },
  {
    id: 'plain-date-time-context-hour-cycle-over-the-call',
    invariant:
      "A plain date-time is written in the hour cycle the call names over the formatting context's.",
    source: 'packages/runtime/src/formatting.ts',
    find: '      ...displayCalendar(value.date.calendar),\n      ...(context.hourCycle === undefined\n        ? {}\n        : { hourCycle: context.hourCycle }),\n      ...options,',
    replace:
      '      ...displayCalendar(value.date.calendar),\n      ...options,\n      ...(context.hourCycle === undefined\n        ? {}\n        : { hourCycle: context.hourCycle }),',
    caughtBy: 'packages/runtime/test/call-named-hour-cycle.test.ts',
  },
  {
    id: 'message-time-zone-overridden-by-context',
    invariant:
      "A time zone a message expression names is used over the formatting context's.",
    source: 'packages/runtime/src/evaluator.ts',
    find: '    ...dateTimeFormatOptions(functionName, resolved),\n  };\n  if (options.timeZone === undefined) {',
    replace:
      '    ...dateTimeFormatOptions(functionName, resolved),\n    ...(environment.formatting.timeZone === undefined\n      ? {}\n      : { timeZone: environment.formatting.timeZone }),\n  };\n  if (options.timeZone === undefined) {',
    caughtBy: 'packages/runtime/test/date-option-rendering.test.ts',
  },
  {
    id: 'message-time-zone-the-host-does-not-read-reported-as-input',
    invariant:
      'A time zone from the formatting context or a message variable, or an hour cycle from the context, that the host does not read is reported by a message as an unsupported formatting capability, as the direct formatters report it.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    unsupportedFormatting(\n      `:${functionName} was given a time zone or an hour cycle this runtime does not read.`,',
    replace:
      '    invalidInput(\n      `:${functionName} was given a time zone or an hour cycle this runtime does not read.`,',
    caughtBy: 'packages/runtime/test/time-zone-host-judged.test.ts',
  },
  {
    id: 'plain-value-zone-read-as-utc-by-spelling',
    invariant:
      'A plain time or date-time is written under a zone an operation names wherever the host reads that zone as UTC, whatever name it is given.',
    source: 'packages/runtime/src/formatting.ts',
    find: "  return answered === 'UTC'\n    ? undefined",
    replace: "  return timeZone === 'UTC'\n    ? undefined",
    caughtBy: 'packages/runtime/test/plain-value-zone-read-as-utc.test.ts',
  },
  {
    id: 'formatting-locale-parent-chain-not-the-pinned-one',
    invariant:
      'A formatting locale the host has no data for falls back through the pinned CLDR parent chain, so ht formats as fr-HT on every host.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  const declared = Object.hasOwn(parents, locale) ? parents[locale] : undefined;',
    replace:
      '  const declared = Object.hasOwn({}, locale) ? parents[locale] : undefined;',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'formatting-locale-chain-end-written-in-the-host-default',
    invariant:
      'Where no locale of the parent chain is one the host has, a formatter returns the typed unsupported result rather than writing in the host default locale.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  if (member === undefined) return REFUSED;',
    replace: '  if (member === undefined) member = base;',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'formatting-locale-keyword-the-host-drops-written',
    invariant:
      'A keyword of the context locale that the operation reads and the host drops is reported as an option the host drops is.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '    if (carried.some((name) => kept[name] !== keywords[name])) return REFUSED;',
    replace: '    void kept;',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'fallback-reported-for-the-same-writing',
    invariant:
      'A locale of the chain written in the language and script of the locale asked for is named and is not reported as a fallback.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '          ...(differsInWriting(base, member, pseudoLocale)\n            ? { fallback: true as const }\n            : {}),',
    replace: '          ...{ fallback: true as const },',
    caughtBy: 'packages/runtime/test/fallback-writing-rule.test.ts',
  },
  {
    id: 'fallback-script-not-compared',
    invariant:
      'A locale of the chain in the language asked for but another script is reported as a fallback.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  return (\n    askedScript !== undefined &&\n    usedScript !== undefined &&\n    askedScript !== usedScript\n  );',
    replace: '  return askedScript === undefined && usedScript === undefined;',
    caughtBy: 'packages/runtime/test/fallback-writing-rule.test.ts',
  },
  {
    id: 'likely-script-of-the-language-alone',
    invariant:
      'The script of a tag without one is the likely script of its language_region before that of its language, so zh-TW is Traditional Chinese.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  return regional ?? likelyScript(locale.language);',
    replace:
      '  return regional === undefined ? likelyScript(locale.language) : undefined;',
    caughtBy: 'packages/runtime/test/fallback-writing-rule.test.ts',
  },
  {
    id: 'formatted-value-fallback-not-reported',
    invariant:
      'A formatted value written in another language or script than the locale asked for reports a fallback.',
    source: 'packages/runtime/src/formatting.ts',
    find: '      ...(used.fallback === undefined ? {} : { fallback: used.fallback }),',
    replace: '      ...{},',
    caughtBy: 'packages/runtime/test/fallback-writing-rule.test.ts',
  },
  {
    id: 'capability-fallback-not-reported',
    invariant:
      'A capability answer given in another language or script than the locale asked for reports a fallback.',
    source: 'packages/runtime/src/formatting.ts',
    find: '    ...(host.used === undefined ? {} : { language: host.used }),\n    ...(host.fallback === undefined ? {} : { fallback: host.fallback }),',
    replace: '    ...(host.used === undefined ? {} : { language: host.used }),',
    caughtBy: 'packages/runtime/test/fallback-writing-rule.test.ts',
  },
  {
    id: 'message-value-fallback-not-reported',
    invariant:
      'A message value part formatted in another language or script than the context locale reports valueFallback.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '      : { valueFallback: value.formattedFallback }),',
    replace: '      : {}),',
    caughtBy: 'packages/runtime/test/fallback-writing-rule.test.ts',
  },
  {
    id: 'plural-chain-not-the-plurals-component',
    invariant:
      'Plural selection walks the parents of the plurals component, not the main ones.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  plural: PLURAL_PARENT_LOCALES,',
    replace: '  plural: PARENT_LOCALES,',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'collation-chain-not-the-collations-component',
    invariant:
      'Ordering walks the parents of the collations component, not the main ones.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  collator: COLLATION_PARENT_LOCALES,',
    replace: '  collator: PARENT_LOCALES,',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'segmentation-chain-not-the-segmentations-component',
    invariant:
      'Segmentation walks the parents of the segmentations component, not the main ones.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  segmenter: SEGMENTATION_PARENT_LOCALES,',
    replace: '  segmenter: PARENT_LOCALES,',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'formatting-chain-nonlikely-script-not-root',
    invariant:
      'A formatting locale that is a language and a script its language does not usually take has root as its main parent, listed or not, so ru-Latn is not written as ru.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  if (parents === PARENT_LOCALES && !pseudoLocale && hasNonlikelyScript(locale))\n    return undefined;\n',
    replace: '',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'formatting-chain-nonlikely-script-applied-to-a-component',
    invariant:
      "The nonlikelyScript rule is the main component's alone, so the plural rules of ru-Latn are those of ru.",
    source: 'packages/runtime/src/host-locale.ts',
    find: '  if (parents === PARENT_LOCALES && !pseudoLocale && hasNonlikelyScript(locale))',
    replace: '  if (!pseudoLocale && hasNonlikelyScript(locale))',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'formatting-chain-nonlikely-script-below-the-script',
    invariant:
      'The nonlikelyScript rule applies to a language and a script alone, so sr-Latn-AQ truncates to sr-Latn.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  if (subtags.length !== 2) return false;\n  const [language, script] = subtags as [string, string];\n  if (!SCRIPT_SUBTAG.test(script)) return false;\n  const likely = likelyScript(language);',
    replace:
      '  if (subtags.length < 2) return false;\n  const [language, script] = subtags as [string, string];\n  if (!SCRIPT_SUBTAG.test(script)) return false;\n  const likely = likelyScript(language);',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'catalog-chain-nonlikely-script-not-root',
    invariant:
      'A configured locale that is a language and a script its language does not usually take has no parent, listed or not, so ru-Latn is not served ru catalogs.',
    source: 'packages/toolkit/src/locales.ts',
    find: '  if (!pseudoLocale && hasNonlikelyScript(locale)) return undefined;\n',
    replace: '',
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'formatting-chain-pseudo-locale-sent-to-root',
    invariant:
      'A pseudo-locale is written in its language, because its script subtag says only which way its text runs, so en-Arab-XB formats as en.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  if (parents === PARENT_LOCALES && !pseudoLocale && hasNonlikelyScript(locale))',
    replace: '  if (parents === PARENT_LOCALES && hasNonlikelyScript(locale))',
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'pseudo-locale-script-read-from-its-tag',
    invariant:
      'A pseudo-locale written in its language is not a fallback, because the script its tag names is its direction and not its writing.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  const askedScript = pseudoLocale\n    ? likelyScript(askedLocale.language)\n    : scriptOf(askedLocale);',
    replace: '  const askedScript = scriptOf(askedLocale);',
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'pseudo-locale-mark-taken-on-a-real-locale',
    invariant:
      'A context that marks as a pseudo-locale a locale whose region no pseudo-locale takes is refused as malformed rather than formatted.',
    source: 'packages/runtime/src/host-locale.ts',
    find: '  if (pseudoLocale && !ɵisGeneratedPseudoLocales([base], [base])) {\n    return MISMARKED;\n  }\n',
    replace: '',
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'pseudo-locale-mark-dropped-by-a-formatter',
    invariant: 'A formatter reads the pseudo-locale mark of its context.',
    source: 'packages/runtime/src/formatting.ts',
    find: '  const host = hostLocale(service, tag, options, context.pseudoLocale === true);',
    replace: '  const host = hostLocale(service, tag, options);',
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'pseudo-locale-mark-dropped-by-a-capability',
    invariant:
      'Plural selection, ordering and segmentation read the pseudo-locale mark of their context.',
    source: 'packages/runtime/src/formatting.ts',
    find: '    context.locale,\n    options,\n    context.pseudoLocale === true,\n  );',
    replace: '    context.locale,\n    options,\n  );',
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'pseudo-locale-mark-dropped-by-a-message-number',
    invariant:
      "A message's number reads the pseudo-locale mark of its context.",
    source: 'packages/runtime/src/evaluator.ts',
    find: "    'number',\n    formattingTag,\n    options,\n    environment.formatting.pseudoLocale === true,\n",
    replace: "    'number',\n    formattingTag,\n    options,\n    false,\n",
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'pseudo-locale-mark-dropped-by-a-message-date',
    invariant: "A message's date reads the pseudo-locale mark of its context.",
    source: 'packages/runtime/src/evaluator.ts',
    find: "    'date-time',\n    formattingTag,\n    options,\n    environment.formatting.pseudoLocale === true,\n",
    replace: "    'date-time',\n    formattingTag,\n    options,\n    false,\n",
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'pseudo-locale-not-marked-by-the-runtime',
    invariant:
      'The runtime marks the formatting context of a locale its generated configuration lists as a pseudo-locale.',
    source: 'packages/runtime/src/localization.ts',
    find: '      ...(this.pseudoLocales.has(locale)\n        ? { pseudoLocale: true as const }\n        : {}),\n',
    replace: '',
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'pseudo-locale-mark-transferred',
    invariant:
      'The state a server render transfers carries no pseudo-locale mark, so it keeps the shape its profile names.',
    source: 'packages/runtime/src/localization.ts',
    find: 'formatting: transferredFormatting(this.active.publicSnapshot.formatting),',
    replace: 'formatting: this.active.publicSnapshot.formatting,',
    caughtBy: 'packages/runtime/test/pseudo-locale-formatting.test.ts',
  },
  {
    id: 'catalog-chain-pseudo-locale-sent-to-root',
    invariant:
      'A pseudo-locale inherits through its language, so en-Arab-XB reaches en and is not sent to root.',
    source: 'packages/toolkit/src/locales.ts',
    find: '  if (!pseudoLocale && hasNonlikelyScript(locale)) return undefined;',
    replace: '  if (hasNonlikelyScript(locale)) return undefined;',
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'catalog-chain-pseudo-locale-not-handed-on',
    invariant:
      'The chain a build hands the runtime for a pseudo-locale it generated is the one through its language.',
    source: 'packages/toolkit/src/generated-contracts.ts',
    find: '        graph.pseudoLocales.includes(locale),\n',
    replace: '',
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'catalog-chain-unknown-language-sent-to-root',
    invariant:
      'A configured locale in a language the pinned data gives no likely script keeps truncation.',
    source: 'packages/toolkit/src/locales.ts',
    find: '  const likely = likelyScript(language);\n  return likely !== undefined && likely !== script;',
    replace:
      '  const likely = likelyScript(language);\n  return likely !== script;',
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'formatting-chain-region-not-aliased',
    invariant:
      "A formatting language_region whose likely script is not its language's inherits through its language_script_region, so zh-AU is written as zh-Hant and not as zh.",
    source: 'packages/runtime/src/host-locale.ts',
    find: '  if (aliased !== undefined) return aliased;\n',
    replace: '',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'catalog-chain-region-not-aliased',
    invariant:
      "A configured language_region whose likely script is not its language's inherits through its language_script_region, so zh-TW never falls back to zh.",
    source: 'packages/toolkit/src/locales.ts',
    find: '  if (aliased !== undefined) return aliased;\n',
    replace: '',
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'catalog-chain-region-alias-drops-the-region',
    invariant:
      'A language_region aliases to the language_script_region of the same region, so zh-TW passes through zh-Hant-TW.',
    source: 'packages/toolkit/src/locales.ts',
    find: '    : `${locale.slice(0, cut)}-${script}${locale.slice(cut)}`;',
    replace: '    : `${locale.slice(0, cut)}-${script}`;',
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'formatting-locale-fallback-not-reported',
    invariant:
      'A formatted value reports the locale of the parent chain that wrote it as its language.',
    source: 'packages/runtime/src/formatting.ts',
    find: '    language: host.used ?? context.locale,',
    replace: '    language: context.locale,',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'capability-locale-fallback-not-reported',
    invariant:
      'A capability answer reports the locale of the parent chain that answered as its language.',
    source: 'packages/runtime/src/formatting.ts',
    find: '    ...(host.used === undefined ? {} : { language: host.used }),',
    replace: '    ...{},',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'message-value-language-not-reported',
    invariant:
      'A message value part reports the locale of the parent chain a function formatted it in as its valueLanguage.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '      : { valueLanguage: value.formattedIn }),',
    replace: '      : {}),',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'message-formatting-locale-the-host-lacks-written',
    invariant:
      'A message function under a formatting locale whose parent chain the host has none of raises the typed unsupported result.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '  if (!host.ok) {\n    unsupportedFormatting(',
    replace: '  if (host.ok === undefined) {\n    unsupportedFormatting(',
    caughtBy: 'packages/runtime/test/host-locale-chain.test.ts',
  },
  {
    id: 'context-time-zone-feature-not-marked',
    invariant:
      'A catalog with a date or time expression that names no time zone is marked as requiring the context time zone.',
    source: 'packages/toolkit/src/compiled-artifacts.ts',
    find: "      features.add('context-time-zone');",
    replace: '      void features;',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'asset-source-copied',
    invariant:
      'A resolved asset carries the very source value the application declared, unread and uncopied.',
    source: 'packages/runtime/src/assets.ts',
    find: "        kind: 'language-independent' as const,\n        source: descriptor.source,",
    replace:
      "        kind: 'language-independent' as const,\n        source: structuredClone(descriptor.source),",
    caughtBy: 'packages/runtime/test/asset-source-opaque.test.ts',
  },
  {
    id: 'container-slot-children-dropped-from-projection',
    invariant:
      'The text projection of a structured message keeps the children of a container slot, formatted values included.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '            visit(part.children, depth + 1);',
    replace: '            void depth;',
    caughtBy: 'packages/runtime/test/rich-text-projection.test.ts',
  },
  {
    id: 'diagnostic-spoofing-control-passed-through',
    invariant:
      'A directional override or control character reaching diagnostic text is replaced, so the input a diagnostic reports on cannot reorder what the reader sees.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: "    result += unsafeDiagnosticControl.test(character) ? '\\ufffd' : character;",
    replace:
      '    result += unsafeDiagnosticControl.test(character) ? character : character;',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'extension-shape-left-open',
    invariant:
      'A runtime extension descriptor and binding admit exactly the fields their kind declares, so there is no field an extension could use to opt out of the rules.',
    source: 'packages/runtime/src/runtime-safety.ts',
    find: '    keys.every((key) => allowed.has(key)) &&',
    replace: '    keys.length >= 0 &&',
    caughtBy: 'packages/runtime/test/extension-opt-out.test.ts',
  },
  {
    id: 'isolates-written-into-the-value-part',
    invariant:
      'The value a structured part carries is the formatted value alone; the isolates belong to the rendered projection.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    value: value.text,',
    replace: '    value: `\\u2067${value.text}\\u2069`,',
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'markup-name-read-as-a-kind',
    invariant:
      'A markup name a catalog writes that is not a built-in kind becomes a message-local slot, never a kind looked up by that name.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "      inherited?.kind ??\n      (builtInSlotKinds.has(name) ? name : 'message-local');",
    replace: '      inherited?.kind ??\n      name;',
    caughtBy: 'packages/toolkit/test/no-component-registry.test.ts',
  },
  {
    id: 'neutral-asset-bound-to-the-target-locale',
    invariant:
      'An asset declared neutral resolves to the same language-independent representation in every locale, so a locale change has nothing of it to move.',
    source: 'packages/runtime/src/assets.ts',
    find: "        kind: 'language-independent' as const,\n        source: descriptor.source,",
    replace:
      "        kind: 'locale-bound' as const,\n        source: descriptor.source,\n        supplyingLocale: request.targetLocale,\n        language: languageForLocale(request.targetLocale),\n        direction: directionForLocale(request.targetLocale),",
    caughtBy: 'packages/runtime/test/neutral-asset-locale.test.ts',
  },
  {
    id: 'seat-answers-its-own-status',
    invariant:
      'The server seat answers every address exactly as the request handler a deployment installs does: same status, headers and body.',
    source: 'packages/runtime/testing/src/server-seat.ts',
    find: '      status: response.status,',
    replace: '      status: response.status === 308 ? 301 : response.status,',
    caughtBy: 'packages/runtime/test/server-seat.test.ts',
  },
  {
    id: 'seat-answers-another-scheme-on-its-origin',
    invariant:
      'The server seat hands an address of a scheme other than http and https to the handler as written, where it is refused.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  const scheme = /^https?:\\/\\//iu.exec(address);',
    replace: '  const scheme = /^[a-z][a-z0-9+.-]*:\\/\\//iu.exec(address);',
    caughtBy: 'packages/runtime/test/server-seat-addresses-and-head.test.ts',
  },
  {
    id: 'seat-reads-a-null-reference-as-a-character',
    invariant:
      'The server seat leaves a numeric character reference that names no character as it was written.',
    source: 'packages/runtime/testing/src/server-seat.ts',
    find: '        return point > 0 &&',
    replace: '        return point >= 0 &&',
    caughtBy: 'packages/runtime/test/server-seat-addresses-and-head.test.ts',
  },
  {
    id: 'slot-options-projected-as-text',
    invariant:
      'Nothing a catalog writes on a slot reaches the text projection of the message.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '            visit(part.children, depth + 1);',
    replace:
      "            append(Object.values(part.options).join(' '));\n            visit(part.children, depth + 1);",
    caughtBy: 'packages/runtime/test/rich-text-projection.test.ts',
  },
  {
    id: 'structural-key-control-admitted',
    invariant:
      'A catalog key carrying an invisible or bidirectional control is refused as such, not only when some other grammar happens to refuse the key.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '      if (!isSafeStructuralText(key)) {',
    replace: '      if (!isSafeStructuralText(key) && false) {',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'structured-message-trusts-markup',
    invariant:
      'No runtime source hands the browser a string to parse as HTML or tells Angular to stop sanitizing one.',
    source: 'packages/runtime/src/message-template.ts',
    find: '  protected binding(name: string): TrustedSlotBinding | undefined {',
    replace:
      "  protected trustedMarkup(html: string): unknown {\n    const holder = document.createElement('template');\n    holder.innerHTML = html;\n    return holder.content;\n  }\n\n  protected binding(name: string): TrustedSlotBinding | undefined {",
    caughtBy: 'packages/runtime/test/no-trusted-markup.test.ts',
  },
  {
    id: 'target-drops-a-required-slot',
    invariant:
      'A target message that omits a required link or action slot is refused, so a translation cannot take an action away from a reader.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    if (!source.optional && !targetSlotMap.has(source.name)) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/required-slot-in-target.test.ts',
  },
  {
    id: 'unregistered-message-function-admitted',
    invariant:
      'A catalog that calls a message function the application never registered is refused when it is parsed.',
    source: 'packages/toolkit/src/message-format.ts',
    find: '        !customFunctionNames.has(name),',
    replace: '        false,',
    caughtBy: 'packages/toolkit/test/catalog-authority.test.ts',
  },
  {
    id: 'unregistered-slot-kind-admitted',
    invariant:
      'A catalog that declares a slot kind the application never registered is refused, so a catalog cannot name trusted rendering code into existence.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "      kind !== 'message-local' &&",
    replace: '      false &&',
    caughtBy: 'packages/toolkit/test/catalog-authority.test.ts',
  },
  {
    id: 'unvalidated-catalog-compiled',
    invariant:
      'A catalog set that parsed and failed validation is refused before any artifact is compiled from it.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "        severity === 'error' && !COMPLETENESS_CODES.has(code),",
    replace: '        false && !COMPLETENESS_CODES.has(code),',
    caughtBy: 'packages/toolkit/test/unvalidated-content-not-compiled.test.ts',
  },
  {
    id: 'alternate-carries-the-visit-query',
    invariant:
      "A page's alternate URLs omit the query the visitor arrived with.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    const url = mounted(splitSuffix(address)[0], baseHref, site);',
    replace: '    const url = mounted(address, baseHref, site);',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'canonical-carries-the-visit-query',
    invariant:
      "A page's canonical URL omits the query the visitor arrived with.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    resolution.parameters,\n    [],\n    undefined,\n    spellings,\n  );\n  const canonical = mounted(',
    replace:
      '    resolution.parameters,\n    resolution.query,\n    undefined,\n    spellings,\n  );\n  const canonical = mounted(',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'correction-copies-raw-query-text',
    invariant:
      'A correction carries the query and fragment as parsed and encoded again, never as the text the request wrote.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  const canonicalSuffix = `${canonicalQuery.length === 0 ? '' : `?${canonicalQuery}`}${canonicalFragment === undefined ? '' : `#${canonicalFragment}`}`;",
    replace: '  const canonicalSuffix = target.slice(rawPath.length);',
    caughtBy: 'packages/runtime/test/another-locale-spelling.test.ts',
  },
  {
    id: 'declared-failure-lifts-route-robots',
    invariant:
      'A page that declares an operational failure leaves its route kept out of indexing, because a declaration can narrow an indexing class and never widen one.',
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: '      ...(resolved.robots === undefined ? {} : { robots: resolved.robots }),',
    replace: '      ...{},',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'dynamic-identity-case-folded',
    invariant:
      'A parameter segment keeps the spelling its codec serializes, so an identifier differing from its lowercase form is neither folded nor corrected.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      canonicalSegments.push(canonical);',
    replace: '      canonicalSegments.push(canonical.toLowerCase());',
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'locale-neutral-correction-varies',
    invariant:
      'A redirect under a locale-neutral policy is not classified as varying, because its location is the same for every locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "        ...(resolution.reason === 'locale-entry'",
    replace:
      "        ...(resolution.reason === 'locale-entry' ||\n        resolution.reason === 'canonical-correction'",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'locale-neutral-correction-names-another-locale-route',
    invariant:
      'A correction under a locale-neutral policy names the locale and the route its location resolves to for the same request.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '        routeId: settled.match.route.id,',
    replace: '        routeId: nearest.match.route.id,',
    caughtBy: 'packages/runtime/test/locale-neutral-correction-route.test.ts',
  },
  {
    id: 'locale-self-name-read-from-the-engine',
    invariant:
      'A locale option carries the self-name the build generated, and asks the engine only for a locale the build has no name for.',
    source: 'packages/runtime/src/localization.ts',
    find: '  if (generated !== undefined) return generated;',
    replace: '  if (generated !== undefined && false) return generated;',
    caughtBy: 'packages/runtime/test/locale-self-name.test.ts',
  },
  {
    id: 'missing-translation-refuses-the-message',
    invariant:
      'A message the requested locale has no translation for renders from the next catalog in the order and is reported as a missing translation, not refused.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    if (locale !== targetLocale) attempted.push(locale);',
    replace: '    if (locale !== targetLocale) break;',
    caughtBy: 'packages/runtime/test/missing-translation-outcome.test.ts',
  },
  {
    id: 'participant-commit-promise-accepted',
    invariant:
      'A commit that answers with a promise is refused as a contract rejection, and the change fails.',
    source: 'packages/runtime/src/participant-runtime.ts',
    find: '        if (asyncCallbackRejected(result)) {\n          throw new LocalizationError(\n            deferredHookDiagnostic(item.adapter.id, item.context),',
    replace:
      '        if (asyncCallbackRejected(result) && (false as boolean)) {\n          throw new LocalizationError(\n            deferredHookDiagnostic(item.adapter.id, item.context),',
    caughtBy:
      'packages/runtime/test/participant-registration-admission.test.ts',
  },
  {
    id: 'change-ends-the-initialization-it-met',
    invariant:
      'A locale change requested while the context is initializing leaves the initialization and its participants alone until it has settled.',
    source: 'packages/runtime/src/localization.ts',
    find: '    if (!initializing) overtake();',
    replace: '    overtake();',
    caughtBy:
      'packages/runtime/test/locale-change-during-initialization.test.ts',
  },
  {
    id: 'destroyed-context-keeps-working-after-its-commit',
    invariant:
      'A change whose commit destroyed the context loads no progressive scope into it afterwards.',
    source: 'packages/runtime/src/localization.ts',
    find: '        if (left) return committed;',
    replace: '        void left;',
    caughtBy: 'packages/runtime/test/locale-change-interruptions.test.ts',
  },
  {
    id: 'initialization-recorded-after-its-sink-is-told',
    invariant:
      'An initialization asked for from the sink that is told one started is answered with the attempt in flight.',
    source: 'packages/runtime/src/localization.ts',
    find: '    this.initialization = initialization;\n',
    replace:
      '    queueMicrotask(() => {\n      this.initialization = initialization;\n    });\n',
    caughtBy: 'packages/runtime/test/initialization-reentry.test.ts',
  },
  {
    id: 'destroyed-context-reports-a-scope-as-it-was',
    invariant:
      'A scope of a destroyed context reads as failed with the disposed failure, not as the readiness it had.',
    source: 'packages/runtime/src/localization.ts',
    find: '    this.disposedWith.set(reason.diagnostic);',
    replace: '    void reason;',
    caughtBy: 'packages/runtime/test/context-disposal.test.ts',
  },
  {
    id: 'unreadable-recovery-message-replaces-the-failure',
    invariant:
      'A recovery message that cannot be evaluated is left out, and the initialization still ends with the failure that stopped it.',
    source: 'packages/runtime/src/localization.ts',
    find: '      return this.recoveryText(identity, targetLocale);\n    } catch (error: unknown) {',
    replace:
      '      return this.recoveryText(identity, targetLocale);\n    } catch (error: unknown) {\n      if (error !== undefined) throw error;',
    caughtBy: 'packages/runtime/test/recovery-payload-representations.test.ts',
  },
  {
    id: 'participant-cancellation-stops-at-preparation',
    invariant:
      "A change that is abandoned after its required participants prepared still reaches each one's signal, and none of them is then asked to commit.",
    source: 'packages/runtime/src/participant-runtime.ts',
    find: '        signalValue,\n        cohort.signal,\n      ]).catch((error: unknown) => {',
    replace:
      '        cohort.signal,\n      ]).catch((error: unknown) => {\n        void signalValue;',
    caughtBy: 'packages/runtime/test/participant-cohort-preparation.test.ts',
  },
  {
    id: 'participant-hook-promise-unreported',
    invariant:
      'A rollback, discard or disposal that answers with a promise is reported as a contract rejection naming the participant.',
    source: 'packages/runtime/src/participant-runtime.ts',
    find: '    if (asyncCallbackRejected(answer) && this.refused !== undefined) {',
    replace:
      '    if ((false as boolean) && this.refused !== undefined) {\n      void answer;',
    caughtBy: 'packages/runtime/test/participant-hook-answers.test.ts',
  },
  {
    id: 'participant-report-extra-fields-admitted',
    invariant:
      'A participant answer carrying a field its status does not name is refused, so a consumer payload has no way into the transaction.',
    source: 'packages/runtime/src/participant-runtime.ts',
    find: "      if (!keysWithin(value, ['status', 'representation', 'identity'])) {",
    replace: '      if (!keysWithin(value, Object.keys(value))) {',
    caughtBy: 'packages/runtime/test/participant-own-language.test.ts',
  },
  {
    id: 'progressive-region-failure-escapes',
    invariant:
      "A progressive region's failure is recorded in that region's state and goes no further.",
    source: 'packages/runtime/src/participant-runtime.ts',
    find: '      this.commitPrepared([prepared]);\n    } catch {\n      // Independent regional outcomes are exposed through participant state.\n    }',
    replace:
      '      this.commitPrepared([prepared]);\n    } catch (error: unknown) {\n      throw error;\n    }',
    caughtBy: 'packages/runtime/test/progressive-region-failure.test.ts',
  },
  {
    id: 'progressive-region-relabelled-as-the-page',
    invariant:
      'A region keeps the language and direction it reported, rather than being relabelled as the locale it was asked for.',
    source: 'packages/runtime/src/participant-runtime.ts',
    find: '        const current = Object.freeze({\n          targetLocale: item.context.targetLocale,\n          transitionId: item.context.transitionId,\n          report: item.report,\n        });',
    replace:
      "        const current = Object.freeze({\n          targetLocale: item.context.targetLocale,\n          transitionId: item.context.transitionId,\n          report: item.report.status === 'ready'\n            ? Object.freeze({\n                ...item.report,\n                representation: Object.freeze({\n                  kind: 'locale-bound' as const,\n                  supplyingLocale: item.context.targetLocale,\n                  direction: directionForLocale(item.context.targetLocale),\n                }),\n              })\n            : item.report,\n        });",
    caughtBy: 'packages/runtime/test/participant-own-language.test.ts',
  },
  {
    id: 'provider-file-evaluated-to-read-routing',
    invariant:
      'The routing declaration is read from the provider file source, and no consumer code is run to obtain it.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '  for (const sourceFile of program.getSourceFiles()) {\n    const normalized = normalizePath(sourceFile.fileName);',
    replace:
      "  for (const sourceFile of program.getSourceFiles()) {\n    if (!sourceFile.isDeclarationFile && sourceFile.text.includes('withRouting(')) {\n      new Function('require', 'exports', ts.transpileModule(sourceFile.text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(() => ({ withRouting: (options: unknown) => options }), {});\n    }\n    const normalized = normalizePath(sourceFile.fileName);",
    caughtBy: 'packages/toolkit/test/route-data-reading.test.ts',
  },
  {
    id: 'request-origin-read-from-a-forwarding-header',
    invariant:
      'The handler resolves a request at the origin its adapter was configured with, never at one a request header names.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '        origin: url.origin,',
    replace:
      "        origin: `https://${request.headers.get('x-forwarded-host') ?? url.host}`,",
    caughtBy: 'packages/runtime/test/forged-host.test.ts',
  },
  {
    id: 'route-projection-follows-file-order',
    invariant:
      'The route projection is ordered by source position, so the order the compiler reads files in never changes it.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '  routes.sort((left, right) =>',
    replace: '  routes.slice().sort((left, right) =>',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'written-out-policy-table-read-unchecked',
    invariant:
      'A policy written out as an object is held to the tables a constructor writes, so a prefix table that reads a prefix as another locale is refused wherever the policy is read.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '        ownEntry(prefixTable, prefix) !== locale',
    replace: '        false',
    caughtBy: 'packages/runtime/test/written-out-locale-policies.test.ts',
  },
  {
    id: 'locale-that-is-not-text-read-as-a-tag',
    invariant:
      'A policy constructor refuses an empty slot in a list of locales, and a locale that is not text, as a configuration error.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (typeof value !== 'string') {\n    return routeError(\n      'A route locale that is not text is invalid.',",
    replace:
      "  if (value === 0) {\n    return routeError(\n      'A route locale that is not text is invalid.',",
    caughtBy: 'packages/runtime/test/policy-list-empty-slot.test.ts',
  },
  {
    id: 'roots-list-empty-slot-read-as-text',
    invariant:
      'An empty slot in a list of locale-neutral roots is refused, and is not read as the path segment its spelling would be.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    typeof value === 'string' &&\n    /^[a-z0-9](?:[a-z0-9-]",
    replace: '    /^[a-z0-9](?:[a-z0-9-]',
    caughtBy: 'packages/runtime/test/neutral-roots-empty-slot.test.ts',
  },
  {
    id: 'identifier-codec-throws-on-a-refused-value',
    invariant:
      'The identifier codec declines a value its pattern refuses by writing nothing, and does not throw.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    serialize: (value: string) => (pattern.test(value) ? value : undefined),',
    replace:
      "    serialize: (value: string) => {\n      if (!pattern.test(value)) throw new Error('refused');\n      return value;\n    },",
    caughtBy: 'packages/runtime/test/built-in-codecs-decline.test.ts',
  },
  {
    id: 'integer-codec-throws-on-a-refused-value',
    invariant:
      'The integer codec declines a value outside its range by writing nothing, and does not throw.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '        ? String(value)\n        : undefined,',
    replace:
      "        ? String(value)\n        : routeError('An integer route parameter is outside its codec range.'),",
    caughtBy: 'packages/runtime/test/built-in-codecs-decline.test.ts',
  },
  {
    id: 'option-of-another-kind-read-as-an-object',
    invariant:
      'An option declared as an object is refused as a configuration error when it is given a value of another kind.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (typeof given !== 'object' || given === null || Array.isArray(given)) {\n    return routeError(",
    replace: "  if (typeof given === 'symbol') {\n    return routeError(",
    caughtBy: 'packages/runtime/test/options-of-another-kind.test.ts',
  },
  {
    id: 'option-of-another-kind-called-as-a-function',
    invariant:
      'An option declared as a function is refused as a configuration error when it is given a value of another kind.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (typeof value !== 'function') {\n    return routeError(",
    replace: "  if (typeof value === 'symbol') {\n    return routeError(",
    caughtBy: 'packages/runtime/test/options-of-another-kind.test.ts',
  },
  {
    id: 'option-of-another-kind-written-as-text',
    invariant:
      'An option declared as text is refused as a configuration error when it is given a value of another kind.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (typeof value !== 'string') {\n    return routeError(\n      `${name} must be text",
    replace:
      "  if (typeof value === 'symbol') {\n    return routeError(\n      `${name} must be text",
    caughtBy: 'packages/runtime/test/options-of-another-kind.test.ts',
  },
  {
    id: 'option-outside-its-named-values-let-through',
    invariant:
      'An option declared as one of a set of named values is refused as a configuration error when it is given any other value.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (typeof value !== 'string' || !names.includes(value as Name)) {",
    replace: "  if (typeof value === 'symbol') {",
    caughtBy: 'packages/runtime/test/options-of-another-kind.test.ts',
  },
  {
    id: 'observability-sink-of-another-kind-stored',
    invariant:
      'An observability sink that is not an object with an emit function is refused as a configuration error where it is handed over.',
    source: 'packages/runtime/src/observability.ts',
    find: "  refuseSinkOfAnotherKind(sink, 'The observability sink');",
    replace: '  void 0;',
    caughtBy: 'packages/runtime/test/options-of-another-kind.test.ts',
  },
  {
    id: 'option-of-another-kind-read-as-a-list',
    invariant:
      'An option declared as a list is refused as a configuration error when it is given a value of another kind.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (!Array.isArray(value)) {\n    return routeError(',
    replace: "  if (typeof value === 'symbol') {\n    return routeError(",
    caughtBy: 'packages/runtime/test/options-of-another-kind.test.ts',
  },
  {
    id: 'written-out-policy-member-of-another-kind-read',
    invariant:
      'A policy written out with a member that belongs to another kind of policy is refused wherever the policy is read.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  for (const member of OTHER_KIND_MEMBERS[policy.kind]) {',
    replace:
      '  for (const member of OTHER_KIND_MEMBERS[policy.kind].slice(0, 0)) {',
    caughtBy: 'packages/runtime/test/policy-member-of-another-kind.test.ts',
  },
  {
    id: 'request-origin-that-is-not-text-ignored',
    invariant:
      'A request context whose origin is not text is refused, never read at the default origin.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (origin === undefined || typeof origin === 'string') return origin;",
    replace:
      "  if (true) return typeof origin === 'string' ? origin : undefined;",
    caughtBy: 'packages/runtime/test/request-context-locale.test.ts',
  },
  {
    id: 'route-matched-without-its-codec',
    invariant:
      'A route whose codec was removed from a projection after it was checked matches no address.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (codec === undefined) {\n        matched = false;',
    replace: '      if (codec === undefined) {\n        matched = true;',
    caughtBy: 'packages/runtime/test/path-prefix-resolution.test.ts',
  },
  {
    id: 'unserved-policy-kind-narrowed-anyway',
    invariant:
      'A locale URL policy of a kind Equator does not serve is refused where it is narrowed, naming the kinds that are served.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    kind !== 'locale-host'\n  ) {\n    routeError(",
    replace: "    kind !== 'locale-host' &&\n    false\n  ) {\n    routeError(",
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'unsupported-locale-remembered',
    invariant:
      'A response at an address naming a locale the site does not serve writes no locale cookie, because nothing was chosen there.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '    return resolution.locale;\n  }\n  return undefined;\n}',
    replace:
      "    return resolution.locale;\n  }\n  return 'presentationLocale' in resolution\n    ? resolution.presentationLocale\n    : undefined;\n}",
    caughtBy: 'packages/runtime/test/http-cookie-sync.test.ts',
  },
  {
    id: 'artifact-address-carries-the-application-fingerprint',
    invariant:
      "An artifact's address carries its own scope's contract fingerprint, so a contract change confined to another scope leaves it unchanged.",
    source: 'packages/toolkit/src/compiled-artifacts.ts',
    find: '    applicationContractFingerprint: scope.applicationContractFingerprint,',
    replace:
      '    applicationContractFingerprint: graph.applicationContractFingerprint,',
    caughtBy: 'packages/toolkit/test/artifact-identity-boundaries.test.ts',
  },
  {
    id: 'artifact-for-an-unconfigured-locale-admitted',
    invariant:
      'A generated set with an artifact for a locale the configuration does not ship is refused before anything is loaded.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '        !configuration.locales.includes(address.key.catalogLocale) ||',
    replace: '        false ||',
    caughtBy: 'packages/runtime/test/generated-set-admission.test.ts',
  },
  {
    id: 'artifact-without-a-loader-admitted',
    invariant:
      'A generated set with no loader for one of its artifacts is refused at construction rather than at the first load.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '        !hasOwn(loaders, key)\n      ) {',
    replace: '        false\n      ) {',
    caughtBy: 'packages/runtime/test/generated-set-admission.test.ts',
  },
  {
    id: 'blocking-decided-on-wording',
    invariant:
      'Whether diagnostics block a run is decided on severity alone; rewording a summary never changes it.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: "  return diagnostics.some(({ severity }) => severity === 'error');",
    replace:
      "  return diagnostics.some(({ severity, summary }) => severity === 'error' || /fatal/iu.test(summary));",
    caughtBy: 'packages/toolkit/test/gate-exit-code.test.ts',
  },
  {
    id: 'catalog-admitted-under-another-standards-profile',
    invariant:
      'A loaded catalog whose standards profile differs from its address is refused as malformed before its digest is computed.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '      received.standardsProfile !== artifact.address.standardsProfile ||',
    replace: '      false ||',
    caughtBy: 'packages/runtime/test/artifact-standards-profile.test.ts',
  },
  {
    id: 'catalog-digest-not-recomputed',
    invariant:
      'A catalog edited after compilation is refused by its content digest even when its measured size is unchanged.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '      (await digestCanonicalCatalog(catalog)) !== artifact.address.contentDigest',
    replace: '      false',
    caughtBy: 'packages/runtime/test/catalog-identity-over-the-value.test.ts',
  },
  {
    id: 'catalog-load-failure-miscoded',
    invariant:
      'A catalog loader that rejects is reported as catalog-load-failed with reason module-load-failed.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "            'catalog-load-failed',\n            'A generated local catalog module could not be loaded.',",
    replace:
      "            'catalog-admission-failed',\n            'A generated local catalog module could not be loaded.',",
    caughtBy: 'packages/runtime/test/failed-load-is-not-retried.test.ts',
  },
  {
    id: 'catalog-load-reaches-the-network',
    invariant:
      'Loading a catalog calls the generated loader and nothing else: no network request, no persistent store.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '      .then(() => (this.loaders[key] as () => unknown)())',
    replace:
      '      .then(() => globalThis.fetch(artifact.modulePath))\n      .then(() => (this.loaders[key] as () => unknown)())',
    caughtBy: 'packages/runtime/test/loader-needs-no-service.test.ts',
  },
  {
    id: 'catalog-message-record-open',
    invariant:
      'A catalog message record is closed, so a field that could carry a handler or an import is refused where it is written.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "const messageRecordSchema = {\n  type: 'object',\n  additionalProperties: false,",
    replace: "const messageRecordSchema = {\n  type: 'object',",
    caughtBy: 'packages/toolkit/test/catalog-carries-no-code.test.ts',
  },
  {
    id: 'catalog-set-identity-spans-providers',
    invariant:
      "Each provider's catalog-set identity is taken over that provider's own artifact addresses, so a change to another provider leaves it unchanged.",
    source: 'packages/toolkit/src/compiled-artifacts.ts',
    find: '        artifacts.map(({ address }) => addressIdentityJson(address)),',
    replace:
      '        catalogs.map((catalog) => addressIdentityJson(artifactAddress(catalog))),',
    caughtBy: 'packages/toolkit/test/artifact-identity-boundaries.test.ts',
  },
  {
    id: 'catalog-top-level-not-exact',
    invariant:
      'A loaded catalog whose top level is not exactly the fields its schema names is refused as malformed, before its digest is computed.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '      !hasExactKeys(received as unknown',
    replace: '      false && !hasExactKeys(received as unknown',
    caughtBy: 'packages/runtime/test/catalog-top-level-fields.test.ts',
  },
  {
    id: 'descriptor-admits-another-standards-profile',
    invariant:
      'A generated set whose descriptor names a standards profile other than equator-1 is refused when the catalog store is built.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "        address.standardsProfile !== 'equator-1' ||",
    replace: '        false ||',
    caughtBy: 'packages/runtime/test/artifact-standards-profile.test.ts',
  },
  {
    id: 'descriptor-array-read-through-accessors',
    invariant:
      "An extension descriptor array's entries are read from their property descriptors, so a getter in one is refused without running.",
    source: 'packages/toolkit/src/extensions.ts',
    find: "        if (descriptor === undefined || !('value' in descriptor)) {\n          throw new TypeError(\n            'Extension descriptor arrays cannot contain accessors.',\n          );\n        }\n        return portableSnapshot(descriptor.value, seen, depth + 1, budget);",
    replace:
      '        void descriptor;\n        return portableSnapshot(\n          (value as unknown[])[Number(key)],\n          seen,\n          depth + 1,\n          budget,\n        );',
    caughtBy: 'packages/toolkit/test/descriptor-read-as-data.test.ts',
  },
  {
    id: 'descriptor-record-read-through-accessors',
    invariant:
      "An extension descriptor's fields are read from their property descriptors, so a getter in one is refused without running.",
    source: 'packages/toolkit/src/extensions.ts',
    find: "    if (!descriptor.enumerable || !('value' in descriptor)) {\n      throw new TypeError(\n        'Extension descriptor records cannot contain hidden fields or accessors.',\n      );\n    }\n    Object.defineProperty(output, key, {\n      configurable: false,\n      enumerable: true,\n      value: portableSnapshot(descriptor.value, seen, depth + 1, budget),",
    replace:
      '    void descriptor;\n    Object.defineProperty(output, key, {\n      configurable: false,\n      enumerable: true,\n      value: portableSnapshot(\n        (value as Record<string, unknown>)[key],\n        seen,\n        depth + 1,\n        budget,\n      ),',
    caughtBy: 'packages/toolkit/test/descriptor-read-as-data.test.ts',
  },
  {
    id: 'descriptor-registry-fingerprint-unchecked',
    invariant:
      "A descriptor whose semantic-registry fingerprint differs from the generated configuration's is refused.",
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '    descriptor.semanticRegistryFingerprint !==\n      configuration.semanticRegistryFingerprint',
    replace: '    false',
    caughtBy: 'packages/runtime/test/generated-set-admission.test.ts',
  },
  {
    id: 'diagnostic-identifier-controls-kept',
    invariant:
      'A control or bidirectional-override character in an identifier that reaches a diagnostic is replaced with U+FFFD.',
    source: 'packages/runtime/src/runtime-safety.ts',
    find: "      ? '\\ufffd'\n      : character;",
    replace: '      ? character\n      : character;',
    caughtBy: 'packages/runtime/test/diagnostic-identifier-bounds.test.ts',
  },
  {
    id: 'diagnostic-identifier-unbounded',
    invariant:
      'An identifier that reaches a diagnostic is cut at diagnosticIdentifierCodePoints and marked with an ellipsis.',
    source: 'packages/runtime/src/runtime-safety.ts',
    find: '    if (count >= maximum) {',
    replace: '    if (count >= Infinity) {',
    caughtBy: 'packages/runtime/test/diagnostic-identifier-bounds.test.ts',
  },
  {
    id: 'extension-id-without-a-namespace',
    invariant:
      'An extension function identity without a provider namespace is refused by the registry schema.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "  pattern: '^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,63}$',",
    replace: "  pattern: '^(?:[a-z][a-z0-9-]{0,31}:)?[a-z][a-z0-9-]{0,63}$',",
    caughtBy: 'packages/toolkit/test/extension-namespace.test.ts',
  },
  {
    id: 'failed-catalog-load-retried',
    invariant:
      'A loader that fails is reported after one call; the store has no retry behind the loader contract.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "      .catch((cause: unknown) => {\n        throw new LocalizationError(\n          operationalDiagnostic(\n            'catalog-load-failed',",
    replace:
      "      .catch(() => (this.loaders[key] as () => unknown)())\n      .catch((cause: unknown) => {\n        throw new LocalizationError(\n          operationalDiagnostic(\n            'catalog-load-failed',",
    caughtBy: 'packages/runtime/test/failed-load-is-not-retried.test.ts',
  },
  {
    id: 'function-from-another-edition-admitted',
    invariant:
      'The message function profile is exactly the ten functions LDML 48.2 defines, so a function from another edition is refused at authoring.',
    source: 'packages/toolkit/src/message-format.ts',
    find: "      ['time', 'draft', 'none'],\n    ].map(",
    replace:
      "      ['time', 'draft', 'none'],\n      ['relativetime', 'draft', 'none'],\n    ].map(",
    caughtBy: 'packages/toolkit/test/pinned-function-profile.test.ts',
  },
  {
    id: 'in-flight-catalog-load-not-joined',
    invariant:
      'A second request for a catalog already loading joins the first load instead of starting another.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '    if (existing !== undefined) return existing;',
    replace: '    void existing;',
    caughtBy: 'packages/runtime/test/in-flight-load-is-joined.test.ts',
  },
  {
    id: 'inert-snapshot-admits-a-function',
    invariant:
      'The inert snapshot refuses a function wherever it appears, so an artifact cannot supply an implementation.',
    source: 'packages/runtime/src/runtime-safety.ts',
    find: "    if (typeof value !== 'object') {\n      throw new TypeError('Only inert JSON data is admitted.');",
    replace:
      "    if (typeof value === 'function') return value;\n    if (typeof value !== 'object') {\n      throw new TypeError('Only inert JSON data is admitted.');",
    caughtBy: 'packages/runtime/test/catalog-carries-no-code.test.ts',
  },
  {
    id: 'loader-accessor-admitted',
    invariant:
      'A loader-map entry that is an accessor is refused, and its getter is never called.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "    if (typeof property.value !== 'function') {\n      throw new LocalizationError(\n        operationalDiagnostic(\n          'invalid-configuration',\n          'Generated catalog loaders must contain only data functions.',\n        ),\n      );\n    }\n    copied[identity] = property.value as () => unknown;",
    replace:
      "    if (typeof candidate[identity] !== 'function') {\n      throw new LocalizationError(\n        operationalDiagnostic(\n          'invalid-configuration',\n          'Generated catalog loaders must contain only data functions.',\n        ),\n      );\n    }\n    void property;\n    copied[identity] = candidate[identity] as () => unknown;",
    caughtBy: 'packages/runtime/test/loader-map-copy.test.ts',
  },
  {
    id: 'loader-map-held-by-reference',
    invariant:
      'The store keeps its own copy of the loader map, so an entry replaced after construction does not run.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '  return Object.freeze(copied);',
    replace: '  void copied;\n  return candidate;',
    caughtBy: 'packages/runtime/test/loader-map-copy.test.ts',
  },
  {
    id: 'malformed-content-digest-admitted',
    invariant:
      'An artifact whose content digest is not sha256- and 43 base64url characters is refused.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '        !/^sha256-[A-Za-z0-9_-]{43}$/u.test(address.contentDigest) ||',
    replace: '        false ||',
    caughtBy: 'packages/runtime/test/generated-set-admission.test.ts',
  },
  {
    id: 'matching-digest-admits-without-structure',
    invariant:
      'A candidate whose digest matches its address is still refused when its structure is invalid, because a digest proves byte identity and nothing more.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '    const received = snapshot.value as unknown as AsReceived<',
    replace:
      '    if (\n      (await digestCanonicalCatalog(snapshot.value)) ===\n      artifact.address.contentDigest\n    ) {\n      return snapshot.value as unknown as CompiledCatalog;\n    }\n    const received = snapshot.value as unknown as AsReceived<',
    caughtBy: 'packages/runtime/test/digest-proves-only-identity.test.ts',
  },
  {
    id: 'owner-identity-follows-the-scopes',
    invariant:
      'The owner identity a compilation records depends on the provider and generated root only, so adding a scope does not change it.',
    source: 'packages/toolkit/src/compiled-artifacts.ts',
    find: '  const ownerId = generatedOwnerId(request.owner);',
    replace:
      '  const ownerId = generatedOwnerId({\n    ...request.owner,\n    generatedRootPath: `${request.owner.generatedRootPath}#${request.catalogs.length}`,\n  });',
    caughtBy: 'packages/toolkit/test/no-second-record.test.ts',
  },
  {
    id: 'percent-scale-guessed-from-magnitude',
    invariant:
      'A percentage is converted by the scale its value declares, never by how large the amount is.',
    source: 'packages/runtime/src/formatting.ts',
    find: "    value.scale === 'fractional' ? value.amount : divideByHundred(value.amount);",
    replace:
      '    Number(value.amount.value) > 1\n      ? divideByHundred(value.amount)\n      : value.amount;',
    caughtBy: 'packages/runtime/test/percent-scale.test.ts',
  },
  {
    id: 'percentage-points-coerced-into-percent',
    invariant:
      'A percentage-points value handed to a :percent placeholder is refused, never read as a proportion.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    const value = record[contract.name];\n    if (!isValidInput(value, contract)) {',
    replace:
      "    const given = record[contract.name];\n    const value =\n      isRecord(given) && given['kind'] === 'percentage-points'\n        ? Number((given['amount'] as { readonly value: string }).value)\n        : given;\n    if (!isValidInput(value, contract)) {",
    caughtBy: 'packages/runtime/test/percentage-points-are-not-percent.test.ts',
  },
  {
    id: 'repeated-catalog-identity-admitted',
    invariant:
      'Two artifacts claiming one catalog identity are refused rather than one replacing the other.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '        artifacts.has(key) ||',
    replace: '        false ||',
    caughtBy: 'packages/runtime/test/generated-set-admission.test.ts',
  },
  {
    id: 'thenable-extension-result-admitted',
    invariant:
      'An extension handler result that is a thenable is refused as an invalid or unbounded result.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "        typeof (result as { readonly then?: unknown }).then === 'function'",
    replace: '        false',
    caughtBy: 'packages/runtime/test/message-function-extensions.test.ts',
  },
  {
    id: 'toolkit-import-installs-a-hook',
    invariant: 'Importing the toolkit API installs no process listener.',
    source: 'packages/toolkit/src/index.ts',
    find: "export { formatCatalog, parseCatalog } from './catalog.js';",
    replace:
      "process.once('exit', () => undefined);\nexport { formatCatalog, parseCatalog } from './catalog.js';",
    caughtBy: 'packages/toolkit/test/import-is-inert.test.ts',
  },
  {
    id: 'toolkit-import-sets-exit-code',
    invariant: 'Importing the toolkit API leaves process.exitCode as it was.',
    source: 'packages/toolkit/src/index.ts',
    find: "export { formatCatalog, parseCatalog } from './catalog.js';",
    replace:
      "process.exitCode = 0;\nexport { formatCatalog, parseCatalog } from './catalog.js';",
    caughtBy: 'packages/toolkit/test/import-is-inert.test.ts',
  },
  {
    id: 'toolkit-imports-a-private-compiler-symbol',
    invariant:
      'The toolkit imports no ɵ-prefixed name from @angular/compiler or typescript.',
    source: 'packages/toolkit/src/host-compatibility.ts',
    find: "import { VERSION as angularCompilerVersion } from '@angular/compiler';",
    replace:
      "import { VERSION as angularCompilerVersion, ɵgetDOM } from '@angular/compiler';\nvoid ɵgetDOM;",
    caughtBy: 'packages/toolkit/test/compiler-host-public-api.test.ts',
  },
  {
    id: 'toolkit-imports-below-a-compiler-root',
    invariant:
      'The toolkit imports @angular/compiler and typescript only at their package roots.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "import ts from 'typescript';",
    replace:
      "import ts from 'typescript';\nimport 'typescript/lib/tsserverlibrary.js';",
    caughtBy: 'packages/toolkit/test/compiler-host-public-api.test.ts',
  },
  {
    id: 'unbounded-extension-result-admitted',
    invariant:
      "An extension handler result longer than its descriptor's maximumOutputLength is refused.",
    source: 'packages/runtime/src/evaluator.ts',
    find: "        codePointLengthAtMost(\n          result['text'],\n          binding.descriptor.maximumOutputLength,\n        ) === undefined ||",
    replace: '        false ||',
    caughtBy: 'packages/runtime/test/message-function-extensions.test.ts',
  },
  {
    id: 'unsupported-artifact-feature-admitted',
    invariant:
      'A generated set whose artifact requires a feature this release does not support is refused.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '        address.requiredFeatures.some(\n          (feature) => !supportedArtifactFeatures.has(feature),\n        ) ||',
    replace: '        false ||',
    caughtBy: 'packages/runtime/test/generated-set-admission.test.ts',
  },
  {
    id: 'untranslated-scope-reported-as-load-failure',
    invariant:
      'A scope with no artifact in a locale is reported unavailable, never as a catalog that failed to load.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "    code: 'scope-unavailable',\n    outcome: 'localized-representation-unavailable',",
    replace:
      "    code: 'catalog-load-failed',\n    outcome: 'operational-failure',",
    caughtBy:
      'packages/runtime/test/untranslated-scope-is-not-a-failure.test.ts',
  },
  {
    id: 'xliff-depth-ceiling-lifted',
    invariant:
      'An XLIFF document nested past xliffDepth is refused at the depth ceiling.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '      if (stack.length + 1 > RESOURCE_LIMITS.xliffDepth)',
    replace: '      if (false)',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'xliff-dtd-admitted',
    invariant:
      'An XLIFF document carrying a DTD or entity declaration is refused by the DTD rule, not merely by a later element-name rule.',
    source: 'packages/toolkit/src/xliff.ts',
    find: "    if (document.startsWith('<!', index) || document.startsWith('<?', index)) {",
    replace: "    if (document.startsWith('<?', index)) {",
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'xliff-node-ceiling-lifted',
    invariant:
      'An XLIFF document with more than xliffNodes nodes is refused at the node ceiling.',
    source: 'packages/toolkit/src/resource-limits.ts',
    find: '  xliffNodes: 250_000,',
    replace: '  xliffNodes: Number.POSITIVE_INFINITY,',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'xliff-undeclared-entity-admitted',
    invariant:
      'An entity reference outside the XML predefined set and character references is refused rather than passed through.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '  if (/&(?!#x[0-9A-Fa-f]+;|#[0-9]+;|amp;|lt;|gt;|quot;|apos;)/u.test(value)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'xliff-unit-identity-trusted',
    invariant:
      "An XLIFF unit whose contract carries an identity other than the source catalog's for that message is reported with EQ1803 and not imported.",
    source: 'packages/toolkit/src/xliff.ts',
    find: '      contract.identity !== messageIdentity(request.source, contract.messageId)',
    replace: '      false',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'ambiguous-discovery-picks-the-nearest',
    invariant:
      'Upward configuration discovery that finds more than one candidate within the package fails with EQ1702 naming every candidate.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "  if (within.length > 1) return { outcome: 'many', candidates: within };",
    replace:
      "  if (within.length > 1) return { outcome: 'one', ownerRoot: within[0] as string };",
    caughtBy: 'packages/toolkit/test/configuration-discovery.test.ts',
  },
  {
    id: 'analysis-evaluates-application-modules',
    invariant:
      'Static analysis reads the application without evaluating any of its modules, getters, calls or decorators.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '  const program = ts.createProgram({\n    rootNames: request.rootNames.map((path) =>',
    replace:
      "  for (const name of request.rootNames) {\n    try {\n      const text = suppliedSources.get(normalizePath(name)) ?? readFileSync(name, 'utf8');\n      const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;\n      const messages = new Proxy({}, { get: () => ({ messageId: '' }) });\n      new Function('exports', 'require', output)({}, () => ({ messages }));\n    } catch {\n      // An evaluation that fails is still an evaluation.\n    }\n  }\n  const program = ts.createProgram({\n    rootNames: request.rootNames.map((path) =>",
    caughtBy: 'packages/toolkit/test/analysis-executes-nothing.test.ts',
  },
  {
    id: 'authored-digits-inspected',
    invariant:
      'Digits inside an authored catalog value are neither reported nor rewritten between the catalog and the compiled output.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '      const violation = inspectAuthoredBidi(value);',
    replace:
      "      const violation = inspectAuthoredBidi(value);\n      if (/\\p{Nd}{3,}/u.test(value)) {\n        diagnostics.push(\n          yamlDiagnostic(\n            source,\n            sourcePath,\n            'EQ1103',\n            'Equator catalog text carries digits a locale would render in its own numbering system.',\n            { node, path },\n          ),\n        );\n      }",
    caughtBy: 'packages/toolkit/test/authored-digits.test.ts',
  },
  {
    id: 'cached-state-reaches-the-output',
    invariant:
      'Generated output is byte-identical whether or not a work root with earlier compiler state was present.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '    contractFiles: contracts.value,',
    replace:
      '    contractFiles:\n      request.previousState === undefined\n        ? contracts.value\n        : contracts.value.map((file, index) =>\n            index === 0\n              ? { ...file, contents: `${file.contents}// ${request.previousState?.outputPlanDigest}\\n` }\n              : file,\n          ),',
    caughtBy: 'packages/toolkit/test/work-root-determinism.test.ts',
  },
  {
    id: 'catalog-discovery-reads-build-output',
    invariant:
      'Catalogs are discovered only in the owner catalog directory; catalog-shaped files in build output, dependencies or a nested project are never read.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  const scopeEntries = await readdir(catalogRoot, { withFileTypes: true });\n  scopeEntries.sort((left, right) => compareCodeUnit(left.name, right.name));\n  for (const scopeEntry of scopeEntries) {\n    if (scopeEntry.isSymbolicLink() || !scopeEntry.isDirectory()) {\n      diagnostics.push(\n        projectDiagnostic(\n          `Equator catalog root contains unsupported entry ${JSON.stringify(scopeEntry.name)}.`,\n        ),\n      );\n      continue;\n    }\n    const scopeRoot = resolve(catalogRoot, scopeEntry.name);',
    replace:
      "  const scopeEntries = (\n    await Promise.all(\n      ['i18n', 'dist/i18n', 'dist/browser/i18n'].map((root) =>\n        readdir(resolve(location.ownerRoot, ...root.split('/')), {\n          withFileTypes: true,\n        }).catch(() => []),\n      ),\n    )\n  ).flat();\n  scopeEntries.sort((left, right) => compareCodeUnit(left.name, right.name));\n  for (const scopeEntry of scopeEntries) {\n    if (scopeEntry.isSymbolicLink() || !scopeEntry.isDirectory()) {\n      diagnostics.push(\n        projectDiagnostic(\n          `Equator catalog root contains unsupported entry ${JSON.stringify(scopeEntry.name)}.`,\n        ),\n      );\n      continue;\n    }\n    const scopeRoot = resolve(scopeEntry.parentPath, scopeEntry.name);",
    caughtBy: 'packages/toolkit/test/catalog-discovery-exclusions.test.ts',
  },
  {
    id: 'check-fix-drops-a-message',
    invariant:
      'check --fix rewrites an authored catalog only when the rewritten text parses to the same catalog model.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    const contents = formatted.value;\n    const roundTrip = parseCatalog(contents, catalogOptions);\n    if (\n      !roundTrip.ok ||\n      JSON.stringify(roundTrip.value) !== JSON.stringify(file.catalog)\n    ) {',
    replace:
      "    const contents = formatted.value.replace(/\\n[^\\n]*\\n$/u, '\\n');\n    const roundTrip = parseCatalog(contents, catalogOptions);\n    if (\n      !roundTrip.ok\n    ) {",
    caughtBy: 'packages/toolkit/test/check-fix-preserves-semantics.test.ts',
  },
  {
    id: 'cli-answer-differs-from-the-api',
    invariant:
      'The command line reports the diagnostics and plan the programmatic API returns for the same project, because both run the same core.',
    source: 'packages/toolkit/src/cli.ts',
    find: '    unique.set(diagnosticKey(diagnostic), diagnostic);',
    replace:
      "    if (diagnostic.severity === 'info') continue;\n    unique.set(diagnosticKey(diagnostic), diagnostic);",
    caughtBy: 'packages/toolkit/test/cli-surface-agreement.test.ts',
  },
  {
    id: 'compiler-cache-carries-a-timestamp',
    invariant: 'No file in the work root carries a timestamp.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    stateDigest,\n    state,\n  });\n  return `${JSON.stringify(envelope, null, 2)}\\n`;',
    replace:
      '    stateDigest,\n    state,\n    writtenAt: new Date().toISOString(),\n  });\n  return `${JSON.stringify(envelope, null, 2)}\\n`;',
    caughtBy: 'packages/toolkit/test/work-root-determinism.test.ts',
  },
  {
    id: 'compiler-cache-carries-the-owner-root',
    invariant: "No file in the work root carries the owner's absolute path.",
    source: 'packages/toolkit/src/project-host.ts',
    find: '  const contents = compilerCacheContents(ownerId, state);',
    replace:
      '  const contents = compilerCacheContents(ownerId, {\n    ...state,\n    ownerRoot: project.ownerRoot,\n  } as CompilerState);',
    caughtBy: 'packages/toolkit/test/work-root-determinism.test.ts',
  },
  {
    id: 'compiler-core-schedules-work',
    invariant:
      'Nothing the compiler core can run reaches process state, the network, a filesystem write, a timer or a watch.',
    source: 'packages/toolkit/src/output-plan.ts',
    find: '  const exact = new Set<string>();\n',
    replace:
      '  const exact = new Set<string>();\n  setTimeout(() => undefined, 0);\n',
    caughtBy: 'packages/toolkit/test/compiler-core-isolation.test.ts',
  },
  {
    id: 'duplicate-catalog-identity-accepted',
    invariant:
      'Two catalogs with one provider, scope and locale fail the compilation, whichever arrives first.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      if (first !== undefined) {',
    replace: '      if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/catalog-discovery-exclusions.test.ts',
  },
  {
    id: 'empty-project-generation-refused',
    invariant:
      'Generation on a project with no catalogs succeeds and reports only an info note naming where the first catalog goes.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "for example i18n/shell/${configuration.sourceLocale}.yaml.`,\n            'info',",
    replace:
      "for example i18n/shell/${configuration.sourceLocale}.yaml.`,\n            'error',",
    caughtBy: 'packages/toolkit/test/first-run-sequence.test.ts',
  },
  {
    id: 'exported-message-group-counts-as-use',
    invariant:
      'Exporting a message group, by name, by re-export or as a default, is not a reachability root.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '          ts.isArrayLiteralExpression(node.parent);',
    replace:
      '          ts.isArrayLiteralExpression(node.parent) ||\n          ts.isExportAssignment(node.parent) ||\n          ts.isExportSpecifier(node.parent);',
    caughtBy: 'packages/toolkit/test/public-export-not-a-root.test.ts',
  },
  {
    id: 'extension-descriptor-accessor-invoked',
    invariant:
      'A programmatic extension descriptor is read as inert data: an accessor on it is refused without being called.',
    source: 'packages/toolkit/src/extensions.ts',
    find: '    snapshot = portableSnapshot(inputs);',
    replace:
      '    snapshot = JSON.parse(JSON.stringify(inputs)) as CanonicalJsonValue;',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'extension-descriptor-carries-its-own-fingerprint',
    invariant:
      'An extension descriptor that carries a fingerprint of its own is refused; the fingerprint is always derived.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "            additionalProperties: false,\n            required: [\n              'kind',\n              'id',\n              'operandType',",
    replace:
      "            additionalProperties: true,\n            required: [\n              'kind',\n              'id',\n              'operandType',",
    caughtBy: 'packages/toolkit/test/extension-descriptor-authority.test.ts',
  },
  {
    id: 'generated-module-imports-a-sibling-relatively',
    invariant:
      'Generated modules reach one another through the #i18n import base, never a relative path or a compiler-only alias.',
    source: 'packages/toolkit/src/generated-contracts.ts',
    find: '    "import { catalogSet } from \'#i18n/catalog-set\';",',
    replace: '    "import { catalogSet } from \'./catalog-set\';",',
    caughtBy: 'packages/toolkit/test/generated-import-base.test.ts',
  },
  {
    id: 'human-column-zero-based',
    invariant:
      'A human diagnostic position is the machine span start plus one, in line and column.',
    source: 'packages/toolkit/src/cli.ts',
    find: '          diagnostic.span.start.column + 1',
    replace: '          diagnostic.span.start.column',
    caughtBy: 'packages/toolkit/test/cli-streams-prompts-interruption.test.ts',
  },
  {
    id: 'human-diagnostics-on-stdout',
    invariant:
      'Human diagnostics are written to standard error, never to standard output.',
    source: 'packages/toolkit/src/cli.ts',
    find: '      process.stderr.write(humanDiagnostic(diagnostic));\n    // The success lines',
    replace:
      '      process.stdout.write(humanDiagnostic(diagnostic));\n    // The success lines',
    caughtBy: 'packages/toolkit/test/cli-streams-prompts-interruption.test.ts',
  },
  {
    id: 'init-adds-a-lifecycle-script',
    invariant:
      'init adds only equator:* commands to package.json scripts and no install, publish, pre or post hook.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "  'equator:watch': 'equator watch',\n});",
    replace:
      "  'equator:watch': 'equator watch',\n  prebuild: 'equator generate',\n});",
    caughtBy: 'packages/toolkit/test/init-leaves-the-build-alone.test.ts',
  },
  {
    id: 'init-asks-a-fifth-question',
    invariant:
      'Interactive init asks exactly the source locale, the default locale, the supported locales and the aliases, in that order.',
    source: 'packages/toolkit/src/cli.ts',
    find: '    const aliases =\n      aliasText.length === 0',
    replace:
      "    await prompt.question('Fallback locale: ');\n    const aliases =\n      aliasText.length === 0",
    caughtBy: 'packages/toolkit/test/cli-streams-prompts-interruption.test.ts',
  },
  {
    id: 'init-prompts-off-a-terminal',
    invariant:
      'A bare equator init prompts only when standard input and standard error are both terminals; otherwise it asks nothing and fails with the complete invocation.',
    source: 'packages/toolkit/src/cli.ts',
    find: '  if (hasArguments || !process.stdin.isTTY || !process.stderr.isTTY) {',
    replace: '  if (hasArguments) {',
    caughtBy: 'packages/toolkit/test/cli-streams-prompts-interruption.test.ts',
  },
  {
    id: 'interchange-source-read-as-wording',
    invariant:
      'An imported interchange unit contributes its translation only; an edited source side is never read as catalog wording.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    const pattern = data === undefined ? undefined : patternText(target, data);',
    replace:
      "    const edited = childElements(segment, XLIFF_NAMESPACE, 'source')[0] ?? target;\n    const pattern = data === undefined ? undefined : patternText(edited, data);",
    caughtBy: 'packages/toolkit/test/interchange-authority.test.ts',
  },
  {
    id: 'interruption-after-failure',
    invariant:
      'An interrupted run answers 130 even when it had already failed.',
    source: 'packages/toolkit/src/cli.ts',
    find: '    if (wasInterrupted()) return 130;\n    if (!result.ok) return reportFailure(invocation, result.diagnostics);',
    replace:
      '    if (!result.ok) return reportFailure(invocation, result.diagnostics);\n    if (wasInterrupted()) return 130;',
    caughtBy: 'packages/toolkit/test/cli-streams-prompts-interruption.test.ts',
  },
  {
    id: 'invented-input-follows-completeness-policy',
    invariant:
      'Turning an opt-in completeness policy off, or on with a declaration, leaves a protected error at error.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "          `Target message ${JSON.stringify(messageId)} changes or invents input ${JSON.stringify(input.name)}.`,\n          ['messages', messageId],\n",
    replace:
      "          `Target message ${JSON.stringify(messageId)} changes or invents input ${JSON.stringify(input.name)}.`,\n          ['messages', messageId],\n          policy.severity,\n",
    caughtBy: 'packages/toolkit/test/protected-errors-under-policy.test.ts',
  },
  {
    id: 'lazy-route-table-loaded-to-read-it',
    invariant:
      'Route analysis follows a lazy loader through the program and never evaluates the route file it names.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '          lazyEntryFiles.add(target);',
    replace:
      "          lazyEntryFiles.add(target);\n          try {\n            new Function('exports', 'require', ts.transpileModule(target.text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)({}, () => ({}));\n          } catch {\n            // Loading the table is how its routes would be read.\n          }",
    caughtBy: 'packages/toolkit/test/route-code-not-executed.test.ts',
  },
  {
    id: 'machine-stdout-carries-human-text',
    invariant:
      'Under --json, standard output carries exactly one JSON document and nothing else.',
    source: 'packages/toolkit/src/cli.ts',
    find: '    writeMachineResult(invocation.command, exitCode, ordered, result);',
    replace:
      '    writeMachineResult(invocation.command, exitCode, ordered, result);\n    process.stdout.write(`${human}\\n`);',
    caughtBy: 'packages/toolkit/test/cli-streams-prompts-interruption.test.ts',
  },
  {
    id: 'manifest-read-once-during-inspection',
    invariant:
      'Output freshness rereads the completion manifest after inspecting the inventory and fails as stale (EQ1603) when it changed or vanished in between.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '  const confirmed = await readCurrentManifest(generatedRoot);',
    replace: '  const confirmed = current;',
    caughtBy: 'packages/toolkit/test/manifest-reread.test.ts',
  },
  {
    id: 'manifest-vouches-for-edited-output',
    invariant:
      'A generated file whose completion manifest agrees with it is still rewritten when it is not what the output plan produces.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '    else if (existing.digest !== file.digest || existing.bytes !== file.bytes) {',
    replace: '    else if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/first-generation-overlay.test.ts',
  },
  {
    id: 'nested-generated-and-work-roots-accepted',
    invariant:
      'The generated root and the work root are refused when one is, contains or lies inside the other.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '    generatedRoot === workRoot ||\n    containedPath(generatedRoot, workRoot) ||\n    containedPath(workRoot, generatedRoot)\n',
    replace: '    false\n',
    caughtBy: 'packages/toolkit/test/generated-root-separation.test.ts',
  },
  {
    id: 'output-transaction-swaps-a-directory',
    invariant:
      'Publishing a generation renames only files and never renames a directory or creates a link.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '      if (await pathExists(backup)) await unlink(backup);\n    }\n    await unlink(journalPath);',
    replace:
      '      if (await pathExists(backup)) await unlink(backup);\n    }\n    await rename(roots.generatedRoot, `${roots.generatedRoot}.previous`);\n    await rename(`${roots.generatedRoot}.previous`, roots.generatedRoot);\n    await unlink(journalPath);',
    caughtBy: 'packages/toolkit/test/output-transaction-primitives.test.ts',
  },
  {
    id: 'owner-identity-follows-the-scope-list',
    invariant:
      'Writing the first catalog or adding a scope needs no Equator step before the next generation succeeds.',
    source: 'packages/toolkit/src/compiled-artifacts.ts',
    find: '  const ownerId = generatedOwnerId(request.owner);',
    replace:
      "  const ownerId = digestCanonicalJson('equator-generated-owner/1', {\n    owner: generatedOwnerId(request.owner),\n    scopes: [...new Set(request.catalogs.map((catalog) => catalog.scopeId))].sort(),\n  });",
    caughtBy: 'packages/toolkit/test/first-run-sequence.test.ts',
  },
  {
    id: 'string-literal-counts-as-message-use',
    invariant:
      'A string, an interpolated string, an unbounded index or an object spelled like a handle never becomes a message identity.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '      if (\n        (ts.isIdentifier(node) ||\n          ts.isPropertyAccessExpression(node) ||\n          ts.isElementAccessExpression(node)) &&\n        !inTypePosition(node) &&\n        !namesOnlyAType(checker, node)\n      ) {\n        const identity = resolvedMessageIdentity(checker, node);',
    replace:
      "      if (ts.isStringLiteral(node)) {\n        const named = [...knownIdentities].find(\n          (known) => known === node.text || known.endsWith(`:${node.text}`),\n        );\n        if (named !== undefined) {\n          addUsage(named, portableSourcePath, node.getStart(sourceFile), node.getEnd(), 'typescript');\n        }\n      }\n      if (\n        (ts.isIdentifier(node) ||\n          ts.isPropertyAccessExpression(node) ||\n          ts.isElementAccessExpression(node)) &&\n        !inTypePosition(node) &&\n        !namesOnlyAType(checker, node)\n      ) {\n        const identity = resolvedMessageIdentity(checker, node);",
    caughtBy: 'packages/toolkit/test/message-identity-sources.test.ts',
  },
  {
    id: 'terminal-escape-to-a-non-terminal',
    invariant:
      'Nothing the executable writes to a non-terminal carries a terminal escape.',
    source: 'packages/toolkit/src/cli.ts',
    find: '  return `${location}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.summary}\\n`;',
    replace:
      '  return `\\u001b[33m${location}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.summary}\\n`;',
    caughtBy: 'packages/toolkit/test/cli-streams-prompts-interruption.test.ts',
  },
  {
    id: 'toolkit-import-writes-to-disk',
    invariant:
      'Importing the toolkit entry point compiles nothing, watches nothing, writes nothing and changes no process state.',
    source: 'packages/toolkit/src/index.ts',
    find: "export { parseConfiguration } from './configuration.js';",
    replace:
      "export { parseConfiguration } from './configuration.js';\nimport { mkdirSync as probe } from 'node:fs';\nprobe('.equator', { recursive: true });",
    caughtBy: 'packages/toolkit/test/import-cost.test.ts',
  },
  {
    id: 'translation-state-kept-in-the-work-root',
    invariant:
      'The translation-state record lives outside every disposable and default-ignored root and survives a clean.',
    source: 'packages/toolkit/src/translation-state.ts',
    find: "export const TRANSLATION_STATE_PATH =\n  '.equator-translation-state.json' as const;",
    replace:
      "export const TRANSLATION_STATE_PATH =\n  '.equator/translation-state.json' as const;",
    caughtBy: 'packages/toolkit/test/translation-state-durability.test.ts',
  },
  {
    id: 'undeclared-extension-option-accepted',
    invariant:
      'A catalog that passes a registered function an option it does not declare is an error.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      if (option === undefined) {\n        diagnostics.push(',
    replace:
      '      if (option === undefined) {\n        continue;\n        diagnostics.push(',
    caughtBy: 'packages/toolkit/test/catalog-extension-references.test.ts',
  },
  {
    id: 'unregistered-extension-reference-accepted',
    invariant:
      'A catalog reference to a message function the project registry does not hold is an error.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "    if (descriptor === undefined) {\n      diagnostics.push(\n        semanticDiagnostic(\n          catalog,\n          'EQ1805',\n          `Message function ${JSON.stringify(reference.name)} has no registered application-local descriptor.`,",
    replace:
      "    if (descriptor === undefined) {\n      continue;\n      diagnostics.push(\n        semanticDiagnostic(\n          catalog,\n          'EQ1805',\n          `Message function ${JSON.stringify(reference.name)} has no registered application-local descriptor.`,",
    caughtBy: 'packages/toolkit/test/catalog-extension-references.test.ts',
  },
  {
    id: 'watch-drops-the-pending-cycle',
    invariant:
      'An event that arrives while a generation runs causes one more generation after it, so the latest input is what ends up published.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '      } else if (pending) {\n        pending = false;\n        void cycle();',
    replace: '      } else if (pending) {\n        pending = false;',
    caughtBy: 'packages/toolkit/test/watch-reconciliation.test.ts',
  },
  {
    id: 'watch-generates-on-every-event',
    invariant:
      'Watch debounces filesystem events, so the events of a write in progress produce one generation from the finished file.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '        if (timer !== undefined) clearTimeout(timer);\n        timer = setTimeout(() => {\n          timer = undefined;\n          void cycle();\n        }, debounce);',
    replace: '        void cycle();',
    caughtBy: 'packages/toolkit/test/watch-reconciliation.test.ts',
  },
  {
    id: 'watch-ignores-an-unnamed-event',
    invariant:
      'A filesystem event that names no file (a dropped or overflowed event) widens to a full reconciliation.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  if (fileName === null) return false;',
    replace: '  if (fileName === null) return true;',
    caughtBy: 'packages/toolkit/test/watch-reconciliation.test.ts',
  },
  {
    id: 'watch-leaves-its-watcher-open',
    invariant:
      'Watch holds its platform watcher only while the call runs, and closes it before returning.',
    source: 'packages/toolkit/src/project-host.ts',
    // The wait for the close goes with the close, or the planted defect would read as a hang.
    find: "      closed = new Promise((resolveClosed) => {\n        closing.once('close', () => resolveClosed());\n      });\n      closing.close();\n",
    replace: '      void closing;\n',
    caughtBy: 'packages/toolkit/test/watch-foreground.test.ts',
  },
  {
    id: 'watch-repeats-a-cycle-over-unchanged-inputs',
    invariant:
      'A watch cycle that rereads the inputs the cycle before it settled generates nothing and reports nothing.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '      if (inputs === settledInputs) return;\n',
    replace: '',
    caughtBy: 'packages/toolkit/test/watch-unchanged-inputs.test.ts',
  },
  {
    id: 'watch-settles-a-cycle-its-inputs-did-not-decide',
    invariant:
      'A watch cycle stopped by something other than its inputs runs again on the next event, over the same inputs.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '      if (decidedByInputs) settledInputs = inputs;',
    replace: '      settledInputs = inputs;',
    caughtBy: 'packages/toolkit/test/watch-unchanged-inputs.test.ts',
  },
  {
    id: 'watch-skips-startup-reconciliation',
    invariant: 'Watch reconciles fully at startup before any filesystem event.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  await cycle();\n  if (options.signal.aborted',
    replace: '  if (options.signal.aborted',
    caughtBy: 'packages/toolkit/test/watch-reconciliation.test.ts',
  },
  {
    id: 'asynchronous-formatting-adapter-admitted',
    invariant:
      'A formatting adapter that answers with a thenable is refused, even when the thenable carries text.',
    source: 'packages/runtime/src/formatting-runtime.ts',
    find: '      !isPlainRecord(output) ||\n      isPromiseLike(output) ||',
    replace: '      !isPlainRecord(output) ||',
    caughtBy: 'packages/runtime/test/formatting-adapter-refusals.test.ts',
  },
  {
    id: 'closed-literal-set-coerced',
    invariant:
      'A value is matched against a closed literal set exactly, without case folding, trimming or string conversion.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    return (contract.enum as readonly unknown[]).includes(value);',
    replace:
      '    return (contract.enum as readonly unknown[]).includes(String(value).trim().toLowerCase());',
    caughtBy: 'packages/runtime/test/closed-literal-set.test.ts',
  },
  {
    id: 'closed-literal-set-open',
    invariant:
      "A string outside an input's closed literal set is refused as invalid-message-input and never interpolated.",
    source: 'packages/runtime/src/evaluator.ts',
    find: '    return (contract.enum as readonly unknown[]).includes(value);',
    replace: "    return typeof value === 'string';",
    caughtBy: 'packages/runtime/test/closed-literal-set.test.ts',
  },
  {
    id: 'content-language-maximized',
    invariant:
      'The language a consumer declares for its content comes back as declared, never expanded with likely subtags.',
    source: 'packages/runtime/src/locale-presentation.ts',
    find: "    language: profile.locale,\n    direction: profile.direction,\n    classification: 'known',",
    replace:
      "    language: new Intl.Locale(profile.locale).maximize().toString(),\n    direction: profile.direction,\n    classification: 'known',",
    caughtBy: 'packages/runtime/test/content-language-preserved.test.ts',
  },
  {
    id: 'content-language-minimized',
    invariant:
      'The language a consumer declares for its content comes back as declared, never reduced to its minimal form.',
    source: 'packages/runtime/src/locale-presentation.ts',
    find: "    language: profile.locale,\n    direction: profile.direction,\n    classification: 'known',",
    replace:
      "    language: new Intl.Locale(profile.locale).minimize().toString(),\n    direction: profile.direction,\n    classification: 'known',",
    caughtBy: 'packages/runtime/test/content-language-preserved.test.ts',
  },
  {
    id: 'empty-families-mapping-written',
    invariant:
      'The canonical writer omits the families mapping from a source catalog whose scope has none.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '    ...(Object.keys(catalog.families).length === 0\n      ? {}',
    replace: '    ...((false as boolean)\n      ? {}',
    caughtBy: 'packages/toolkit/test/families-placement.test.ts',
  },
  {
    id: 'entry-workflow-field-accepted',
    invariant:
      'A source or target catalog entry carrying an identity, locale, ownership, revision, approval, ticket, vendor or status field is refused.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "const messageRecordSchema = {\n  type: 'object',\n  additionalProperties: false,",
    replace:
      "const messageRecordSchema = {\n  type: 'object',\n  additionalProperties: true,",
    caughtBy: 'packages/toolkit/test/entry-workflow-fields.test.ts',
  },
  {
    id: 'fallback-accepts-an-unknown-input',
    invariant:
      'An input the supplying message does not declare is refused, not ignored.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    if (!contracts.has(name)) invalidInput(`Unknown message input ${name}.`);',
    replace: '    void contracts.has(name);',
    caughtBy: 'packages/runtime/test/incompatible-fallback-candidate.test.ts',
  },
  {
    id: 'fallback-accepts-another-generated-abi',
    invariant:
      'A fallback catalog built against another generated ABI is refused, not rendered.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    handle.generatedAbi !== candidate.catalog.generatedAbi ||',
    replace: '    false ||',
    caughtBy: 'packages/runtime/test/incompatible-fallback-candidate.test.ts',
  },
  {
    id: 'fallback-accepts-another-result-kind',
    invariant:
      "A fallback message whose result kind differs from the handle's is refused, not rendered.",
    source: 'packages/runtime/src/evaluator.ts',
    find: '    handle.resultKind !== message.resultKind\n  ) {',
    replace: '    false\n  ) {',
    caughtBy: 'packages/runtime/test/incompatible-fallback-candidate.test.ts',
  },
  {
    id: 'fallback-values-formatted-in-the-supplying-locale',
    invariant:
      "A value in a message a fallback catalog supplied is written in the target locale's formatting context, not the supplying catalog's.",
    source: 'packages/runtime/src/evaluator.ts',
    find: "  const host = hostFormattingTag(\n    functionName,\n    'number',\n    formattingTag,",
    replace:
      "  const host = hostFormattingTag(\n    functionName,\n    'number',\n    environment.supplyingLocale,",
    caughtBy: 'packages/runtime/test/supplying-and-formatting-locale.test.ts',
  },
  {
    id: 'family-segment-key-unmatched',
    invariant:
      'A segments key that is not a placeholder of the template is refused with EQ1305 at the segments mapping.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '  if (segmentNames.some((name) => !placeholders.has(name))) {',
    replace: '  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/family-templates.test.ts',
  },
  {
    id: 'family-segment-type-unregistered',
    invariant:
      'A segments value that is not a registered identifier-segment type is refused with EQ1805.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "      extensionDescriptor(extensions, 'identifier-segment', type) === undefined\n    ) {",
    replace: '      (false as boolean)\n    ) {',
    caughtBy: 'packages/toolkit/test/family-templates.test.ts',
  },
  {
    id: 'family-template-pattern-part-accepted',
    invariant:
      'A template part that is neither a whole placeholder nor a message-identity literal, such as a glob, a regular expression, an optional or repeated marker, alternation or concatenation, is refused with EQ1305 at the template.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    } else if (nativeMessagePartPattern.test(part)) {',
    replace: '    } else if (true as boolean) {',
    caughtBy: 'packages/toolkit/test/family-templates.test.ts',
  },
  {
    id: 'family-template-placeholder-repeated',
    invariant:
      'A template that repeats a placeholder is refused with EQ1305 at the template.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      if (placeholders.has(name)) {',
    replace: '      if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/family-templates.test.ts',
  },
  {
    id: 'family-template-without-fixed-part',
    invariant:
      'A template without a literal part or without a placeholder is refused with EQ1305 at the template.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '  if (literalCount === 0 || placeholders.size === 0) {',
    replace: '  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/family-templates.test.ts',
  },
  {
    id: 'family-without-member-accepted',
    invariant:
      'A family whose template matches no current source message is refused with EQ1305.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    if (members.length === 0) {\n      diagnostics.push(',
    replace:
      '    if (members.length === 0) {\n      continue;\n      diagnostics.push(',
    caughtBy: 'packages/toolkit/test/family-templates.test.ts',
  },
  {
    id: 'formatter-store-ignores-the-override',
    invariant:
      "An option one call passes reaches only that call; the next call on the same context is written with the context's own options.",
    source: 'packages/runtime/src/evaluator.ts',
    find: '    const key = `number\\u0000${locale}\\u0000${stableOptions(options as Readonly<Record<string, unknown>>)}`;',
    replace: '    const key = `number\\u0000${locale}`;',
    caughtBy: 'packages/runtime/test/per-operation-override.test.ts',
  },
  {
    id: 'formatting-adapter-output-unbounded',
    invariant:
      "A formatting adapter's text is held to the maximum output length its descriptor declares.",
    source: 'packages/runtime/src/formatting-runtime.ts',
    find: '        binding.descriptor.maximumOutputLength,\n      ) === undefined ||',
    replace: '        Number.MAX_SAFE_INTEGER,\n      ) === undefined ||',
    caughtBy: 'packages/runtime/test/formatting-adapter-refusals.test.ts',
  },
  {
    id: 'formatting-adapter-trusted-as-passed',
    invariant:
      "A formatting adapter is resolved through the calling context's own registry, so one the context did not install is refused and a copy passed under an installed identity is never run.",
    source: 'packages/runtime/src/formatting-runtime.ts',
    find: '        ? this.context.extensions.formattingAdapter(extensionId)',
    replace:
      '        ? (adapter as unknown as RuntimeFormattingAdapterBinding)',
    caughtBy: 'packages/runtime/test/formatting-adapter-refusals.test.ts',
  },
  {
    id: 'integer-parameter-codec-reads-localized-digits',
    invariant:
      "An integer route parameter is read in ASCII digits only; the same number in a locale's own digits is not a spelling of it.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    parse: (value: string) => {\n      if (!/^-?[0-9]{1,64}$/u.test(value)) {',
    replace:
      "    parse: (spelled: string) => {\n      const value = spelled\n        .normalize('NFKC')\n        .replace(/[\\u0660-\\u0669]/gu, (digit) => String(digit.charCodeAt(0) - 0x660))\n        .replace(/[\\u06F0-\\u06F9]/gu, (digit) => String(digit.charCodeAt(0) - 0x6f0))\n        .replace(/[\\u0966-\\u096F]/gu, (digit) => String(digit.charCodeAt(0) - 0x966));\n      if (!/^-?[0-9]{1,64}$/u.test(value)) {",
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'interactive-slot-nested',
    invariant:
      'An interactive slot inside another interactive slot, directly or through a plain slot, is refused with EQ1303.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      (interactiveSlotKinds.has(kind) || descriptor?.interactive === true) &&',
    replace: '      false &&',
    caughtBy: 'packages/toolkit/test/interactive-slot-nesting.test.ts',
  },
  {
    id: 'issue-convention-consulted-before-the-binding',
    invariant:
      "An explicit binding for an issue code wins over the message the code's name derives.",
    source: 'packages/runtime/src/presentation.ts',
    find: '  const binding =\n    source.bindings !== undefined && Object.hasOwn(source.bindings, issue.code)\n      ? source.bindings[issue.code]\n      : undefined;\n  if (binding !== undefined) {',
    replace:
      '  const binding =\n    issueMessage(source.messages, issue.code) === undefined &&\n    source.bindings !== undefined &&\n    Object.hasOwn(source.bindings, issue.code)\n      ? source.bindings[issue.code]\n      : undefined;\n  if (binding !== undefined) {',
    caughtBy: 'packages/runtime/test/issue-presentation.test.ts',
  },
  {
    id: 'issue-code-letter-outside-ascii-read-as-a-word',
    invariant:
      'An issue code is read in ASCII letters and digits alone, so a letter outside ASCII separates words and the derived identifier is one a catalog can hold.',
    source: 'packages/runtime/src/issue-convention.ts',
    find: "    const lower = character >= 'a' && character <= 'z';",
    replace: '    const lower = /\\p{Ll}/u.test(character);',
    caughtBy: 'packages/runtime/test/issue-code-message-pairing.test.ts',
  },
  {
    id: 'issue-message-accepted-by-name-alone',
    invariant:
      "A message found by an issue code's name is accepted only when its own identity ends in the derived identifier.",
    source: 'packages/runtime/src/issue-convention.ts',
    find: '  return identity === messageId || identity.endsWith(`.${messageId}`)\n    ? candidate\n    : undefined;',
    replace: '  void identity;\n  return candidate;',
    caughtBy: 'packages/runtime/test/issue-presentation.test.ts',
  },
  {
    id: 'markup-name-read-as-an-element',
    invariant:
      'A markup name the slot-kind registry does not hold is a message-local slot, whatever HTML element it is spelled like.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "      inherited?.kind ??\n      (builtInSlotKinds.has(name) ? name : 'message-local');\n    const customKind = extensionDescriptor(extensions, 'rich-slot-kind', kind);",
    replace:
      "      inherited?.kind ??\n      (builtInSlotKinds.has(name) ? name : name === 'a' ? 'link' : 'message-local');\n    const customKind = extensionDescriptor(extensions, 'rich-slot-kind', kind);",
    caughtBy: 'packages/toolkit/test/markup-names.test.ts',
  },
  {
    id: 'markup-option-undeclared-accepted',
    invariant:
      'A markup option a registered custom kind does not declare, such as a class or a style, is refused with EQ1805.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "      allowed === undefined ||\n      value.kind !== 'literal' ||\n      !allowed.includes(value.value)",
    replace:
      "      allowed !== undefined &&\n      (value.kind !== 'literal' ||\n      !allowed.includes(value.value))",
    caughtBy: 'packages/toolkit/test/markup-options.test.ts',
  },
  {
    id: 'markup-option-value-unlisted-accepted',
    invariant:
      'A markup option on a registered custom kind is refused with EQ1805 when its value is not one the descriptor lists.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      !allowed.includes(value.value)\n    ) {',
    replace: '      false\n    ) {',
    caughtBy: 'packages/toolkit/test/markup-options.test.ts',
  },
  {
    id: 'parsing-adapter-input-unbounded',
    invariant:
      "Input past a parsing adapter's declared bound is refused as out of range before the adapter is invoked.",
    source: 'packages/runtime/src/formatting-runtime.ts',
    find: '          binding.descriptor.maximumInputLength,',
    replace: '          Number.MAX_SAFE_INTEGER,',
    caughtBy: 'packages/runtime/test/formatting-adapter-refusals.test.ts',
  },
  {
    id: 'parsing-adapter-status-outside-the-model',
    invariant:
      "A parsing adapter's result is admitted only with a status from the closed result model.",
    source: 'packages/runtime/src/formatting-runtime.ts',
    find: "    !adapterInputStatuses.has(value['status'] as LocalizedInputStatus) ||",
    replace: '',
    caughtBy: 'packages/runtime/test/formatting-adapter-refusals.test.ts',
  },
  {
    id: 'percentage-points-formatted-as-a-percent',
    invariant:
      'Percentage points are written as a count with their own semantic unit, never through percent style.',
    source: 'packages/runtime/src/formatting.ts',
    find: "    'percentage-points',\n    value,\n    value.amount,\n    context,\n    options,",
    replace:
      "    'percentage-points',\n    value,\n    value.amount,\n    context,\n    { ...options, style: 'percent' },",
    caughtBy: 'packages/runtime/test/percentage-points.test.ts',
  },
  {
    id: 'person-name-locales-read-from-the-catalogs',
    invariant:
      'The person-name profiles a build carries are chosen from the declared locales, not from the locales that happen to have catalogs.',
    source: 'packages/toolkit/src/compiled-artifacts.ts',
    find: '  const personNameProfiles = personNameProfilesFor([\n    ...request.graph.locales,',
    replace:
      '  const personNameProfiles = personNameProfilesFor([\n    ...new Set(catalogs.map(({ key }) => key.catalogLocale)),',
    caughtBy: 'packages/toolkit/test/one-locale-declaration.test.ts',
  },
  {
    id: 'refinement-enum-null-accepted',
    invariant:
      'An enum carrying null is refused with EQ1102, because null is governed only by nullable.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "          minItems: 1,\n          uniqueItems: true,\n          items: {\n            anyOf: [\n              { type: 'string' },",
    replace:
      "          minItems: 1,\n          uniqueItems: true,\n          items: {\n            anyOf: [\n              { type: 'null' },\n              { type: 'string' },",
    caughtBy: 'packages/toolkit/test/input-refinements.test.ts',
  },
  {
    id: 'refinement-enum-of-another-type-accepted',
    invariant:
      'An enum literal incompatible with the effective input type is refused with EQ1302.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      refinement.enum.some((literal) => !literalMatchesType(literal, type))',
    replace: '      (false as boolean)',
    caughtBy: 'packages/toolkit/test/input-refinements.test.ts',
  },
  {
    id: 'refinement-enum-repeats-accepted',
    invariant: 'An enum that repeats a literal is refused with EQ1102.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "          minItems: 1,\n          uniqueItems: true,\n          items: {\n            anyOf: [\n              { type: 'string' },",
    replace:
      "          minItems: 1,\n          uniqueItems: false,\n          items: {\n            anyOf: [\n              { type: 'string' },",
    caughtBy: 'packages/toolkit/test/input-refinements.test.ts',
  },
  {
    id: 'refinement-key-not-an-input-accepted',
    invariant:
      'An inputs key that is not the exact inferred external variable name, whether misspelled, written with its sigil, unused, or naming a local declaration, is refused with EQ1302.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    if (!message.semantics.externalInputs.includes(name)) {',
    replace: '    if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/input-refinements.test.ts',
  },
  {
    id: 'refinement-record-field-accepted',
    invariant:
      'A refinement record holds only type, enum, optional, nullable and description, so a default, coercion, substitution or conversion field is refused with EQ1102.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "    {\n      type: 'object',\n      additionalProperties: false,\n      minProperties: 1,\n      properties: {\n        type: portableTypeIdSchema,",
    replace:
      "    {\n      type: 'object',\n      additionalProperties: true,\n      minProperties: 1,\n      properties: {\n        type: portableTypeIdSchema,",
    caughtBy: 'packages/toolkit/test/input-refinements.test.ts',
  },
  {
    id: 'refinement-type-outside-the-registry-accepted',
    invariant:
      'A refinement type that is not in the portable registry, such as a TypeScript symbol, an import, a type expression or a source path, is refused with EQ1302.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '  if (!portableTypes.has(refinement.type as PortableTypeId)) {\n    diagnostics.push(',
    replace:
      '  if (!portableTypes.has(refinement.type as PortableTypeId)) {\n    return refinement.type as PortableTypeId;\n    diagnostics.push(',
    caughtBy: 'packages/toolkit/test/input-refinements.test.ts',
  },
  {
    id: 'refused-input-carries-a-value',
    invariant:
      'A localized input result carries a value only when its status is valid.',
    source: 'packages/runtime/src/localized-input.ts',
    find: '  return Object.freeze({\n    status,\n    text,\n    diagnostic: diagnostic(',
    replace:
      '  return Object.freeze({\n    status,\n    text,\n    value: text,\n    diagnostic: diagnostic(',
    caughtBy: 'packages/runtime/test/non-valid-input-carries-no-value.test.ts',
  },
  {
    id: 'registered-interactive-kind-nested',
    invariant:
      'A registered kind that declares itself interactive is refused inside a link, as the built-in interactive kinds are.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      (interactiveSlotKinds.has(kind) || descriptor?.interactive === true) &&',
    replace: '      interactiveSlotKinds.has(kind) &&',
    caughtBy: 'packages/toolkit/test/interactive-slot-nesting.test.ts',
  },
  {
    id: 'registered-interactive-parent-ignored',
    invariant:
      'A link inside a registered interactive kind is refused with EQ1303.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "          extensionDescriptor(extensions, 'rich-slot-kind', parentKind)\n            ?.interactive === true",
    replace: '          (false as boolean)',
    caughtBy: 'packages/toolkit/test/interactive-slot-nesting.test.ts',
  },
  {
    id: 'rich-slot-binding-without-projection-accepted',
    invariant:
      'A runtime binding for a custom rich-slot kind that supplies no projectText is refused as invalid-configuration when the extensions are assembled.',
    source: 'packages/runtime/src/extensions.ts',
    find: "  if (!hasExactKeys(candidate, ['descriptor', handlerName])) {",
    replace:
      "  if (descriptor.kind === 'rich-slot-kind' && !('projectText' in candidate)) {\n    return Object.freeze({ descriptor, projectText: () => '' }) as unknown as RuntimeExtensionBinding;\n  }\n  if (!hasExactKeys(candidate, ['descriptor', handlerName])) {",
    caughtBy: 'packages/runtime/test/rich-slot-projection-binding.test.ts',
  },
  {
    id: 'rich-slot-kind-projection-open',
    invariant:
      "A rich-slot-kind descriptor's text projection is children or binding-required and nothing else.",
    source: 'packages/toolkit/src/schemas.ts',
    find: "              textProjection: {\n                enum: ['children', 'binding-required'],",
    replace:
      "              textProjection: {\n                enum: ['children', 'binding-required', 'none'],",
    caughtBy: 'packages/toolkit/test/rich-slot-kind-projection.test.ts',
  },
  {
    id: 'rich-slot-kind-without-projection-accepted',
    invariant:
      'A rich-slot-kind descriptor that declares no text projection is refused.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "            required: ['kind', 'id', 'shape', 'interactive', 'textProjection'],",
    replace: "            required: ['kind', 'id', 'shape', 'interactive'],",
    caughtBy: 'packages/toolkit/test/rich-slot-kind-projection.test.ts',
  },
  {
    id: 'rich-slot-projection-not-text-accepted',
    invariant:
      'A rich-slot projection that answers with something other than bounded text is refused as invalid-configuration.',
    source: 'packages/runtime/src/extensions.ts',
    find: "      typeof value !== 'string' ||\n      codePointLengthAtMost(value, RUNTIME_LIMITS.outputCodePoints) ===",
    replace:
      '      (false as boolean) ||\n      codePointLengthAtMost(String(value), RUNTIME_LIMITS.outputCodePoints) ===',
    caughtBy: 'packages/runtime/test/rich-slot-projection-binding.test.ts',
  },
  {
    id: 'malformed-catalog-set-refused-untyped',
    invariant:
      'A catalog set or configuration with a member missing or of another shape is refused as a configuration failure by the store.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "        'invalid-configuration',\n        'The generated catalog set or its configuration is malformed.',",
    replace:
      "        'internal-invariant',\n        'The generated catalog set or its configuration is malformed.',",
    caughtBy: 'packages/runtime/test/catalog-set-shape-faults.test.ts',
  },
  {
    id: 'generated-value-snapshot-failure-untyped',
    invariant:
      'A generated configuration or catalog set that is not inert data is refused as a configuration failure, not with the bare error of the copy.',
    source: 'packages/runtime/src/runtime-safety.ts',
    find: "    throw new LocalizationError(\n      operationalDiagnostic('invalid-configuration', message),\n      { cause },\n    );",
    replace: '    throw cause;',
    caughtBy: 'packages/runtime/test/generated-values-not-inert.test.ts',
  },
  {
    id: 'extension-descriptor-snapshot-failure-untyped',
    invariant:
      'An extension descriptor that is not inert data is refused as invalid-configuration, as any other malformed descriptor is.',
    source: 'packages/runtime/src/extensions.ts',
    find: '    return invalid(NOT_INERT, { cause });',
    replace: '    throw cause;',
    caughtBy: 'packages/runtime/test/runtime-extension-admission.test.ts',
  },
  {
    id: 'valueless-option-kept-in-the-call',
    invariant:
      'An option whose variable was omitted or is null is left out of the call, so what the operand carried under its name still applies.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "      !name.startsWith('u:') && value !== undefined && value !== null,",
    replace: "      !name.startsWith('u:'),",
    caughtBy: 'packages/runtime/test/function-option-resolution.test.ts',
  },
  {
    id: 'empty-expression-printed-as-nothing',
    invariant:
      'A compiled expression that names neither an operand nor a function is refused as invalid-rich-message and is never printed as empty text.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "    const named = readReference(expression['operand'], environment);",
    replace:
      "    const named =\n      expression['operand'] === undefined\n        ? ({ kind: 'literal', raw: '' } as const)\n        : readReference(expression['operand'], environment);",
    caughtBy: 'packages/runtime/test/compiled-body-refusals.test.ts',
  },
  {
    id: 'scope-refused-for-its-name',
    invariant:
      'Every scope name the identity grammar admits compiles to its own module, whatever its length or number of parts.',
    source: 'packages/toolkit/src/identities.ts',
    find: "    scopePattern,\n    'EQ1104',\n    'Scope identity',",
    replace:
      "    /^[a-z][a-z0-9]{0,15}$/u,\n    'EQ1104',\n    'Scope identity',",
    caughtBy: 'packages/toolkit/test/scope-name-and-breadth.test.ts',
  },
  {
    id: 'slot-absent-from-a-variant-required',
    invariant:
      'A slot absent from any reachable variant, or declared and unused by the source, is optional.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      counts.length === 0 || counts.some((count) => count === 0);',
    replace: '      counts.length === 0;',
    caughtBy: 'packages/toolkit/test/slot-refinements.test.ts',
  },
  {
    id: 'slot-authored-outside-within-accepted',
    invariant:
      'A within refinement that excludes a placement the source authors is refused with EQ1303.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      [...parents].some((parent) => !refinement.within?.includes(parent))',
    replace: '      (false as boolean)',
    caughtBy: 'packages/toolkit/test/slot-refinements.test.ts',
  },
  {
    id: 'slot-refinement-field-accepted',
    invariant:
      'An expanded slot refinement holds only kind, shape, optional, repeatable, within and description, so a component, template, element, class, style or URL field is refused with EQ1102.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "    {\n      type: 'object',\n      additionalProperties: false,\n      minProperties: 1,\n      properties: {\n        kind: portableTypeIdSchema,",
    replace:
      "    {\n      type: 'object',\n      additionalProperties: true,\n      minProperties: 1,\n      properties: {\n        kind: portableTypeIdSchema,",
    caughtBy: 'packages/toolkit/test/slot-refinements.test.ts',
  },
  {
    id: 'slot-repeated-on-a-path-single',
    invariant: 'A slot used more than once on a reachable path is repeatable.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    const inferredRepeatable = counts.some((count) => count > 1);',
    replace: '    const inferredRepeatable = false as boolean;',
    caughtBy: 'packages/toolkit/test/slot-refinements.test.ts',
  },
  {
    id: 'target-catalog-families-accepted',
    invariant:
      'A target catalog carrying a families mapping is refused with EQ1102.',
    source: 'packages/toolkit/src/schemas.ts',
    find: '        ],\n      },\n    },\n  },\n} as const);\n\nconst extensionIdSchema',
    replace:
      '        ],\n      },\n    },\n    families: SOURCE_CATALOG_SCHEMA.properties.families,\n  },\n} as const);\n\nconst extensionIdSchema',
    caughtBy: 'packages/toolkit/test/families-placement.test.ts',
  },
  {
    id: 'throwing-formatting-adapter-propagates',
    invariant:
      'A formatting adapter that throws gives the caller a typed unsupported-formatting result, never the exception.',
    source: 'packages/runtime/src/formatting-runtime.ts',
    find: '        Object.freeze({ value, locale: formatting.locale, formatting }),\n      );\n    } catch {',
    replace:
      '        Object.freeze({ value, locale: formatting.locale, formatting }),\n      );\n    } catch (error) {\n      if (error !== undefined) throw error;',
    caughtBy: 'packages/runtime/test/formatting-adapter-refusals.test.ts',
  },
  {
    id: 'unmapped-external-value-presented-as-known',
    invariant:
      'An external value nothing is bound to is presented as a typed unknown that keeps its own value, with the unknown message and a diagnostic.',
    source: 'packages/runtime/src/presentation.ts',
    find: "  if (message === undefined) {\n    return Object.freeze({\n      status: 'unknown',\n      value,",
    replace:
      "  if (message === undefined) {\n    return Object.freeze({\n      status: 'known',\n      value,",
    caughtBy: 'packages/runtime/test/issue-presentation.test.ts',
  },
  {
    id: 'unused-slot-shape-assumed',
    invariant:
      'A declared slot the source does not use, whose kind does not determine a shape, is refused unless the refinement states one.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      refinement?.shape ?? inferredShape ?? builtInShape ?? customKind?.shape;',
    replace:
      "      refinement?.shape ?? inferredShape ?? builtInShape ?? customKind?.shape ?? ('paired' as const);",
    caughtBy: 'packages/toolkit/test/slot-refinements.test.ts',
  },
  {
    id: 'instant-formatted-in-the-host-zone',
    invariant:
      "An instant with no time zone from the context or the options is refused, rather than read against the host's zone.",
    source: 'packages/runtime/src/formatting.ts',
    find: "  if (context.timeZone === undefined && options.timeZone === undefined) {\n    return unsupported(\n      'Instant formatting requires an explicit deterministic time zone.',",
    replace:
      "  if (context.locale.length < 0) {\n    return unsupported(\n      'Instant formatting requires an explicit deterministic time zone.',",
    caughtBy: 'packages/runtime/test/instant-time-zone.test.ts',
  },
  {
    id: 'cancelled-load-failure-left-unobserved',
    invariant:
      'A shared load whose caller had already cancelled still has its failure observed, so it never surfaces as an unhandled rejection.',
    source: 'packages/runtime/src/runtime-safety.ts',
    find: '    promise.catch(() => undefined);\n',
    replace: '',
    caughtBy:
      'packages/runtime/test/cancelled-load-failure-is-observed.test.ts',
  },
  {
    id: 'external-value-bound-through-an-inherited-member',
    invariant:
      'An external value spelled like a member every object inherits was bound to nothing and is presented as unknown.',
    source: 'packages/runtime/src/presentation.ts',
    find: 'safeCode(value) && Object.hasOwn(bindings, value)',
    replace: 'safeCode(value) && value in bindings',
    caughtBy: 'packages/runtime/test/inherited-member-codes.test.ts',
  },
  {
    id: 'runtime-import-starts-a-timer',
    invariant: 'Importing a runtime entry point starts no timer.',
    source: 'packages/runtime/src/formatting.ts',
    find: 'const sharedFormatters = new FormatterCache(',
    replace:
      'setTimeout(() => undefined, 0);\nconst sharedFormatters = new FormatterCache(',
    caughtBy: 'packages/runtime/test/import-has-no-effects.test.ts',
  },
  {
    id: 'runtime-import-creates-the-outcome-channel',
    invariant:
      'Importing a runtime entry point adds nothing to global state; the page-outcome channel is created when it is first used.',
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: 'const channels = (): WeakMap<Request, PageOutcomeChannel> =>',
    replace:
      'registry[CHANNELS] ??= new WeakMap<Request, PageOutcomeChannel>();\nconst channels = (): WeakMap<Request, PageOutcomeChannel> =>',
    caughtBy: 'packages/runtime/test/import-has-no-effects.test.ts',
  },
  {
    id: 'fallback-variant-chosen-by-the-reader-locale',
    invariant:
      "A variant of a message supplied by a fallback catalog is chosen by the supplying catalog's plural rules, not the formatting locale's.",
    source: 'packages/runtime/src/evaluator.ts',
    find: "        'plural',\n        environment.supplyingLocale,",
    replace: "        'plural',\n        environment.formatting.locale,",
    caughtBy: 'packages/runtime/test/fallback-plural-selection.test.ts',
  },
  {
    id: 'withdrawn-page-widens-a-private-route',
    invariant:
      "A declaration of an absent or removed page keeps a private route's nofollow; a declaration narrows an indexing class and never widens one.",
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: "resolved.robots === 'noindex, nofollow' ? 'noindex, nofollow' : 'noindex',",
    replace: "'noindex',",
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'empty-family-registry-generated',
    invariant:
      'A scope with no message family is generated with no family registry, empty or otherwise.',
    source: 'packages/toolkit/src/generated-contracts.ts',
    find: "    ...(scope.families.length === 0\n      ? []\n      : [`export const families = ${renderFamilies(scope)};`, '']),",
    replace:
      "    ...(scope.families.length === 0\n      ? ['export const families = Object.freeze({});', '']\n      : [`export const families = ${renderFamilies(scope)};`, '']),",
    caughtBy: 'packages/toolkit/test/empty-family-registry.test.ts',
  },
  {
    id: 'generated-root-inside-a-dependency-accepted',
    invariant:
      'A generated root inside a dependency directory is refused at configuration (EQ1601), since a package manager replaces that directory on install.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "path.split('/').includes('node_modules')",
    replace: 'false',
    caughtBy: 'packages/toolkit/test/generated-root-separation.test.ts',
  },
  {
    id: 'generated-root-inside-the-build-output-accepted',
    invariant:
      "A generated root inside the application's build output is refused at configuration (EQ1601), since the build empties that directory.",
    source: 'packages/toolkit/src/project-host.ts',
    find: 'outputPath !== undefined && containedPath(absolute, outputPath)',
    replace: 'false',
    caughtBy: 'packages/toolkit/test/generated-root-separation.test.ts',
  },
  {
    id: 'type-query-counts-as-message-use',
    invariant:
      'A handle named in a type position, such as `typeof messages.issue.unknown`, is not a use of the message.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '        !inTypePosition(node) &&\n        !namesOnlyAType(checker, node)',
    replace: '        !namesOnlyAType(checker, node)',
    caughtBy: 'packages/toolkit/test/message-identity-sources.test.ts',
  },
  {
    id: 'handle-type-alias-counts-as-message-use',
    invariant:
      "A name that stands only for a handle's type, such as a type alias, is not a use of the message.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '        !inTypePosition(node) &&\n        !namesOnlyAType(checker, node)',
    replace: '        !inTypePosition(node)',
    caughtBy: 'packages/toolkit/test/message-identity-sources.test.ts',
  },
  {
    id: 'within-permits-a-slot-inside-code',
    invariant:
      'A `within` refinement cannot permit a slot inside `code`, which holds only text and values.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "        parentKind === 'code'\n          ? 'code, which holds only text and values'\n          : interactive(kind)",
    replace:
      "        false\n          ? 'code, which holds only text and values'\n          : interactive(kind)",
    caughtBy: 'packages/toolkit/test/within-weakening.test.ts',
  },
  {
    id: 'within-permits-interactive-nesting',
    invariant:
      'A `within` refinement cannot permit an interactive slot inside another interactive slot.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "          : interactive(kind) && interactive(parentKind)\n            ? 'another interactive slot'",
    replace: "          : false\n            ? 'another interactive slot'",
    caughtBy: 'packages/toolkit/test/within-weakening.test.ts',
  },
  {
    id: 'built-in-slot-option-admitted',
    invariant:
      'An option written on a built-in or message-local slot, which no registered kind declares, is refused.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    validateCustomSlotOptions(\n      catalog,\n      messageId,\n      part.name,\n      part.options,\n      descriptor?.options,',
    replace:
      '    if (descriptor !== undefined) validateCustomSlotOptions(\n      catalog,\n      messageId,\n      part.name,\n      part.options,\n      descriptor?.options,',
    caughtBy:
      'packages/toolkit/test/markup-options-without-a-descriptor.test.ts',
  },
  {
    id: 'unreadable-translation-state-read-as-empty',
    invariant:
      'A translation-state record that is not JSON is refused rather than read as an empty record.',
    source: 'packages/toolkit/src/translation-state.ts',
    find: '    document = JSON.parse(text);\n  } catch {\n    return undefined;\n  }',
    replace:
      '    document = JSON.parse(text);\n  } catch {\n    return EMPTY_TRANSLATION_STATE;\n  }',
    caughtBy: 'packages/toolkit/test/translation-state-unreadable.test.ts',
  },
  {
    id: 'malformed-translation-state-entry-skipped',
    invariant:
      'A translation-state entry that is not a pair of fingerprints makes the record unreadable rather than being skipped and re-stamped.',
    source: 'packages/toolkit/src/translation-state.ts',
    find: "    if (typeof source !== 'string' || typeof target !== 'string') {\n      return undefined;\n    }",
    replace:
      "    if (typeof source !== 'string' || typeof target !== 'string') {\n      continue;\n    }",
    caughtBy: 'packages/toolkit/test/translation-state-unreadable.test.ts',
  },
  {
    id: 'unreadable-translation-state-refused-after-publication',
    invariant:
      'An unreadable translation-state record stops generate before any output is published.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  const recorded = await readTranslationState(project.ownerRoot);\n  if (!recorded.ok) return { result: recorded, decidedByInputs: false };\n  const publication = await applyOutputPlan({',
    replace:
      '  const recorded = await readTranslationState(project.ownerRoot);\n  const publication = await applyOutputPlan({',
    caughtBy: 'packages/toolkit/test/translation-state-unreadable.test.ts',
  },
  {
    id: 'unknown-unprefixed-address-negotiated',
    invariant:
      'An address that states no locale and that nothing serves in any locale is a 404 where it stands, not a locale entry.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "      // unchanged.\n      return Object.freeze({\n        status: 'not-found',\n        httpStatus: 404,\n        presentationLocale: policy.defaultLocale,\n      });",
    replace:
      "      // unchanged.\n      if (!policy.omitDefaultPrefix) {\n        const entryLocale =\n          servedPreference(policy, context.locale) ?? policy.defaultLocale;\n        return Object.freeze({\n          status: 'redirect',\n          reason: 'locale-entry',\n          httpStatus: 307,\n          cache: 'private-no-cache',\n          locale: entryLocale,\n          location: `/${policy.locales[entryLocale]}/${encodedSegments(parsed.segments)}`,\n        });\n      }\n      return Object.freeze({\n        status: 'not-found',\n        httpStatus: 404,\n        presentationLocale: policy.defaultLocale,\n      });",
    caughtBy: 'packages/runtime/test/locale-of-an-unprojected-address.test.ts',
  },
  {
    id: 'handler-draws-a-missing-page-in-the-default-locale',
    invariant:
      'A renderer is handed the locale the response names in Content-Language, so a missing page under a served prefix is drawn in that locale.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '        : resolution.presentationLocale;',
    replace: '        : policy.defaultLocale;',
    caughtBy: 'packages/runtime/test/handler-render-locale.test.ts',
  },
  {
    id: 'handler-reads-accept-language-by-exact-tag',
    invariant:
      "The request handler negotiates Accept-Language through the runtime's own negotiation, so a regional variant reaches its language's served locale and a weight above 1 counts as 1.",
    source: 'packages/runtime/http/src/handler.ts',
    find: "      negotiateLocale(\n        parseAcceptLanguage(request.headers.get('accept-language') ?? ''),\n        Object.keys(policy.locales),\n        canonicalTag,\n      );",
    replace:
      "      (request.headers.get('accept-language') ?? '')\n        .split(',')\n        .map((part) => ({ tag: (part.split(';')[0] ?? '').trim(), q: Number(/q=([0-9.]+)/u.exec(part)?.[1] ?? 1) }))\n        .sort((left, right) => right.q - left.q)\n        .map(({ tag }) => servedLocale(policy, tag))\n        .find((locale) => locale !== undefined) ?? (negotiateLocale.length + parseAcceptLanguage.length < 0 ? undefined : undefined);",
    caughtBy: 'packages/runtime/test/handler-language-negotiation.test.ts',
  },
  {
    id: 'query-bounded-only-as-requested',
    invariant:
      'A query spelling that grows past its bounds once canonically encoded is refused, not corrected to an address the resolver then refuses.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '        encodedSuffixText(name).length > 128 ||\n        encodedSuffixText(value).length > 512\n',
    replace: '        name.length > 128 ||\n        value.length > 512\n',
    caughtBy: 'packages/runtime/test/canonical-correction-single-hop.test.ts',
  },
  {
    id: 'fragment-bounded-only-as-requested',
    invariant:
      'A fragment that grows past its bound once canonically encoded is refused, not corrected to an address the resolver then refuses.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (canonicalFragment !== undefined && canonicalFragment.length > 512) {',
    replace:
      '  if (canonicalFragment !== undefined && fragment !== undefined && [...fragment].length > 512) {',
    caughtBy: 'packages/runtime/test/canonical-correction-single-hop.test.ts',
  },
  {
    id: 'query-slash-refused-as-a-separator',
    invariant:
      'A slash in a query value or a fragment is read as data, so a return address in a query is answered.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    return /[\\p{Cc}\\\\]/u.test(decoded) ? undefined : decoded;',
    replace:
      '    return /[\\p{Cc}\\\\/]/u.test(decoded) ? undefined : decoded;',
    caughtBy: 'packages/runtime/test/query-and-fragment-separators.test.ts',
  },
  {
    id: 'query-slash-escaped-by-a-correction',
    invariant:
      'A correction or a redirect writes a slash and a question mark in a query or a fragment as themselves.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  return encodeURIComponent(text).replace(/%2F/gu, '/').replace(/%3F/gu, '?');",
    replace: '  return encodeURIComponent(text);',
    caughtBy: 'packages/runtime/test/query-and-fragment-separators.test.ts',
  },
  {
    id: 'request-spelling-read-unnormalized',
    invariant:
      'A request spelling that is not in Unicode Normalization Form C is read in that form and corrected to the canonical address.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    const decoded = decodeURIComponent(value).normalize('NFC');",
    replace: '    const decoded = decodeURIComponent(value);',
    caughtBy: 'packages/runtime/test/request-normal-form.test.ts',
  },
  {
    id: 'cache-directive-after-a-missing-comma-dropped',
    invariant:
      "A directive that follows another with no comma between them in a page's Cache-Control is still read, so no-store is never lost to a max-age.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (name.length > 0) found.push([name, argument]);',
    replace:
      "    while (at < value.length && value.charAt(at) !== ',') at += 1;\n    if (name.length > 0) found.push([name, argument]);",
    caughtBy: 'packages/runtime/test/page-cache-control-grammar.test.ts',
  },
  {
    id: 'migration-sink-unreachable',
    invariant:
      'Applying an authored change plan is public, so a consumer can hand it the observability sink the migration events are reported to.',
    source: 'packages/toolkit/src/index.ts',
    find: '  applyAuthoredChangePlan,\n  createMigrationPlan,\n',
    replace: '  createMigrationPlan,\n',
    caughtBy: 'packages/toolkit/test/observability.test.ts',
  },
  {
    id: 'cache-eviction-unreported',
    invariant:
      "The catalog cache reports each entry it evicts, with the entry's identity.",
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "      this.cache.delete(candidate[0]);\n      const { key } = candidate[1].catalog;\n      this.observability?.emit({\n        code: RUNTIME_EVENT_CODES.cache,\n        phase: 'cache',\n        status: 'succeeded',\n        providerId: key.providerId,\n        scopeId: key.scopeId,\n        targetLocale: key.catalogLocale,\n        count: this.cache.size,\n      });\n",
    replace: '      this.cache.delete(candidate[0]);\n',
    caughtBy: 'packages/runtime/test/cache-events.test.ts',
  },
  {
    id: 'cache-pin-pressure-unreported',
    invariant:
      'The catalog cache reports a bound it cannot keep because every entry over it is pinned.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "      if (candidate === undefined) {\n        this.observability?.emit({\n          code: RUNTIME_EVENT_CODES.cache,\n          phase: 'cache',\n          status: 'unavailable',\n          count: this.cache.size,\n        });\n        return;\n      }",
    replace: '      if (candidate === undefined) return;',
    caughtBy: 'packages/runtime/test/cache-events.test.ts',
  },
  {
    id: 'refused-transfer-unreported',
    invariant:
      'The catalog cache reports a transferred catalog it refuses to admit, so a server sending catalogs the browser cannot admit is visible.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: "        reason: 'catalog-admission-failed',\n        providerId: keyRecord['providerId'] as string,",
    replace:
      "        reason: 'catalog-load-failed',\n        providerId: keyRecord['providerId'] as string,",
    caughtBy: 'packages/runtime/test/cache-events.test.ts',
  },
  {
    id: 'load-evicts-before-the-pin',
    invariant:
      'A catalog being acquired is pinned before the cache evicts to its bound, so the entry a caller is about to hold is never the one evicted.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '        if (!this.disposed) this.retain(key, catalog);\n        return catalog;',
    replace:
      '        if (!this.disposed) {\n          this.retain(key, catalog);\n          this.evict();\n        }\n        return catalog;',
    caughtBy: 'packages/runtime/test/cache-events.test.ts',
  },
  {
    id: 'offered-catalog-forgets-its-leases',
    invariant:
      'A catalog offered for an identity that is already cached keeps the entry and the leases on it, so a held catalog is never the one evicted.',
    source: 'packages/runtime/src/catalog-runtime.ts',
    find: '    let entry = this.cache.get(key);\n    if (entry === undefined) {',
    replace:
      '    let entry: CachedCatalog | undefined;\n    if (entry === undefined) {',
    caughtBy: 'packages/runtime/test/catalog-store-cache-and-admission.test.ts',
  },
  {
    id: 'asset-locale-of-another-type-not-refused',
    invariant:
      'A locale, a language or an identity of another type is refused as invalid configuration wherever an asset is declared, selected or reported.',
    source: 'packages/runtime/src/assets.ts',
    find: "    typeof locale === 'string' &&\n    locale.length <= 64 &&",
    replace: '    (locale as string).length <= 64 &&',
    caughtBy: 'packages/runtime/test/asset-declaration-and-selection.test.ts',
  },
  {
    id: 'address-that-is-not-text-refused-without-its-reason',
    invariant:
      'A rich-message destination whose address is not text is refused with the reason malformed-input.',
    source: 'packages/runtime/src/destinations.ts',
    find: "  if (typeof href !== 'string') {",
    replace: "  if (typeof href !== 'string' && href === '') {",
    caughtBy:
      'packages/runtime/test/rich-message-destination-admission.test.ts',
  },
  {
    id: 'allowlist-entry-refused-without-its-reason',
    invariant:
      'An allowlist entry that is not a credential-free HTTPS origin refuses the call with the reason malformed-input.',
    source: 'packages/runtime/src/destinations.ts',
    find: "          'An external destination allowlist entry must be a credential-free HTTPS origin.',\n          'malformed-input',",
    replace:
      "          'An external destination allowlist entry must be a credential-free HTTPS origin.',",
    caughtBy:
      'packages/runtime/test/external-destination-allowlist-entries.test.ts',
  },
  {
    id: 'address-under-another-scheme-admitted',
    invariant:
      'An external destination is admitted only over HTTPS, so an address under another scheme whose origin reads as an allowed one is refused.',
    source: 'packages/runtime/src/destinations.ts',
    find: "    parsed.protocol !== 'https:' ||\n    !origins.has(parsed.origin) ||",
    replace: '    !origins.has(parsed.origin) ||',
    caughtBy:
      'packages/runtime/test/external-destination-allowlist-entries.test.ts',
  },
  {
    id: 'territory-split-takes-the-first-region',
    invariant:
      'A region CLDR split into several becomes the one likely subtags give the language, not the first of the list.',
    source: 'packages/runtime/core/src/language-tag.ts',
    find: '    replacements.find(({ region }) => region === likely) ??\n',
    replace: '',
    caughtBy: 'packages/runtime/test/language-tag.test.ts',
  },
  {
    id: 'alias-rule-taken-in-table-order',
    invariant:
      'Of the alias rules matching a tag, the one UTS #35 Annex C orders first applies, so a rule naming more subtags wins over one naming fewer.',
    source: 'packages/runtime/core/src/language-tag.ts',
    find: '        (first === undefined || rule.order < first.order) &&',
    replace: '        (first === undefined || rule.order > first.order) &&',
    caughtBy: 'packages/runtime/test/language-tag.test.ts',
  },
  {
    id: 'unicode-keyword-true-kept',
    invariant:
      'A Unicode extension keyword whose value is true is spelled as its key alone, as hosts spell it.',
    source: 'packages/runtime/core/src/language-tag.ts',
    find: "        value === '' || value === 'true' ? key : `${key}-${value}`,",
    replace: "        value === '' ? key : `${key}-${value}`,",
    caughtBy: 'packages/runtime/test/language-tag.test.ts',
  },
  {
    id: 'repeated-variant-accepted',
    invariant: 'A tag repeating a variant is refused, as ECMA-402 refuses it.',
    source: 'packages/runtime/core/src/language-tag.ts',
    find: '    if (id.variants.includes(variant)) return undefined;',
    replace: '',
    caughtBy: 'packages/runtime/test/language-tag.test.ts',
  },
  {
    id: 'region-alias-replaces-a-stated-region',
    invariant:
      'A rule that does not name a region fills one only where the tag had none, so sv-FI-aaland keeps FI.',
    source: 'packages/runtime/core/src/language-tag.ts',
    find: "  if (type.region !== '' || id.region === '') {",
    replace: '  if (true) {',
    caughtBy: 'packages/runtime/test/language-tag.test.ts',
  },
  {
    id: 'toolkit-language-tag-twin-drifts',
    invariant:
      'The toolkit canonicalizes a declaration with the same code the runtime canonicalizes a request with.',
    source: 'packages/toolkit/src/language-tag.ts',
    find: 'const MAXIMUM_ALIAS_STEPS = 16;',
    replace: 'const MAXIMUM_ALIAS_STEPS = 17;',
    caughtBy: 'packages/runtime/test/message-function-options.test.ts',
  },
  {
    id: 'toolkit-canonicalizes-with-the-host',
    invariant:
      "The toolkit canonicalizes a declared locale from the pinned CLDR alias data, not the host's ICU.",
    source: 'packages/toolkit/src/locales.ts',
    find: '  const canonical = canonicalizeLanguageTag(locale);',
    replace:
      '  let canonical: string | undefined;\n  try {\n    canonical = Intl.getCanonicalLocales(locale)[0];\n  } catch {\n    canonical = canonicalizeLanguageTag(locale);\n  }',
    caughtBy: 'packages/toolkit/test/pinned-locale-aliases.test.ts',
  },
  {
    id: 'participant-request-context-withheld',
    invariant:
      'A request context given to createLocalizationContext is handed, unchanged, to every participant of that context.',
    source: 'packages/runtime/src/localization.ts',
    find: '      : { participantRequestContext: options.requestContext }),',
    replace: '      : {}),',
    caughtBy:
      'packages/runtime/test/standalone-context-request-context.test.ts',
  },
  {
    id: 'person-name-thrown-for-an-unreadable-language',
    invariant:
      'A person name whose language tag the platform refuses is formatted, with a field asked for in capitals cased by no locale, and never thrown.',
    source: 'packages/runtime/src/formatting.ts',
    find: '    return text.toUpperCase();',
    replace: '    throw new RangeError(language);',
    caughtBy:
      'packages/runtime/test/person-name-casing-unreadable-language.test.ts',
  },
]);
