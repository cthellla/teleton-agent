import { describe, it, expect, beforeEach } from "vitest";
import { renderSkillsPromptSection } from "../prompt.js";
import { getSkillRegistry, setSkillRegistry } from "../registry.js";
import type { Skill, SkillOwner } from "../types.js";

function makeSkill(name: string, owner: SkillOwner = { kind: "shared" }): Skill {
  return {
    name,
    description: `desc ${name}`,
    owner,
    dir: `/fake/${name}`,
    path: `/fake/${name}/SKILL.md`,
    body: "body",
    resources: [],
  };
}

beforeEach(() => {
  setSkillRegistry(null);
});

describe("renderSkillsPromptSection", () => {
  it("returns null when nothing is visible to the viewer", () => {
    getSkillRegistry().replaceAll([makeSkill("ad", { kind: "admin" })]);
    expect(renderSkillsPromptSection({ isAdmin: false, senderId: 1 })).toBeNull();
  });

  it("includes shared skills for non-admin", () => {
    getSkillRegistry().replaceAll([
      makeSkill("a", { kind: "shared" }),
      makeSkill("b", { kind: "admin" }),
    ]);
    const out = renderSkillsPromptSection({ isAdmin: false, senderId: 1 });
    expect(out).toContain("- **a**");
    expect(out).not.toContain("- **b**");
  });

  it("admin sees admin + shared with tags", () => {
    getSkillRegistry().replaceAll([
      makeSkill("pub", { kind: "shared" }),
      makeSkill("ad", { kind: "admin" }),
    ]);
    const out = renderSkillsPromptSection({ isAdmin: true, senderId: 1 });
    expect(out).toContain("- **ad** _(admin)_:");
    expect(out).toContain("- **pub**:");
  });

  it("user sees only their own personal skill", () => {
    getSkillRegistry().replaceAll([
      makeSkill("mine", { kind: "user", userId: 42 }),
      makeSkill("yours", { kind: "user", userId: 99 }),
    ]);
    const out = renderSkillsPromptSection({ isAdmin: false, senderId: 42 });
    expect(out).toContain("- **mine** _(personal)_");
    expect(out).not.toContain("yours");
  });

  it("never includes the body or resources", () => {
    getSkillRegistry().replaceAll([makeSkill("hn")]);
    const out = renderSkillsPromptSection({ isAdmin: false });
    expect(out).not.toContain("body");
  });
});
