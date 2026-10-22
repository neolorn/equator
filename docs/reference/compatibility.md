# Compatibility

The versions an install accepts, and the versions each release is run on. Every range is read
out of the package manifests.

This page is generated from the packages and is not edited by hand.

## Node

`^22.22.3 || ^24.15.0 || ^26.0.0`

The suites run at the lowest version of every line the range admits, and on the version this
repository develops on:

`22.22.3`, `24.15.0`, `26.0.0`, `26.10.0`.

The development row below is also installed, tested, built and served on `22.22.3` and `24.15.0`,
the lowest version of each line other than the one this repository develops on.

## Angular, TypeScript and RxJS

| What                | Range                           |
| ------------------- | ------------------------------- |
| `@angular/core`     | `>=22.0.0 <23.0.0`              |
| `@angular/common`   | `>=22.0.0 <23.0.0`              |
| `rxjs`              | `>=7.4.0 <8.0.0`                |
| `@angular/compiler` | `>=22.0.0 <23.0.0` (build time) |
| `typescript`        | `>=6.0.2 <6.1.0` (build time)   |

Angular is a peer, not a dependency, so the copy that compiles your application is the copy Equator
compiles against. There is never a second Angular in your tree because of Equator.

## Peers you install only if you use them

`@angular/forms` at `>=22.0.0 <23.0.0`, needed if you import from `@neolorn/equator/forms`.

`@angular/router` at `>=22.0.0 <23.0.0`, needed if you import from `@neolorn/equator/router`.

`@angular/ssr` at `>=22.0.0 <23.0.0`, needed if you import from `@neolorn/equator/ssr`.

Leave one out and the entry point that needs it is the only thing you cannot import. A
browser-only application installs none of the three.

## The combinations that are built and tested

| Row                             | Angular  | TypeScript | RxJS    |
| ------------------------------- | -------- | ---------- | ------- |
| Equator development row         | `22.2.1` | `6.0.3`    | `7.8.2` |
| Angular patch compatibility row | `22.0.4` | `6.0.3`    | `7.8.2` |
| Demanding compiler options      | `22.2.1` | `6.0.3`    | `7.8.2` |
| Lowest supported versions       | `22.0.0` | `6.0.2`    | `7.4.0` |

Each row builds a real application against the packages and runs it. The lower bound row's
versions are the floors of the ranges above, read from the same manifests, so the row moves when a
floor moves.

Angular ships its framework and its build tooling on separate patch trains, so the two sit at
different versions on the same day, and a row that pins only the framework leaves the tooling
unwatched.

`@angular/build` before 22.1.7 finishes a build in which a prerendered page failed to render and
writes no file for that page. A page Equator refuses after it has started rendering, such as one
that declares its outcome while prerendering, is then missing from the output instead of failing
the build.

## Browsers

Equator targets what your Angular build targets. It adds no browser requirement of its own beyond
`Intl`, which every browser Angular supports has had for years.

What varies between browsers is the data behind `Intl`. Two browsers can format the same date
slightly differently in the same locale, so assert on what your application does with the result
rather than on the exact string, which is
[How to test localized output](../how-to/test-localized-output.md).

## Formatting a host does not provide

Equator formats with the host's own `Intl`. On a host without the capability a function needs,
that function returns a failure with the code `unsupported-formatting-capability` rather than an
approximation.

These are the hosts each release is run on that lack one:

| Host           | Missing               | What fails there                                  |
| -------------- | --------------------- | ------------------------------------------------- |
| Node `22.22.3` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |

## When a version outside the range is installed

The toolkit checks the host before the compiler does anything and refuses with `EQ1806` rather
than attempting a best effort. A refusal names what it found and what it wanted, so the fix is
the install rather than a bisect.
