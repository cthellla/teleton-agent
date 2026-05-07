import { describe, it, expect, beforeEach } from "vitest";
import { skillInvokeExecutor } from "../tool.js";
import { getSkillRegistry, setSkillRegistry } from "../registry.js";
import type { Skill, SkillOwner } from "../types.js";
import type { ToolContext } from "../../tools/types.js";

function makeSkill(name: string, owner: SkillOwner = { kind: "shared" }): Skill {
  return {
    name,
    description: `do ${name}`,
    owner,
    dir: `/fake/${name}`,
    path: `/fake/${name}/SKILL.md`,
    body: `# ${name}\nbody for ${name}`,
    resources: ["helper.sh"],
    version: "1.0.0",
  };
}

function ctx(senderId: number, adminIds: number[] = []): ToolContext {
  return {
    senderId,
    config: { telegram: { admin_ids: adminIds } },
  } as unknown as ToolContext;
}

beforeEach(() => {
  setSkillRegistry(null);
});

describe("skill_invoke executor", () => {
  it("returns the body for a shared skill, regardless of caller", async () => {
    getSkillRegistry().replaceAll([makeSkill("hn", { kind: "shared" })]);
    const result = await skillInvokeExecutor({ name: "hn" }, ctx(1));
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.name).toBe("hn");
    expect(data.body).toContain("body for hn");
  });

  it("admin skill: visible to admin, hidden from non-admin", async () => {
    getSkillRegistry().replaceAll([makeSkill("op", { kind: "admin" })]);
    const adminResult = await skillInvokeExecutor({ name: "op" }, ctx(1, [1]));
    expect(adminResult.success).toBe(true);
    const userResult = await skillInvokeExecutor({ name: "op" }, ctx(2, [1]));
    expect(userResult.success).toBe(false);
    expect(userResult.error).toContain("Unknown or inaccessible");
  });

  it("personal skill: visible only to its owner", async () => {
    getSkillRegistry().replaceAll([makeSkill("mine", { kind: "user", userId: 42 })]);
    const ownerResult = await skillInvokeExecutor({ name: "mine" }, ctx(42));
    expect(ownerResult.success).toBe(true);
    const otherResult = await skillInvokeExecutor({ name: "mine" }, ctx(99));
    expect(otherResult.success).toBe(false);
  });

  it("returns error with suggestions filtered to viewer", async () => {
    getSkillRegistry().replaceAll([
      makeSkill("pub", { kind: "shared" }),
      makeSkill("secret", { kind: "admin" }),
    ]);
    const result = await skillInvokeExecutor({ name: "missing" }, ctx(1, []));
    expect(result.success).toBe(false);
    expect(result.error).toContain("missing");
    expect(result.error).toContain("pub");
    expect(result.error).not.toContain("secret");
  });

  it("reports when no skills are visible", async () => {
    getSkillRegistry().replaceAll([makeSkill("ad", { kind: "admin" })]);
    const result = await skillInvokeExecutor({ name: "ad" }, ctx(1, []));
    expect(result.success).toBe(false);
    expect(result.error).toContain("No skills are currently available to you");
  });
});
