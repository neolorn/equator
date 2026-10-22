# How to translate catalogs

Export the source catalogs to
[XLIFF 2.2](https://docs.oasis-open.org/xliff/xliff-core/v2.2/xliff-core-v2.2.html), hand the
documents to translators, and import what comes back. What travels is the message and the notes you
wrote beside it.

## Before you begin

You need catalogs, which is [How to write a message](write-messages.md).

## Export and import

`exportXliff22` and `importXliff22` are exported from `@neolorn/equator-toolkit` and work on one
scope in one target locale at a time, so a project with two scopes and one translated locale
exchanges two documents. Both take catalogs read with `parseCatalog`, whose `providerId` is the
`name` in the owner's `package.json`.

`exportXliff22({ source, target })` carries each message with the `description` and `context` you
authored, so a translator has the notes rather than a bare string. Pass the existing translation as
`target` and the work already done comes back in the document.
`importXliff22({ document, source })` reads the returned document against the catalog it was
exported from and returns the translated catalog. A segment still in the `initial` state is not
imported, because it holds a placeholder rather than translated work.

A message without variants reaches the translator as text, with its placeholders and markup as
XLIFF inline codes a translation tool protects. A message with variants, one written with `.match`,
travels as its MessageFormat 2 text, and the translator edits the variants in that syntax.

The toolkit has no command for the exchange. `formatCatalog` returns the imported catalog as the
text of a new file in canonical form, so comments and block scalars in the translated file are not
kept.

Each of the four functions returns a result rather than throwing for content it cannot take. Check
`ok`, then read the document, the catalog or the text from `value`; a result that is not `ok`
carries `diagnostics` alone.

Nothing about your build, your routes or your project goes into the document, and nothing in the
document can introduce markup or a destination into your page, which is
[About the trust model for translated content](../explanation/about-trusted-content.md).

## Check what is finished

A locale that is not finished has four shapes: no catalog for a scope, a catalog missing a message, a
message missing a plural form its language needs, and a translation written against a source message
that has since changed.

```text
npx equator check --require-complete
```

All four stop the run under `--require-complete` and are ordinary warnings without it, because during
development the source language lands first and the translations follow. An inherited answer counts
as an answer.

## Ship a locale that is not ready

Name the locale rather than turning the gate off for every locale.

`equator.config.json` takes an `inProgress` entry naming the locale and a note, which
`equator init --in-progress` writes for you. That locale's findings are still printed, with your
note quoted into them, and they stop blocking.

The note is required, and it is what tells the next person whether the exemption still holds.

## Review a translation in place

`withOverlayLocale` renders a locale on top of the one that is committed, without changing it. A
reviewer opens the page as it will read in Arabic while the application, its state and its addresses
stay where they are.

It is not a way to serve a locale you have not declared. What it overlays has to be a locale you
compiled.

## Accept a translation that still fits

After a source edit that does not change the meaning, the translation written against the old
wording is reported stale until it changes. `.equator-translation-state.json` records, one line per
message and locale, the source each translation was written against. Delete the line for that
message and locale, and the next `generate` records the translation as written against the current
source. When it is the last entry, delete the comma that ends the line before it too. A record that
is not valid JSON, such as one a merge left conflict markers in, stops `generate` and `check` with
`EQ1702` and is left as it is until you resolve it.

## What is checked in

The catalogs, `equator.config.json` and `.equator-translation-state.json` are yours and are checked
in. Without the translation state, a fresh checkout reports no translation stale.

Everything under the generated root, `src/generated/i18n/` unless configured otherwise, is output:
it carries an ownership marker, it regenerates, and `equator clean` removes it. A hand-edited
generated file is overwritten by the next `generate`. `.equator/` holds a cache that is safe to
delete. Add both to `.gitignore`:

```text
src/generated/i18n/
.equator/
```

## Related

- [How to run generation in your build](run-generation-in-your-build.md)
- [About compilation and generated contracts](../explanation/about-compilation.md)
- [Command line](../reference/cli.md)
