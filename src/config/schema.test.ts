import { describe, expect, test } from "vitest";
import {
  findConfigDir,
  parseConfig,
  type RootfsImageBuildConfig,
  type RootfsImagePullConfig,
  type TuorConfig,
} from "./schema.ts";

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
  test("parses a fully-populated config with correct defaults", () => {
    const raw = {
      guestUser: { uid: 0, gid: 0 },
      network: { mode: "restricted", allowedHosts: ["*.github.com"] },
      workdir: { hostPath: "/host/project", guestPath: "/workspace" },
      mounts: [
        { hostPath: "/data", guestPath: "/mnt/data", mode: "readwrite" },
        { hostPath: "../relative" },
      ],
      nix: {
        profiles: ["/nix/var/nix/profiles/default"],
        nixLd: true,
      },
    };
    const config = parseConfig(raw);
    expect(config).toMatchObject({
      guestUser: { uid: 0, gid: 0 },
      network: { mode: "restricted", allowedHosts: ["*.github.com"] },
      workdir: {
        hostPath: "/host/project",
        guestPath: "/workspace",
        mode: "readonly",
      },
      mounts: [
        { hostPath: "/data", guestPath: "/mnt/data", mode: "readwrite" },
        { hostPath: "../relative", mode: "readonly" },
      ],
      nix: {
        profiles: ["/nix/var/nix/profiles/default"],
        nixLd: true,
      },
    });
  });

  test("leaves optional fields unset for minimal config", () => {
    // guestUser/workdir carry no schema default (they're defaulted post-merge in
    // applyConfigDefaults), so parseConfig leaves them undefined here.
    const config = parseConfig({});
    expect(config.guestUser).toBeUndefined();
    expect(config.workdir).toBeUndefined();
    expect(config.network).toBeUndefined();
    expect(config.mounts).toBeUndefined();
    expect(config.nix).toBeUndefined();
  });

  test("accepts workdir as absolute guest path string", () => {
    expect(parseConfig({ workdir: "/workspace" }).workdir).toBe("/workspace");
  });

  test("accepts workdir as tilde path string", () => {
    expect(parseConfig({ workdir: "~/workspace" }).workdir).toBe("~/workspace");
  });

  test("accepts tilde guestPath in mount", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data", guestPath: "~/data" }],
    });
    expect(config.mounts![0]!.guestPath).toBe("~/data");
  });

  test("accepts tilde hostPath in mount", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "~/projects" }],
    });
    expect(config.mounts![0]!.hostPath).toBe("~/projects");
  });

  test("accepts guestUser { uid: 0, gid: 0 }", () => {
    const config = parseConfig({ guestUser: { uid: 0, gid: 0 } });
    expect(config.guestUser).toEqual({ uid: 0, gid: 0 });
  });

  test("accepts a guestUser.homedir override", () => {
    const config = parseConfig({
      guestUser: { uid: 0, gid: 0, homedir: "/custom/home" },
    });
    expect(config.guestUser?.homedir).toBe("/custom/home");
  });

  test("omits guestUser.homedir when not specified", () => {
    const config = parseConfig({ guestUser: { uid: 0, gid: 0 } });
    expect(config.guestUser?.homedir).toBeUndefined();
  });

  test("rejects a non-root guestUser", () => {
    expect(() =>
      parseConfig({ guestUser: { uid: 1000, gid: 1000 } }),
    ).toThrow();
  });

  test("accepts a per-mount owner", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data", owner: { uid: 1000, gid: 1000 } }],
    });
    expect(config.mounts![0]!.owner).toEqual({ uid: 1000, gid: 1000 });
  });

  test("accepts a per-volume owner", () => {
    const config = parseConfig({
      volumes: [{ guestPath: "/cache", owner: { uid: 1000 } }],
    });
    expect(config.volumes![0]!.owner).toEqual({ uid: 1000 });
  });

  test("rejects a negative owner uid", () => {
    expect(() =>
      parseConfig({ mounts: [{ hostPath: "/data", owner: { uid: -1 } }] }),
    ).toThrow();
  });

  test("parses mount with ignore list", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data", ignore: [".env", ".git"] }],
    });
    expect(config.mounts![0]!.ignore).toEqual([".env", ".git"]);
  });

  test("omits ignore when not specified", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data" }],
    });
    expect(config.mounts![0]).not.toHaveProperty("ignore");
  });

  test("accepts explicit ignoreFileRefs", () => {
    const config = parseConfig({
      mounts: [
        {
          hostPath: "/data",
          ignoreFileRefs: ["host:custom", "mount:.myignore"],
        },
      ],
    });
    expect(config.mounts![0]!.ignoreFileRefs).toEqual([
      "host:custom",
      "mount:.myignore",
    ]);
  });

  test("omits ignoreFileRefs when not specified", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data" }],
    });
    expect(config.mounts![0]).not.toHaveProperty("ignoreFileRefs");
  });

  test("accepts bootCommands as a list of shell strings", () => {
    const config = parseConfig({ bootCommands: ["npm ci", "mkdir -p /cache"] });
    expect(config.bootCommands).toEqual(["npm ci", "mkdir -p /cache"]);
  });

  test("omits bootCommands when not specified", () => {
    const config = parseConfig({});
    expect(config.bootCommands).toBeUndefined();
  });

  test("accepts env with string values", () => {
    const config = parseConfig({ env: { MY_VAR: "hello" } });
    expect(config.env).toEqual({ MY_VAR: "hello" });
  });

  test("accepts env with an explicit value", () => {
    const config = parseConfig({ env: { EDITOR: { value: "vim" } } });
    expect(config.env).toEqual({ EDITOR: { value: "vim" } });
  });

  test("accepts env with an empty object (host var by key name)", () => {
    const config = parseConfig({ env: { EDITOR: {} } });
    expect(config.env).toEqual({ EDITOR: {} });
  });

  test("accepts env with mixed value types", () => {
    const config = parseConfig({
      env: {
        FIXED: "value",
        FROM_HOST: {},
        EXPLICIT: { value: "$OTHER" },
      },
    });
    expect(config.env).toEqual({
      FIXED: "value",
      FROM_HOST: {},
      EXPLICIT: { value: "$OTHER" },
    });
  });

  test("accepts env with secret sourced from host by key name", () => {
    const config = parseConfig({
      env: {
        API_KEY: { secret: true, injectForHosts: ["api.example.com"] },
      },
    });
    expect(config.env).toEqual({
      API_KEY: { secret: true, injectForHosts: ["api.example.com"] },
    });
  });

  test("accepts env with secret given an explicit value", () => {
    const config = parseConfig({
      env: {
        GH_TOKEN: {
          secret: true,
          value: "$GITHUB_TOKEN",
          injectForHosts: ["*.github.com"],
        },
      },
    });
    expect(config.env).toEqual({
      GH_TOKEN: {
        secret: true,
        value: "$GITHUB_TOKEN",
        injectForHosts: ["*.github.com"],
      },
    });
  });

  test("accepts env mixing literals, host-sourced vars, and secrets", () => {
    const config = parseConfig({
      env: {
        FIXED: "value",
        EDITOR: {},
        API_KEY: { secret: true, injectForHosts: ["api.example.com"] },
      },
    });
    expect(config.env).toEqual({
      FIXED: "value",
      EDITOR: {},
      API_KEY: { secret: true, injectForHosts: ["api.example.com"] },
    });
  });

  test("omits env when not specified", () => {
    const config = parseConfig({});
    expect(config.env).toBeUndefined();
  });

  describe("network config", () => {
    test("accepts open mode", () => {
      const config = parseConfig({ network: { mode: "open" } });
      expect(config.network).toEqual({ mode: "open" });
    });

    test("accepts restricted mode with allowedHosts", () => {
      const config = parseConfig({
        network: {
          mode: "restricted",
          allowedHosts: ["*.github.com", "api.anthropic.com"],
        },
      });
      expect(config.network).toEqual({
        mode: "restricted",
        allowedHosts: ["*.github.com", "api.anthropic.com"],
      });
    });

    test("accepts restricted mode with empty allowedHosts (block all)", () => {
      const config = parseConfig({
        network: { mode: "restricted", allowedHosts: [] },
      });
      expect(config.network).toEqual({ mode: "restricted", allowedHosts: [] });
    });

    test("accepts restricted mode with allowedInternalHosts", () => {
      const config = parseConfig({
        network: {
          mode: "restricted",
          allowedHosts: ["api.example.com"],
          allowedInternalHosts: ["litellm.corp.internal"],
        },
      });
      expect(config.network).toEqual({
        mode: "restricted",
        allowedHosts: ["api.example.com"],
        allowedInternalHosts: ["litellm.corp.internal"],
      });
    });

    test("omits allowedInternalHosts when not specified", () => {
      const config = parseConfig({
        network: { mode: "restricted", allowedHosts: [] },
      });
      expect(config.network).not.toHaveProperty("allowedInternalHosts");
    });

    test("accepts restricted mode without allowedHosts", () => {
      const config = parseConfig({ network: { mode: "restricted" } });
      expect(config.network).toEqual({ mode: "restricted" });
    });

    test("rejects unknown network mode", () => {
      expect(() => parseConfig({ network: { mode: "custom" } })).toThrow();
    });
  });

  describe("volumes config", () => {
    test("accepts volumes with absolute guestPath", () => {
      const config = parseConfig({
        volumes: [{ guestPath: "/cache" }],
      });
      expect(config.volumes).toEqual([{ guestPath: "/cache" }]);
    });

    test("accepts volumes with tilde guestPath", () => {
      const config = parseConfig({
        volumes: [{ guestPath: "~/data" }],
      });
      expect(config.volumes![0]!.guestPath).toBe("~/data");
    });

    test("omits volumes when not specified", () => {
      const config = parseConfig({});
      expect(config.volumes).toBeUndefined();
    });

    test("accepts multiple volumes", () => {
      const config = parseConfig({
        volumes: [{ guestPath: "/cache" }, { guestPath: "/data" }],
      });
      expect(config.volumes).toHaveLength(2);
    });
  });

  describe("qemu config", () => {
    test("accepts accel, cpu and machineType", () => {
      const config = parseConfig({
        qemu: {
          accel: "tcg,tb-size=1024",
          cpu: "qemu64",
          machineType: "q35",
        },
      });
      expect(config.qemu).toEqual({
        accel: "tcg,tb-size=1024",
        cpu: "qemu64",
        machineType: "q35",
      });
    });

    test("accepts a partial config", () => {
      const config = parseConfig({ qemu: { accel: "tcg,tb-size=1024" } });
      expect(config.qemu).toEqual({ accel: "tcg,tb-size=1024" });
    });

    test("omits qemu when not specified", () => {
      const config = parseConfig({});
      expect(config.qemu).toBeUndefined();
    });
  });

  describe("resources config", () => {
    test("accepts memory and cpus", () => {
      const config = parseConfig({
        resources: { memory: "2G", cpus: 4 },
      });
      expect(config.resources).toEqual({
        memory: "2G",
        cpus: 4,
      });
    });

    test("accepts a partial config", () => {
      const config = parseConfig({ resources: { cpus: 8 } });
      expect(config.resources).toEqual({ cpus: 8 });
    });

    test.each([
      "512M",
      "2g",
      "1T",
      "1048576K",
    ])("accepts memory: %s", (memory) => {
      expect(parseConfig({ resources: { memory } }).resources).toEqual({
        memory,
      });
    });

    test("omits resources when not specified", () => {
      const config = parseConfig({});
      expect(config.resources).toBeUndefined();
    });
  });

  describe("rootfs config", () => {
    /** Narrow a parsed `rootfs.image` to the pull variant. */
    function pullImage(config: TuorConfig): RootfsImagePullConfig {
      const image = config.rootfs?.image;
      if (!image || "containerfile" in image) {
        throw new Error(`expected a pull-variant image, got ${image}`);
      }
      return image;
    }

    /** Narrow a parsed `rootfs.image` to the Containerfile variant. */
    function buildImage(config: TuorConfig): RootfsImageBuildConfig {
      const image = config.rootfs?.image;
      if (!image || !("containerfile" in image)) {
        throw new Error(`expected a build-variant image, got ${image}`);
      }
      return image;
    }

    test("accepts an image with just a ref", () => {
      const config = parseConfig({
        rootfs: { image: { ref: "docker.io/library/debian:bookworm-slim" } },
      });
      expect(config.rootfs).toEqual({
        image: {
          ref: "docker.io/library/debian:bookworm-slim",
          pullPolicy: "if-not-present",
          buildPolicy: "if-not-present",
        },
      });
    });

    test("defaults an omitted pullPolicy to if-not-present", () => {
      const config = parseConfig({ rootfs: { image: { ref: "alpine:3.23" } } });
      expect(pullImage(config).pullPolicy).toBe("if-not-present");
    });

    test("defaults an omitted buildPolicy to if-not-present", () => {
      const config = parseConfig({ rootfs: { image: { ref: "alpine:3.23" } } });
      expect(pullImage(config).buildPolicy).toBe("if-not-present");
    });

    test.each([
      "if-not-present",
      "always",
    ])("accepts an explicit buildPolicy: %s", (buildPolicy) => {
      const config = parseConfig({
        rootfs: { image: { ref: "alpine:3.23", buildPolicy } },
      });
      expect(pullImage(config).buildPolicy).toBe(buildPolicy);
    });

    test("rejects buildPolicy 'never' on the pull variant", () => {
      expect(() =>
        parseConfig({
          rootfs: { image: { ref: "alpine:3.23", buildPolicy: "never" } },
        }),
      ).toThrow();
    });

    test.each([
      "if-not-present",
      "always",
      "never",
    ])("accepts an explicit pullPolicy: %s", (pullPolicy) => {
      const config = parseConfig({
        rootfs: { image: { ref: "alpine:3.23", pullPolicy } },
      });
      expect(pullImage(config).pullPolicy).toBe(pullPolicy);
    });

    test.each(["docker", "podman"])("accepts engine: %s", (engine) => {
      const config = parseConfig({
        rootfs: { image: { ref: "alpine:3.23", engine } },
      });
      expect(config.rootfs?.image?.engine).toBe(engine);
    });

    test("accepts a size alongside an image", () => {
      const config = parseConfig({
        rootfs: { image: { ref: "alpine:3.23" }, size: "8G" },
      });
      expect(config.rootfs).toEqual({
        image: {
          ref: "alpine:3.23",
          pullPolicy: "if-not-present",
          buildPolicy: "if-not-present",
        },
        size: "8G",
      });
    });

    test("accepts a bare size without an image", () => {
      const config = parseConfig({ rootfs: { size: "512M" } });
      expect(config.rootfs).toEqual({ size: "512M" });
    });

    test.each(["512M", "8g", "1T", "1048576K"])("accepts size: %s", (size) => {
      expect(parseConfig({ rootfs: { size } }).rootfs).toEqual({ size });
    });

    test("omits rootfs when not specified", () => {
      const config = parseConfig({});
      expect(config.rootfs).toBeUndefined();
    });

    describe("Containerfile variant", () => {
      const BUILD_IMAGE = {
        ref: "my-devbox",
        containerfile: "./Containerfile",
        context: ".",
        buildPolicy: "if-not-present",
      };

      test("accepts the minimal build image", () => {
        const config = parseConfig({ rootfs: { image: BUILD_IMAGE } });
        expect(config.rootfs?.image).toEqual(BUILD_IMAGE);
      });

      test("accepts an engine alongside it", () => {
        const config = parseConfig({
          rootfs: { image: { ...BUILD_IMAGE, engine: "podman" } },
        });
        expect(buildImage(config).engine).toBe("podman");
      });

      test.each([
        "if-not-present",
        "always",
      ])("accepts buildPolicy: %s", (buildPolicy) => {
        const config = parseConfig({
          rootfs: { image: { ...BUILD_IMAGE, buildPolicy } },
        });
        expect(buildImage(config).buildPolicy).toBe(buildPolicy);
      });

      test.each([
        "my-devbox",
        "tuor/my-devbox",
        "my-devbox:v1",
        "registry.local/team/devbox:latest",
        "550e8400-e29b-41d4-a716-446655440000",
        "tuor.dev_01",
      ])("accepts ref: %s", (ref) => {
        const config = parseConfig({
          rootfs: { image: { ...BUILD_IMAGE, ref } },
        });
        expect(buildImage(config).ref).toBe(ref);
      });

      test.each([
        ["uppercase in the name", "MyDevbox"],
        ["a digest you cannot build to", "my-devbox@sha256:abc"],
        ["a leading dash", "-my-devbox"],
        ["an empty ref", ""],
      ])("rejects %s", (_what, ref) => {
        expect(() =>
          parseConfig({ rootfs: { image: { ...BUILD_IMAGE, ref } } }),
        ).toThrow();
      });

      test.each([
        ["containerfile", "context"],
        ["context", "containerfile"],
        ["buildPolicy", "buildPolicy"],
      ])("rejects a build image missing %s", (missing) => {
        const image: Record<string, unknown> = { ...BUILD_IMAGE };
        delete image[missing];
        expect(() => parseConfig({ rootfs: { image } })).toThrow();
      });

      /**
       * The two variants are mutually exclusive: `pullPolicy` governs fetching
       * an image that exists, `buildPolicy` producing one that doesn't.
       */
      test("rejects mixing pullPolicy into the build variant", () => {
        expect(() =>
          parseConfig({
            rootfs: { image: { ...BUILD_IMAGE, pullPolicy: "never" } },
          }),
        ).toThrow();
      });

      test("rejects a containerfile without the rest of the variant", () => {
        expect(() =>
          parseConfig({
            rootfs: { image: { ref: "x", containerfile: "./Containerfile" } },
          }),
        ).toThrow();
      });
    });
  });

  test.each([
    ["qemu unknown field", { qemu: { foo: "bar" } }],
    ["qemu empty accel", { qemu: { accel: "" } }],
    ["qemu non-string cpu", { qemu: { cpu: 42 } }],
    ["resources unknown field", { resources: { foo: "bar" } }],
    ["resources malformed memory", { resources: { memory: "2GB" } }],
    ["resources empty memory", { resources: { memory: "" } }],
    [
      "resources memory without a unit suffix",
      { resources: { memory: "1024" } },
    ],
    ["resources non-integer cpus", { resources: { cpus: 1.5 } }],
    ["resources zero cpus", { resources: { cpus: 0 } }],
    ["resources non-number cpus", { resources: { cpus: "4" } }],
    ["rootfs unknown field", { rootfs: { foo: "bar" } }],
    ["rootfs image without ref", { rootfs: { image: { engine: "docker" } } }],
    ["rootfs image empty ref", { rootfs: { image: { ref: "" } } }],
    [
      "rootfs image unknown field",
      { rootfs: { image: { ref: "alpine", platform: "linux/amd64" } } },
    ],
    [
      "rootfs image bad engine",
      { rootfs: { image: { ref: "alpine", engine: "containerd" } } },
    ],
    [
      "rootfs image bad pullPolicy",
      { rootfs: { image: { ref: "alpine", pullPolicy: "sometimes" } } },
    ],
    ["rootfs malformed size", { rootfs: { size: "8GB" } }],
    ["rootfs size with a space", { rootfs: { size: "8 G" } }],
    ["rootfs empty size", { rootfs: { size: "" } }],
    ["rootfs non-string size", { rootfs: { size: 8192 } }],
    ["rootfs size without a unit suffix", { rootfs: { size: "2048" } }],
    [
      "relative guestPath",
      { mounts: [{ hostPath: "/foo", guestPath: "rel" }] },
    ],
    ["empty hostPath", { mounts: [{ hostPath: "" }] }],
    ["invalid mode", { mounts: [{ hostPath: "/x", mode: "bad" }] }],
    ["non-string hostPath", { mounts: [{ hostPath: 123 }] }],
    ["relative workdir string", { workdir: "relative" }],
    ["empty workdir string", { workdir: "" }],
    ["relative nix profile", { nix: { profiles: ["relative/path"] } }],
    [
      "volume with relative guestPath",
      { volumes: [{ guestPath: "relative" }] },
    ],
    [
      "volume with unknown field",
      { volumes: [{ guestPath: "/x", hostPath: "/y" }] },
    ],
    ["bootCommands with empty-string entry", { bootCommands: [""] }],
    ["bootCommands as a bare string", { bootCommands: "npm ci" }],
    ["non-object input", "not an object"],
    ["empty ignore array", { mounts: [{ hostPath: "/x", ignore: [] }] }],
    ["env with non-string value", { env: { X: { value: 123 } } }],
    ["env with unknown source key", { env: { X: { badKey: true } } }],
    [
      "injectForHosts without secret",
      { env: { X: { injectForHosts: ["h"] } } },
    ],
    ["secret without injectForHosts", { env: { X: { secret: true } } }],
    [
      "secret with empty injectForHosts",
      { env: { X: { secret: true, injectForHosts: [] } } },
    ],
    [
      "secret: false (only literal true accepted)",
      { env: { X: { secret: false, injectForHosts: ["h"] } } },
    ],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseConfig(raw)).toThrow();
  });
});
