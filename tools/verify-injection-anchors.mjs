/**
 * Every injection's anchor, held to the source it names.
 *
 * An injection in `assurance-injections.mjs` or `assurance-runtime-injections.mjs` removes a
 * behavior by replacing `find` in `source`. The stages that apply them refuse an injection whose
 * text is no longer in the file, and they take minutes to reach it, the second one after a build
 * and a consumer install. This reads the same thing in under a second and builds nothing, so it
 * runs with the formatter and the linter: an edit to a line an injection is anchored on is refused
 * before a commit, not inside a gate.
 *
 * It refuses an injection whose source is gone, whose `find` is in the source no times or more than
 * once, whose `replace` changes nothing, and an id used twice in one list. It does not say the
 * injection is still caught; `verify:assurance` and `verify:assurance:runtime` say that.
 *
 * Usage: node tools/verify-injection-anchors.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { injections as fast } from './assurance-injections.mjs';
import { injections as runtime } from './assurance-runtime-injections.mjs';
import { inputsRoot } from './stage-self-test.mjs';

const root = inputsRoot();
const failures = [];
const sources = new Map();
const sourceOf = (file) => {
  if (!sources.has(file)) {
    const path = resolve(root, file);
    sources.set(
      file,
      existsSync(path) ? readFileSync(path, 'utf8') : undefined,
    );
  }
  return sources.get(file);
};

const lists = [
  ['tools/assurance-injections.mjs', fast],
  ['tools/assurance-runtime-injections.mjs', runtime],
];
let count = 0;
for (const [list, injections] of lists) {
  const seen = new Set();
  for (const { id, source, find, replace } of injections) {
    count += 1;
    const where = `${list}: ${id}`;
    if (seen.has(id)) failures.push(`${where}: the id is used twice.`);
    seen.add(id);
    if (typeof find !== 'string' || find === '') {
      failures.push(`${where}: the injection names no text to find.`);
      continue;
    }
    if (find === replace) {
      failures.push(`${where}: the replacement is the text it replaces.`);
    }
    const text = sourceOf(source);
    if (text === undefined) {
      failures.push(`${where}: ${source} does not exist.`);
      continue;
    }
    // Read as the runners read it, byte for byte, so a pass here is a match there.
    const occurrences = text.split(find).length - 1;
    if (occurrences !== 1) {
      failures.push(
        `${where}: the text it finds is in ${source} ${occurrences} time(s), and an injection is applied where it is there once.`,
      );
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `${failures.length} injection(s) no longer describe the source they patch:\n${failures
      .map((failure) => `  ${failure}\n`)
      .join('')}`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Injection anchors verified: ${count} injections each find their text once in the file they name.\n`,
  );
}
