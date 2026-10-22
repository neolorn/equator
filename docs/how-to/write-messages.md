# How to write a message

Messages are authored in YAML, one file per locale per scope, and compiled into typed handles. A key
that does not exist is a compile error at the line that uses it.

## Before you begin

You need a project that `equator init` has set up.

## Write the catalog

A catalog lives at `i18n/<scope>/<locale>.yaml`. The scope is a name you choose, and `equator init`
suggests `shell` for the messages that surround everything else:

```yaml excerpt i18n/shell/en-US.yaml
messages:
  app-title: Hello, world
  recovery-message: The page could not be shown. Please reload.
```

## Add a scope

A scope is a directory. Write its catalogs, compile, and import the module. Nothing else declares
it, because the directory is the declaration.

Two kinds of name are taken, and `generate` reports `EQ1503` for a scope that uses one: the name of
a module it writes for every project, such as `routes` or `recovery`, and a name Windows gives to a
device, such as `con`.

```yaml i18n/greeting/en-US.yaml
messages:
  welcome: Welcome back.
  sign-out:
    message: Sign out
    description: The last item in the account menu. A verb, not a noun.
```

```yaml i18n/greeting/ar-EG.yaml
messages:
  welcome: أهلا بعودتك.
  sign-out: تسجيل الخروج
```

```sh run
npx equator generate
```

A message is a plain string or a record. The record form carries `description` and `context` for
whoever translates it, and both travel with the message into an interchange document rather than
living in a spreadsheet beside it. A translated catalog carries no `description`: it is written once,
for the translator, and travels with the source message rather than back from it.

## Use the handle

Keys are kebab-case in the file and camelCase in code. `sign-out` above is `messages.signOut`, and
`app-title` in the shell catalog is `messages.appTitle`. Import `messages` from the module named for
the scope:

```ts excerpt src/app/app.ts
import { messages } from '#i18n/shell';
```

A handle carries the message's identity and its input types. That is what makes a missing key a
compile error, and what makes a message that takes a name refuse to render without one.

## Assert what it renders

```ts src/app/greeting.spec.ts
import { afterEach, describe, expect, it } from 'vitest';

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Localization, withRecoveryMessage } from '@neolorn/equator';
import {
  provideLocalizationTesting,
  resetLocalizationTestEnvironment,
} from '@neolorn/equator/testing';
import { localizationSetup } from '#i18n';
import { messages as shell } from '#i18n/shell';
import { messages } from '#i18n/greeting';

afterEach(resetLocalizationTestEnvironment);

async function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideLocalizationTesting(
        localizationSetup,
        withRecoveryMessage({ message: shell.recoveryMessage }),
      ),
    ],
  });
  const localization = TestBed.inject(Localization);
  await localization.initialize();
  return localization;
}

describe('the greeting scope', () => {
  it('renders in the locale that is committed', async () => {
    const localization = await setup();

    expect(localization.text(messages.welcome)).toBe('Welcome back.');
    expect(localization.text(messages.signOut)).toBe('Sign out');
  });

  it('follows a locale change', async () => {
    const localization = await setup();
    await localization.changeLocale('ar-EG');

    expect(localization.text(messages.welcome)).toBe('أهلا بعودتك.');
  });
});
```

A scope is also the unit of loading. A scope nothing has rendered is not in the bundle a visitor
downloaded, so splitting messages by where they appear is what keeps a page from paying for messages
it never shows.

## Write a placeholder

Placeholders are [MessageFormat 2](https://www.unicode.org/reports/tr35/tr35-78/tr35-messageFormat.html).

`{$name}` is a value you supply. The handle types it, so a message that takes a name cannot be
rendered without one.

`{#strong}…{/strong}` is a slot you render. The message says where the emphasis goes and your
application says what it is made of, so a translator can move it without touching your markup.
Rendering one is [How to render a message](render-messages.md).

Plural and gender selection, number and date formatting, and each locale's plural categories come
from the locale data Equator compiles its profile from, so a translator writing Arabic gets Arabic's
six plural categories rather than English's two.

## Write a message that counts

A message that changes with a number declares the number with `.input` and chooses a variant with
`.match`. Each locale writes the variants its language has, ending with the catch-all `*`:

```yaml i18n/inbox/en-US.yaml
messages:
  unread: |-
    .input {$count :number}
    .match $count
    one {{You have {$count} unread message.}}
    * {{You have {$count} unread messages.}}
```

```yaml i18n/inbox/ar-EG.yaml
messages:
  unread: |-
    .input {$count :number}
    .match $count
    zero {{ليس لديك رسائل غير مقروءة.}}
    one {{لديك رسالة واحدة غير مقروءة.}}
    two {{لديك رسالتان غير مقروءتين.}}
    few {{لديك {$count} رسائل غير مقروءة.}}
    many {{لديك {$count} رسالة غير مقروءة.}}
    * {{لديك {$count} رسالة غير مقروءة.}}
```

`{$count}` inside a variant is formatted as a number in the locale being rendered. `equator check`
reports a translation that leaves out a category its language has.

The inputs are the pipe's argument:

```ts src/app/inbox.ts
import { Component } from '@angular/core';
import { LocalizePipe } from '@neolorn/equator';
import { messages } from '#i18n/inbox';

@Component({
  selector: 'app-inbox',
  imports: [LocalizePipe],
  template: `<p>{{ messages.unread | localize: { count: unreadCount } }}</p>`,
})
export class Inbox {
  protected readonly messages = messages;
  protected readonly unreadCount = 3;
}
```

```sh run
npx equator generate
```

A date or a time is formatted in a time zone, which [How to format values](format-values.md)
covers.

## Related

- [How to render a message](render-messages.md)
- [How to translate catalogs](translate-catalogs.md)
- [About how a locale is resolved](../explanation/about-locale-resolution.md), for which locale
  supplies a message a translation omits
