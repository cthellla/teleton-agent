import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry, getSkillRegistry, setSkillRegistry } from "../registry.js";
import type { Skill, SkillOwner } from "../types.js";

function makeSkill(name: string, owner: SkillOwner = { kind: "shared" }): Skill {
  return {
    name,
    description: `desc ${name}`,
    owner,
    dir: `/fake/${name}`,
    path: `/fake/${name}/SKILL.md`,
    body: `# ${name}\nbody`,
    resources: [],
  };
}

beforeEach(() => {
  setSkillRegistry(null);
});

describe("SkillRegistry — basic ops", () => {
  it("starts empty", () => {
    const r = new SkillRegistry();
    expect(r.size).toBe(0);
    expect(r.all()).toEqual([]);
    expect(r.get("nope")).toBeUndefined();
  });

  it("replaceAll populates lookups by name", () => {
    const r = new SkillRegistry();
    r.replaceAll([makeSkill("a"), makeSkill("b")]);
    expect(r.size).toBe(2);
    expect(r.get("a")?.name).toBe("a");
  });

  it("all() returns sorted by name", () => {
    const r = new SkillRegistry();
    r.replaceAll([makeSkill("zebra"), makeSkill("alpha"), makeSkill("middle")]);
    expect(r.all().map((s) => s.name)).toEqual(["alpha", "middle", "zebra"]);
  });
});

describe("SkillRegistry — visibility", () => {
  it("listVisible: shared visible to everyone", () => {
    const r = new SkillRegistry();
    r.replaceAll([makeSkill("pub", { kind: "shared" })]);
    expect(r.listVisible({ isAdmin: false }).map((s) => s.name)).toEqual(["pub"]);
    expect(r.listVisible({ isAdmin: true, senderId: 1 }).map((s) => s.name)).toEqual(["pub"]);
  });

  it("listVisible: admin skills hidden from non-admins", () => {
    const r = new SkillRegistry();
    r.replaceAll([makeSkill("ad", { kind: "admin" })]);
    expect(r.listVisible({ isAdmin: false, senderId: 1 })).toEqual([]);
    expect(r.listVisible({ isAdmin: true, senderId: 1 }).map((s) => s.name)).toEqual(["ad"]);
  });

  it("listVisible: personal skills only for owner", () => {
    const r = new SkillRegistry();
    r.replaceAll([makeSkill("mine", { kind: "user", userId: 42 })]);
    expect(r.listVisible({ isAdmin: false, senderId: 1 })).toEqual([]);
    expect(r.listVisible({ isAdmin: false, senderId: 42 }).map((s) => s.name)).toEqual(["mine"]);
    expect(r.listVisible({ isAdmin: true, senderId: 1 })).toEqual([]);
  });

  it("listVisible: admin sees shared + admin but not other users' personal", () => {
    const r = new SkillRegistry();
    r.replaceAll([
      makeSkill("pub", { kind: "shared" }),
      makeSkill("ad", { kind: "admin" }),
      makeSkill("usr", { kind: "user", userId: 99 }),
    ]);
    const visible = r.listVisible({ isAdmin: true, senderId: 1 }).map((s) => s.name);
    expect(visible.sort()).toEqual(["ad", "pub"]);
  });

  it("getVisible: returns only when visible", () => {
    const r = new SkillRegistry();
    r.replaceAll([makeSkill("ad", { kind: "admin" })]);
    expect(r.getVisible("ad", { isAdmin: false })?.name).toBeUndefined();
    expect(r.getVisible("ad", { isAdmin: true })?.name).toBe("ad");
  });
});

describe("getSkillRegistry singleton", () => {
  it("returns the same instance across calls", () => {
    expect(getSkillRegistry()).toBe(getSkillRegistry());
  });

  it("setSkillRegistry(null) resets", () => {
    const a = getSkillRegistry();
    a.replaceAll([makeSkill("x")]);
    setSkillRegistry(null);
    const b = getSkillRegistry();
    expect(b).not.toBe(a);
    expect(b.size).toBe(0);
  });
});
