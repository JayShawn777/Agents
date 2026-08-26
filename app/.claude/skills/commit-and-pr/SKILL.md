---
name: commit-and-pr
description: Write conventional commits and open pull requests with a Summary / Changes / Test evidence description. Use when the user says "commit", "commit and PR", "open a PR", or when finishing a feature.
---

# Commit and PR

## Before committing — always

```bash
git status          # what is actually staged
git diff            # unstaged
git diff --staged   # staged
git log --oneline -5   # match the existing message style
```

Then run the gates. Never commit red:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

**Secrets check — every time.** `git status` must not list `.env`. Scan the diff
for keys, tokens, connection strings, and passwords. A secret in a commit is in
history forever, even if the next commit removes it.

## Conventional commits

```
<type>(<scope>): <imperative summary under 72 chars>

<body: what changed and WHY — the diff already shows what>

<footers>
```

| Type | Use for | Example |
|---|---|---|
| `feat:` | New user-facing capability | `feat(auth): add magic-link sign-in` |
| `fix:` | Bug fix | `fix(api): reject expired session tokens` |
| `chore:` | Tooling, deps, config — no product change | `chore: bump prisma to 7.9.1` |
| `refactor:` | Restructuring with no behaviour change | `refactor(db): extract query helpers` |
| `docs:` | Documentation only | `docs: document DATABASE_URL pooling` |
| `test:` | Tests only | `test(api): cover invalid payloads` |

**Rules**
- Imperative mood: "add", not "added" or "adds".
- No trailing period. Scope is optional but preferred.
- A breaking change gets `!` after the scope and a `BREAKING CHANGE:` footer.
- One logical change per commit. If the summary needs "and", split it.
- Never `git add -A` blindly — stage the files you meant to change.
- Reference the spec and ADR in the footer when the work came from a feature pipeline.
- End the message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

**Never** commit secrets. **Never** force-push. **Never** amend a commit that is
already pushed. **Never** use `--no-verify` to get past a failing hook — fix the
failure.

## Opening a PR

Only when the user asks. Never push to `main` — branch first:

```bash
git checkout -b <type>/<short-slug>
git push -u origin <type>/<short-slug>
```

Then `gh pr create` with this body:

```markdown
## Summary

<2-4 sentences: what this does and why it exists. Written for a reviewer who has
not read the spec. Lead with the user-visible change, not the implementation.>

Spec: docs/specs/<slug>.md
ADR: docs/adr/<file>.md

## Changes

**Backend**
- `path` — <what changed and why>

**Frontend**
- `path` — <what changed and why>

**Database**
- Migration `<name>` — <what it does> — destructive: yes/no

## Test evidence

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS — <n> tests |
| `pnpm test:e2e` | PASS — <n> tests |

**Acceptance criteria**
- [x] AC1: <criterion> — covered by `tests/unit/<file>`

**Manual verification**
- <what you actually clicked through, or "None">

## Reviewer notes

- <anything non-obvious: trade-offs, deferred work, follow-ups>
- Deploy: <migration to run, env var to add, or "Nothing special">
```

Paste real command output for the gates. Never write PASS for a gate you did not
run — that is the one thing that makes this section worthless.

End the PR body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
