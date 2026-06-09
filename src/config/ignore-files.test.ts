import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  _parseIgnoreFile,
  collectIgnorePatterns,
  defaultIgnoreFileDeps,
  type IgnoreFileDeps,
  parseIgnoreFileRef,
} from "./ignore-files.ts";

describe("_parseIgnoreFile", () => {
  test("parses simple paths", () => {
    expect(_parseIgnoreFile(".env\n.git\nnode_modules")).toEqual([
      ".env",
      ".git",
      "node_modules",
    ]);
  });

  test("skips blank lines and comments", () => {
    expect(_parseIgnoreFile("# comment\n\n.env\n  \n# another\n.git")).toEqual([
      ".env",
      ".git",
    ]);
  });

  test("trims whitespace from entries", () => {
    expect(_parseIgnoreFile("  .env  \n  .git  ")).toEqual([".env", ".git"]);
  });

  test("returns empty array for empty input", () => {
    expect(_parseIgnoreFile("")).toEqual([]);
  });

  test("returns empty array for comments-only input", () => {
    expect(_parseIgnoreFile("# just comments\n# nothing else")).toEqual([]);
  });
});

describe("parseIgnoreFileRef", () => {
  test("parses host: prefix", () => {
    expect(parseIgnoreFileRef("host:./tuorignore")).toEqual({
      source: "host",
      path: "./tuorignore",
    });
  });

  test("parses host: with absolute path", () => {
    expect(parseIgnoreFileRef("host:/etc/ignore")).toEqual({
      source: "host",
      path: "/etc/ignore",
    });
  });

  test("parses mount: with relative path as recursive", () => {
    expect(parseIgnoreFileRef("mount:.tuorignore")).toEqual({
      source: "mount",
      path: ".tuorignore",
      recursive: true,
    });
  });

  test("parses mount: with absolute path as non-recursive", () => {
    expect(parseIgnoreFileRef("mount:/.tuorignore")).toEqual({
      source: "mount",
      path: "/.tuorignore",
      recursive: false,
    });
  });

  test("throws on missing prefix", () => {
    expect(() => parseIgnoreFileRef(".tuorignore")).toThrow(
      /must start with "host:" or "mount:"/,
    );
  });

  test("throws on unknown prefix", () => {
    expect(() => parseIgnoreFileRef("unknown:.tuorignore")).toThrow(
      /unknown prefix "unknown"/,
    );
  });

  test("throws on empty path after prefix", () => {
    expect(() => parseIgnoreFileRef("host:")).toThrow(/path is empty/);
  });
});

