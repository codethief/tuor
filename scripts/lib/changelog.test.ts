import { describe, expect, test } from "vitest";
import {
  extractReleaseDate,
  extractReleaseNotes,
  rollUnreleasedSection,
} from "./changelog.ts";

const SAMPLE = `# Unreleased

## Features
- A shiny new thing.

## Bug fixes
- Fixed an old thing.


# 0.1.0 (2026-06-15)
Initial release.

- Did the first things.
`;

describe("rollUnreleasedSection", () => {
  test("inserts a dated section and re-opens an empty Unreleased", () => {
    const rolled = rollUnreleasedSection(SAMPLE, "0.2.0", "2026-06-20");
    expect(rolled).toBe(`# Unreleased


# 0.2.0 (2026-06-20)

## Features
- A shiny new thing.

## Bug fixes
- Fixed an old thing.


# 0.1.0 (2026-06-15)
Initial release.

- Did the first things.
`);
  });

  test("leaves prior dated sections untouched", () => {
    const rolled = rollUnreleasedSection(SAMPLE, "0.2.0", "2026-06-20");
    expect(rolled).toContain("# 0.1.0 (2026-06-15)\nInitial release.");
  });

  test("throws when there is no Unreleased section", () => {
    expect(() =>
      rollUnreleasedSection(
        "# 0.1.0 (2026-06-15)\nstuff\n",
        "0.2.0",
        "2026-06-20",
      ),
    ).toThrow(/no .*unreleased/i);
  });

  test("throws when the Unreleased section is empty", () => {
    const empty = "# Unreleased\n\n\n# 0.1.0 (2026-06-15)\nstuff\n";
    expect(() => rollUnreleasedSection(empty, "0.2.0", "2026-06-20")).toThrow(
      /empty/i,
    );
  });
});

describe("extractReleaseNotes", () => {
  test("returns the trimmed body of the requested version", () => {
    expect(extractReleaseNotes(SAMPLE, "0.1.0")).toBe(
      "Initial release.\n\n- Did the first things.",
    );
  });

  test("throws when the version section is absent", () => {
    expect(() => extractReleaseNotes(SAMPLE, "9.9.9")).toThrow(/no .*9\.9\.9/i);
  });

  test("throws when the version section body is empty", () => {
    const emptyBody = "# 0.2.0 (2026-06-20)\n\n# 0.1.0 (2026-06-15)\nstuff\n";
    expect(() => extractReleaseNotes(emptyBody, "0.2.0")).toThrow(/empty/i);
  });
});

describe("extractReleaseDate", () => {
  test("returns the date from the version heading", () => {
    expect(extractReleaseDate(SAMPLE, "0.1.0")).toBe("2026-06-15");
  });

  test("throws when the version heading is absent", () => {
    expect(() => extractReleaseDate(SAMPLE, "9.9.9")).toThrow(/no .*9\.9\.9/i);
  });
});

describe("roll then extract round-trip", () => {
  test("extracts exactly the rolled notes for the new version", () => {
    const rolled = rollUnreleasedSection(SAMPLE, "0.2.0", "2026-06-20");
    expect(extractReleaseNotes(rolled, "0.2.0")).toBe(
      `## Features
- A shiny new thing.

## Bug fixes
- Fixed an old thing.`,
    );
  });
});
