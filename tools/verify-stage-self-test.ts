/**
 * `<stage>:self-test`: the named stage, shown refusing each defect `stage-plants.ts` plants for it.
 *
 * Usage: node tools/verify-stage-self-test.ts <stage>
 */
import { stageSelfTests } from './stage-plants.ts';
import { verifyStagePlants } from './stage-self-test.ts';

const stage = process.argv[2] as string;
const entry = stageSelfTests[stage];
if (entry === undefined) {
  throw new Error(
    `No self-test is declared for ${stage}. Declared: ${Object.keys(stageSelfTests).join(', ')}.`,
  );
}
const failures = await verifyStagePlants({ stage, ...entry });
if (failures > 0) process.exitCode = 1;
