import type { Stats } from "node:fs";
import {
  type VfsStatfs,
  type VirtualFileHandle,
  type VirtualProvider,
  VirtualProviderClass,
} from "@earendil-works/gondolin";

// --- Public API ---

/** Numeric owner (uid/gid) presented to the guest for a mount's entries. */
export type Owner = { uid: number; gid: number };

/**
 * Wraps a VirtualProvider and rewrites the ownership (uid/gid) reported to the
 * guest, so mounted host files appear owned by `owner` regardless of their real
 * on-host ownership.
 *
 * This is display-only: it changes what `stat`/`lstat` (and an open handle's
 * `stat`) report; it does not change on-host ownership, and files the guest
 * creates still land on the host owned by the Tuor process user.
 *
 * Everything other than the ownership fields is forwarded verbatim to the
 * backing provider.
 */
export class OwnershipProvider
  extends VirtualProviderClass
  implements VirtualProvider
{
  private readonly backend: VirtualProvider;
  private readonly owner: Owner;

  constructor(backend: VirtualProvider, owner: Owner) {
    super();
    this.backend = backend;
    this.owner = owner;
  }

  get readonly() {
    return this.backend.readonly;
  }

  get supportsSymlinks() {
    return this.backend.supportsSymlinks;
  }

  get supportsWatch() {
    return this.backend.supportsWatch;
  }

  // --- stat / lstat: rewrite ownership ---

  async stat(path: string, options?: object) {
    return withOwner(await this.backend.stat(path, options), this.owner);
  }

  statSync(path: string, options?: object) {
    return withOwner(this.backend.statSync(path, options), this.owner);
  }

  async lstat(path: string, options?: object) {
    return withOwner(await this.backend.lstat(path, options), this.owner);
  }

  lstatSync(path: string, options?: object) {
    return withOwner(this.backend.lstatSync(path, options), this.owner);
  }

  // --- open: wrap the handle so its stat rewrites ownership too ---

  async open(path: string, flags: string, mode?: number) {
    return new OwnershipFileHandle(
      await this.backend.open(path, flags, mode),
      this.owner,
    );
  }

  openSync(path: string, flags: string, mode?: number) {
    return new OwnershipFileHandle(
      this.backend.openSync(path, flags, mode),
      this.owner,
    );
  }

  // --- everything else: forward verbatim ---

  async readdir(path: string, options?: object) {
    return this.backend.readdir(path, options);
  }

  readdirSync(path: string, options?: object) {
    return this.backend.readdirSync(path, options);
  }

  async mkdir(path: string, options?: object) {
    return this.backend.mkdir(path, options);
  }

  mkdirSync(path: string, options?: object) {
    return this.backend.mkdirSync(path, options);
  }

  async rmdir(path: string) {
    return this.backend.rmdir(path);
  }

  rmdirSync(path: string) {
    return this.backend.rmdirSync(path);
  }

  async unlink(path: string) {
    return this.backend.unlink(path);
  }

  unlinkSync(path: string) {
    return this.backend.unlinkSync(path);
  }

  async rename(oldPath: string, newPath: string) {
    return this.backend.rename(oldPath, newPath);
  }

  renameSync(oldPath: string, newPath: string) {
    return this.backend.renameSync(oldPath, newPath);
  }

  async link(existingPath: string, newPath: string) {
    if (this.backend.link) {
      return this.backend.link(existingPath, newPath);
    }
    return super.link(existingPath, newPath);
  }

  linkSync(existingPath: string, newPath: string) {
    if (this.backend.linkSync) {
      return this.backend.linkSync(existingPath, newPath);
    }
    return super.linkSync(existingPath, newPath);
  }

  async readlink(path: string, options?: object) {
    if (this.backend.readlink) {
      return this.backend.readlink(path, options);
    }
    return super.readlink(path, options);
  }

  readlinkSync(path: string, options?: object) {
    if (this.backend.readlinkSync) {
      return this.backend.readlinkSync(path, options);
    }
    return super.readlinkSync(path, options);
  }

  async symlink(target: string, path: string, type?: string) {
    if (this.backend.symlink) {
      return this.backend.symlink(target, path, type);
    }
    return super.symlink(target, path, type);
  }

  symlinkSync(target: string, path: string, type?: string) {
    if (this.backend.symlinkSync) {
      return this.backend.symlinkSync(target, path, type);
    }
    return super.symlinkSync(target, path, type);
  }

  async realpath(path: string, options?: object) {
    if (this.backend.realpath) {
      return this.backend.realpath(path, options);
    }
    return super.realpath(path, options);
  }

  realpathSync(path: string, options?: object) {
    if (this.backend.realpathSync) {
      return this.backend.realpathSync(path, options);
    }
    return super.realpathSync(path, options);
  }

  async access(path: string, mode?: number) {
    if (this.backend.access) {
      return this.backend.access(path, mode);
    }
    return super.access(path, mode);
  }

  accessSync(path: string, mode?: number) {
    if (this.backend.accessSync) {
      return this.backend.accessSync(path, mode);
    }
    return super.accessSync(path, mode);
  }

  async statfs(path: string): Promise<VfsStatfs> {
    if (this.backend.statfs) {
      return this.backend.statfs(path);
    }
    return super.statfs(path);
  }

  watch(path: string, options?: object) {
    if (this.backend.watch) {
      return this.backend.watch(path, options);
    }
    return super.watch(path, options);
  }

  watchAsync(path: string, options?: object) {
    if (this.backend.watchAsync) {
      return this.backend.watchAsync(path, options);
    }
    return super.watchAsync(path, options);
  }

  watchFile(
    path: string,
    options?: object,
    listener?: (...args: unknown[]) => void,
  ) {
    if (this.backend.watchFile) {
      return this.backend.watchFile(path, options, listener);
    }
    return super.watchFile(path, options);
  }

  unwatchFile(path: string, listener?: (...args: unknown[]) => void) {
    if (this.backend.unwatchFile) {
      return this.backend.unwatchFile(path, listener);
    }
    return super.unwatchFile(path, listener);
  }

  async close() {
    const backend = this.backend as { close?: () => Promise<void> | void };
    if (backend.close) {
      await backend.close();
    }
  }
}

