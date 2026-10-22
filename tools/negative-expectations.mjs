/**
 * Matching a negative compilation file's `// EXPECT:` lines against what the compiler reported.
 *
 * An expectation is met only by a diagnostic located in the code it stands above: from the line
 * after it to the line before the next expectation. Matched against the whole output instead, one
 * case that still fails keeps a neighbour that stopped failing looking caught whenever both report
 * the same text.
 */

// The compiler colours its output when it decides it may, and a colour code can fall inside the
// location a diagnostic is matched by.
const ANSI = /\u001b\[[0-9;]*m/gu;

// Both of the compiler's formats: `file:line:col - error TS1: …` and `file(line,col): error TS1: …`.
const DIAGNOSTIC =
  /^(?<file>.+?)(?::(?<line>\d+):\d+ - |\((?<parenLine>\d+),\d+\): )error TS\d+: (?<message>.*)$/u;

/** The diagnostics the output reports against `file`, each with its line and its full message. */
export function reportedDiagnostics(output, file) {
  const lines = output.replace(ANSI, '').split(/\r?\n/u);
  const diagnostics = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = DIAGNOSTIC.exec(lines[index] ?? '');
    if (match?.groups === undefined) continue;
    const { groups } = match;
    if (groups.file.replaceAll('\\', '/') !== file) continue;
    // A message continues on the indented lines under its first one.
    const message = [groups.message];
    while (/^ {2,}\S/u.test(lines[index + 1] ?? '')) {
      index += 1;
      message.push((lines[index] ?? '').trim());
    }
    diagnostics.push({
      line: Number(groups.line ?? groups.parenLine),
      message: message.join('\n'),
    });
  }
  return diagnostics;
}

/** Each expectation in `source`, with the lines of code it stands above. */
export function expectations(source) {
  const lines = source.split(/\r?\n/u);
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\/\/ EXPECT: (.+)$/u.exec(lines[index] ?? '');
    if (match !== null) {
      found.push({ line: index + 1, text: (match[1] ?? '').trim() });
    }
  }
  // Consecutive expectations describe one statement, so they share the code after the last of them.
  return found.map((expectation, index) => {
    let last = index;
    while (found[last + 1]?.line === found[last].line + 1) last += 1;
    const next = found.slice(last + 1)[0];
    return {
      ...expectation,
      from: found[last].line + 1,
      to: next === undefined ? Number.POSITIVE_INFINITY : next.line - 1,
    };
  });
}

/** The expectations no diagnostic in their own code meets. */
export function unmetExpectations(source, output, file) {
  const diagnostics = reportedDiagnostics(output, file);
  return expectations(source).filter(
    ({ text, from, to }) =>
      !diagnostics.some(
        ({ line, message }) =>
          line >= from && line <= to && message.includes(text),
      ),
  );
}
