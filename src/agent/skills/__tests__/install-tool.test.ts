import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const { SKILLS_DIR } = vi.hoisted(() => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const crypto = require("crypto");
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `skills-install-test-${crypto.randomBytes(4).toString("hex")}-`)
  );
  return { SKILLS_DIR: path.join(root, "skills") };
});

vi.mock("../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../../workspace/paths.js", () => ({
  WORKSPACE_PATHS: {
    SKILLS_DIR,
  },
}));

import { skillInstallExecutor } from "../install-tool.js";
import { getSkillRegistry, setSkillRegistry } from "../registry.js";
import type { ToolContext } from "../../tools/types.js";

function ctx(senderId: number | undefined, adminIds: number[] = []): ToolContext {
  return {
    senderId,
    config: { telegram: { admin_ids: adminIds } },
  } as unknown as ToolContext;
}

beforeEach(() => {
  setSkillRegistry(null);
  rmSync(SKILLS_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(SKILLS_DIR, { recursive: true, force: true });
});

describe("skill_install — happy paths", () => {
  it("non-admin installs a personal skill into users/<id>/", async () => {
    const result = await skillInstallExecutor(
      {
        name: "my-tracker",
        description: "Track my favourite topics on HN.",
        body: "# Body",
      },
      ctx(42, [])
    );

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.scope).toBe("personal");
    expect(data.path).toBe(join(SKILLS_DIR, "users", "42", "my-tracker", "SKILL.md"));

    const written = readFileSync(data.path as string, "utf-8");
    expect(written).toContain("name: my-tracker");
    expect(written).toContain("description: Track my favourite topics on HN.");
    expect(written).toContain("# Body");

    expect(getSkillRegistry().get("my-tracker")?.owner).toEqual({
      kind: "user",
      userId: 42,
    });
  });

  it("admin defaults to admin scope", async () => {
    const result = await skillInstallExecutor(
      { name: "deploy-check", description: "Check deploy.", body: "# Body" },
      ctx(1, [1])
    );
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.scope).toBe("admin");
    expect(data.path).toBe(join(SKILLS_DIR, "admin", "deploy-check", "SKILL.md"));
  });

  it("admin can install with explicit scope=shared", async () => {
    const result = await skillInstallExecutor(
      { name: "common", description: "For all.", body: "# Body", scope: "shared" },
      ctx(1, [1])
    );
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).path).toBe(
      join(SKILLS_DIR, "shared", "common", "SKILL.md")
    );
  });

  it("includes optional version + allowed_tools in frontmatter", async () => {
    const result = await skillInstallExecutor(
      {
        name: "with-meta",
        description: "Has metadata.",
        body: "# Body",
        version: "2.0.0",
        allowed_tools: ["web_fetch", "telegram_send_message"],
      },
      ctx(42)
    );
    expect(result.success).toBe(true);
    const written = readFileSync((result.data as { path: string }).path, "utf-8");
    expect(written).toContain("version: 2.0.0");
    expect(written).toContain("- web_fetch");
  });

  it("overwrite=true replaces the same-owner skill", async () => {
    await skillInstallExecutor({ name: "dup", description: "v1.", body: "# v1" }, ctx(42));
    const result = await skillInstallExecutor(
      { name: "dup", description: "v2.", body: "# v2", overwrite: true },
      ctx(42)
    );
    expect(result.success).toBe(true);
    expect(readFileSync((result.data as { path: string }).path, "utf-8")).toContain("# v2");
  });
});

describe("skill_install — guards", () => {
  it("rejects names that don't match the regex", async () => {
    const result = await skillInstallExecutor(
      { name: "Bad Name", description: "x", body: "y" },
      ctx(42)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid skill name");
  });

  it("non-admin cannot install scope=shared", async () => {
    const result = await skillInstallExecutor(
      { name: "evil", description: "x", body: "y", scope: "shared" },
      ctx(42)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("admin");
  });

  it("non-admin cannot install scope=admin", async () => {
    const result = await skillInstallExecutor(
      { name: "evil", description: "x", body: "y", scope: "admin" },
      ctx(42)
    );
    expect(result.success).toBe(false);
  });

  it("personal scope without senderId fails", async () => {
    const result = await skillInstallExecutor(
      { name: "x", description: "y", body: "z" },
      ctx(undefined)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("sender ID");
  });

  it("refuses to overwrite without overwrite=true", async () => {
    await skillInstallExecutor({ name: "dup", description: "v1.", body: "# v1" }, ctx(42));
    const result = await skillInstallExecutor(
      { name: "dup", description: "v2.", body: "# v2" },
      ctx(42)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("user A cannot overwrite user B's personal skill even with overwrite=true", async () => {
    await skillInstallExecutor({ name: "shared-name", description: "B's.", body: "# B" }, ctx(99));
    const result = await skillInstallExecutor(
      { name: "shared-name", description: "A wants.", body: "# A", overwrite: true },
      ctx(42)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("different owner");
  });

  it("rejects body that produces invalid SKILL.md after wrapping", async () => {
    const result = await skillInstallExecutor(
      { name: "broken", description: "", body: "# Body" },
      ctx(42)
    );
    expect(result.success).toBe(false);
  });

  it("rejects personal scope with senderId <= 0", async () => {
    const result = await skillInstallExecutor({ name: "x", description: "y", body: "z" }, ctx(0));
    expect(result.success).toBe(false);
    expect(result.error).toContain("sender ID");
  });

  it("rejects personal scope with non-integer senderId", async () => {
    const result = await skillInstallExecutor({ name: "x", description: "y", body: "z" }, ctx(1.5));
    expect(result.success).toBe(false);
  });
});
