/**
 * Expand a leading `~` (bare or followed by `/`) to `homeDir`.
 * Does NOT handle `~otheruser` syntax — only the current user's `~`.
 */
export function expandTilde(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return homeDir + path.slice(1);
  return path;
}
