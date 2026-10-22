import { type Localization } from '@neolorn/equator';
import { messages } from '#i18n/shell';

declare const localization: Localization;
declare const greeting: boolean;

/**
 * A handle chosen at runtime between messages that take different inputs.
 *
 * The call has to be right for whichever message is chosen, so it needs the inputs of every one of
 * them. Each case below compiles when the choice is read as a whole, because the two messages have
 * no input in common and that reads as a message taking none.
 */

const chosen = greeting ? messages.welcome : messages.plural.items;

// Neither message can be evaluated without its input.
// EXPECT: Expected 2 arguments, but got 1
localization.text(chosen);

// The inputs of one message leave the other without its own.
// EXPECT: is missing in type '{ count: number; }'
localization.text(chosen, { count: 1 });

const optionallyInputs = greeting ? messages.appTitle : messages.welcome;

// One message taking nothing does not make the other's input optional.
// EXPECT: Expected 2 arguments, but got 1
localization.text(optionallyInputs);
