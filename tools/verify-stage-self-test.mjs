/**
 * `<stage>:self-test`: the named stage, shown refusing each defect `stage-plants.mjs` plants for it.
 *
 * Usage: node tools/verify-stage-self-test.mjs <stage>
 */
import { stageSelfTests } from './stage-plants.mjs';
import { verifyStagePlants } from './stage-self-test.mjs';

const stage = process.argv[2];
const entry = stageSelfTests[stage];
if (entry === undefined) {
  throw new Error(
    `No self-test is declared for ${stage}. Declared: ${Object.keys(stageSelfTests).join(', ')}.`,
  );
}
const failures = await verifyStagePlants({ stage, ...entry });
if (failures > 0) process.exitCode = 1;
