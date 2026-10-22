import { describe, expect, it } from 'vitest';

import { dynamicAssetParticipantReport } from '../src/assets.js';
import { refusalOf } from './compiled-artifact-harness.js';

/**
 * What a participant reports for an asset that ended in an outcome of the application's own.
 *
 * `DynamicAssetParticipantReportInput` gives a report four outcomes, and a domain outcome is the
 * one that carries the application's code: a document withdrawn, an image under review. The code
 * is the application's word, held to the identity grammar because it is logged beside Equator's.
 */

describe('a dynamic asset that ended in a domain outcome', () => {
  it('reports the outcome under the code the application gave', () => {
    const report = dynamicAssetParticipantReport({
      assetId: 'doc.deed',
      status: 'domain-outcome',
      code: 'deed.withdrawn',
    });

    expect(report).toStrictEqual({
      status: 'domain-outcome',
      outcome: 'consumer-domain-outcome',
      code: 'deed.withdrawn',
      identity: { resourceId: 'doc.deed' },
    });
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('carries the representation it came with', () => {
    expect(
      dynamicAssetParticipantReport({
        assetId: 'doc.deed',
        status: 'domain-outcome',
        code: 'deed.withdrawn',
        representation: { kind: 'language-independent' },
      }),
    ).toStrictEqual({
      status: 'domain-outcome',
      outcome: 'consumer-domain-outcome',
      code: 'deed.withdrawn',
      identity: { resourceId: 'doc.deed' },
      representation: { kind: 'language-independent' },
    });
  });

  it('is refused as a configuration failure for a code outside the identity grammar', () => {
    for (const code of ['', '.withdrawn', 'deed withdrawn']) {
      const refusal = refusalOf(() =>
        dynamicAssetParticipantReport({
          assetId: 'doc.deed',
          status: 'domain-outcome',
          code,
        }),
      );

      expect(refusal.diagnostic.code).toBe('invalid-configuration');
      // The outcome is what a handler branches on to tell a broken setup from a missing asset.
      expect(refusal.diagnostic.outcome).toBe('operational-failure');
    }
  });
});
