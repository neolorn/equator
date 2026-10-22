import { describe, expect, it } from 'vitest';

import {
  UNICODE_KEYWORD_TYPE,
  isUnicodeKeywordType,
} from '../src/message-function-options.js';
import { CONFIGURATION_SCHEMA } from '../src/schemas.js';

/**
 * A calendar or a numbering system an application declares for a locale is judged by the
 * configuration schema, and one a message, a value or a formatting context names is judged by
 * `isUnicodeKeywordType`. `specs/08-formatting-parsing-and-domain.spec.md` section 4 holds a name
 * to one rule whoever named it, so the schema's pattern is the one definition and not a second
 * statement of it that can drift.
 */

type Schema = {
  readonly pattern?: string;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly additionalProperties?: Schema | boolean;
};

const declared = (
  (
    (CONFIGURATION_SCHEMA as unknown as Schema).properties?.[
      'formatting'
    ] as Schema
  ).additionalProperties as Schema
).properties as Readonly<Record<string, Schema>>;

describe.each(['numberingSystem', 'calendar'])(
  'the %s an application declares for a locale',
  (member) => {
    it('is held to the pattern a named keyword type is held to', () => {
      expect(declared[member]?.pattern).toBe(UNICODE_KEYWORD_TYPE.source);
    });

    it('is a name to the schema where it is one to the rule, and only there', () => {
      const pattern = new RegExp(declared[member]?.pattern as string, 'u');

      for (const name of [
        'latn',
        'arabext',
        'gregory',
        'islamic-civil',
        'ethiopic-amete-alem',
        'LATN',
        'Hebrew',
        'ab',
        'gregorian',
        'hebrew-',
        '-hebrew',
        'islamic--civil',
        'islamic civil',
        'latn ',
        '',
      ]) {
        expect(pattern.test(name), JSON.stringify(name)).toBe(
          isUnicodeKeywordType(name),
        );
      }
    });
  },
);
