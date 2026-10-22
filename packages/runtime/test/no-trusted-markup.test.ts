import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The runtime never turns a result into markup the browser will trust.
 *
 * `specs/06-runtime-and-angular.spec.md` section 2 and `specs/09-safe-content-and-ux.spec.md` section 2: a
 * structured result is rendered as text and elements Angular creates, and what may be trusted is
 * decided by the safe-content rules, not by the runtime on its own. Each of these is a way to hand
 * the browser a string to parse as HTML, or to tell Angular to stop sanitizing one, and none of
 * them has a reason to appear in the runtime's source. A rendering test would only see the ones on
 * the paths it happens to render, so the source is read instead.
 */

const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));

const TRUSTED_MARKUP =
  /\bbypassSecurityTrust\w*|\bDomSanitizer\b|\b(?:inner|outer)HTML\b|\binsertAdjacentHTML\b|\bcreateContextualFragment\b|\bdocument\.write(?:ln)?\b|\bsrcdoc\b|\bparseFromString\b/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const sourceDirectories = [
  join(runtimeRoot, 'src'),
  ...readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runtimeRoot, entry.name, 'src'))
    .filter((directory) => {
      try {
        return readdirSync(directory).length > 0;
      } catch {
        return false;
      }
    }),
];

describe('the runtime source', () => {
  it('is read in full, every entry point included', () => {
    const roots = sourceDirectories.map((directory) =>
      directory.slice(runtimeRoot.length).replaceAll('\\', '/'),
    );
    expect(roots).toEqual(
      expect.arrayContaining([
        'src',
        'core/src',
        'router/src',
        'http/src',
        'ssr/src',
      ]),
    );
    expect(sourceDirectories.flatMap(sourceFiles).length).toBeGreaterThan(40);
  });

  it('recognizes each way of trusting markup', () => {
    for (const written of [
      'this.sanitizer.bypassSecurityTrustHtml(parts.text)',
      'inject(DomSanitizer)',
      'element.innerHTML = value',
      "[innerHTML]='html'",
      'element.outerHTML = value',
      "element.insertAdjacentHTML('beforeend', value)",
      'range.createContextualFragment(value)',
      'document.write(value)',
      "frame.setAttribute('srcdoc', value)",
      "new DOMParser().parseFromString(value, 'text/html')",
    ]) {
      expect(TRUSTED_MARKUP.test(written), written).toBe(true);
    }
    expect(TRUSTED_MARKUP.test('element.textContent = value')).toBe(false);
  });

  it('trusts no markup anywhere', () => {
    const offending = sourceDirectories.flatMap(sourceFiles).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          TRUSTED_MARKUP.test(line)
            ? [`${file.slice(runtimeRoot.length)}:${index + 1}`]
            : [],
        ),
    );
    expect(offending).toEqual([]);
  });
});
