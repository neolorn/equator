import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { presentNotification } from '../src/presentation.js';
import {
  GENERATED_ABI,
  type MessageHandle,
  type PlainMessageHandle,
} from '@neolorn/equator/core';

import { PROVIDER, compileSet, scope } from './catalog-store-harness.js';
import {
  SHELL,
  TITLE,
  runtime,
  type Runtime,
} from './transaction-runtime-harness.js';

/**
 * A notification localized for a toast host, whichever kind of message it names.
 *
 * The notification names a message and may carry the values it takes. What comes back is the
 * message evaluated with those values, as text for a plain message and as parts for a structured
 * one, beside the identity it arrived with and its tone, which is information where the
 * notification states none. A message that takes no values is evaluated with none, so a
 * notification for one need not carry an empty set.
 */

const RICH = scope('rich');

const handle = <Kind extends 'plain' | 'structured'>(
  scopeId: string,
  messageId: string,
  resultKind: Kind,
  inputNames: readonly string[],
  slotNames: readonly string[],
) =>
  Object.freeze({
    generatedAbi: GENERATED_ABI,
    providerId: PROVIDER,
    scopeId,
    messageId,
    identity: `${PROVIDER}:${scopeId}:${messageId}`,
    resultKind,
    inputNames: Object.freeze([...inputNames]),
    slotNames: Object.freeze([...slotNames]),
  });

const GREETING: PlainMessageHandle = handle(
  'shell',
  'greeting',
  'plain',
  ['name'],
  [],
);
const NOTE = handle('rich', 'note', 'structured', ['name'], ['b']);
const NOTICE = handle('rich', 'notice', 'structured', [], ['b']);

type Structured = MessageHandle & { readonly resultKind: 'structured' };

describe('a notification', () => {
  let localization: Runtime;

  beforeAll(async () => {
    ({ localization } = runtime({
      set: compileSet(undefined, {
        rich: {
          'en-US':
            'messages:\n  notice: "{#b}Fixed{/b} notice"\n  note: "Hello {#b}{$name}{/b}"\n',
          'ar-EG':
            'messages:\n  notice: "إشعار {#b}ثابت{/b}"\n  note: "مرحبا {#b}{$name}{/b}"\n',
        },
      }),
      options: { bootstrapScopes: [SHELL, RICH] },
    }));
    await localization.initialize();
  });

  afterAll(() => {
    localization.dispose();
  });

  it('has a plain message evaluated as text, with the values it carries', () => {
    const notification = presentNotification(localization, {
      id: 'welcome',
      tone: 'success',
      message: GREETING,
      inputs: { name: 'Ada' },
    });

    expect(notification).toMatchObject({
      id: 'welcome',
      tone: 'success',
      content: { kind: 'text', value: 'Hello Ada' },
    });
    expect(Object.isFrozen(notification)).toBe(true);
  });

  it('has a plain message that takes no values evaluated with none, and reads as information', () => {
    expect(
      presentNotification(localization, { id: 'saved', message: TITLE }),
    ).toStrictEqual({
      id: 'saved',
      tone: 'information',
      content: localization.evaluateText(TITLE),
    });
  });

  it('has a structured message evaluated as parts, with the values it carries', () => {
    const inputs = { name: 'Ada' };
    const notification = presentNotification(localization, {
      id: 'mention',
      tone: 'warning',
      message: NOTE,
      inputs,
    });

    expect(notification).toStrictEqual({
      id: 'mention',
      tone: 'warning',
      content: localization.parts(NOTE as Structured, inputs as never),
    });
    expect(notification.content).toMatchObject({
      kind: 'parts',
      text: 'Hello Ada',
    });
  });

  it('has a structured message that takes no values evaluated with none', () => {
    const notification = presentNotification(localization, {
      id: 'notice',
      message: NOTICE,
    });

    expect(notification).toStrictEqual({
      id: 'notice',
      tone: 'information',
      content: localization.parts(NOTICE as Structured),
    });
    expect(notification.content).toMatchObject({
      kind: 'parts',
      text: 'Fixed notice',
    });
  });
});
