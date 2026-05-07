# Example Skills

Drop any of these into the matching namespace under `~/.teleton/workspace/skills/`. The agent picks them up at startup (and via hot-reload while running).

```bash
# Make a "shared" skill (visible to every user)
cp -r examples/skills/shared/repo-summary ~/.teleton/workspace/skills/shared/

# Or install via the agent itself: ask it to run skill_install with your inputs.
```

The three visibility scopes are:

- `shared/<name>/` — visible to all users
- `admin/<name>/` — visible only to admins (`config.telegram.admin_ids`)
- `users/<userId>/<name>/` — visible only to user `<userId>`

See [docs/SKILLS.md](../../docs/SKILLS.md) for the full format.