describe("collectIgnorePatterns", () => {
  const noopDeps: IgnoreFileDeps = {
    readFile: () => "",
    pathExists: () => false,
    walkFiles: () => [],
  };

  test("collects root-scoped patterns from host: ref", () => {
    const deps: IgnoreFileDeps = {
      readFile: (p) => (p === "/config/.tuor/tuorignore" ? ".env\n.git" : ""),
      pathExists: (p) => p === "/config/.tuor/tuorignore",
      walkFiles: () => [],
    };
    const refs = [parseIgnoreFileRef("host:./tuorignore")];
    const result = collectIgnorePatterns(
      refs,
      "/project",
      "/config/.tuor",
      deps,
    );
    expect(result).toEqual([
      { pattern: ".env", scope: "/" },
      { pattern: ".git", scope: "/" },
    ]);
  });

  test("collects root-scoped patterns from mount: absolute ref", () => {
    const deps: IgnoreFileDeps = {
      readFile: (p) => (p === "/project/.tuorignore" ? "build\ndist" : ""),
      pathExists: (p) => p === "/project/.tuorignore",
      walkFiles: () => [],
    };
    const refs = [parseIgnoreFileRef("mount:/.tuorignore")];
    const result = collectIgnorePatterns(refs, "/project", "/cfg", deps);
    expect(result).toEqual([
      { pattern: "build", scope: "/" },
      { pattern: "dist", scope: "/" },
    ]);
  });

  test("collects directory-scoped patterns from mount: recursive ref", () => {
    const deps: IgnoreFileDeps = {
      readFile: (p) => {
        if (p === "/project/.tuorignore") return ".env";
        if (p === "/project/sub/.tuorignore") return "build";
        return "";
      },
      pathExists: () => true,
      walkFiles: (_root, _name) => [
        "/project/.tuorignore",
        "/project/sub/.tuorignore",
      ],
    };
    const refs = [parseIgnoreFileRef("mount:.tuorignore")];
    const result = collectIgnorePatterns(refs, "/project", "/cfg", deps);
    expect(result).toEqual([
      { pattern: ".env", scope: "/" },
      { pattern: "build", scope: "/sub" },
    ]);
  });

  test("silently skips missing host: files", () => {
    const refs = [parseIgnoreFileRef("host:./nonexistent")];
    const result = collectIgnorePatterns(refs, "/project", "/cfg", noopDeps);
    expect(result).toEqual([]);
  });

  test("silently skips missing mount: absolute files", () => {
    const refs = [parseIgnoreFileRef("mount:/.nonexistent")];
    const result = collectIgnorePatterns(refs, "/project", "/cfg", noopDeps);
    expect(result).toEqual([]);
  });

  test("returns empty when no ignore files found for recursive ref", () => {
    const refs = [parseIgnoreFileRef("mount:.tuorignore")];
    const result = collectIgnorePatterns(refs, "/project", "/cfg", noopDeps);
    expect(result).toEqual([]);
  });

  test("follows symlinks to directories during recursive walk", () => {
    const root = mkdtempSync(join(tmpdir(), "tuor-symdir-"));
    try {
      const target = join(root, "target");
      mkdirSync(target);
      writeFileSync(join(target, ".tuorignore"), "secret");
      symlinkSync("target", join(root, "link"));

      const refs = [parseIgnoreFileRef("mount:.tuorignore")];
      const result = collectIgnorePatterns(
        refs,
        root,
        "/cfg",
        defaultIgnoreFileDeps,
      );
      // Found in both the real dir and via the symlink
      expect(result).toContainEqual({ pattern: "secret", scope: "/target" });
      expect(result).toContainEqual({ pattern: "secret", scope: "/link" });
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("does not recurse into symlinks to files", () => {
    const root = mkdtempSync(join(tmpdir(), "tuor-symfile-"));
    try {
      writeFileSync(join(root, "realfile"), "content");
      symlinkSync("realfile", join(root, "link"));

      const refs = [parseIgnoreFileRef("mount:.tuorignore")];
      // Should not throw (would throw ENOTDIR if it tried to readdir the symlink)
      const result = collectIgnorePatterns(
        refs,
        root,
        "/cfg",
        defaultIgnoreFileDeps,
      );
      expect(result).toEqual([]);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("throws on symlink cycle during recursive walk", () => {
    const root = mkdtempSync(join(tmpdir(), "tuor-cycle-"));
    try {
      const sub = join(root, "sub");
      mkdirSync(sub);
      // sub/loop -> .. creates a cycle: sub/loop resolves back to root
      symlinkSync("..", join(sub, "loop"));

      const refs = [parseIgnoreFileRef("mount:.tuorignore")];
      expect(() =>
        collectIgnorePatterns(refs, root, "/cfg", defaultIgnoreFileDeps),
      ).toThrow(/Symlink cycle detected/);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("merges patterns from multiple refs", () => {
    const deps: IgnoreFileDeps = {
      readFile: (p) => {
        if (p === "/cfg/tuorignore") return ".env";
        if (p === "/project/.tuorignore") return "build";
        return "";
      },
      pathExists: () => true,
      walkFiles: () => ["/project/.tuorignore"],
    };
    const refs = [
      parseIgnoreFileRef("host:tuorignore"),
      parseIgnoreFileRef("mount:.tuorignore"),
    ];
    const result = collectIgnorePatterns(refs, "/project", "/cfg", deps);
    expect(result).toEqual([
      { pattern: ".env", scope: "/" },
      { pattern: "build", scope: "/" },
    ]);
  });
});