// --- Internals ---

/**
 * Wraps a VirtualFileHandle, rewriting the ownership reported by `stat`/
 * `statSync` (used by the create + fstat RPC paths). All other operations
 * forward to the inner handle.
 */
class OwnershipFileHandle implements VirtualFileHandle {
  private readonly inner: VirtualFileHandle;
  private readonly owner: Owner;

  constructor(inner: VirtualFileHandle, owner: Owner) {
    this.inner = inner;
    this.owner = owner;
  }

  get path() {
    return this.inner.path;
  }

  get flags() {
    return this.inner.flags;
  }

  get mode() {
    return this.inner.mode;
  }

  get position() {
    return this.inner.position;
  }

  get closed() {
    return this.inner.closed;
  }

  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position?: number | null,
  ) {
    return this.inner.read(buffer, offset, length, position);
  }

  readSync(
    buffer: Buffer,
    offset: number,
    length: number,
    position?: number | null,
  ) {
    return this.inner.readSync(buffer, offset, length, position);
  }

  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position?: number | null,
  ) {
    return this.inner.write(buffer, offset, length, position);
  }

  writeSync(
    buffer: Buffer,
    offset: number,
    length: number,
    position?: number | null,
  ) {
    return this.inner.writeSync(buffer, offset, length, position);
  }

  readFile(options?: { encoding?: BufferEncoding } | BufferEncoding) {
    return this.inner.readFile(options);
  }

  readFileSync(options?: { encoding?: BufferEncoding } | BufferEncoding) {
    return this.inner.readFileSync(options);
  }

  writeFile(data: Buffer | string, options?: { encoding?: BufferEncoding }) {
    return this.inner.writeFile(data, options);
  }

  writeFileSync(
    data: Buffer | string,
    options?: { encoding?: BufferEncoding },
  ) {
    return this.inner.writeFileSync(data, options);
  }

  async stat(options?: object) {
    return withOwner(await this.inner.stat(options), this.owner);
  }

  statSync(options?: object) {
    return withOwner(this.inner.statSync(options), this.owner);
  }

  truncate(len?: number) {
    return this.inner.truncate(len);
  }

  truncateSync(len?: number) {
    return this.inner.truncateSync(len);
  }

  close() {
    return this.inner.close();
  }

  closeSync() {
    return this.inner.closeSync();
  }
}

/**
 * Return a copy of `stats` with uid/gid replaced by `owner`.
 *
 * We clone (rather than mutate) so the backend's object is untouched, and we
 * preserve the prototype so methods like `isDirectory()` (which read
 * `this.mode`) keep working. `uid`/`gid` are plain writable data properties on
 * both Node's `fs.Stats` and Gondolin's virtual Stats, so overriding them on the
 * clone is enough.
 */
function withOwner(stats: Stats, owner: Owner): Stats {
  const clone = Object.create(
    Object.getPrototypeOf(stats),
    Object.getOwnPropertyDescriptors(stats),
  ) as Stats;
  clone.uid = owner.uid;
  clone.gid = owner.gid;
  return clone;
}
