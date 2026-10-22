# How to add a locale

Serve another language by declaring it and writing its catalogs. Everything else about a locale is
published data: its direction, its plural categories, its number and date conventions, and what it
inherits from.

## Before you begin

You need a project that `equator init` has set up.

## Declare the locale

`equator.config.json` holds the locale set:

```json excerpt equator.config.json
{
  "sourceLocale": "en-US",
  "defaultLocale": "en-US",
  "locales": ["en-US", "ar-EG"]
}
```

Add the new tag to `locales`. There is no second registry and no per-locale configuration block.

`sourceLocale` is the language you author in. `defaultLocale` is the one a visitor gets when nothing
else decides. They are usually the same tag, and they answer different questions: you can author in
English and serve Arabic by default.

A locale identity is a [BCP 47](https://www.rfc-editor.org/info/bcp47) tag, canonicalized before
anything compares it. `EN-us`, `en-US` and `en-Latn-US` are one locale, so a browser spelling a tag
differently from your configuration is not a miss.

## Write its catalogs

Each scope needs a file for the new locale, at `i18n/<scope>/<locale>.yaml`, with the same keys as
the source catalog. Writing one is
[How to write a message](write-messages.md).

## Compile and check

```text
npx equator generate
npx equator check --require-complete
```

`--require-complete` fails while any scope is missing the locale, any message is missing a plural
form its language needs, or a translation was written against a source message that has since
changed. Ship the locale before its catalogs are finished with an `inProgress` entry, which is
[How to translate catalogs](translate-catalogs.md).

## Choose the sources a locale is resolved from

Equator asks four sources for a visitor's locale and takes the first answer: the address, a
persisted choice, `Accept-Language`, then `defaultLocale`. `withLocaleSources` names the ones to
ask and the order to ask them in:

```text
withLocaleSources('url', 'stored', 'default')
```

That application never asks the browser. A source answers or declines, and declining passes the
question along rather than ending it.

Leaving `withLocaleSources` out selects the four above, in that order. A choice kept in your own
account record is a store given to `withPersistence`, which is
[How to add a locale switcher](add-a-locale-switcher.md). For the order itself and how a requested
language is matched against the set you serve, read
[About how a locale is resolved](../explanation/about-locale-resolution.md).

## Related

- [How to write a message](write-messages.md)
- [How to add a locale switcher](add-a-locale-switcher.md)
- [About how a locale is resolved](../explanation/about-locale-resolution.md)
