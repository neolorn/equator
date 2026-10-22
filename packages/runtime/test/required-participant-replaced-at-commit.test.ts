import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';

import { participant, runtime } from './transaction-runtime-harness.js';

describe('the participants a change runs on their own', () => {
  it('a required participant replaced while the change commits is prepared by its own registration', async () => {
    const first = participant('region');
    const second = participant('region');
    let made: ReturnType<typeof runtime> | undefined;
    let registration:
      | ReturnType<
          ReturnType<typeof runtime>['localization']['registerParticipant']
        >
      | undefined;
    const hook: LocalizationCommitHook = {
      apply: () => undefined,
      committed: (snapshot) => {
        if (snapshot.primaryLocale !== 'ar-EG' || registration === undefined)
          return;
        registration.unregister();
        registration = undefined;
        made?.localization.registerParticipant(second.value);
      },
    };
    made = runtime({ options: { commitHooks: [hook] } });
    const { localization } = made;
    registration = localization.registerParticipant(first.value);
    await localization.initialize();

    const result = await localization.changeLocale('ar-EG');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.status).toBe('committed');
    // The replacement is prepared once, by the run its own registration schedules after the change
    // settles, and that run has an identity of its own.
    expect(
      second.calls.filter((call) => call.startsWith('prepare')),
    ).toHaveLength(1);
    expect(second.contexts[0]?.transitionId).not.toBe(result.transitionId);
    localization.dispose();
  });
});
