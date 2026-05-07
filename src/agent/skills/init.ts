/**
 * Bootstrap skills at startup: scan ~/.teleton/workspace/skills/, populate the
 * registry, optionally start the FS watcher, and return a stop handle.
 */

import { mkdirSync } from "fs";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { createLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errors.js";
import { loadSkillsFromDir } from "./loader.js";
import { getSkillRegistry } from "./registry.js";
import { SkillWatcher } from "./watcher.js";

const log = createLogger("Skills");

export interface InitializeSkillsOptions {
  /** Watch the skills dir for changes and hot-reload (default true). */
  watch?: boolean;
  /** Override the skills root (tests). Defaults to WORKSPACE_PATHS.SKILLS_DIR. */
  skillsDir?: string;
}

export interface SkillsHandle {
  count: number;
  stop: () => Promise<void>;
}

export function initializeSkills(options: InitializeSkillsOptions = {}): SkillsHandle {
  const dir = options.skillsDir ?? WORKSPACE_PATHS.SKILLS_DIR;
  const watch = options.watch ?? true;

  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    log.warn(`Could not create skills dir ${dir}: ${getErrorMessage(error)}`);
  }

  const skills = loadSkillsFromDir(dir);
  getSkillRegistry().replaceAll(skills);

  if (skills.length > 0) {
    log.info(`🧠 ${skills.length} skill(s) loaded: ${skills.map((s) => s.name).join(", ")}`);
  }

  if (!watch) {
    return { count: skills.length, stop: async () => {} };
  }

  const watcher = new SkillWatcher(dir);
  watcher.start();

  return {
    count: skills.length,
    stop: async () => {
      await watcher.stop();
    },
  };
}
