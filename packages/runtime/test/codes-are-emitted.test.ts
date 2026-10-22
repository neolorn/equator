/**
 * Every event code and failure code the runtime declares is one it produces.
 *
 * `specs/11-diagnostics-and-observability.spec.md` section 1 lists the areas a release reports
 * on, and section 4 has every code documented. A code declared and never produced reads, to a
 * consumer filtering on it, as an area where nothing goes wrong, which is the one reading the list
 * is there to rule out. The cases read the sources, because an unproduced code has no behavior to
 * drive.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RUNTIME_EVENT_CODES } from '../src/observability.js';

const RUNTIME = fileURLToPath(new URL('..', import.meta.url));

function sourceLines(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'test', 'dist'].includes(entry.name)
        ? []
        : sourceLines(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
      ? readFileSync(path, 'utf8').split('\n')
      : [];
  });
}

const lines = sourceLines(RUNTIME);

/**
 * The failure codes, read from the union that declares them, so a code added there is checked
 * without anyone listing it here.
 */
const failureCodes = [
  ...(
    /export type LocalizationFailureCode =([\s\S]*?);/u.exec(
      readFileSync(join(RUNTIME, 'core/src/contracts.ts'), 'utf8'),
    )?.[1] ?? ''
  ).matchAll(/'([a-z-]+)'/gu),
].map(([, code]) => code as string);

/**
 * A line that produces the code rather than declaring, comparing, or matching it: a union member,
 * an equality test, a `case` label and a type annotation all name a code without producing one.
 */
function produces(line: string, code: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.includes(`'${code}'`) &&
    !trimmed.startsWith('|') &&
    !trimmed.startsWith('*') &&
    !trimmed.startsWith('//') &&
    !trimmed.startsWith('case ') &&
    !/[=!]==\s*'/u.test(trimmed) &&
    !/'\s*[=!]==/u.test(trimmed) &&
    !/^readonly \w+\??:/u.test(trimmed)
  );
}

describe('the runtime codes', () => {
  it('reads the failure codes from their declaration', () => {
    expect(failureCodes).toContain('catalog-load-failed');
    expect(failureCodes.length).toBeGreaterThan(20);
  });

  it.each(Object.keys(RUNTIME_EVENT_CODES))(
    'emits the %s event code somewhere',
    (area) => {
      expect(
        lines.some((line) => line.includes(`RUNTIME_EVENT_CODES.${area}`)),
      ).toBe(true);
    },
  );

  it.each(failureCodes)('produces the %s failure code somewhere', (code) => {
    expect(lines.filter((line) => produces(line, code))).not.toEqual([]);
  });
});
