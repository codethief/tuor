import { describe, expect, test } from "vitest";
import { expandTilde, inferGuestHomeDir } from "./homedir.ts";

describe("inferGuestHomeDir", () => {
  test("returns /root for root user", () => {
    expect(inferGuestHomeDir("root")).toBe("/root");
  });

  test("returns /home/$user for non-root user", () => {
    expect(inferGuestHomeDir("dev")).toBe("/home/dev");
  });
});

describe("expandTilde", () => {
  test("expands bare ~ to homeDir", () => {
    expect(expandTilde("~", "/home/dev")).toBe("/home/dev");
  });

  test("expands ~/path to homeDir/path", () => {
    expect(expandTilde("~/projects", "/home/dev")).toBe("/home/dev/projects");
  });

  test("expands nested ~/a/b/c", () => {
    expect(expandTilde("~/a/b/c", "/root")).toBe("/root/a/b/c");
  });

  test("leaves absolute paths unchanged", () => {
    expect(expandTilde("/opt/data", "/home/dev")).toBe("/opt/data");
  });

  test("leaves relative paths unchanged", () => {
    expect(expandTilde("../foo", "/home/dev")).toBe("../foo");
  });

  test("does not expand ~user syntax", () => {
    expect(expandTilde("~other/foo", "/home/dev")).toBe("~other/foo");
  });
});
