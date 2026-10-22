# Cost

What each entry point adds to an application, what the generated contracts and the compiler produce, and what the packages weigh. Every figure is in bytes.

This page is generated from the packages and is not edited by hand.

## How it is measured

Two applications install the built packages and are built for production with the Angular CLI (`@angular/build` 22.2.1), which links the partially compiled runtime and removes what nothing reaches. Compressed sizes are gzip at level 9 and Brotli at quality 11, per file, on Node 26.10.0.

- Minimal consumer: selects the setup, one locale switcher and the recovery message, and nothing else.
- Full consumer: selects routing, forms, server rendering, hydration and the request handler.

The initial files are the browser entry and every file it imports statically. Lazy files are the other browser files, and server files are the server build.

## Entry points

The bytes of each entry point's own module in each build, before compression, as the build's metafile attributes them. An entry point that reaches another counts only its own bytes.

| Entry point                | Minimal consumer, initial | Minimal consumer, lazy | Minimal consumer, server | Full consumer, initial | Full consumer, lazy | Full consumer, server |
| -------------------------- | ------------------------: | ---------------------: | -----------------------: | ---------------------: | ------------------: | --------------------: |
| `@neolorn/equator`         |                   222,083 |                      0 |                        0 |                294,504 |                   0 |               252,573 |
| `@neolorn/equator/core`    |                    30,320 |                      0 |                        0 |                 69,754 |                   0 |               121,208 |
| `@neolorn/equator/forms`   |                         0 |                      0 |                        0 |                  4,385 |                   0 |                 3,549 |
| `@neolorn/equator/http`    |                         0 |                      0 |                        0 |                      0 |                   0 |                 6,886 |
| `@neolorn/equator/router`  |                         0 |                      0 |                        0 |                 41,325 |                   0 |                34,360 |
| `@neolorn/equator/ssr`     |                         0 |                      0 |                        0 |                      0 |                   0 |                   153 |
| `@neolorn/equator/testing` |                         0 |                      0 |                        0 |                      0 |                   0 |                     0 |

## Locale data in the runtime

The tables the formatters walk where a context names a locale the host has no data for, generated from the pinned CLDR release and measured as they stand in the primary entry point's module. They are why such a locale is written the same way on every host, and they count toward that entry point.

| Table                                                             | Bytes |  gzip | Brotli |
| ----------------------------------------------------------------- | ----: | ----: | -----: |
| The parent locales of the pinned CLDR release, for each component | 4,254 |   845 |    688 |
| The likely script of each language the host may have data for     | 1,999 | 1,127 |    947 |

## Applications

Everything each build emits, including Angular and the application itself.

| Application      | Part    | Files |     Bytes |    gzip |  Brotli |
| ---------------- | ------- | ----: | --------: | ------: | ------: |
| Minimal consumer | initial |     1 |   342,442 | 104,110 |  89,312 |
| Minimal consumer | lazy    |     4 |     8,758 |   4,299 |   3,521 |
| Minimal consumer | server  |     0 |         0 |       0 |       0 |
| Full consumer    | initial |     1 |   738,781 | 214,375 | 179,243 |
| Full consumer    | lazy    |     6 |    63,160 |  17,535 |  15,375 |
| Full consumer    | server  |    20 | 1,637,774 | 479,732 | 413,217 |

## Generated contracts

The generated code in the initial files, and each lazily loaded catalog: one scope in one locale.

### Minimal consumer

Generated code in the initial files: 13,835 bytes.

| Scope | Locale | Bytes |  gzip | Brotli |
| ----- | ------ | ----: | ----: | -----: |
| shell | ar     | 2,333 | 1,138 |    916 |
| shell | ar-EG  | 2,042 | 1,040 |    851 |
| shell | en-US  | 2,259 | 1,037 |    862 |
| shell | th     | 2,124 | 1,084 |    892 |

### Full consumer

Generated code in the initial files: 51,271 bytes.

| Scope | Locale |  Bytes |  gzip | Brotli |
| ----- | ------ | -----: | ----: | -----: |
| lazy  | ar-EG  |    944 |   603 |    493 |
| lazy  | en-US  |    926 |   568 |    464 |
| shell | ar-EG  | 25,962 | 6,353 |  5,514 |
| shell | en-US  | 24,040 | 5,807 |  5,170 |

## Compiler output

What `equator generate` writes for each application. A second run over unchanged inputs writes nothing, which the consumer stages assert.

| Application      | Files |   Bytes |
| ---------------- | ----: | ------: |
| Minimal consumer |    15 |  42,310 |
| Full consumer    |    16 | 179,696 |

## Packages

Each entry point as published, unminified, and each package as installed, source maps and declarations included.

| Entry point                |   Bytes |   gzip | Brotli |
| -------------------------- | ------: | -----: | -----: |
| `@neolorn/equator`         | 431,434 | 91,471 | 73,580 |
| `@neolorn/equator/core`    | 118,781 | 30,879 | 24,969 |
| `@neolorn/equator/forms`   |   7,177 |  2,251 |  1,958 |
| `@neolorn/equator/http`    |  13,826 |  4,159 |  3,624 |
| `@neolorn/equator/router`  |  56,922 | 13,446 | 11,576 |
| `@neolorn/equator/ssr`     |     658 |    310 |    275 |
| `@neolorn/equator/testing` |   9,654 |  3,218 |  2,753 |

| Package                    | Files |     Bytes |
| -------------------------- | ----: | --------: |
| `@neolorn/equator`         |    38 | 3,210,904 |
| `@neolorn/equator-toolkit` |   238 | 4,004,657 |
