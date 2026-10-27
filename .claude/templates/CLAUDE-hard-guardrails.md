<!--
Snippet for a project's CLAUDE.md. Commands read the `## Hard guardrails` section, treat every line as
binding as the universal guardrails in ~/.claude/commands/_shared-autonomous.md §4, and copy it verbatim
into every agent brief. Propose it to the owner; CLAUDE.md is never edited without confirmation.
Delete the lines that do not apply and fill the placeholders.
-->

## Hard guardrails

- **Shells:** run `unset <CLOUD_PROFILE_VAR> <ACCESS_KEY_VAR> <SECRET_KEY_VAR> <SESSION_TOKEN_VAR>` first in every agent shell.
- **Never run** `<cloud CLI>` or `<infra tool>` from an agent; write production-side work as an OWNER step.
- **Live services:** never point local code at `<service>`; use `<fake or recorded fixtures>`.
- **Protected people and records:** never unsubscribe, delete or email `<address or record>`.
- **Deploys:** `<branch>` deploys on push; never push it without the owner's approval of that specific deploy.
- **Databases:** never point tests at `<shared DB>`; test DBs are `<prefix>_<lane>_test` on `<host:port>`.
- **Secrets** live in `<secret store>`; never on disk or in `.env`.

## Invariants (a breach is CRITICAL in verification)

1. `<invariant, e.g. suppression is global with no bypass>`
2. `<invariant, e.g. no cross-tenant data access>`
3. `<invariant, e.g. migrations are additive only>`
