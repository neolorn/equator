import { expect, it } from 'vitest';

import type { ZonedDateTimeValue } from '@neolorn/equator/core';
import { formatZonedDateTime, instant } from '../src/formatting.js';

it('keeps the calendar of the context for a zoned value that names none', () => {
  // 2024-03-14T12:00:00Z
  const moment = instant('1710417600000000000');
  const value = {
    kind: 'zoned-date-time',
    instant: moment,
    timeZone: 'UTC',
  } as unknown as ZonedDateTimeValue;
  const result = formatZonedDateTime(
    value,
    { locale: 'en-US', calendar: 'buddhist' },
    { year: 'numeric' },
  );
  expect(result.ok && result.value.text).toContain('2567');
});
