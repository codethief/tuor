import { describe, expect, test } from "vitest";
import { MemoryProvider } from "@earendil-works/gondolin";
import { OverlayProvider } from "./overlay-provider.ts";

/** Create a MemoryProvider with some pre-populated files. */
async function createPopulatedProvider(
  files: Record<string, string>,
): Promise<MemoryProvider> {
  const provider = new MemoryProvider();
  for (const [filePath, content] of Object.entries(files)) {
    // Ensure parent directories exist
    const parts = filePath.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const dir = "/" + parts.slice(0, i).join("/");
      try {
        provider.statSync(dir);
      } catch {
        provider.mkdirSync(dir);
      }
    }
    const handle = provider.openSync(filePath, "w");
    handle.writeFileSync(content);
    handle.closeSync();
  }
  return provider;
}

async function readFile(
  provider: OverlayProvider,
  filePath: string,
): Promise<string> {
  const handle = await provider.open(filePath, "r");
  try {
    const content = await handle.readFile({ encoding: "utf-8" });
    return content as string;
  } finally {
    await handle.close();
  }
}

async function writeFile(
  provider: OverlayProvider,
  filePath: string,
  content: string,
): Promise<void> {
  const handle = await provider.open(filePath, "w");
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

describe("OverlayProvider", () => {
  describe("stat", () => {
    test("falls through to lower when not in upper", async () => {
      const lower = await createPopulatedProvider({ "/hello.txt": "lower" });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      const stat = await overlay.stat("/hello.txt");
      expect(stat.isFile()).toBe(true);
    });

    test("returns upper stat when file exists in both layers", async () => {
      const lower = await createPopulatedProvider({ "/hello.txt": "lower" });
      const upper = await createPopulatedProvider({ "/hello.txt": "upper!" });
      const overlay = new OverlayProvider(lower, upper);

      const stat = await overlay.stat("/hello.txt");
      expect(stat.isFile()).toBe(true);
      // upper file has different content length
      expect(stat.size).toBe(6);
    });

    test("throws ENOENT when file is whited out", async () => {
      const lower = await createPopulatedProvider({ "/hello.txt": "lower" });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await overlay.unlink("/hello.txt");

      await expect(overlay.stat("/hello.txt")).rejects.toThrow(/ENOENT/);
    });
  });

  describe("open (read)", () => {
    test("reads from lower when not in upper", async () => {
      const lower = await createPopulatedProvider({
        "/hello.txt": "from lower",
      });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      expect(await readFile(overlay, "/hello.txt")).toBe("from lower");
    });

    test("reads from upper when file exists in upper", async () => {
      const lower = await createPopulatedProvider({
        "/hello.txt": "from lower",
      });
      const upper = await createPopulatedProvider({
        "/hello.txt": "from upper",
      });
      const overlay = new OverlayProvider(lower, upper);

      expect(await readFile(overlay, "/hello.txt")).toBe("from upper");
    });

    test("throws ENOENT for whited-out file", async () => {
      const lower = await createPopulatedProvider({
        "/hello.txt": "from lower",
      });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await overlay.unlink("/hello.txt");

      await expect(overlay.open("/hello.txt", "r")).rejects.toThrow(/ENOENT/);
    });
  });

  describe("open (write)", () => {
    test("creates file in upper, lower untouched", async () => {
      const lower = new MemoryProvider();
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      // Need root dir in upper for file creation
      await writeFile(overlay, "/new.txt", "created");

      expect(await readFile(overlay, "/new.txt")).toBe("created");
      // Verify it's in upper, not lower
      const upperHandle = upper.openSync("/new.txt", "r");
      expect(upperHandle.readFileSync({ encoding: "utf-8" })).toBe("created");
      upperHandle.closeSync();
      expect(() => lower.statSync("/new.txt")).toThrow();
    });

    test("copy-up on open with r+ flag", async () => {
      const lower = await createPopulatedProvider({
        "/hello.txt": "original",
      });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      // Open for read+write, which should copy up
      const handle = await overlay.open("/hello.txt", "r+");
      const content = await handle.readFile({ encoding: "utf-8" });
      expect(content).toBe("original");
      await handle.writeFile("modified");
      await handle.close();

      // Upper should now have the file
      const upperHandle = upper.openSync("/hello.txt", "r");
      expect(upperHandle.readFileSync({ encoding: "utf-8" })).toBe("modified");
      upperHandle.closeSync();

      // Lower should be untouched
      const lowerHandle = lower.openSync("/hello.txt", "r");
      expect(lowerHandle.readFileSync({ encoding: "utf-8" })).toBe("original");
      lowerHandle.closeSync();
    });

    test("write to existing upper file does not touch lower", async () => {
      const lower = await createPopulatedProvider({
        "/hello.txt": "lower version",
      });
      const upper = await createPopulatedProvider({
        "/hello.txt": "upper version",
      });
      const overlay = new OverlayProvider(lower, upper);

      await writeFile(overlay, "/hello.txt", "new content");

      expect(await readFile(overlay, "/hello.txt")).toBe("new content");
      const lowerHandle = lower.openSync("/hello.txt", "r");
      expect(lowerHandle.readFileSync({ encoding: "utf-8" })).toBe(
        "lower version",
      );
      lowerHandle.closeSync();
    });
  });

  describe("unlink", () => {
    test("creates whiteout for lower-only file", async () => {
      const lower = await createPopulatedProvider({
        "/hello.txt": "lower",
      });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await overlay.unlink("/hello.txt");

      // File should be invisible
      await expect(overlay.stat("/hello.txt")).rejects.toThrow(/ENOENT/);
      // Whiteout marker should exist in upper
      expect(() => upper.statSync("/.wh.hello.txt")).not.toThrow();
      // Lower file should still exist
      expect(() => lower.statSync("/hello.txt")).not.toThrow();
    });

    test("removes from upper and creates whiteout when in both layers", async () => {
      const lower = await createPopulatedProvider({
        "/hello.txt": "lower",
      });
      const upper = await createPopulatedProvider({
        "/hello.txt": "upper",
      });
      const overlay = new OverlayProvider(lower, upper);

      await overlay.unlink("/hello.txt");

      await expect(overlay.stat("/hello.txt")).rejects.toThrow(/ENOENT/);
      expect(() => upper.statSync("/hello.txt")).toThrow();
      expect(() => upper.statSync("/.wh.hello.txt")).not.toThrow();
    });

    test("throws ENOENT for nonexistent file", async () => {
      const lower = new MemoryProvider();
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await expect(overlay.unlink("/nope.txt")).rejects.toThrow(/ENOENT/);
    });
  });

  describe("readdir", () => {
    test("merges entries from both layers", async () => {
      const lower = await createPopulatedProvider({
        "/dir/a.txt": "a",
        "/dir/b.txt": "b",
      });
      const upper = await createPopulatedProvider({
        "/dir/c.txt": "c",
      });
      const overlay = new OverlayProvider(lower, upper);

      const entries = (await overlay.readdir("/dir")) as string[];
      expect(entries.sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    test("upper entry wins on conflict", async () => {
      const lower = await createPopulatedProvider({
        "/dir/file.txt": "lower",
      });
      const upper = await createPopulatedProvider({
        "/dir/file.txt": "upper",
      });
      const overlay = new OverlayProvider(lower, upper);

      const entries = (await overlay.readdir("/dir")) as string[];
      expect(entries).toEqual(["file.txt"]);
    });

    test("excludes whited-out entries", async () => {
      const lower = await createPopulatedProvider({
        "/dir/keep.txt": "keep",
        "/dir/remove.txt": "remove",
      });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await overlay.unlink("/dir/remove.txt");

      const entries = (await overlay.readdir("/dir")) as string[];
      expect(entries).toEqual(["keep.txt"]);
    });

    test("does not expose whiteout markers to guest", async () => {
      const lower = await createPopulatedProvider({
        "/dir/secret.txt": "secret",
        "/dir/visible.txt": "visible",
      });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await overlay.unlink("/dir/secret.txt");

      const entries = (await overlay.readdir("/dir")) as string[];
      // Should not contain .wh.secret.txt
      expect(entries).toEqual(["visible.txt"]);
    });

    test("opaque directory does not merge lower entries", async () => {
      const lower = await createPopulatedProvider({
        "/dir/old.txt": "old",
      });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      // Delete dir and recreate — should become opaque
      await overlay.rmdir("/dir");
      await overlay.mkdir("/dir");

      const entries = (await overlay.readdir("/dir")) as string[];
      // old.txt from lower should NOT appear (dir is opaque)
      // .wh..wh..opq marker should also be filtered
      expect(entries).toEqual([]);
    });
  });

  describe("mkdir", () => {
    test("creates directory in upper layer", async () => {
      const lower = new MemoryProvider();
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await overlay.mkdir("/newdir");

      expect((await overlay.stat("/newdir")).isDirectory()).toBe(true);
      expect(upper.statSync("/newdir").isDirectory()).toBe(true);
    });

    test("throws EEXIST when dir exists in lower", async () => {
      const lower = await createPopulatedProvider({ "/dir/file.txt": "x" });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await expect(overlay.mkdir("/dir")).rejects.toThrow(/EEXIST/);
    });

    test("on whited-out path clears whiteout and marks opaque", async () => {
      const lower = await createPopulatedProvider({
        "/dir/old.txt": "old",
      });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await overlay.rmdir("/dir");
      await overlay.mkdir("/dir");

      // Directory should exist
      expect((await overlay.stat("/dir")).isDirectory()).toBe(true);
      // Opaque marker should exist
      expect(() => upper.statSync("/dir/.wh..wh..opq")).not.toThrow();
      // Whiteout should be gone
      expect(() => upper.statSync("/.wh.dir")).toThrow();
    });
  });

  describe("rename", () => {
    test("renames file within upper layer", async () => {
      const lower = new MemoryProvider();
      const upper = await createPopulatedProvider({ "/a.txt": "content" });
      const overlay = new OverlayProvider(lower, upper);

      await overlay.rename("/a.txt", "/b.txt");

      await expect(overlay.stat("/a.txt")).rejects.toThrow(/ENOENT/);
      expect(await readFile(overlay, "/b.txt")).toBe("content");
    });

    test("copies up from lower and whiteouts old path", async () => {
      const lower = await createPopulatedProvider({ "/a.txt": "content" });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await overlay.rename("/a.txt", "/b.txt");

      await expect(overlay.stat("/a.txt")).rejects.toThrow(/ENOENT/);
      expect(await readFile(overlay, "/b.txt")).toBe("content");
      // Lower should be untouched
      expect(() => lower.statSync("/a.txt")).not.toThrow();
      // Whiteout should exist for old path
      expect(() => upper.statSync("/.wh.a.txt")).not.toThrow();
    });

    test("throws ENOENT for nonexistent source", async () => {
      const lower = new MemoryProvider();
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      await expect(overlay.rename("/nope.txt", "/b.txt")).rejects.toThrow(
        /ENOENT/,
      );
    });
  });

  describe("sync variants", () => {
    test("statSync falls through to lower", async () => {
      const lower = await createPopulatedProvider({ "/hello.txt": "lower" });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      const stat = overlay.statSync("/hello.txt");
      expect(stat.isFile()).toBe(true);
    });

    test("openSync reads from lower", async () => {
      const lower = await createPopulatedProvider({ "/hello.txt": "lower" });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      const handle = overlay.openSync("/hello.txt", "r");
      expect(handle.readFileSync({ encoding: "utf-8" })).toBe("lower");
      handle.closeSync();
    });

    test("unlinkSync creates whiteout", async () => {
      const lower = await createPopulatedProvider({ "/hello.txt": "lower" });
      const upper = new MemoryProvider();
      const overlay = new OverlayProvider(lower, upper);

      overlay.unlinkSync("/hello.txt");

      expect(() => overlay.statSync("/hello.txt")).toThrow(/ENOENT/);
      expect(() => upper.statSync("/.wh.hello.txt")).not.toThrow();
    });
  });
});
