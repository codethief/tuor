import { describe, expect, test } from "vitest";
import {
  _resolveDefaultProfiles,
  type NixDeps,
  resolveNixSetup,
} from "./nix.ts";

const LOADER_X64 = "/lib64/ld-linux-x86-64.so.2";
const LOADER_ARM64 = "/lib/ld-linux-aarch64.so.1";
const NIX_LD_SHIM = "/nix/store/abc-nix-ld/bin/nix-ld";

/**
 * realpath stub: resolves the host's loader symlink into /nix/store (as a
 * nix-ld host does), plus whatever extra mappings a test needs.
 */
function realpathWith(map: Record<string, string> = {}) {
  return (p: string) => {
    if (map[p] !== undefined) return map[p];
    return p === LOADER_X64 || p === LOADER_ARM64 ? NIX_LD_SHIM : p;
  };
}

const baseDeps: NixDeps = {
  hostEnv: {},
  hostArch: "x64",
  resolveProfiles: () => [
    "/nix/store/abc-system-path",
    "/nix/store/xyz-user-env",
  ],
  realpath: realpathWith(),
  pathExists: () => true,
  warn: () => {},
};

function deps(overrides: Partial<NixDeps> = {}): NixDeps {
  return { ...baseDeps, ...overrides };
}

describe("resolveNixSetup", () => {
  test("throws when /nix does not exist", () => {
    expect(() =>
      resolveNixSetup(
        { nixLd: false },
        deps({ pathExists: (p) => p !== "/nix" }),
      ),
    ).toThrow("/nix does not exist");
  });

  test("throws when no profiles are found", () => {
    expect(() =>
      resolveNixSetup({ nixLd: false }, deps({ resolveProfiles: () => [] })),
    ).toThrow("No Nix profiles found");
  });

  describe("mounts", () => {
    test("always mounts /nix read-only", () => {
      const { mounts } = resolveNixSetup({ nixLd: false }, deps());
      expect(mounts).toContainEqual(
        expect.objectContaining({
          hostPath: "/nix",
          guestPath: "/nix",
          mode: "readonly",
        }),
      );
    });

    test("mounts nothing but /nix, even when nixLd is enabled", () => {
      // The loader is symlinked rather than mounted — mounting the host's
      // loader dir would shadow the guest's own /lib on aarch64.
      for (const nixLd of [false, true]) {
        const { mounts } = resolveNixSetup({ nixLd }, deps());
        expect(mounts.map((m) => m.guestPath)).toEqual(["/nix"]);
      }
    });

    test("nix mounts have empty shadowPatterns", () => {
      const { mounts } = resolveNixSetup({ nixLd: true }, deps());
      for (const mount of mounts) {
        expect(mount.shadowPatterns).toEqual([]);
      }
    });
  });

  describe("nixLd boot commands", () => {
    test("emits no boot commands when nixLd is disabled", () => {
      const { bootCommands } = resolveNixSetup({ nixLd: false }, deps());
      expect(bootCommands).toEqual([]);
    });

    test("symlinks the shim to the x64 loader path", () => {
      const { bootCommands } = resolveNixSetup(
        { nixLd: true },
        deps({ hostArch: "x64" }),
      );
      expect(bootCommands).toEqual([
        `mkdir -p /lib64 && ln -sf ${NIX_LD_SHIM} ${LOADER_X64}`,
      ]);
    });

    test("symlinks the shim to the arm64 loader path", () => {
      const { bootCommands } = resolveNixSetup(
        { nixLd: true },
        deps({ hostArch: "arm64" }),
      );
      expect(bootCommands).toEqual([
        `mkdir -p /lib && ln -sf ${NIX_LD_SHIM} ${LOADER_ARM64}`,
      ]);
    });

    test("throws when the host loader does not exist", () => {
      expect(() =>
        resolveNixSetup(
          { nixLd: true },
          deps({
            hostArch: "arm64",
            pathExists: (p) => p !== LOADER_ARM64,
          }),
        ),
      ).toThrow(`${LOADER_ARM64} does not exist`);
    });

    test("throws when the host loader does not resolve under /nix/", () => {
      expect(() =>
        resolveNixSetup(
          { nixLd: true },
          deps({ hostArch: "arm64", realpath: (p) => p }),
        ),
      ).toThrow("not under /nix/");
    });

    test("throws on an unsupported architecture", () => {
      expect(() =>
        resolveNixSetup({ nixLd: true }, deps({ hostArch: "s390x" })),
      ).toThrow('architecture "s390x" is not supported');
    });
  });

  describe("profile resolution", () => {
    test("uses explicit profiles from config", () => {
      const { env } = resolveNixSetup(
        {
          profiles: ["/nix/store/custom-a", "/nix/store/custom-b"],
          nixLd: false,
        },
        deps(),
      );
      expect(env.PATH).toBe("/nix/store/custom-a/bin:/nix/store/custom-b/bin");
    });

    test("resolves symlinks for explicit profiles", () => {
      const { env } = resolveNixSetup(
        { profiles: ["/run/current-system/sw"], nixLd: false },
        deps({
          realpath: (p) =>
            p === "/run/current-system/sw" ? "/nix/store/abc-system-path" : p,
        }),
      );
      expect(env.PATH).toBe("/nix/store/abc-system-path/bin");
    });

    test("rejects explicit profile that does not resolve under /nix/", () => {
      expect(() =>
        resolveNixSetup(
          { profiles: ["/usr/local/share/myprofile"], nixLd: false },
          deps(),
        ),
      ).toThrow("not under /nix/");
    });

    test("auto-detects profiles when not specified", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({
          resolveProfiles: () => ["/nix/store/sys-path", "/nix/store/user-env"],
        }),
      );
      expect(env.PATH).toBe("/nix/store/sys-path/bin:/nix/store/user-env/bin");
    });
  });

  describe("env vars", () => {
    test("always sets NIX_SSL_CERT_FILE", () => {
      const { env } = resolveNixSetup({ nixLd: false }, deps());
      expect(env.NIX_SSL_CERT_FILE).toBe("/run/gondolin/ca-certificates.crt");
    });

    test("resolves NIX_LD_LIBRARY_PATH entries through symlinks", () => {
      const { env } = resolveNixSetup(
        { nixLd: true },
        deps({
          hostEnv: { NIX_LD_LIBRARY_PATH: "/run/current-system/sw/lib" },
          realpath: realpathWith({
            "/run/current-system/sw/lib": "/nix/store/abc-libs/lib",
          }),
        }),
      );
      expect(env.NIX_LD_LIBRARY_PATH).toBe("/nix/store/abc-libs/lib");
    });

    test("resolves NIX_LD through symlinks", () => {
      const { env } = resolveNixSetup(
        { nixLd: true },
        deps({
          hostEnv: { NIX_LD: "/run/current-system/sw/share/nix-ld/lib/ld.so" },
          realpath: realpathWith({
            "/run/current-system/sw/share/nix-ld/lib/ld.so":
              "/nix/store/abc-glibc/lib/ld-linux-x86-64.so.2",
          }),
        }),
      );
      expect(env.NIX_LD).toBe("/nix/store/abc-glibc/lib/ld-linux-x86-64.so.2");
    });

    test("does not forward nix-ld env vars when nixLd is disabled", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({
          hostEnv: {
            NIX_LD: "/nix/store/abc-glibc/lib/ld.so",
            NIX_LD_LIBRARY_PATH: "/nix/store/abc-libs/lib",
          },
        }),
      );
      expect(env).not.toHaveProperty("NIX_LD");
      expect(env).not.toHaveProperty("NIX_LD_LIBRARY_PATH");
    });

    test("resolves multiple colon-separated NIX_LD_LIBRARY_PATH entries", () => {
      const { env } = resolveNixSetup(
        { nixLd: true },
        deps({
          hostEnv: {
            NIX_LD_LIBRARY_PATH:
              "/run/current-system/sw/lib:/run/current-system/sw/lib64",
          },
          realpath: realpathWith({
            "/run/current-system/sw/lib": "/nix/store/abc/lib",
            "/run/current-system/sw/lib64": "/nix/store/xyz/lib64",
          }),
        }),
      );
      expect(env.NIX_LD_LIBRARY_PATH).toBe(
        "/nix/store/abc/lib:/nix/store/xyz/lib64",
      );
    });

    test("filters out NIX_LD_LIBRARY_PATH entries that don't resolve under /nix/", () => {
      const { env } = resolveNixSetup(
        { nixLd: true },
        deps({
          hostEnv: {
            NIX_LD_LIBRARY_PATH: "/usr/lib:/run/current-system/sw/lib",
          },
          realpath: realpathWith({
            "/run/current-system/sw/lib": "/nix/store/abc/lib",
          }),
        }),
      );
      expect(env.NIX_LD_LIBRARY_PATH).toBe("/nix/store/abc/lib");
    });

    test("omits NIX_LD_LIBRARY_PATH entirely when no entries resolve under /nix/", () => {
      const { env } = resolveNixSetup(
        { nixLd: true },
        deps({
          hostEnv: { NIX_LD_LIBRARY_PATH: "/usr/lib" },
        }),
      );
      expect(env).not.toHaveProperty("NIX_LD_LIBRARY_PATH");
    });

    test("omits NIX_LD_LIBRARY_PATH when not on host", () => {
      const { env } = resolveNixSetup({ nixLd: true }, deps({ hostEnv: {} }));
      expect(env).not.toHaveProperty("NIX_LD_LIBRARY_PATH");
    });

    test("resolves LOCALE_ARCHIVE through symlinks", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({
          hostEnv: {
            LOCALE_ARCHIVE: "/run/current-system/sw/lib/locale/locale-archive",
          },
          realpath: (p) =>
            p === "/run/current-system/sw/lib/locale/locale-archive"
              ? "/nix/store/abc-glibc/lib/locale/locale-archive"
              : p,
        }),
      );
      expect(env.LOCALE_ARCHIVE).toBe(
        "/nix/store/abc-glibc/lib/locale/locale-archive",
      );
    });

    test("drops LOCALE_ARCHIVE when it doesn't resolve under /nix/", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({
          hostEnv: { LOCALE_ARCHIVE: "/usr/lib/locale/locale-archive" },
        }),
      );
      expect(env).not.toHaveProperty("LOCALE_ARCHIVE");
    });

    test("resolves TZDIR through symlinks", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({
          hostEnv: { TZDIR: "/run/current-system/sw/share/zoneinfo" },
          realpath: (p) =>
            p === "/run/current-system/sw/share/zoneinfo"
              ? "/nix/store/xyz-tzdata/share/zoneinfo"
              : p,
        }),
      );
      expect(env.TZDIR).toBe("/nix/store/xyz-tzdata/share/zoneinfo");
    });

    test("omits absent host env vars", () => {
      const { env } = resolveNixSetup({ nixLd: false }, deps({ hostEnv: {} }));
      expect(Object.keys(env)).toEqual(["PATH", "NIX_SSL_CERT_FILE"]);
    });

    test("warns when a path doesn't resolve under /nix/", () => {
      const warnings: string[] = [];
      resolveNixSetup(
        { nixLd: false },
        deps({
          hostEnv: { LOCALE_ARCHIVE: "/usr/lib/locale/locale-archive" },
          warn: (msg) => warnings.push(msg),
        }),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("LOCALE_ARCHIVE");
      expect(warnings[0]).toContain("/usr/lib/locale/locale-archive");
      expect(warnings[0]).toContain("not under /nix/");
    });

    test("warns when a path does not exist", () => {
      const warnings: string[] = [];
      resolveNixSetup(
        { nixLd: false },
        deps({
          hostEnv: { TZDIR: "/no/such/path" },
          realpath: (p) => {
            if (p === "/no/such/path") throw new Error("ENOENT");
            return p;
          },
          warn: (msg) => warnings.push(msg),
        }),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("TZDIR");
      expect(warnings[0]).toContain("does not exist");
    });

    test("warns for each dropped entry in a path-list", () => {
      const warnings: string[] = [];
      resolveNixSetup(
        { nixLd: true },
        deps({
          hostEnv: { NIX_LD_LIBRARY_PATH: "/usr/lib:/opt/lib" },
          warn: (msg) => warnings.push(msg),
        }),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain("/usr/lib");
      expect(warnings[1]).toContain("/opt/lib");
    });
  });

  describe("TLS setup", () => {
    test("sets NIX_SSL_CERT_FILE to Gondolin's CA bundle", () => {
      const { env } = resolveNixSetup({ nixLd: false }, deps());
      expect(env.NIX_SSL_CERT_FILE).toBe("/run/gondolin/ca-certificates.crt");
    });
  });
});

describe("_resolveDefaultProfiles", () => {
  test("returns empty array when NIX_PROFILES is not set", () => {
    expect(_resolveDefaultProfiles({})).toEqual([]);
  });

  test("returns empty array for empty NIX_PROFILES", () => {
    expect(_resolveDefaultProfiles({ NIX_PROFILES: "" })).toEqual([]);
  });
});
