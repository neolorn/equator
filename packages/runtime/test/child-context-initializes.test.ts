import { expect, it } from 'vitest';

import { runtime } from './transaction-runtime-harness.js';

it('initializes a child context, which has no commit hooks of its own', async () => {
  const { localization } = runtime();
  await localization.initialize();
  const child = localization.createChildContext();
  const snapshot = await child.initialize();
  expect(snapshot.primaryLocale).toBe('en-US');
  expect(child.lifecycle()).toBe('ready');
  child.dispose();
  localization.dispose();
});
