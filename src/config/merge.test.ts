import { describe, expect, test } from "vitest";
import { type ConfigLayer, findAllConfigDirs, mergeConfigs } from "./merge.ts";
import type { MountConfig, TuorConfig } from "./schema.ts";

/** Minimal valid config (matching what parseConfig returns with defaults filled). */
function config(overrides: Partial<TuorConfig> = {}): TuorConfig {
  return { user: "root", workdir: "/", ...overrides };
}

function layer(
  configDir: string,
  overrides: Partial<TuorConfig> = {},
): ConfigLayer {
  return { config: config(overrides), configDir };
}

/** Mount config with required mode default. */
function mount(
  overrides: Partial<MountConfig> & { hostPath: string },
): MountConfig {
  return { mode: "readonly", ...overrides };
}

describe("findAllConfigDirs", () => {
  test("returns home config first, then ancestors root-to-closest", () => {
    const existing = new Set([
      "/home/user/.config/tuor/config.json",
      "/projects/.tuor/config.json",
      "/projects/myapp/.tuor/config.json",
    ]);
    const exists = (p: string) => existing.has(p);

    const result = findAllConfigDirs(
      "/projects/myapp/src",
      "/home/user",
      exists,
    );
    expect(result).toEqual([
      "/home/user/.config/tuor",
      "/projects/.tuor",
      "/projects/myapp/.tuor",
    ]);
  });

  test("returns only home config when no .tuor/ dirs exist", () => {
    const existing = new Set(["/home/user/.config/tuor/config.json"]);
    const exists = (p: string) => existing.has(p);

    const result = findAllConfigDirs("/projects/myapp", "/home/user", exists);
    expect(result).toEqual(["/home/user/.config/tuor"]);
  });

  test("returns only .tuor/ dirs when no home config exists", () => {
    const existing = new Set(["/projects/.tuor/config.json"]);
    const exists = (p: string) => existing.has(p);

    const result = findAllConfigDirs("/projects/myapp", "/home/user", exists);
    expect(result).toEqual(["/projects/.tuor"]);
  });

  test("returns empty array when no configs found", () => {
    const result = findAllConfigDirs("/some/path", "/home/user", () => false);
    expect(result).toEqual([]);
  });

  test("deduplicates home config if .tuor/ walk would also find it", () => {
    const existing = new Set(["/home/user/.config/tuor/config.json"]);
    const exists = (p: string) => existing.has(p);

    const result = findAllConfigDirs(
      "/home/user/.config/tuor/sub",
      "/home/user",
      exists,
    );
    expect(result).toEqual(["/home/user/.config/tuor"]);
    expect(result.length).toBe(1);
  });
});

