import { describe, expect, it } from 'vitest';

import {
  parseMessageSemanticModel,
  type MessageExpression,
  type MessageMarkup,
  type MessageSemanticModel,
} from '../src/message-format.js';

/**
 * The parts of a message's model that do not follow the order or the spelling it was written in.
 *
 * Two writings of one message differ in the order of their options, their attributes and their
 * placeholders. The model lists each of those by code point, so a consumer that compares two models
 * or serializes one sees the same thing for both. A field the syntax has no way to write is left
 * off the model instead of being carried as a key with nothing in it.
 */

function model(source: string): MessageSemanticModel {
  const result = parseMessageSemanticModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function bodyOf(source: string) {
  const parsed = model(source);
  if (parsed.kind !== 'pattern') throw new Error('expected a plain message');
  return parsed.pattern;
}

function expressionOf(source: string): MessageExpression {
  const part = bodyOf(source).find(
    (each): each is MessageExpression =>
      typeof each !== 'string' && each.kind === 'expression',
  );
  if (part === undefined) throw new Error('expected a placeholder');
  return part;
}

function markupOf(source: string): MessageMarkup {
  const part = bodyOf(source).find(
    (each): each is MessageMarkup =>
      typeof each !== 'string' && each.kind === 'markup',
  );
  if (part === undefined) throw new Error('expected markup');
  return part;
}

describe('the options and attributes of a normalized message', () => {
  it('lists the options of a function by code point, whatever order they were written in', () => {
    const written = expressionOf(
      '{$n :number signDisplay=always minimumFractionDigits=2}',
    );
    const reordered = expressionOf(
      '{$n :number minimumFractionDigits=2 signDisplay=always}',
    );

    expect(Object.keys(written.function?.options ?? {})).toEqual([
      'minimumFractionDigits',
      'signDisplay',
    ]);
    expect(Object.keys(reordered.function?.options ?? {})).toEqual([
      'minimumFractionDigits',
      'signDisplay',
    ]);
  });

  it('lists the options of markup by code point, whatever order they were written in', () => {
    expect(
      Object.keys(markupOf('{#link title=|Home| href=|/|}Home{/link}').options),
    ).toEqual(['href', 'title']);
  });

  it('lists the attributes of a placeholder by code point, whatever order they were written in', () => {
    expect(
      Object.keys(expressionOf('{$name @zeta @alpha}').attributes),
    ).toEqual(['alpha', 'zeta']);
    expect(
      Object.keys(expressionOf('{$name @alpha @zeta}').attributes),
    ).toEqual(['alpha', 'zeta']);
  });

  it('lists the attributes of markup by code point, whatever order they were written in', () => {
    expect(
      Object.keys(markupOf('{#b @zeta=one @alpha=two}bold{/b}').attributes),
    ).toEqual(['alpha', 'zeta']);
  });
});

describe('the names a normalized message reports', () => {
  it('lists the inputs it takes from outside by code point, not in the order it uses them', () => {
    expect(model('{$zeta} and {$alpha}').externalInputs).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('lists the functions it calls by code point, not in the order it calls them', () => {
    expect(model('{$a :string} and {$b :number}').functions).toEqual([
      'number',
      'string',
    ]);
  });
});

describe('a field the message syntax cannot write', () => {
  it('is left off a catch-all key, which has only its kind', () => {
    const parsed = model(
      '.input {$n :number}\n.match $n\none {{one}}\n* {{many}}',
    );
    if (parsed.kind !== 'select') throw new Error('expected a selection');

    expect(parsed.variants.map(({ keys }) => keys.map(Object.keys))).toEqual([
      [['kind', 'value']],
      [['kind']],
    ]);
  });

  it('is left off the model, which carries no comment', () => {
    expect(Object.hasOwn(model('Hello'), 'comment')).toBe(false);
    expect(
      Object.hasOwn(
        model('.input {$n :number}\n.match $n\n* {{many}}'),
        'comment',
      ),
    ).toBe(false);
  });
});
