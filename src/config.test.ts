import { describe, expect, test } from "vitest";
import { findConfigDir, parseConfig } from "./config.ts";

describe("findConfigDir", () => {
  test("returns config dir when config.json exists in start directory", () => {
    const exists = (path: string) => path === "/project/.tuor/config.json";
    expect(findConfigDir("/project", exists)).toBe("/project/.tuor");
  });

  test("returns config dir when config.json exists in parent directory", () => {
    const exists = (path: string) => path === "/project/.tuor/config.json";
    expect(findConfigDir("/project/src/deep", exists)).toBe("/project/.tuor");
  });

  test("returns null when no config.json is found", () => {
    const exists = () => false;
    expect(findConfigDir("/some/path", exists)).toBeNull();
  });
});

describe("parseConfig", () => {
  test("parses minimal config with tag", () => {
    const raw = { rootfs: { ociImage: { tag: "docker.io/ubuntu:latest" } } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "docker.io/ubuntu:latest" }, fsSize: 2048 },
      user: "root",
      workdir: "/",
    });
  });

  test("parses full config with all optional fields", () => {
    const raw = {
      rootfs: {
        ociImage: {
          containerfile: "./Containerfile",
          context: "./ctx",
          engine: "podman",
        },
        fsSize: 4096,
      },
      user: "myuser",
    };
    expect(parseConfig(raw)).toEqual({
      rootfs: {
        ociImage: {
          containerfile: "./Containerfile",
          context: "./ctx",
          engine: "podman",
        },
        fsSize: 4096,
      },
      user: "myuser",
      workdir: "/",
    });
  });

  test("parses mounts with all fields", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      mounts: [
        {
          hostPath: "/home/user/project",
          guestPath: "/workspace",
          readOnly: true,
        },
      ],
    };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest" }, fsSize: 2048 },
      user: "root",
      mounts: [
        {
          hostPath: "/home/user/project",
          guestPath: "/workspace",
          readOnly: true,
        },
      ],
      workdir: "/",
    });
  });

  test("parses mounts with hostPath only, readOnly defaults to false", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      mounts: [{ hostPath: "../myproject" }],
    };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest" }, fsSize: 2048 },
      user: "root",
      mounts: [{ hostPath: "../myproject", readOnly: false }],
      workdir: "/",
    });
  });

  test("rejects mounts with relative guestPath", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      mounts: [{ hostPath: "/foo", guestPath: "relative/path" }],
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects mounts with empty hostPath", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      mounts: [{ hostPath: "" }],
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects mounts with non-string hostPath", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      mounts: [{ hostPath: 123 }],
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects invalid input", () => {
    expect(() => parseConfig("not an object")).toThrow();
    expect(() => parseConfig({ rootfs: { ociImage: {} } })).toThrow();
  });

  test("parses workdir as absolute guest path string", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      workdir: "/workspace",
    };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest" }, fsSize: 2048 },
      user: "root",
      workdir: "/workspace",
    });
  });

  test("parses workdir as MountConfig with hostPath only", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      workdir: { hostPath: "/host/project" },
    };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest" }, fsSize: 2048 },
      user: "root",
      workdir: { hostPath: "/host/project", readOnly: false },
    });
  });

  test("parses workdir as MountConfig with guestPath", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      workdir: { hostPath: "/host/project", guestPath: "/workspace" },
    };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest" }, fsSize: 2048 },
      user: "root",
      workdir: {
        hostPath: "/host/project",
        guestPath: "/workspace",
        readOnly: false,
      },
    });
  });

  test("rejects workdir with non-absolute guest path string", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      workdir: "relative/path",
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects workdir with empty string", () => {
    const raw = {
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
      workdir: "",
    };
    expect(() => parseConfig(raw)).toThrow();
  });
});
