import type { Dirent } from "node:fs";
import path from "node:path";
import { getSystemErrorName } from "node:util";
import {
  ERRNO,
  isWriteFlag,
  normalizeVfsPath,
  type VfsStatfs,
  type VirtualFileHandle,
  type VirtualProvider,
  VirtualProviderClass,
} from "@earendil-works/gondolin";

// --- Constants ---

const WHITEOUT_PREFIX = ".wh.";
const OPAQUE_MARKER = ".wh..wh..opq";

// --- Public API ---

/**
 * Union-mount provider with copy-on-write semantics (like Linux overlayfs).
 *
 * Reads check the upper layer first, falling through to the lower layer when a
 * file hasn't been modified. Writes always go to the upper layer. Deletes
 * record whiteout markers in the upper layer so that lower-layer files stay
 * hidden.
 */
export class OverlayProvider
  extends (VirtualProviderClass as new () => Record<string, unknown>)
  implements VirtualProvider
{
  private readonly lower: VirtualProvider;
  private readonly upper: VirtualProvider;

  constructor(lower: VirtualProvider, upper: VirtualProvider) {
    super();
    this.lower = lower;
    this.upper = upper;
  }

  get readonly() {
    return false;
  }

  get supportsSymlinks() {
    return this.lower.supportsSymlinks;
  }

  // TODO: merging watchers across two layers
  get supportsWatch() {
    return false;
  }

  // --- stat / lstat ---

  async stat(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (await this.hasWhiteout(p)) throw enoent("stat", p);
    try {
      return await this.upper.stat(p, options);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
      return this.lower.stat(p, options);
    }
  }

  statSync(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (this.hasWhiteoutSync(p)) throw enoent("stat", p);
    try {
      return this.upper.statSync(p, options);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
      return this.lower.statSync(p, options);
    }
  }

  async lstat(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (await this.hasWhiteout(p)) throw enoent("lstat", p);
    try {
      return await this.upper.lstat(p, options);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
      return this.lower.lstat(p, options);
    }
  }

  lstatSync(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (this.hasWhiteoutSync(p)) throw enoent("lstat", p);
    try {
      return this.upper.lstatSync(p, options);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
      return this.lower.lstatSync(p, options);
    }
  }

  // --- open ---

  async open(
    entryPath: string,
    flags: string,
    mode?: number,
  ): Promise<VirtualFileHandle> {
    const p = normalizeVfsPath(entryPath);

    if (isWriteFlag(flags)) {
      return this.openForWrite(p, flags, mode);
    }

    // Read-only: upper first, then lower
    try {
      return await this.upper.open(p, flags, mode);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
      if (await this.hasWhiteout(p)) throw enoent("open", p);
      return this.lower.open(p, flags, mode);
    }
  }

  openSync(entryPath: string, flags: string, mode?: number): VirtualFileHandle {
    const p = normalizeVfsPath(entryPath);

    if (isWriteFlag(flags)) {
      return this.openForWriteSync(p, flags, mode);
    }

    try {
      return this.upper.openSync(p, flags, mode);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
      if (this.hasWhiteoutSync(p)) throw enoent("open", p);
      return this.lower.openSync(p, flags, mode);
    }
  }

  // --- readdir ---

  async readdir(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (await this.hasWhiteout(p)) throw enoent("readdir", p);

    const upperEntries = await tryReaddir(this.upper, p, options);

    if (await this.isOpaque(p)) {
      return filterWhiteoutEntries(upperEntries);
    }

    const lowerEntries = await tryReaddir(this.lower, p, options);

    // tryReaddir returns [] for both "empty dir" and "dir doesn't exist".
    // When both layers return [], check whether the directory actually exists.
    if (upperEntries.length === 0 && lowerEntries.length === 0) {
      const exists =
        (await existsIn(this.upper, p)) || (await existsIn(this.lower, p));
      if (!exists) throw enoent("readdir", p);
    }

    return mergeEntries(lowerEntries, upperEntries);
  }

  readdirSync(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (this.hasWhiteoutSync(p)) throw enoent("readdir", p);

    const upperEntries = tryReaddirSync(this.upper, p, options);

    if (this.isOpaqueSync(p)) {
      return filterWhiteoutEntries(upperEntries);
    }

    const lowerEntries = tryReaddirSync(this.lower, p, options);

    // tryReaddir returns [] for both "empty dir" and "dir doesn't exist".
    // When both layers return [], check whether the directory actually exists.
    if (upperEntries.length === 0 && lowerEntries.length === 0) {
      const exists = existsInSync(this.upper, p) || existsInSync(this.lower, p);
      if (!exists) throw enoent("readdir", p);
    }

    return mergeEntries(lowerEntries, upperEntries);
  }

  // --- mkdir ---

  async mkdir(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    const whited = await this.hasWhiteout(p);

    if (!whited) {
      // Check if dir already exists in the merged view
      if ((await existsIn(this.upper, p)) || (await existsIn(this.lower, p))) {
        throw createErrnoError(ERRNO.EEXIST, "mkdir", p);
      }
    }

    await this.ensureUpperParents(p);
    const result = await this.upper.mkdir(p, options);
    if (whited) {
      await this.markOpaque(p);
      await this.removeWhiteout(p);
    }
    return result;
  }

  mkdirSync(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    const whited = this.hasWhiteoutSync(p);

    if (!whited) {
      if (existsInSync(this.upper, p) || existsInSync(this.lower, p)) {
        throw createErrnoError(ERRNO.EEXIST, "mkdir", p);
      }
    }

    this.ensureUpperParentsSync(p);
    const result = this.upper.mkdirSync(p, options);
    if (whited) {
      this.markOpaqueSync(p);
      this.removeWhiteoutSync(p);
    }
    return result;
  }

  // --- unlink ---

  async unlink(entryPath: string) {
    const p = normalizeVfsPath(entryPath);
    const inUpper = await existsIn(this.upper, p);
    const whited = await this.hasWhiteout(p);
    const inLower = !whited && (await existsIn(this.lower, p));

    if (!inUpper && !inLower) throw enoent("unlink", p);

    if (inUpper) await this.upper.unlink(p);
    if (inLower) await this.createWhiteout(p);
  }

  unlinkSync(entryPath: string) {
    const p = normalizeVfsPath(entryPath);
    const inUpper = existsInSync(this.upper, p);
    const whited = this.hasWhiteoutSync(p);
    const inLower = !whited && existsInSync(this.lower, p);

    if (!inUpper && !inLower) throw enoent("unlink", p);

    if (inUpper) this.upper.unlinkSync(p);
    if (inLower) this.createWhiteoutSync(p);
  }

  // --- rmdir ---

  async rmdir(entryPath: string) {
    const p = normalizeVfsPath(entryPath);
    const inUpper = await existsIn(this.upper, p);
    const whited = await this.hasWhiteout(p);
    const inLower = !whited && (await existsIn(this.lower, p));

    if (!inUpper && !inLower) throw enoent("rmdir", p);

    if (inUpper) await this.upper.rmdir(p);
    if (inLower) await this.createWhiteout(p);
  }

  rmdirSync(entryPath: string) {
    const p = normalizeVfsPath(entryPath);
    const inUpper = existsInSync(this.upper, p);
    const whited = this.hasWhiteoutSync(p);
    const inLower = !whited && existsInSync(this.lower, p);

    if (!inUpper && !inLower) throw enoent("rmdir", p);

    if (inUpper) this.upper.rmdirSync(p);
    if (inLower) this.createWhiteoutSync(p);
  }

  // --- rename ---

  async rename(oldPath: string, newPath: string) {
    const from = normalizeVfsPath(oldPath);
    const to = normalizeVfsPath(newPath);

    const inUpper = await existsIn(this.upper, from);
    const whited = await this.hasWhiteout(from);
    const inLower = !whited && (await existsIn(this.lower, from));

    if (!inUpper && !inLower) throw enoent("rename", from);

    // Copy up source if only in lower
    if (!inUpper && inLower) {
      await this.copyUp(from);
    }

    await this.ensureUpperParents(to);
    await this.upper.rename(from, to);

    // Whiteout old path if it existed in lower
    if (inLower) await this.createWhiteout(from);

    // Clear whiteout at destination if any
    if (await this.hasWhiteout(to)) await this.removeWhiteout(to);
  }

  renameSync(oldPath: string, newPath: string) {
    const from = normalizeVfsPath(oldPath);
    const to = normalizeVfsPath(newPath);

    const inUpper = existsInSync(this.upper, from);
    const whited = this.hasWhiteoutSync(from);
    const inLower = !whited && existsInSync(this.lower, from);

    if (!inUpper && !inLower) throw enoent("rename", from);

    if (!inUpper && inLower) {
      this.copyUpSync(from);
    }

    this.ensureUpperParentsSync(to);
    this.upper.renameSync(from, to);

    if (inLower) this.createWhiteoutSync(from);
    if (this.hasWhiteoutSync(to)) this.removeWhiteoutSync(to);
  }

  // --- optional VirtualProvider methods ---

  async access(entryPath: string, mode?: number) {
    const p = normalizeVfsPath(entryPath);
    if (await this.hasWhiteout(p)) throw enoent("access", p);
    try {
      if (this.upper.access) return await this.upper.access(p, mode);
      await this.upper.stat(p);
      return;
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
    }
    if (this.lower.access) return this.lower.access(p, mode);
    await this.lower.stat(p); // throws ENOENT if not in lower either
  }

  accessSync(entryPath: string, mode?: number) {
    const p = normalizeVfsPath(entryPath);
    if (this.hasWhiteoutSync(p)) throw enoent("access", p);
    try {
      if (this.upper.accessSync) return this.upper.accessSync(p, mode);
      this.upper.statSync(p);
      return;
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
    }
    if (this.lower.accessSync) return this.lower.accessSync(p, mode);
    this.lower.statSync(p);
  }

  async readlink(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (await this.hasWhiteout(p)) throw enoent("readlink", p);
    try {
      if (this.upper.readlink) return await this.upper.readlink(p, options);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
    }
    if (this.lower.readlink) return this.lower.readlink(p, options);
    throw enoent("readlink", p);
  }

  readlinkSync(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (this.hasWhiteoutSync(p)) throw enoent("readlink", p);
    try {
      if (this.upper.readlinkSync) return this.upper.readlinkSync(p, options);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
    }
    if (this.lower.readlinkSync) return this.lower.readlinkSync(p, options);
    throw enoent("readlink", p);
  }

  async symlink(target: string, entryPath: string, type?: string) {
    const p = normalizeVfsPath(entryPath);
    if (await this.hasWhiteout(p)) await this.removeWhiteout(p);
    await this.ensureUpperParents(p);
    if (this.upper.symlink) return this.upper.symlink(target, p, type);
    throw createErrnoError(ERRNO.ENOSYS, "symlink", p);
  }

  symlinkSync(target: string, entryPath: string, type?: string) {
    const p = normalizeVfsPath(entryPath);
    if (this.hasWhiteoutSync(p)) this.removeWhiteoutSync(p);
    this.ensureUpperParentsSync(p);
    if (this.upper.symlinkSync) return this.upper.symlinkSync(target, p, type);
    throw createErrnoError(ERRNO.ENOSYS, "symlink", p);
  }

  async realpath(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (await this.hasWhiteout(p)) throw enoent("realpath", p);
    try {
      if (this.upper.realpath) return await this.upper.realpath(p, options);
      await this.upper.stat(p);
      return p;
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
    }
    if (this.lower.realpath) return this.lower.realpath(p, options);
    await this.lower.stat(p);
    return p;
  }

  realpathSync(entryPath: string, options?: object) {
    const p = normalizeVfsPath(entryPath);
    if (this.hasWhiteoutSync(p)) throw enoent("realpath", p);
    try {
      if (this.upper.realpathSync) return this.upper.realpathSync(p, options);
      this.upper.statSync(p);
      return p;
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
    }
    if (this.lower.realpathSync) return this.lower.realpathSync(p, options);
    this.lower.statSync(p);
    return p;
  }

  async statfs(entryPath: string): Promise<VfsStatfs> {
    const p = normalizeVfsPath(entryPath);
    if (this.upper.statfs) return this.upper.statfs(p);
    if (this.lower.statfs) return this.lower.statfs(p);
    throw createErrnoError(ERRNO.ENOSYS, "statfs", p);
  }

  async close() {
    const upperClose = (this.upper as { close?: () => Promise<void> | void })
      .close;
    const lowerClose = (this.lower as { close?: () => Promise<void> | void })
      .close;
    if (upperClose) await upperClose.call(this.upper);
    if (lowerClose) await lowerClose.call(this.lower);
  }

  // --- Private: open helpers ---

  private async openForWrite(
    p: string,
    flags: string,
    mode?: number,
  ): Promise<VirtualFileHandle> {
    if (await this.hasWhiteout(p)) await this.removeWhiteout(p);
    await this.ensureUpperParents(p);

    // Pure create (w/wx): no copy-up needed
    if (/^[wa]x?$/.test(flags)) {
      return this.upper.open(p, flags, mode);
    }

    // r+, a+, w+: need existing content for r+/a+, copy up if only in lower
    if (!(await existsIn(this.upper, p)) && (await existsIn(this.lower, p))) {
      await this.copyUp(p);
    }

    return this.upper.open(p, flags, mode);
  }

  private openForWriteSync(
    p: string,
    flags: string,
    mode?: number,
  ): VirtualFileHandle {
    if (this.hasWhiteoutSync(p)) this.removeWhiteoutSync(p);
    this.ensureUpperParentsSync(p);

    if (/^[wa]x?$/.test(flags)) {
      return this.upper.openSync(p, flags, mode);
    }

    if (!existsInSync(this.upper, p) && existsInSync(this.lower, p)) {
      this.copyUpSync(p);
    }

    return this.upper.openSync(p, flags, mode);
  }

  // --- Private: copy-up ---

  private async copyUp(p: string) {
    await this.ensureUpperParents(p);
    const handle = await this.lower.open(p, "r");
    try {
      const content = await handle.readFile();
      const dest = await this.upper.open(p, "w");
      try {
        await dest.writeFile(
          typeof content === "string" ? Buffer.from(content) : content,
        );
      } finally {
        await dest.close();
      }
    } finally {
      await handle.close();
    }
  }

  private copyUpSync(p: string) {
    this.ensureUpperParentsSync(p);
    const handle = this.lower.openSync(p, "r");
    try {
      const content = handle.readFileSync();
      const dest = this.upper.openSync(p, "w");
      try {
        dest.writeFileSync(
          typeof content === "string" ? Buffer.from(content) : content,
        );
      } finally {
        dest.closeSync();
      }
    } finally {
      handle.closeSync();
    }
  }

  // --- Private: parent directory creation in upper ---

  private async ensureUpperParents(p: string) {
    const dir = path.posix.dirname(p);
    if (dir === "/" || dir === p) return;
    try {
      await this.upper.mkdir(dir, { recursive: true });
    } catch (err) {
      if (!isExistsError(err)) throw err;
    }
  }

  private ensureUpperParentsSync(p: string) {
    const dir = path.posix.dirname(p);
    if (dir === "/" || dir === p) return;
    try {
      this.upper.mkdirSync(dir, { recursive: true });
    } catch (err) {
      if (!isExistsError(err)) throw err;
    }
  }

  // --- Private: whiteout operations ---

  private async hasWhiteout(p: string): Promise<boolean> {
    if (p === "/") return false;
    const marker = whiteoutPath(p);
    if (await existsIn(this.upper, marker)) return true;
    // Check if any ancestor is whited out
    const parent = path.posix.dirname(p);
    if (parent !== p) return this.hasWhiteout(parent);
    return false;
  }

  private hasWhiteoutSync(p: string): boolean {
    if (p === "/") return false;
    const marker = whiteoutPath(p);
    if (existsInSync(this.upper, marker)) return true;
    const parent = path.posix.dirname(p);
    if (parent !== p) return this.hasWhiteoutSync(parent);
    return false;
  }

  private async createWhiteout(p: string) {
    const marker = whiteoutPath(p);
    await this.ensureUpperParents(marker);
    const handle = await this.upper.open(marker, "w");
    await handle.close();
  }

  private createWhiteoutSync(p: string) {
    const marker = whiteoutPath(p);
    this.ensureUpperParentsSync(marker);
    const handle = this.upper.openSync(marker, "w");
    handle.closeSync();
  }

  private async removeWhiteout(p: string) {
    const marker = whiteoutPath(p);
    try {
      await this.upper.unlink(marker);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
    }
  }

  private removeWhiteoutSync(p: string) {
    const marker = whiteoutPath(p);
    try {
      this.upper.unlinkSync(marker);
    } catch (err) {
      if (!isNoEntryError(err)) throw err;
    }
  }

  private async isOpaque(dirPath: string): Promise<boolean> {
    return existsIn(this.upper, path.posix.join(dirPath, OPAQUE_MARKER));
  }

  private isOpaqueSync(dirPath: string): boolean {
    return existsInSync(this.upper, path.posix.join(dirPath, OPAQUE_MARKER));
  }

  private async markOpaque(dirPath: string) {
    const marker = path.posix.join(dirPath, OPAQUE_MARKER);
    const handle = await this.upper.open(marker, "w");
    await handle.close();
  }

  private markOpaqueSync(dirPath: string) {
    const marker = path.posix.join(dirPath, OPAQUE_MARKER);
    const handle = this.upper.openSync(marker, "w");
    handle.closeSync();
  }
}

