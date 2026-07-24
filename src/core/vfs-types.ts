/**
 * A provider that optionally exposes a `close` lifecycle method for releasing
 * resources.
 *
 * Gondolin's `VirtualProvider` type does not declare `close`, yet several
 * concrete providers (e.g. `SandboxVfsProvider`, `ShadowProvider`) implement one
 * for cleanup. Wrappers intersect this with `VirtualProvider` on the backends
 * they accept so they can forward `close` when present — without casting at the
 * call site. `close` stays optional, so any plain `VirtualProvider` still
 * satisfies the intersection.
 */
export type MaybeClosable = { close?: () => Promise<void> | void };
