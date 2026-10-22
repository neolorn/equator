/**
 * Reading a parsed JSON tree, for the two authored files Equator accepts in JSON.
 *
 * The project configuration and the authored change plan are both read as a tree rather than as a
 * parsed value, because an author needs to be told where the mistake is and `JSON.parse` keeps no
 * offsets. Both then want the same three things from that tree, and the only thing they disagree
 * about is which diagnostic a duplicate key is reported under.
 */
import {
  createScanner,
  type Node as JsonNode,
  type SyntaxKind,
} from 'jsonc-parser';

import {
  toolkitDiagnostic,
  spanAt,
  type ToolkitDiagnostic,
  type ToolkitDiagnosticCode,
  type SourceSpan,
} from './diagnostics.js';
import { RESOURCE_LIMITS } from './resource-limits.js';

/** How a caller names a duplicate key, which is all that separates the two of them. */
export interface DuplicateKeyReport {
  readonly code: ToolkitDiagnosticCode;
  readonly summary: (key: string) => string;
}

/** The span a node occupies in its source, for a node the caller may not have. */
export function jsonNodeSpan(
  source: string,
  node: JsonNode | undefined,
  sourcePath: string | undefined,
): SourceSpan | undefined {
  return node === undefined
    ? undefined
    : spanAt(source, node.offset, node.length, sourcePath);
}

/**
 * Every key written twice in the same object, anywhere in the tree.
 *
 * A later key silently replaces an earlier one in every JSON parser there is, so an author who
 * writes one twice gets the second and no word about the first.
 */
export function duplicateJsonKeys(
  source: string,
  node: JsonNode,
  sourcePath: string | undefined,
  report: DuplicateKeyReport,
): readonly ToolkitDiagnostic[] {
  const diagnostics: ToolkitDiagnostic[] = [];
  collectDuplicateKeys(source, node, sourcePath, report, [], diagnostics);
  return Object.freeze(diagnostics);
}

/**
 * The walk itself, which carries one array down the tree rather than joining one per level.
 *
 * The diagnostic ceiling is checked against that one array, so a file with a duplicate key at
 * every depth stops at the ceiling rather than at the ceiling times the depth.
 */
function collectDuplicateKeys(
  source: string,
  node: JsonNode,
  sourcePath: string | undefined,
  report: DuplicateKeyReport,
  path: readonly (string | number)[],
  diagnostics: ToolkitDiagnostic[],
): void {
  if (diagnostics.length >= RESOURCE_LIMITS.diagnostics) return;

  if (node.type === 'object') {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      if (keyNode?.type !== 'string' || typeof keyNode.value !== 'string') {
        continue;
      }

      const propertyPath = [...path, keyNode.value];
      if (seen.has(keyNode.value)) {
        const span = jsonNodeSpan(source, keyNode, sourcePath);
        diagnostics.push(
          toolkitDiagnostic(report.code, report.summary(keyNode.value), {
            path: propertyPath,
            ...(span === undefined ? {} : { span }),
          }),
        );
      } else {
        seen.add(keyNode.value);
      }

      if (valueNode !== undefined) {
        collectDuplicateKeys(
          source,
          valueNode,
          sourcePath,
          report,
          propertyPath,
          diagnostics,
        );
      }
      if (diagnostics.length >= RESOURCE_LIMITS.diagnostics) break;
    }
  } else if (node.type === 'array') {
    for (const [index, item] of (node.children ?? []).entries()) {
      collectDuplicateKeys(
        source,
        item,
        sourcePath,
        report,
        [...path, index],
        diagnostics,
      );
      if (diagnostics.length >= RESOURCE_LIMITS.diagnostics) break;
    }
  }
}

/**
 * The value a tree stands for, frozen and without a prototype at every depth.
 *
 * The keys come from an authored file, so a key spelled `__proto__` would reach
 * `Object.prototype` on a plain object literal and reaches nothing here.
 */
export function constructJsonValue(node: JsonNode): unknown {
  switch (node.type) {
    case 'array':
      return Object.freeze((node.children ?? []).map(constructJsonValue));
    case 'boolean':
    case 'number':
    case 'string':
      return node.value;
    case 'null':
      return null;
    case 'object': {
      const value = Object.create(null) as Record<string, unknown>;
      for (const property of node.children ?? []) {
        const keyNode = property.children?.[0];
        const valueNode = property.children?.[1];
        if (
          keyNode?.type === 'string' &&
          typeof keyNode.value === 'string' &&
          valueNode !== undefined
        ) {
          Object.defineProperty(value, keyNode.value, {
            configurable: false,
            enumerable: true,
            value: constructJsonValue(valueNode),
            writable: false,
          });
        }
      }
      return Object.freeze(value);
    }
    default:
      throw new TypeError(`Unsupported JSON node type: ${node.type}`);
  }
}

/**
 * Whether the text nests objects and arrays deeper than `maximumDepth`, read without parsing it.
 *
 * `parseTree` recurses once per level, so a document nested deep enough overflows the stack before
 * there is a tree to measure. The scanner reads one token at a time, strings included, so counting
 * brackets with it is bounded by the text's length rather than by the stack.
 */
// `SyntaxKind` is a const enum, which this build cannot read at run time, so the four bracket
// tokens and the end of input are spelled with the values jsonc-parser 3.3.1 declares for them.
const OPEN_BRACE = 1 as SyntaxKind;
const CLOSE_BRACE = 2 as SyntaxKind;
const OPEN_BRACKET = 3 as SyntaxKind;
const CLOSE_BRACKET = 4 as SyntaxKind;
const END_OF_INPUT = 17 as SyntaxKind;

export function jsonNestingExceeds(
  source: string,
  maximumDepth: number,
): boolean {
  const scanner = createScanner(source, true);
  let depth = 0;
  for (
    let token = scanner.scan();
    token !== END_OF_INPUT;
    token = scanner.scan()
  ) {
    if (token === OPEN_BRACE || token === OPEN_BRACKET) {
      depth += 1;
      if (depth > maximumDepth) return true;
    } else if (token === CLOSE_BRACE || token === CLOSE_BRACKET) {
      depth -= 1;
    }
  }
  return false;
}