// --- Module-private helpers ---

function whiteoutPath(p: string): string {
  const dir = path.posix.dirname(p);
  const name = path.posix.basename(p);
  return path.posix.join(dir, WHITEOUT_PREFIX + name);
}

function getEntryName(entry: string | Dirent): string {
  return typeof entry === "string" ? entry : entry.name;
}

async function existsIn(
  provider: VirtualProvider,
  p: string,
): Promise<boolean> {
  try {
    await provider.stat(p);
    return true;
  } catch (err) {
    if (isNoEntryError(err)) return false;
    throw err;
  }
}

function existsInSync(provider: VirtualProvider, p: string): boolean {
  try {
    provider.statSync(p);
    return true;
  } catch (err) {
    if (isNoEntryError(err)) return false;
    throw err;
  }
}

async function tryReaddir(
  provider: VirtualProvider,
  p: string,
  options?: object,
): Promise<Array<string | Dirent>> {
  try {
    return (await provider.readdir(p, options)) as Array<string | Dirent>;
  } catch (err) {
    if (isNoEntryError(err)) return [];
    throw err;
  }
}

function tryReaddirSync(
  provider: VirtualProvider,
  p: string,
  options?: object,
): Array<string | Dirent> {
  try {
    return provider.readdirSync(p, options) as Array<string | Dirent>;
  } catch (err) {
    if (isNoEntryError(err)) return [];
    throw err;
  }
}

