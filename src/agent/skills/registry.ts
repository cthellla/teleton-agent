import type { Skill, SkillViewer } from "./types.js";
import { isVisibleTo } from "./types.js";
import { loadSkillsFromDir } from "./loader.js";

let registryInstance: SkillRegistry | null = null;

type ReloadHook = () => void;

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private reloadHook: ReloadHook | null = null;

  replaceAll(skills: Skill[]): void {
    this.skills = new Map(skills.map((s) => [s.name, s]));
  }

  /** Reload from disk and notify the watcher to skip its next debounced rescan. */
  reloadFromDisk(skillsRoot: string): void {
    this.replaceAll(loadSkillsFromDir(skillsRoot));
    this.reloadHook?.();
  }

  /** Watcher uses this to register a callback fired right after a programmatic reload. */
  setReloadHook(hook: ReloadHook | null): void {
    this.reloadHook = hook;
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** All skills, regardless of viewer, sorted by name. Use `listVisible` for caller-scoped filtering. */
  all(): Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Skills visible to the given viewer (sender + admin status), sorted by name. */
  listVisible(viewer: SkillViewer): Skill[] {
    const visible: Skill[] = [];
    for (const skill of this.skills.values()) {
      if (isVisibleTo(skill, viewer)) visible.push(skill);
    }
    return visible.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Returns the skill if it exists AND is visible to the viewer. */
  getVisible(name: string, viewer: SkillViewer): Skill | undefined {
    const skill = this.skills.get(name);
    if (!skill) return undefined;
    return isVisibleTo(skill, viewer) ? skill : undefined;
  }

  get size(): number {
    return this.skills.size;
  }
}

export function getSkillRegistry(): SkillRegistry {
  if (!registryInstance) {
    registryInstance = new SkillRegistry();
  }
  return registryInstance;
}

/** Test-only: reset the singleton between cases. */
export function setSkillRegistry(registry: SkillRegistry | null): void {
  registryInstance = registry;
}
