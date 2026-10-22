/**
 * Every event code the toolkit declares is one it emits.
 *
 * `specs/11-diagnostics-and-observability.spec.md` section 1 lists the areas a release reports
 * on. A code declared and never emitted reads, to a consumer filtering on it, as an area where
 * nothing goes wrong. The toolkit's diagnostic codes are held to the same by the diagnostics
 * reference, which refuses one documented and raised nowhere; this covers the event codes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TOOLKIT_EVENT_CODES } from '../src/index.js';

const SOURCE = fileURLToPath(new URL('../src', import.meta.url));

const text = readdirSync(SOURCE, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
  .join('\n');

describe('the toolkit event codes', () => {
  it.each(Object.keys(TOOLKIT_EVENT_CODES))(
    'emits the %s event code somewhere',
    (area) => {
      expect(text).toContain(`TOOLKIT_EVENT_CODES.${area}`);
    },
  );
});
