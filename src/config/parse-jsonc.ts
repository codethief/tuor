import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";

/**
 * Parse `text` as JSONC and return the resulting JSON tree. Throws on malformed
 * input.
 *
 * `sourcePath` is only used to make errors point at the offending file.
 */
export function parseJsonc(text: string, sourcePath: string): unknown {
  const errors: ParseError[] = [];
  const result = parse(text, errors, { allowTrailingComma: true });

  // Report the first error only: a single typo typically cascades into a string
  // of follow-up errors whose positions are past the actual mistake.
  const firstError = errors[0];
  if (firstError !== undefined) {
    const { line, column } = offsetToLineColumn(text, firstError.offset);
    throw new Error(
      `Invalid JSON in ${sourcePath}:${line}:${column}: ` +
        `${printParseErrorCode(firstError.error)}`,
    );
  }

  return result;
}

// --- Internals ---

/** Translate a character offset into 1-based line/column for error messages. */
function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  const LINE_ENDING = "\n";
  // ^Note that for the purposes of counting lines, this covers Windows line
  // endings \r\n, too.

  const upToOffset = text.slice(0, offset);
  const lastNewline = upToOffset.lastIndexOf(LINE_ENDING);
  return {
    line: upToOffset.split(LINE_ENDING).length,
    column: offset - lastNewline,
  };
}
