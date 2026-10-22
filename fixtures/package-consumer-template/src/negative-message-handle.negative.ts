import {
  resolveLocalizedRoute,
  type Localization,
  type PlainMessageHandle,
} from '@neolorn/equator';
import { messages } from '#i18n/shell';

import { routePolicy, appRouteProjection } from './app/localization.routes';

declare const localization: Localization;

/**
 * Message-handle and route-resolution calls that must not compile.
 *
 * Each fix here could have been made by loosening the contract instead of correcting it, and the
 * loosened version passes every positive assertion in `type-contracts.spec.ts`. These are the
 * cases that tell the two apart.
 *
 * Separate from the route and template negatives because the verifier compiles one negative file
 * at a time: the Angular compiler reports template diagnostics only for a program with no ordinary
 * TypeScript errors, so a file carrying both kinds proves half of what it claims.
 */

// 2.1's *Fails when*: loosening `MessageInputArguments` to `readonly [inputs?: …]` makes
// `text(handle)` compile for every handle, including one whose message requires inputs. That
// passes the positive case and silently drops the requiredness guarantee for every typed message
// in the application.
// EXPECT: Expected 2 arguments, but got 1
localization.text(messages.welcome);

// The same guarantee from the other side: an input the message does not declare.
// EXPECT: 'nmae' does not exist in type
localization.text(messages.welcome, { nmae: 'Equator' });

// A structured handle is not a plain one. `PlainMessageHandle` widening far enough to accept the
// call above would generally also accept this, and a structured message rendered through the plain
// path loses its slots.
// EXPECT: is not assignable to type 'PlainMessageHandle'
const structuredAsPlain: PlainMessageHandle = messages.learnMore;

// The catalog is the only author of a message's words, so a call site cannot carry wording of its
// own beside the inputs for the runtime to fall back to.
// EXPECT: Expected 2 arguments, but got 3
localization.text(messages.welcome, { name: 'Equator' }, 'Welcome back');

// A signal of a message is evaluated as the message is, so it needs the same inputs, whether they
// are given as values or as a signal of them.
// EXPECT: Expected 2 arguments, but got 1
localization.textSignal(messages.welcome);

// EXPECT: Expected 2 arguments, but got 1
localization.partsSignal(messages.hostile.rich);

// A handle is what the runtime is passed, and a qualified string spelled to look like one is not
// accepted in its place.
// EXPECT: Argument of type 'string' is not assignable to parameter of type
localization.text('shell:shell:welcome');

// 2.2's *Fails when*: adding the generic but leaving the return `string`. The round trip compiles
// either way, so the assertion that catches it is on the inferred literal type: a route identity
// this projection does not declare must not be assignable to what the resolution returns.
const resolution = resolveLocalizedRoute(
  '/en-us',
  routePolicy,
  appRouteProjection,
);
if (resolution.status === 'success') {
  // EXPECT: Type '"itemm"' is not assignable
  const typo: typeof resolution.routeId = 'itemm';
  void typo;
}

void structuredAsPlain;
