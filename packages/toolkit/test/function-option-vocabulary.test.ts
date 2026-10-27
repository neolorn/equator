import { describe, expect, it, vi } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';

/**
 * Every built-in function declares the options it accepts, and the compiler builds the
 * formatter the evaluator will build for all of them rather than for the numeric six.
 *
 * The failure it guards against is the reason the check is shaped this way. A lookup in a table
 * that holds only the numeric family, returning when the function is absent, accepts **every option
 * name and every option value written on `:string`, `:datetime`, `:date` and `:time` unread**, and
 * that fails in two directions at once: messages that compile and throw while rendering, and
 * messages that compile, render, and ignore the option the author wrote.
 *
 * The exhaustive half of this lives in `tools/verify-message-function-space.ts`, which generates
 * its cases from the table and runs in the gate. What is here is the named cases: the ones a
 * reader needs to see spelled out, and the ones whose diagnostics a person has to be able to act on.
 */
describe('the option vocabulary of the built-in functions', () => {
  const refusal = (source: string): string => {
    const result = parseMessageSemanticModel(source);
    expect(result.ok, `${source} was accepted`).toBe(false);
    if (result.ok) return '';
    return result.diagnostics.map(({ summary }) => summary).join(' | ');
  };

  const accepted = (source: string): void => {
    const result = parseMessageSemanticModel(source);
    expect(
      result.ok,
      `${source} was refused: ${result.ok ? '' : result.diagnostics.map(({ summary }) => summary).join(' | ')}`,
    ).toBe(true);
  };

  describe('the date family', () => {
    it.each([
      ['fields', '{$d :date fields=weekday}'],
      ['length', '{$d :date length=long}'],
      ['dateFields', '{$d :datetime dateFields=month-day-weekday}'],
      ['dateLength', '{$d :datetime dateLength=short}'],
      ['timePrecision', '{$d :datetime timePrecision=second}'],
      ['precision', '{$d :time precision=hour}'],
      ['timeZoneStyle', '{$d :time timeZoneStyle=long}'],
      ['hour12', '{$d :time hour12=false}'],
      ['calendar', '{$d :date calendar=buddhist}'],
      ['timeZone', '{$d :date timeZone=|Europe/Paris|}'],
    ])('accepts %s, which the standard requires it to', (_name, source) => {
      accepted(source);
    });

    it('refuses an option no date function has', () => {
      expect(refusal('{$d :date nosuchoption=1}')).toContain(
        'is not an option of :date; it takes calendar, fields, length, timeZone',
      );
    });

    /**
     * `:datetime` writes `dateFields` and `dateLength` where `:date` writes `fields` and `length`,
     * and the specification does not let either borrow the other's spelling.
     */
    it('refuses one function spelling of an option on another', () => {
      expect(refusal('{$d :date dateFields=weekday}')).toContain(
        'is not an option of :date',
      );
      expect(refusal('{$d :datetime fields=weekday}')).toContain(
        'is not an option of :datetime',
      );
    });

    it('refuses a value outside the option', () => {
      expect(refusal('{$d :date fields=nosuch}')).toContain(
        'is not one of weekday, day-weekday, month-day, month-day-weekday, year-month-day, year-month-day-weekday',
      );
      expect(refusal('{$d :time hour12=maybe}')).toContain(
        'is not true or false',
      );
    });

    /**
     * *"The `fields` and `length` option values MUST each be set by a literal."* Everything except
     * the three date/time override options, which describe the environment rather than the message.
     */
    it('refuses a variable where the standard requires a literal, and allows one where it does not', () => {
      expect(
        refusal('.input {$f :string}\n{{When: {$d :date fields=$f}}}'),
      ).toContain('must be a literal, not a variable reference');
      accepted('.input {$z :string}\n{{When: {$d :date timeZone=$z}}}');
    });
  });

  /**
   * A time zone's valid values are a body of data rather than a rule. A calendar is judged by how
   * its name is written and not by which calendars the compiling machine has.
   */
  describe('the two options that name data', () => {
    /**
     * The pinned time-zone database decides, and the host is not asked: a host reads a clock
     * offset as a zone and hosts differ in which zones they have, so a message judged by the
     * machine that compiles it would compile on one machine and not on another.
     */
    it.each([
      ['a zone', 'Asia/Tokyo'],
      ['a former name the database links', 'Asia/Calcutta'],
      ['a name in another case', 'europe/paris'],
      ['a fixed offset the database names', 'Etc/GMT-14'],
      ['UTC', 'UTC'],
    ])('compiles %s without asking the host', (_title, zone) => {
      const built = vi.spyOn(Intl, 'DateTimeFormat');

      accepted(`{$d :date timeZone=|${zone}|}`);

      expect(built).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it.each([
      ['a name the database does not carry', 'Nowhere/Nowhere'],
      ['a clock offset, which the host reads as a zone', '+05:00'],
      ['a name with a space after it', 'UTC '],
      ['the empty name', ''],
    ])('refuses %s', (_title, zone) => {
      // The host takes the offset, which is why it is not the judge.
      expect(
        () => new Intl.DateTimeFormat('en', { timeZone: '+05:00' }),
      ).not.toThrow();
      expect(refusal(`{$d :date timeZone=|${zone}|}`)).toContain(
        'is not a time zone identifier such as UTC or Europe/Paris',
      );
    });

    it('refuses a zone an operand carries that the database does not name', () => {
      expect(
        refusal('.local $x = {$d :datetime timeZone=|+05:00|}\n{{{$x :date}}}'),
      ).toContain('is not a time zone identifier such as UTC or Europe/Paris');
    });

    /**
     * Which calendars exist is the host's data, and the machine that compiles is not the one that
     * renders. A name is judged by how UTS #35 writes one, so every machine gives a message the
     * same answer, and a well-formed name the rendering host does not count in is reported where
     * the date is formatted.
     */
    it.each(['japanese', 'islamic-civil', 'ethiopic-amete-alem', 'nosuch'])(
      'compiles the well-formed calendar name %s without asking the host',
      (calendar) => {
        const supported = vi.spyOn(Intl, 'supportedValuesOf');
        const built = vi.spyOn(Intl, 'DateTimeFormat');

        accepted(`{$d :date calendar=${calendar}}`);

        expect(supported).not.toHaveBeenCalled();
        expect(built).not.toHaveBeenCalled();
        vi.restoreAllMocks();
      },
    );

    it.each([
      ['in upper case', 'HEBREW'],
      ['in mixed case', 'Hebrew'],
      ['of two characters', 'ab'],
      ['of nine characters', 'gregorian'],
      ['ended by a hyphen', '|hebrew-|'],
      ['joined by two hyphens', '|islamic--civil|'],
      ['with a space', '|islamic civil|'],
      ['with a mark', '|!!|'],
      ['that is empty', '||'],
    ])('refuses a calendar name %s', (_title, calendar) => {
      expect(refusal(`{$d :date calendar=${calendar}}`)).toContain(
        'is not a calendar name such as gregory or islamic-civil, written in lower case',
      );
    });
  });

  /**
   * `timeZone=input` names the operand's own zone. An Equator date input is a `Date` and carries
   * none, so the only operand that can answer is one whose declaration wrote a zone.
   *
   * The specification's answer when nothing does is a Bad Operand error at format time beside a
   * rendered fallback. Section 6 of `specs/04-message-authoring-and-catalogs.spec.md` declines
   * that, and the reason is sharper here
   * than almost anywhere: the fallback formats the instant in whatever zone the consumer's context
   * happens to hold, which either side of midnight is a different day on the screen with no
   * indication that anything went wrong.
   */
  describe('timeZone=input', () => {
    it('is refused when nothing in the message gives the operand a zone', () => {
      expect(refusal('{$d :date timeZone=input}')).toContain(
        'names the time zone of its operand, and nothing in this message gives the operand one',
      );
    });

    it('is accepted when the operand carries one', () => {
      accepted(
        '.local $t = {$d :datetime timeZone=|Asia/Tokyo|}\n{{When: {$t :date timeZone=input}}}',
      );
    });

    it('is refused when the operand is annotated but writes no zone', () => {
      expect(
        refusal(
          '.local $t = {$d :datetime dateLength=long}\n{{When: {$t :date timeZone=input}}}',
        ),
      ).toContain('nothing in this message gives the operand one');
    });
  });

  /**
   * *"The function `:string` has no options."* An empty vocabulary is a statement, and the one that
   * turns `{$s :string case=upper}` from a message that renders unchanged into a refusal.
   */
  it('refuses any option on :string, which the specification gives none', () => {
    expect(refusal('{$s :string case=upper}')).toContain(
      'is not an option of :string, which the specification gives none',
    );
  });

  it('leaves u: options alone, which belong to the syntax rather than to the function', () => {
    accepted('{$s :string u:dir=ltr}');
    accepted('{$d :date u:id=when timeZone=UTC}');
  });
});
