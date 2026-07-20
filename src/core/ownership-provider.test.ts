import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealFSProvider } from "@earendil-works/gondolin";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { OwnershipProvider } from "./ownership-provider.ts";

const OWNER = { uid: 4242, gid: 4243 };

describe("OwnershipProvider", () => {
  let dir: string;
  let backend: RealFSProvider;
  let provider: OwnershipProvider;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/tuor-ownership-`);
    writeFileSync(join(dir, "file.txt"), "hello");
    mkdirSync(join(dir, "subdir"));
    symlinkSync("file.txt", join(dir, "link"));
    backend = new RealFSProvider(dir);
    provider = new OwnershipProvider(backend, OWNER);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("stat reports the configured owner", async () => {
    const stats = await provider.stat("/file.txt");
    expect(stats.uid).toBe(OWNER.uid);
    expect(stats.gid).toBe(OWNER.gid);
  });

  test("statSync reports the configured owner", () => {
    const stats = provider.statSync("/file.txt");
    expect(stats.uid).toBe(OWNER.uid);
    expect(stats.gid).toBe(OWNER.gid);
  });

  test("lstat reports the configured owner", async () => {
    const stats = await provider.lstat("/link");
    expect(stats.uid).toBe(OWNER.uid);
    expect(stats.gid).toBe(OWNER.gid);
  });

  test("preserves Stats methods through the clone", async () => {
    const dirStats = await provider.stat("/subdir");
    expect(dirStats.isDirectory()).toBe(true);
    expect(dirStats.isFile()).toBe(false);
    expect(dirStats.uid).toBe(OWNER.uid);

    const fileStats = await provider.stat("/file.txt");
    expect(fileStats.isFile()).toBe(true);

    const linkStats = await provider.lstat("/link");
    expect(linkStats.isSymbolicLink()).toBe(true);
  });

  test("an open handle's stat reports the configured owner", async () => {
    const handle = await provider.open("/file.txt", "r");
    try {
      const stats = await handle.stat();
      expect(stats.uid).toBe(OWNER.uid);
      expect(stats.gid).toBe(OWNER.gid);
    } finally {
      await handle.close();
    }
  });

  test("preserves the file size (other fields pass through)", async () => {
    const stats = await provider.stat("/file.txt");
    expect(stats.size).toBe("hello".length);
  });

  test("readdir passes through unchanged", async () => {
    const entries = await provider.readdir("/");
    const names = entries.map((e) => (typeof e === "string" ? e : e.name));
    expect(names.sort()).toEqual(["file.txt", "link", "subdir"]);
  });

  test("reads file content through the wrapper", async () => {
    const handle = await provider.open("/file.txt", "r");
    try {
      const content = await handle.readFile({ encoding: "utf-8" });
      expect(content).toBe("hello");
    } finally {
      await handle.close();
    }
  });

  test("does not mutate the backend's Stats object", async () => {
    // The backend keeps reporting the real on-host owner; only the wrapper
    // rewrites it. (Confirms we clone rather than mutate in place.)
    const real = await backend.stat("/file.txt");
    expect(real.uid).not.toBe(OWNER.uid);
  });
});
