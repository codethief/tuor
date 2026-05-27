/** Derive the conventional home directory for a Linux user. */
function inferGuestHomeDir(user: string): string {
  return user === "root" ? "/root" : `/home/${user}`;
}

/**
 * Expand a leading `~` (bare or followed by `/`) to `homeDir`.
 * Does NOT handle `~otheruser` syntax — only the current user's `~`.
 */
function expandTilde(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return homeDir + path.slice(1);
  return path;
}

export { expandTilde, inferGuestHomeDir };