/**
 * Merge lower and upper directory entries. Upper entries take precedence.
 * Whiteout markers in the upper listing are filtered out and used to exclude
 * corresponding lower entries.
 */
function mergeEntries(
  lowerEntries: Array<string | Dirent>,
  upperEntries: Array<string | Dirent>,
): Array<string | Dirent> {
  const merged: Array<string | Dirent> = [];
  const upperNames = new Set<string>();
  const whiteoutNames = new Set<string>();

  for (const entry of upperEntries) {
    const name = getEntryName(entry);
    if (name.startsWith(WHITEOUT_PREFIX)) {
      whiteoutNames.add(name.slice(WHITEOUT_PREFIX.length));
    } else {
      upperNames.add(name);
      merged.push(entry);
    }
  }

  for (const entry of lowerEntries) {
    const name = getEntryName(entry);
    if (!upperNames.has(name) && !whiteoutNames.has(name)) {
      merged.push(entry);
    }
  }

  return merged;
}

function filterWhiteoutEntries(
  entries: Array<string | Dirent>,
): Array<string | Dirent> {
  return entries.filter((e) => !getEntryName(e).startsWith(WHITEOUT_PREFIX));
}

function isNoEntryError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const error = err as NodeJS.ErrnoException;
  return (
    error.code === "ENOENT" ||
    error.code === "ERRNO_2" ||
    error.errno === ERRNO.ENOENT
  );
}

function isExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const error = err as NodeJS.ErrnoException;
  return error.code === "EEXIST" || error.errno === ERRNO.EEXIST;
}

/**
 * Based on Gondolin's createErrnoError (not part of its public API).
 * NB: Gondolin passes `errno` directly to getSystemErrorName, but that function
 * expects negative values (e.g. -2 for ENOENT) while os.constants.errno gives
 * positive ones. We fix this by negating.
 */
function createErrnoError(
  errno: number,
  syscall: string,
  entryPath?: string,
): NodeJS.ErrnoException {
  let code = "EUNKNOWN";
  try {
    code = getSystemErrorName(-errno);
  } catch {
    code = `ERRNO_${errno}`;
  }
  const message = entryPath
    ? `${code}: ${syscall} '${entryPath}'`
    : `${code}: ${syscall}`;
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  error.errno = errno;
  error.syscall = syscall;
  if (entryPath) error.path = entryPath;
  return error;
}

function enoent(syscall: string, entryPath: string): NodeJS.ErrnoException {
  return createErrnoError(ERRNO.ENOENT, syscall, entryPath);
}
