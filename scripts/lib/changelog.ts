// Pure helpers for the `CHANGELOG.md` lifecycle. The file is a flat list of top-level
// `# ` sections: a `# Unreleased` section on top, then `# X.Y.Z (DATE)` sections below.
//
// - At *prepare* time, `rollUnreleasedSection` turns the accumulated `# Unreleased`
//   body into a dated release section and re-opens an empty `# Unreleased`.
// - At *release* time, `extractReleaseNotes` pulls a dated section's body back out for
//   the GitHub Release notes.
//
// Both rely on the same notion of "a section body = everything from just after the
// heading line up to the next top-level heading (or EOF)".

interface Section {
  /** Index of the first character of the heading line. */
  readonly headingStart: number;
  /** Index of the first character of the body (just past the heading's newline). */
  readonly bodyStart: number;
  /** Index just past the body: the next top-level heading, or the content length. */
  readonly bodyEnd: number;
  /** The section body, verbatim (leading/trailing whitespace included). */
  readonly body: string;
}

const NEXT_TOP_LEVEL_HEADING = /^# /m;

/** Locates the first section whose heading line matches `heading`, or null. */
function findSection(content: string, heading: RegExp): Section | null {
  const match = heading.exec(content);
  if (match === null) {
    return null;
  }
  const headingStart = match.index;
  const newlineIdx = content.indexOf("\n", headingStart);
  const bodyStart = newlineIdx === -1 ? content.length : newlineIdx + 1;

  const afterHeading = content.slice(bodyStart);
  const nextHeading = NEXT_TOP_LEVEL_HEADING.exec(afterHeading);
  const bodyEnd =
    nextHeading === null ? content.length : bodyStart + nextHeading.index;

  return {
    headingStart,
    bodyStart,
    bodyEnd,
    body: content.slice(bodyStart, bodyEnd),
  };
}

/** Escapes a string for safe use as a literal inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rolls the `# Unreleased` section into a dated `# ${version} (${dateIso})` section,
 * leaving its body in place under the new heading and re-opening a fresh empty
 * `# Unreleased` on top. Throws if there is no `# Unreleased` section or its body is
 * empty (nothing to release).
 */
export function rollUnreleasedSection(
  content: string,
  version: string,
  dateIso: string,
): string {
  const section = findSection(content, /^# Unreleased[ \t]*$/m);
  if (section === null) {
    throw new Error("No `# Unreleased` section found in the changelog.");
  }
  if (section.body.trim() === "") {
    throw new Error("The `# Unreleased` section is empty; nothing to release.");
  }

  const before = content.slice(0, section.headingStart);
  const bodyAndRest = content.slice(section.bodyStart);
  return `${before}# Unreleased\n\n\n# ${version} (${dateIso})\n${bodyAndRest}`;
}

/**
 * Returns the body of the `# ${version} (...)` section, trimmed. Throws if there is no
 * such section or its body is empty.
 */
export function extractReleaseNotes(content: string, version: string): string {
  const heading = new RegExp(`^# ${escapeRegExp(version)} \\(`, "m");
  const section = findSection(content, heading);
  if (section === null) {
    throw new Error(
      `No \`# ${version} (...)\` section found in the changelog.`,
    );
  }
  const notes = section.body.trim();
  if (notes === "") {
    throw new Error(`Release notes for version ${version} are empty.`);
  }
  return notes;
}
