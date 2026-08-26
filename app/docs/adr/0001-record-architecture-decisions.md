# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Jaysh
- **Spec:** n/a

## Context
This repository is built by a pipeline of subagents (see CLAUDE.md). Agents have
no memory between runs, so a decision that lives only in a chat transcript is lost
the moment the session ends. The next agent then re-litigates it, or silently
contradicts it.

## Decision
We will record every non-obvious technical decision as an ADR in `docs/adr/`,
numbered sequentially, using `docs/adr/TEMPLATE.md`. The architect agent writes
them. ADRs are immutable once Accepted — supersede, never edit.

## Alternatives considered
### Document decisions in code comments only
- **Pros:** Lives next to the code; impossible to miss.
- **Cons:** No room for rejected alternatives or context; deleted with the code.
- **Rejected because:** The reasoning matters longer than the code does.

## Consequences
### Positive
- Agents read prior decisions instead of re-deriving them.
- Rejected options stay visible, so they are not retried.

### Negative / accepted trade-offs
- Small overhead per decision.

### Follow-up required
- [ ] None.

## Revisit when
ADRs start going unread — which shows up as agents contradicting them.
