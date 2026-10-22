# About how a locale switch is a transaction

`changeLocale(locale)` prepares everything the arriving locale needs and commits only when all of it
is ready. Until then the page stays exactly as it was.

## Preparing before committing

A locale change touches the messages, the document's `lang` and `dir`, the address under a URL policy
that carries the locale, focus, scroll position, and whatever else registered as a participant.
Applying those as each becomes ready produces a page in two languages, an address that disagrees with
the words under it, and a screen reader announcing a change that has half happened.

The catalogs are the slow part, and they are the part that can fail. Preparing them first means the
failure mode is "nothing moved", which is a state the visitor was already in and can act on.

## What commits together

When the switch commits, the messages, the document's `lang` and `dir`, the address, focus and scroll
position move together, and so does anything registered through `registerParticipant`.

A participant is asked to prepare for the arriving locale and the commit waits for it. A content
store, a search index, a client for a system that returns localized text: each has to fetch again
before the new locale is shown, and showing the new page before they have is the same defect as
showing half a catalog. A participant that fails fails the switch.

`participants()` reports what each one is doing, which is what to render when a switch is slow enough
to show progress for.

Lifecycle hooks run around the commit, for overlays and view transitions that need to know the moment
the page changes.

## Holding the whole page, or most of it

A change is coordinated unless it asks otherwise: the commit waits for every scope the view renders,
so the wait is as long as the slowest catalog. Text below the fold or behind an interaction does not
have to be part of that wait. A progressive change commits with the scopes that are ready and loads
the ones named as progressive beside it. Equator reports where each of those stands through
`scopeReadiness` and decides nothing about the region that renders it: a placeholder, the previous
content, or nothing at all is the application's choice, because only the application knows what
that region is for.

A scope is progressive only where there is an earlier view to keep on screen. A coordinated change
loads it before committing, and a server render, a prerender and the first render in a browser load
it before rendering, because none of them has anything to show in its place. A progressive scope
that fails stays failed in its own region and does not undo the commit.

## A switch and a navigation

A switch is not a navigation. The Router's URL is still the route you are on. Only the address the visitor sees carries the locale,
and only under a policy that puts it there.

A page can have an address in one locale and none in another, where a route parameter has no
spelling there. A switch to that locale from such a page ends as `failed` with `route-unavailable`,
and the words, the address and the document's `lang` stay as they were.

A switch made while a navigation is on its way is the visitor's latest choice, so it outlives that
navigation. Where the navigation is then cancelled or fails, or lands on a page whose document
cannot be written, the visitor is back on the page they left, in the locale they switched to.

## Application state

A switch reuses the running application rather than reloading the document, so state survives it: a
visitor who changes language mid-form keeps what they typed.

## Hydration

Server-rendered HTML is claimed by hydration rather than rewritten, and hydration adopts the locale
the server chose rather than negotiating one. Content behind a deferred hydration boundary can be
claimed after a locale has changed. Angular's ordinary update pass then finds the stored binding
value no longer matching the committed locale and writes the current one over the claimed DOM, so
the block shows the committed locale. Equator adds no repair of its own for this. Content placed
behind a boundary that Angular's public APIs cannot hydrate or replace is outside that guarantee.

`renderedLocale()` reports the locale the server-rendered document was written in, and `undefined` in
a browser that rendered the page itself. Once hydration is over, the runtime reads the locale stores
again, so a remembered choice that the declared order puts first moves a server-rendered page after
its first view.

## Where the guarantee ends

A policy that puts the locale in the origin cannot hold it, because application state does not cross
origins. There, a change is reported as a redirect and the document moves instead, to the address the
page on screen has at the other origin. Where it has none there, the change fails and the document
stays. That is one of the costs of choosing that policy, and it is weighed in
[About how routing derives addresses](about-addresses.md).

## Related

- [How to add a locale switcher](../how-to/add-a-locale-switcher.md)
- [How to render on the server](../how-to/render-on-the-server.md)
- [How to extend Equator](../how-to/add-an-extension.md)
- [How to test localized output](../how-to/test-localized-output.md)
