/**
 * SkillWatcher — chokidar-based hot reload for ~/.teleton/workspace/skills/.
 *
 * Strategy: on any change inside the skills directory, debounce briefly then
 * rescan the entire tree. Skills are cheap to parse (a handful of small .md
 * files), so a full rescan is simpler and safer than per-file diffing.
 *
 * Errors during reload never crash the agent — bad SKILL.md files are logged
 * and skipped; the previous registry stays in place if scanning throws.
 */

import chokidar from "chokidar";
import { createLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errors.js";
import { loadSkillsFromDir } from "./loader.js";
import { getSkillRegistry } from "./registry.js";

const log = createLogger("SkillWatcher");

const RELOAD_DEBOUNCE_MS = 300;

/**
 * Window during which a programmatic reload (skill_install) suppresses the watcher's debounced rescan.
 * Sized to cover slow filesystems (e.g. Raspberry Pi SD cards): write latency + awaitWriteFinish (300ms)
 * + debounce (300ms) + buffer.
 */
const SUPPRESS_MS = 1500;

export class SkillWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private suppressUntil = 0;

  constructor(private readonly skillsDir: string) {}

  start(): void {
    if (this.watcher) return;

    getSkillRegistry().setReloadHook(() => {
      this.suppressUntil = Date.now() + SUPPRESS_MS;
    });

    this.watcher = chokidar.watch(this.skillsDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
      ignored: ["**/.git/**", "**/node_modules/**", "**/*.swp", "**/.DS_Store"],
      depth: 5,
      followSymlinks: false,
      ignorePermissionErrors: true,
    });

    const onChange = (): void => this.scheduleReload();
    this.watcher.on("add", onChange);
    this.watcher.on("change", onChange);
    this.watcher.on("unlink", onChange);
    this.watcher.on("addDir", onChange);
    this.watcher.on("unlinkDir", onChange);
    this.watcher.on("error", (error: unknown) => {
      log.warn(`Watcher error: ${getErrorMessage(error)}`);
    });
  }

  async stop(): Promise<void> {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    getSkillRegistry().setReloadHook(null);
    if (this.watcher) {
      const w = this.watcher;
      this.watcher = null;
      try {
        await w.close();
      } catch (error) {
        log.warn(`Watcher close failed: ${getErrorMessage(error)}`);
      }
    }
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.reload();
    }, RELOAD_DEBOUNCE_MS);
  }

  private reload(): void {
    if (Date.now() < this.suppressUntil) return;
    try {
      const skills = loadSkillsFromDir(this.skillsDir);
      const registry = getSkillRegistry();
      const before = registry.size;
      registry.replaceAll(skills);
      log.info(`Skills reloaded: ${before} -> ${skills.length}`);
    } catch (error) {
      log.error(`Skill reload failed, keeping previous registry: ${getErrorMessage(error)}`);
    }
  }
}
