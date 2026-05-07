import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

vi.mock("../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { loadSkillFromDir, loadSkillsFromDir, parseSkillFile } from "../loader.js";
import type { SkillOwner } from "../types.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), `skills-test-${randomBytes(4).toString("hex")}-`));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeSkill(
  parentDir: string,
  name: string,
  content: string,
  extraFiles: Record<string, string> = {}
): string {
  const dir = join(parentDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  for (const [filename, body] of Object.entries(extraFiles)) {
    writeFileSync(join(dir, filename), body);
  }
  return dir;
}

const fm = (name: string, description = "trigger desc"): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nbody for ${name}\n`;

describe("parseSkillFile", () => {
  it("parses a valid skill file", () => {
    const result = parseSkillFile(fm("my-skill", "Does the thing."));
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.frontmatter.description).toBe("Does the thing.");
    expect(result.body.includes("body for my-skill")).toBe(true);
  });

  it("rejects file with no frontmatter", () => {
    expect("error" in parseSkillFile("name: x\ndescription: y\n")).toBe(true);
  });

  it("rejects unclosed frontmatter", () => {
    expect("error" in parseSkillFile("---\nname: x\ndescription: y\n")).toBe(true);
  });

  it("rejects invalid YAML", () => {
    expect("error" in parseSkillFile("---\nname: [unclosed\n---\n")).toBe(true);
  });

  it("rejects names that don't match the regex", () => {
    for (const name of ["My-Skill", "my skill", "x".repeat(100), "-leading-dash", ""]) {
      expect("error" in parseSkillFile(`---\nname: ${name}\ndescription: y\n---\n`)).toBe(true);
    }
  });

  it("requires a non-empty description", () => {
    expect("error" in parseSkillFile("---\nname: ok\ndescription: ''\n---\n")).toBe(true);
  });

  it("rejects multi-line description", () => {
    expect(
      "error" in parseSkillFile("---\nname: ok\ndescription: |\n  line one\n  line two\n---\n")
    ).toBe(true);
  });

  it("captures optional version + allowed_tools", () => {
    const result = parseSkillFile(
      "---\nname: x\ndescription: y\nversion: 1.2.3\nallowed_tools:\n  - web_fetch\n  - telegram_send_message\n---\n"
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.frontmatter.version).toBe("1.2.3");
    expect(result.frontmatter.allowed_tools).toEqual(["web_fetch", "telegram_send_message"]);
  });

  it("strips UTF-8 BOM before parsing", () => {
    const result = parseSkillFile(`﻿${fm("ok")}`);
    expect("error" in result).toBe(false);
  });

  it("rejects files exceeding the size cap", () => {
    const huge = "---\nname: ok\ndescription: y\n---\n" + "x".repeat(2_000_000);
    expect("error" in parseSkillFile(huge)).toBe(true);
  });

  it("handles CRLF line endings", () => {
    expect("error" in parseSkillFile("---\r\nname: ok\r\ndescription: y\r\n---\r\nbody\r\n")).toBe(
      false
    );
  });
});

describe("loadSkillFromDir", () => {
  const owner: SkillOwner = { kind: "shared" };

  it("loads a valid skill with resources and tags it with the given owner", () => {
    const dir = makeSkill(tmpRoot, "hn-digest", fm("hn-digest", "Digest HN."), {
      "helper.sh": "#!/bin/sh",
      "prompt.md": "extra",
    });

    const skill = loadSkillFromDir(dir, { kind: "user", userId: 42 });
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("hn-digest");
    expect(skill?.owner).toEqual({ kind: "user", userId: 42 });
    expect(skill?.resources.sort()).toEqual(["helper.sh", "prompt.md"]);
  });

  it("rejects skill where directory name != frontmatter name", () => {
    const dir = makeSkill(tmpRoot, "wrong-dir", fm("different"));
    expect(loadSkillFromDir(dir, owner)).toBeNull();
  });

  it("returns null when SKILL.md is missing", () => {
    const dir = join(tmpRoot, "no-skill-md");
    mkdirSync(dir);
    writeFileSync(join(dir, "README.md"), "not a skill");
    expect(loadSkillFromDir(dir, owner)).toBeNull();
  });

  it("returns null on parse error without throwing", () => {
    const dir = makeSkill(tmpRoot, "broken", "no frontmatter at all\n");
    expect(loadSkillFromDir(dir, owner)).toBeNull();
  });
});

describe("loadSkillsFromDir — namespaces", () => {
  it("returns [] when the root does not exist", () => {
    expect(loadSkillsFromDir(join(tmpRoot, "missing"))).toEqual([]);
  });

  it("loads skills from shared/, admin/, and users/<id>/", () => {
    const sharedDir = join(tmpRoot, "shared");
    const adminDir = join(tmpRoot, "admin");
    const userDir = join(tmpRoot, "users", "12345");

    makeSkill(sharedDir, "alpha", fm("alpha", "Public alpha."));
    makeSkill(adminDir, "bravo", fm("bravo", "Admin bravo."));
    makeSkill(userDir, "charlie", fm("charlie", "Personal charlie."));

    const skills = loadSkillsFromDir(tmpRoot);
    expect(skills.map((s) => s.name)).toEqual(["alpha", "bravo", "charlie"]);
    expect(skills.find((s) => s.name === "alpha")?.owner).toEqual({ kind: "shared" });
    expect(skills.find((s) => s.name === "bravo")?.owner).toEqual({ kind: "admin" });
    expect(skills.find((s) => s.name === "charlie")?.owner).toEqual({
      kind: "user",
      userId: 12345,
    });
  });

  it("treats legacy flat layout as shared", () => {
    makeSkill(tmpRoot, "legacy", fm("legacy", "Legacy flat."));
    const skills = loadSkillsFromDir(tmpRoot);
    expect(skills).toHaveLength(1);
    expect(skills[0].owner).toEqual({ kind: "shared" });
  });

  it("does not treat reserved namespace dirs (shared/admin/users) as flat skills", () => {
    mkdirSync(join(tmpRoot, "shared"));
    mkdirSync(join(tmpRoot, "admin"));
    mkdirSync(join(tmpRoot, "users"));

    expect(loadSkillsFromDir(tmpRoot)).toEqual([]);
  });

  it("skips invalid user IDs (non-numeric directory names)", () => {
    const userDir = join(tmpRoot, "users", "not-a-number");
    makeSkill(userDir, "ghost", fm("ghost"));
    expect(loadSkillsFromDir(tmpRoot)).toEqual([]);
  });

  it("rejects globally duplicated names — first one wins", () => {
    makeSkill(join(tmpRoot, "shared"), "dup", fm("dup", "shared."));
    makeSkill(join(tmpRoot, "admin"), "dup", fm("dup", "admin."));
    const skills = loadSkillsFromDir(tmpRoot);
    expect(skills).toHaveLength(1);
    expect(skills[0].owner).toEqual({ kind: "shared" });
  });

  it("ignores rogue files at the root", () => {
    writeFileSync(join(tmpRoot, "rogue.md"), fm("rogue"));
    makeSkill(join(tmpRoot, "shared"), "real", fm("real"));
    const skills = loadSkillsFromDir(tmpRoot);
    expect(skills.map((s) => s.name)).toEqual(["real"]);
  });

  it("returns sorted by name", () => {
    makeSkill(join(tmpRoot, "shared"), "zebra", fm("zebra"));
    makeSkill(join(tmpRoot, "admin"), "alpha", fm("alpha"));
    makeSkill(join(tmpRoot, "users", "1"), "middle", fm("middle"));
    expect(loadSkillsFromDir(tmpRoot).map((s) => s.name)).toEqual(["alpha", "middle", "zebra"]);
  });
});
