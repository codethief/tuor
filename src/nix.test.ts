import { describe, expect, test } from "vitest";
import {
  resolveNixSetup,
  resolveDefaultProfiles,
  type NixDeps,
} from "./nix.ts";

const baseDeps: NixDeps = {
  hostEnv: {},
  resolveProfiles: () => ["/nix/store/abc-system-path", "/nix/store/xyz-user-env"],
  realpath: (p) => p,
  nixExists: () => true,
  lib64Exists: () => true,
};

function deps(overrides: Partial<NixDeps> = {}): NixDeps {
  return { ...baseDeps, ...overrides };
}

describe("resolveNixSetup", () => {
  test("throws when /nix does not exist", () => {
    expect(() =>
      resolveNixSetup({ nixLd: false }, deps({ nixExists: () => false })),
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
      expect(mounts).toContainEqual({
        hostPath: "/nix",
        guestPath: "/nix",
        mode: "readonly",
      });
    });

    test("does not mount /lib64 by default", () => {
      const { mounts } = resolveNixSetup({ nixLd: false }, deps());
      expect(mounts.find((m) => m.guestPath === "/lib64")).toBeUndefined();
    });

    test("mounts /lib64 read-only when nixLd is true", () => {
      const { mounts } = resolveNixSetup({ nixLd: true }, deps());
      expect(mounts).toContainEqual({
        hostPath: "/lib64",
        guestPath: "/lib64",
        mode: "readonly",
      });
    });

    test("throws when nixLd is true but /lib64 does not exist", () => {
      expect(() =>
        resolveNixSetup(
          { nixLd: true },
          deps({ lib64Exists: () => false }),
        ),
      ).toThrow("/lib64 does not exist");
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
            p === "/run/current-system/sw"
              ? "/nix/store/abc-system-path"
              : p,
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
      ).toThrow('not under /nix/');
    });

    test("auto-detects profiles when not specified", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({
          resolveProfiles: () => ["/nix/store/sys-path", "/nix/store/user-env"],
        }),
      );
      expect(env.PATH).toBe(
        "/nix/store/sys-path/bin:/nix/store/user-env/bin",
      );
    });
  });

  describe("env vars", () => {
    test("always sets NIX_SSL_CERT_FILE", () => {
      const { env } = resolveNixSetup({ nixLd: false }, deps());
      expect(env.NIX_SSL_CERT_FILE).toBe("/run/gondolin/nix-ca-bundle.crt");
    });

    test("forwards NIX_LD_LIBRARY_PATH from host when present", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({ hostEnv: { NIX_LD_LIBRARY_PATH: "/nix/store/libs" } }),
      );
      expect(env.NIX_LD_LIBRARY_PATH).toBe("/nix/store/libs");
    });

    test("omits NIX_LD_LIBRARY_PATH when not on host", () => {
      const { env } = resolveNixSetup({ nixLd: false }, deps({ hostEnv: {} }));
      expect(env).not.toHaveProperty("NIX_LD_LIBRARY_PATH");
    });

    test("forwards LOCALE_ARCHIVE from host when present", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({ hostEnv: { LOCALE_ARCHIVE: "/nix/store/locales" } }),
      );
      expect(env.LOCALE_ARCHIVE).toBe("/nix/store/locales");
    });

    test("forwards TZDIR from host when present", () => {
      const { env } = resolveNixSetup(
        { nixLd: false },
        deps({ hostEnv: { TZDIR: "/nix/store/tzdata" } }),
      );
      expect(env.TZDIR).toBe("/nix/store/tzdata");
    });

    test("omits absent host env vars", () => {
      const { env } = resolveNixSetup({ nixLd: false }, deps({ hostEnv: {} }));
      expect(Object.keys(env)).toEqual(["PATH", "NIX_SSL_CERT_FILE"]);
    });
  });

  describe("TLS setup", () => {
    test("produces command that concatenates CA bundles", () => {
      const { tlsSetupCommand } = resolveNixSetup({ nixLd: false }, deps());
      expect(tlsSetupCommand).toContain("ca-certificates.crt");
      expect(tlsSetupCommand).toContain("mitm/ca.crt");
      expect(tlsSetupCommand).toContain("/run/gondolin/nix-ca-bundle.crt");
    });
  });
});

describe("resolveDefaultProfiles", () => {
  test("returns empty array when NIX_PROFILES is not set", () => {
    expect(resolveDefaultProfiles({})).toEqual([]);
  });

  test("returns empty array for empty NIX_PROFILES", () => {
    expect(resolveDefaultProfiles({ NIX_PROFILES: "" })).toEqual([]);
  });
});