describe("mergeConfigs", () => {
  test("single layer returns config unchanged (except path pre-resolution)", () => {
    const result = mergeConfigs([layer("/project/.tuor", { user: "dev" })]);
    expect(result.user).toBe("dev");
  });

  test("throws on empty layers", () => {
    expect(() => mergeConfigs([])).toThrow("at least one");
  });

  describe("scalar fields: child wins", () => {
    test("user", () => {
      const result = mergeConfigs([
        layer("/a", { user: "parent" }),
        layer("/b", { user: "child" }),
      ]);
      expect(result.user).toBe("child");
    });

    test("workdir string", () => {
      const result = mergeConfigs([
        layer("/a", { workdir: "/parent-dir" }),
        layer("/b", { workdir: "/child-dir" }),
      ]);
      expect(result.workdir).toBe("/child-dir");
    });

    test("rootfsSize: child overrides parent", () => {
      const result = mergeConfigs([
        layer("/a", { rootfsSize: "1G" }),
        layer("/b", { rootfsSize: "4G" }),
      ]);
      expect(result.rootfsSize).toBe("4G");
    });

    test("rootfsSize: parent used when child omits", () => {
      const result = mergeConfigs([
        layer("/a", { rootfsSize: "1G" }),
        layer("/b"),
      ]);
      expect(result.rootfsSize).toBe("1G");
    });

    test("guestHomeDir: child overrides parent", () => {
      const result = mergeConfigs([
        layer("/a", { guestHomeDir: "/old" }),
        layer("/b", { guestHomeDir: "/new" }),
      ]);
      expect(result.guestHomeDir).toBe("/new");
    });

    test("nix: child overrides parent", () => {
      const result = mergeConfigs([
        layer("/a", { nix: { nixLd: false } }),
        layer("/b", { nix: { nixLd: true } }),
      ]);
      expect(result.nix).toEqual({ nixLd: true });
    });

    test("nix: parent used when child omits", () => {
      const result = mergeConfigs([
        layer("/a", { nix: { nixLd: true } }),
        layer("/b"),
      ]);
      expect(result.nix).toEqual({ nixLd: true });
    });
  });

  describe("array fields: concatenation", () => {
    test("mounts are concatenated parent-first", () => {
      const result = mergeConfigs([
        layer("/a", { mounts: [mount({ hostPath: "/parent-mount" })] }),
        layer("/b", { mounts: [mount({ hostPath: "/child-mount" })] }),
      ]);
      expect(result.mounts).toHaveLength(2);
      expect(result.mounts![0]!.hostPath).toBe("/parent-mount");
      expect(result.mounts![1]!.hostPath).toBe("/child-mount");
    });

    test("volumes are concatenated", () => {
      const result = mergeConfigs([
        layer("/a", { volumes: [{ guestPath: "/vol1" }] }),
        layer("/b", { volumes: [{ guestPath: "/vol2" }] }),
      ]);
      expect(result.volumes).toHaveLength(2);
    });

    test("parent-only mounts preserved when child has none", () => {
      const result = mergeConfigs([
        layer("/a", { mounts: [mount({ hostPath: "/data" })] }),
        layer("/b"),
      ]);
      expect(result.mounts).toHaveLength(1);
    });

    test("no mounts field when neither layer has mounts", () => {
      const result = mergeConfigs([layer("/a"), layer("/b")]);
      expect(result.mounts).toBeUndefined();
    });
  });

  describe("env: shallow key merge", () => {
    test("child key overrides parent key", () => {
      const result = mergeConfigs([
        layer("/a", { env: { A: "parent", B: "only-parent" } }),
        layer("/b", { env: { A: "child", C: "only-child" } }),
      ]);
      expect(result.env).toEqual({
        A: "child",
        B: "only-parent",
        C: "only-child",
      });
    });

    test("parent env used when child has none", () => {
      const result = mergeConfigs([
        layer("/a", { env: { X: "val" } }),
        layer("/b"),
      ]);
      expect(result.env).toEqual({ X: "val" });
    });

    test("secrets merge like other env values", () => {
      const result = mergeConfigs([
        layer("/a", {
          env: { KEY: { secret: true, fromHost: true, hosts: ["a.com"] } },
        }),
        layer("/b", {
          env: { OTHER: { secret: true, fromHost: "X", hosts: ["b.com"] } },
        }),
      ]);
      expect(result.env).toEqual({
        KEY: { secret: true, fromHost: true, hosts: ["a.com"] },
        OTHER: { secret: true, fromHost: "X", hosts: ["b.com"] },
      });
    });

    test("no env when neither layer has env", () => {
      const result = mergeConfigs([layer("/a"), layer("/b")]);
      expect(result.env).toBeUndefined();
    });
  });

  describe("network: mode from child, hosts concatenated", () => {
    test("both restricted: hosts are concatenated and deduplicated", () => {
      const result = mergeConfigs([
        layer("/a", {
          network: { mode: "restricted", allowedHosts: ["a.com", "b.com"] },
        }),
        layer("/b", {
          network: { mode: "restricted", allowedHosts: ["b.com", "c.com"] },
        }),
      ]);
      expect(result.network).toEqual({
        mode: "restricted",
        allowedHosts: ["a.com", "b.com", "c.com"],
      });
    });

    test("allowedInternalHosts also merged", () => {
      const result = mergeConfigs([
        layer("/a", {
          network: { mode: "restricted", allowedInternalHosts: ["int.a"] },
        }),
        layer("/b", {
          network: { mode: "restricted", allowedInternalHosts: ["int.b"] },
        }),
      ]);
      expect(result.network!.mode).toBe("restricted");
      expect((result.network as any).allowedInternalHosts).toEqual([
        "int.a",
        "int.b",
      ]);
    });

    test("child open overrides parent restricted", () => {
      const result = mergeConfigs([
        layer("/a", {
          network: { mode: "restricted", allowedHosts: ["a.com"] },
        }),
        layer("/b", { network: { mode: "open" } }),
      ]);
      expect(result.network).toEqual({ mode: "open" });
    });

    test("child restricted overrides parent open", () => {
      const result = mergeConfigs([
        layer("/a", { network: { mode: "open" } }),
        layer("/b", {
          network: { mode: "restricted", allowedHosts: ["x.com"] },
        }),
      ]);
      expect(result.network).toEqual({
        mode: "restricted",
        allowedHosts: ["x.com"],
      });
    });

    test("parent network used when child has none", () => {
      const result = mergeConfigs([
        layer("/a", { network: { mode: "open" } }),
        layer("/b"),
      ]);
      expect(result.network).toEqual({ mode: "open" });
    });

    test("no network when neither layer has it", () => {
      const result = mergeConfigs([layer("/a"), layer("/b")]);
      expect(result.network).toBeUndefined();
    });
  });

  describe("path pre-resolution", () => {
    test("relative mount hostPath resolved against source configDir", () => {
      const result = mergeConfigs([
        layer("/home/.config/tuor", {
          mounts: [mount({ hostPath: "../projects" })],
        }),
        layer("/work/project/.tuor", {
          mounts: [mount({ hostPath: "../shared" })],
        }),
      ]);
      expect(result.mounts![0]!.hostPath).toBe("/home/.config/projects");
      expect(result.mounts![1]!.hostPath).toBe("/work/project/shared");
    });

    test("absolute mount hostPath left unchanged", () => {
      const result = mergeConfigs([
        layer("/any/dir", { mounts: [mount({ hostPath: "/absolute/path" })] }),
      ]);
      expect(result.mounts![0]!.hostPath).toBe("/absolute/path");
    });

    test("tilde mount hostPath left unchanged", () => {
      const result = mergeConfigs([
        layer("/any/dir", { mounts: [mount({ hostPath: "~/projects" })] }),
      ]);
      expect(result.mounts![0]!.hostPath).toBe("~/projects");
    });

    test("host: ignoreFileRefs pre-resolved against source configDir", () => {
      const result = mergeConfigs([
        layer("/home/.config/tuor", {
          mounts: [
            mount({ hostPath: "/data", ignoreFileRefs: ["host:./myignore"] }),
          ],
        }),
      ]);
      expect(result.mounts![0]!.ignoreFileRefs).toContain(
        "host:/home/.config/tuor/myignore",
      );
    });

    test("mount: ignoreFileRefs left unchanged", () => {
      const result = mergeConfigs([
        layer("/any", {
          mounts: [
            mount({ hostPath: "/data", ignoreFileRefs: ["mount:.tuorignore"] }),
          ],
        }),
      ]);
      expect(result.mounts![0]!.ignoreFileRefs).toContain("mount:.tuorignore");
    });

    test("default ignoreFileRefs are filled in and pre-resolved", () => {
      const result = mergeConfigs([
        layer("/project/.tuor", { mounts: [mount({ hostPath: "/data" })] }),
      ]);
      expect(result.mounts![0]!.ignoreFileRefs).toEqual([
        "host:/project/.tuor/tuorignore",
        "mount:.tuorignore",
      ]);
    });

    test("workdir MountConfig hostPath pre-resolved", () => {
      const result = mergeConfigs([
        layer("/project/.tuor", {
          workdir: {
            hostPath: "..",
            guestPath: "/workspace",
            mode: "readonly" as const,
          },
        }),
      ]);
      const wd = result.workdir as MountConfig;
      expect(wd.hostPath).toBe("/project");
    });
  });

  describe("three-level merge", () => {
    test("most specific wins for scalars, arrays concatenate across all layers", () => {
      const result = mergeConfigs([
        layer("/home/.config/tuor", {
          user: "home-user",
          env: { EDITOR: "vim" },
          mounts: [mount({ hostPath: "/global-tools" })],
        }),
        layer("/projects/.tuor", {
          user: "project-user",
          env: { EDITOR: "nano", PROJECT: "myproj" },
          mounts: [mount({ hostPath: "/project-data" })],
        }),
        layer("/projects/myapp/.tuor", {
          env: { APP: "myapp" },
          mounts: [mount({ hostPath: "/app-data" })],
        }),
      ]);

      // Scalars: most specific child wins (child has default "root" from helper)
      expect(result.user).toBe("root");

      // Env: shallow merge
      expect(result.env).toEqual({
        EDITOR: "nano",
        PROJECT: "myproj",
        APP: "myapp",
      });

      // Mounts: concatenated in order
      expect(result.mounts).toHaveLength(3);
      expect(result.mounts![0]!.hostPath).toBe("/global-tools");
      expect(result.mounts![1]!.hostPath).toBe("/project-data");
      expect(result.mounts![2]!.hostPath).toBe("/app-data");
    });
  });
});
