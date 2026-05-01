---
name: todo
description: Manage project TODOs — create, edit, update status, and close items with full context capture.
---

# Project TODO Manager

**Command**: `/todo <action> [args]`
**Data file**: `context/TODOS.md` (project-scoped, lives in the project's working directory)

## Actions

- `/todo` or `/todo list` — Show all active TODOs
- `/todo add <description>` — Create a new TODO
- `/todo update <ID> <field> <value>` — Update a TODO field (status, priority, goal, steps)
- `/todo close <ID> [resolution]` — Close a TODO with resolution notes
- `/todo show <ID>` — Show full details of a specific TODO
- `/todo reopen <ID>` — Reopen a closed TODO

---

## Workflow

### Step 1: Read current state

Read the TODO file to understand current state:

```
Read context/TODOS.md
```

If the file does not exist yet, create it with empty `## Active TODOs` and `## Closed TODOs` sections.

### Step 2: Parse the user's action from `$ARGUMENTS`

Parse the first word of `$ARGUMENTS` to determine the action:
- No args or `list` → **List** action
- `add <description>` → **Add** action
- `update <ID> <details>` → **Update** action
- `close <ID> [resolution]` → **Close** action
- `show <ID>` → **Show** action
- `reopen <ID>` → **Reopen** action

### Step 3: Execute the action

#### ADD Action
When adding a new TODO:

1. **Auto-increment ID**: Find the highest existing `AUTO-NNN` ID in the file (both Active and Closed sections) and increment by 1. Start at `AUTO-001` if none exist.

2. **Auto-capture context**: Before asking the user anything, gather context automatically:
   - Run `git status` and `git diff --stat` to understand what's currently being worked on
   - Note the current branch
   - Check recent git log (`git log --oneline -3`) for recent activity
   - Look at any recently modified files to understand the working context

3. **Create the TODO entry** with this exact format, inserting it at the end of the `## Active TODOs` section (before the `---` separator above `## Closed TODOs`):

```markdown
### AUTO-NNN: <short title derived from description>
- **Status**: OPEN
- **Priority**: P2
- **Created**: YYYY-MM-DD
- **Updated**: YYYY-MM-DD
- **Context**: <auto-captured: what branch, what files were being worked on, what the current state of work is>
- **Circumstances**: <the user's description and any surrounding context about WHY this TODO exists>
- **Goal**: <what successful resolution looks like — infer from the description>
- **Recommended Steps**:
  1. <step 1 — analyze the codebase/context to suggest concrete steps>
  2. <step 2>
  3. <step 3>
```

4. **Infer intelligently**: Use the description AND the auto-captured context to fill in:
   - A concise title (not just the raw description)
   - The goal (what "done" looks like)
   - 2-5 recommended steps based on your understanding of the codebase

5. **Show the created TODO** to the user for confirmation.

#### UPDATE Action
When updating a TODO (`/todo update AUTO-NNN <details>`):

1. Find the TODO by ID in the file
2. Parse what the user wants to update. Common updates:
   - Status: `/todo update AUTO-001 status IN_PROGRESS`
   - Priority: `/todo update AUTO-001 priority P1`
   - Steps: `/todo update AUTO-001 steps "add step: verify with tests"`
   - Any freeform update: `/todo update AUTO-001 "discovered the root cause is in config.ts"`
3. Update the relevant fields
4. Always update the `Updated` date
5. For freeform updates, append to a `- **Notes**:` field (create if not present)
6. Write the updated file back
7. Show the updated TODO

#### CLOSE Action
When closing a TODO (`/todo close AUTO-NNN [resolution]`):

1. Find the TODO by ID in the Active section
2. Change status to `CLOSED`
3. Add `- **Closed**: YYYY-MM-DD`
4. Add `- **Resolution**: <resolution text or "Completed">`
5. Move the entire TODO block from `## Active TODOs` to `## Closed TODOs`
6. Update the `Updated` date
7. Write the updated file
8. Confirm closure to user

#### LIST Action
Display a summary table of all active TODOs:

```
ID        | Priority | Status      | Title
----------|----------|-------------|---------------------------
AUTO-001  | P1       | IN_PROGRESS | Fix browser auth token...
AUTO-002  | P2       | OPEN        | Add retry logic to...
```

If no active TODOs, say so.

#### SHOW Action
Display the full TODO entry for the given ID (search both Active and Closed sections).

#### REOPEN Action
Move a closed TODO back to Active, set status to OPEN, remove Resolution and Closed date, update the Updated date.

### Step 4: Write changes

After any mutation (add/update/close/reopen), write the updated content back to the TODO file using the Edit or Write tool.

## Important Rules

1. **Always read the file first** before any operation
2. **Never lose data** — be careful with edits, preserve all existing entries
3. **Auto-capture context** on `add` — don't just record the user's words, capture the development state
4. **Recommended steps should be actionable** — reference specific files, modules, or patterns from the codebase when possible
5. **Keep the file clean** — maintain consistent formatting
6. **Today's date**: Use the current date for Created/Updated fields
