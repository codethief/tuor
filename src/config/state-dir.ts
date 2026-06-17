import { join } from "node:path";

/**
 * Layout of Tuor's internal state directory.
 *
 * Within a config dir (a `.tuor/` directory), Tuor persists internal state
 * under `STATE_DIR_NAME`. This is Tuor's own data (e.g. persistent overlay
 * upper layers), not user content, and should never be treated as such — e.g.
 * the recursive ignore-file scan must not descend into it.
 */

export const STATE_DIR_NAME = ".state";

/** Subdir of the state dir holding persistent overlay upper layers. */
export const OVERLAYS_DIR_NAME = "overlays";

/** Absolute path to Tuor's internal state dir for the given config dir. */
export function getStateDir(configDir: string): string {
  return join(configDir, STATE_DIR_NAME);
}

/** Absolute path to the dir holding persistent overlay upper layers. */
export function getOverlaysDir(configDir: string): string {
  return join(getStateDir(configDir), OVERLAYS_DIR_NAME);
}
