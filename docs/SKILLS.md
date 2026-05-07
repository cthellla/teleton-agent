# Skills

Skills are agent-callable Markdown playbooks with **lazy loading** — inspired by Claude Code skills. Each skill is a directory containing a `SKILL.md` file with YAML frontmatter (a one-line trigger description) plus the full body.

Only the frontmatter (`name` + `description`) is injected into the agent's system prompt. The body is fetched on-demand via the `skill_invoke` tool when the model decides a skill is relevant. This keeps the prompt small while letting you add an unbounded library of playbooks.

## Visibility namespaces

Each skill belongs to one of three namespaces, determined by where the directory lives under `~/.teleton/workspace/skills/`:

```text
shared/<name>/SKILL.md          visible to every user
admin/<name>/SKILL.md            visible only to admins (config.telegram.admin_ids)
users/<userId>/<name>/SKILL.md   visible only to user <userId>
```

A flat `~/.teleton/workspace/skills/<name>/SKILL.md` (legacy layout) is treated as `shared`.

The same skill name cannot exist twice anywhere. Later duplicates are skipped at load time with a warning.

## SKILL.md format

```markdown
---
name: hn-digest
description: Build a daily Hacker News digest for the channel. Use when the user asks for "today's HN", a daily roundup, or top stories of the day.
version: 1.0.0
---

# HN Digest Playbook

Steps:
1. Call `hn_top_stories` with limit=20.
2. Filter stories with score >= 100.
3. For each, call `hn_extract_facts` and produce a 2-bullet summary.
...
```

### Frontmatter fields

| Field | Required | Notes |
|---|---|---|
| `name` | yes | `^[a-z0-9][a-z0-9_-]{0,63}$`; must equal the directory name. |
| `description` | yes | One line, ≤ 1024 chars. The model decides when to invoke based on this. |
| `version` | no | Free-form string. Not used by the runtime. |
| `allowed_tools` | no | Informational list of tools. Not enforced. |

### Body

Anything after the closing `---` is the body. Free-form Markdown. Delivered verbatim to the model when `skill_invoke` is called.

### Resource files

Any file in the skill directory other than `SKILL.md` is a **resource**. Resources are not auto-loaded — the body should reference them by relative path, and the agent reads them with `workspace_read` when the playbook says so. `skill_invoke` returns the list of resource filenames.

## How the agent uses skills

1. At startup, the loader scans `~/.teleton/workspace/skills/` and registers every valid skill with its owner.
2. `buildSystemPrompt` filters skills by viewer (sender + admin status) and injects an `## Available Skills` section listing each visible skill's `name + description`.
3. When a user request matches a description, the model calls `skill_invoke({ name })`.
4. The tool returns the full body + resource list, and the model continues with that context loaded.

## Hot reload

A `chokidar` watcher monitors `skills/`. Adding, editing, or removing a `SKILL.md` (or its directory) triggers a debounced rescan (~300 ms). The agent picks up changes mid-session — no restart needed. Invalid skills are logged and skipped without affecting valid ones.

## Installing skills via the agent

The `skill_install` tool lets the agent create new skills on disk:

```text
skill_install({
  name: "repo-summary",
  description: "Summarize a GitHub repository ...",
  body: "# Repo Summary\n\n...",
  scope: "personal" | "shared" | "admin" | undefined,
  version?: string,
  allowed_tools?: string[],
  overwrite?: boolean
})
```

### Scope rules

- `scope: "shared"` — writes to `shared/`. Requires admin.
- `scope: "admin"` — writes to `admin/`. Requires admin.
- `scope: "personal"` — writes to `users/<senderId>/`. Available to anyone with a sender ID.

### Default scope

- Admin caller → `"admin"`
- Non-admin caller → `"personal"`

### Validation

The tool wraps the supplied fields into a SKILL.md text and re-parses it through the same loader pipeline. If the result fails validation (bad name, missing description, invalid YAML, etc.) the install is rejected before any file is written. Path traversal is prevented by the name regex.

`overwrite: false` (default) refuses to clobber an existing skill. With `overwrite: true`, the caller can replace skills they own — admins for `shared`/`admin` skills, the original user for personal skills. Cross-owner overwrites are always rejected.

After a successful write the registry reloads immediately so the new skill is available on the next prompt build (the FS watcher would also catch it within a second).

## Programmatic API

```ts
import {
  initializeSkills,
  renderSkillsPromptSection,
  type SkillsHandle,
  type SkillViewer,
} from "./agent/skills/index.js";

const handle: SkillsHandle = initializeSkills();   // scans + starts watcher
handle.count                                       // number of skills loaded
await handle.stop();                               // stop watcher (called automatically on shutdown)

renderSkillsPromptSection({ senderId: 42, isAdmin: false });  // string injected into prompt, or null
```

The `skill_invoke` and `skill_install` tools are registered alongside the rest of the agent's tools — no extra wiring needed.
