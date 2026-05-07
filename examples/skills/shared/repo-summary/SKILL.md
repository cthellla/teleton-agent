---
name: repo-summary
description: Summarize a GitHub repository when the user gives an owner/repo or full GitHub URL and asks "what does this do", "tl;dr", or for a quick overview.
version: 1.0.0
---

# Repo Summary

Use this playbook when the user asks for a quick summary of a GitHub repository.

## Steps

1. Parse the user's input into `owner/repo`.
   - Accept `owner/repo`, `github.com/owner/repo`, or full `https://github.com/owner/repo` URLs.
   - If you can't resolve it, ask the user to confirm.
2. Call `web_fetch` on `https://api.github.com/repos/<owner>/<repo>` to get description, stars, language, license, default branch.
3. Call `web_fetch` on `https://raw.githubusercontent.com/<owner>/<repo>/<default_branch>/README.md` and take the first ~2000 chars.
4. Reply with:
   - One-sentence pitch (rewrite the API description in plain language).
   - 3 bullets: what it does, who it's for, anything notable.
   - Stars · primary language · license — on one line.

## Output format

Plain text, no preamble. Telegram-friendly, no ASCII tables.
