/**
 * The normative statements of the specifications, read from the documents themselves.
 *
 * `specs/README.md` section 2 makes a sentence normative if and only if it carries a BCP 14 keyword
 * in capitals, so the reader is that rule and nothing else: no marker, no numbering, no list kept
 * beside the documents. A statement is one sentence, except where a sentence ends in a colon and a
 * list follows it, because the list is what the sentence requires and an edit to an item changes
 * the requirement.
 *
 * The index's own conformance-language section is left out. Its keywords are the words being
 * defined, quoted rather than used, and a map entry for "The key words MUST, ..." would bind
 * nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const KEYWORD =
  /\b(?:MUST|SHOULD|MAY|REQUIRED|RECOMMENDED|OPTIONAL|SHALL)\b/u;

const DEFINING_SECTION = {
  file: 'README.md',
  heading: '2. Conformance language',
};

const LIST_ITEM = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/u;

export interface NormativeStatement {
  readonly file: string;
  readonly section: string;
  readonly statement: string;
}

interface Block {
  readonly heading: string;
  readonly kind: 'item' | 'paragraph';
  text: string;
  claimed?: boolean;
}

/** One logical line per paragraph or list item, with its heading. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  let heading = '';
  let fence = false;
  let current: Block | undefined;
  const flush = () => {
    if (current !== undefined) out.push(current);
    current = undefined;
  };
  for (const line of text.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) {
      flush();
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const headingMatch = /^#{1,6}\s+(.*)$/u.exec(line);
    if (headingMatch !== null) {
      flush();
      heading = (headingMatch[1] as string).trim();
      continue;
    }
    if (
      line.trim() === '' ||
      /^\s*\|/u.test(line) ||
      /^\[[^\]]+\]:\s/u.test(line)
    ) {
      flush();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      flush();
      current = { heading, kind: 'item', text: (item[2] as string).trim() };
      continue;
    }
    if (current === undefined)
      current = { heading, kind: 'paragraph', text: line.trim() };
    else current.text += ` ${line.trim()}`;
  }
  flush();
  return out;
}

/**
 * Splits prose into sentences at a full stop, question mark or exclamation mark followed by a
 * space, and never inside a code span, where a dot is part of a name or a path.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let code = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '`') code = !code;
    if (code) continue;
    if (
      (character === '.' || character === '?' || character === '!') &&
      text[index + 1] === ' '
    ) {
      out.push(text.slice(start, index + 1).trim());
      start = index + 2;
    }
  }
  const rest = text.slice(start).trim();
  if (rest !== '') out.push(rest);
  return out;
}

/** The normative statements of one document, in document order. */
export function statementsOf(file: string, text: string): NormativeStatement[] {
  const statements: NormativeStatement[] = [];
  const all = blocks(text);
  for (let index = 0; index < all.length; index += 1) {
    const block = all[index] as Block;
    if (
      file === DEFINING_SECTION.file &&
      block.heading === DEFINING_SECTION.heading
    )
      continue;
    if (block.kind === 'item' && block.claimed === true) continue;
    const parts = sentences(block.text);
    for (let at = 0; at < parts.length; at += 1) {
      let statement = parts[at] as string;
      const last = at === parts.length - 1;
      if (last && statement.endsWith(':') && all[index + 1]?.kind === 'item') {
        const items: string[] = [];
        for (let next = index + 1; all[next]?.kind === 'item'; next += 1) {
          items.push((all[next] as Block).text);
          (all[next] as Block).claimed = true;
        }
        statement = `${statement} ${items.map((item) => `- ${item}`).join(' ')}`;
      }
      if (KEYWORD.test(statement)) {
        statements.push({ file, section: block.heading, statement });
      }
    }
  }
  return statements;
}

/** Every normative statement in `specs/`, keyed by document and text. */
export function readNormativeStatements(
  workspaceRoot: string,
): NormativeStatement[] {
  const directory = resolve(workspaceRoot, 'specs');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .flatMap((name) =>
      statementsOf(name, readFileSync(resolve(directory, name), 'utf8')),
    );
}
