import { capabilityClaimsReporters } from '../tools/capability-evidence.ts';

/**
 * One worker, one file at a time, for the reason the feature lab's runner configuration gives: the
 * answer then does not depend on how many cores the machine has.
 */
export default {
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // This application sits one directory inside the seat, whose stamp names the consumer row.
    reporters: capabilityClaimsReporters({ consumer: '..' }),
  },
};
