---
name: recommend-agents
description: "Analyze project requirements, recommend agents from ~/.claude/_repo/, install selected agents to PROJECT .claude/agents/, optimize for context window, and configure routing rules. Requires: ~/.claude/_repo/ directory with AGENT-INDEX.md."
---
# Agent Recommendation Engine

**Command**: `/recommend-agents`

Full-lifecycle agent management: analyze project, recommend agents, install with user selection, optimize context, configure routing.

**Directories**:
- **Source**: `~/.claude/_repo/` — shared catalog (read-only)
- **Index**: `~/.claude/_repo/AGENT-INDEX.md`
- **Installed**: `<project>/.claude/agents/` — project-specific, version-controlled

**Requires**: `~/.claude/_repo/AGENT-INDEX.md`. If missing, stop and inform user.

Use TodoWrite. Check if CLAUDE.md has "## Agent Routing Rules" section — if so, inform user config will be updated.

---

## Phase 1: Extract Project Signals

### 1.1: Read Project Configuration
| Source | Extract |
|--------|---------|
| CLAUDE.md | Stack, patterns, testing, build system |
| package.json (root + packages/*/) | Dependencies, scripts, workspaces |
| tsconfig.json | Strict mode, target, module |
| Directory scan | packages/ = monorepo, src/components/ = frontend, docker-compose = containers |

### 1.2: Identify Installed Agents
Read `<project>/.claude/agents/` files. Extract: name, description, tools, model, specialization.

### 1.3: Compile Signal Map
```
Languages: [...] | Frameworks: [...] | Libraries: [...]
Patterns: [monorepo, pipeline, etc.] | Testing: [...] | Build: [...]
```

---

## Phase 2: Match & Present Recommendations

### 2.1: Load Agent Index
Read `~/.claude/_repo/AGENT-INDEX.md`. If missing: STOP.

### 2.2: Score Agents
| Match Type | Weight |
|------------|--------|
| Direct tag match | High |
| Domain match | Medium |
| Pattern match | Low |

Filter: exclude installed, exclude irrelevant. Flag: mismatched installed agents.

### 2.3: Group into Tiers
- **Tier 1**: Direct tag match on core tech OR fills critical gap
- **Tier 2**: Domain match OR multiple pattern matches
- **Tier 3**: Pattern matches only, situational

### 2.4: Present Report
```markdown
# Agent Recommendations for [Project]
**Signals**: [tech/patterns] | **Installed**: [agents]

## Installed Agent Review
| Agent | Status | Notes |

## Tier 1-3 Tables
| Agent | Source | Why |

## Coverage Matrix
| Area | Covered By | Gap? |
```

---

## Phase 3: Interactive Selection

Use `AskUserQuestion` with `multiSelect: true` for each tier with recommendations.

**Per tier**: "Which [tier-level] agents should be installed?" Options: agent list with descriptions.

**Mismatched agents**: Ask how to handle (Replace / Keep+supplement / Remove / Leave).

---

## Phase 4: Install Selected Agents

1. Find source: `~/.claude/_repo/*/[agent].md`
2. Read source file
3. Create `<project>/.claude/agents/` if needed
4. Write to `<project>/.claude/agents/[agent].md`
5. Handle replacements if requested

**Output**: `Installed: [...] | Replaced: [...] | Total: N`

---

## Phase 5: Context Optimization

### 5.1: Read All Agents
Count lines for all `.md` in `<project>/.claude/agents/`.

### 5.2: Strip VoltAgent Boilerplate
**Remove**: Communication Protocol JSON, progress tracking blocks, delivery notifications, generic "Integration with other agents" (replace with single line), generic 3-phase workflow structure.

**Keep**: YAML frontmatter, role description (1-2 para), domain-specific checklists, unique methodology, decision frameworks.

### 5.3: Handle Overlaps
- **Duplicates**: Keep installed version
- **Functional overlap** (>60% tag match): Merge into one
- **Partial overlap**: Keep both with cross-references

### 5.4: Add Project Context
```markdown
## Project Context
- See CLAUDE.md for architecture and tech stack
- [1-3 project-specific bullets]
```

### 5.5: Verify Size
- **Target**: 80-150 lines
- **Hard max**: 200 lines (flag if exceeded)
- **Pre-existing agents**: Flag but don't auto-trim

### 5.7: Output Report
```markdown
## Context Optimization
| Agent | Before | After | Reduction | Notes |
Total: X→Y lines (Z% reduction)
```

---

## Phase 6: Agent Improvement Analysis

Evaluate ALL agents in `.claude/agents/`:

| Criterion | Check |
|-----------|-------|
| Description | Correct trigger for this project? |
| Proactive trigger | "Use PROACTIVELY when..." present? |
| Tools | Only needed tools? (read-only = no Write/Edit) |
| Model | Opus justified or could use sonnet? |
| Alignment | Content matches project tech stack? |
| Missing | Project-relevant capabilities to add? |
| Unnecessary | Content irrelevant to project? |

**Output per agent**:
```markdown
### [agent] — [OK / NEEDS UPDATE / CRITICAL]
- Description: [current] → [suggested]
- Add: [...] | Remove: [...]
- Model/Tools: Keep or change with reason
```

Ask user which improvements to apply (multiSelect).

---

## Phase 7: Rules Configuration

### 7.1: Build Routing Table
APPEND to CLAUDE.md (or UPDATE existing section):
```markdown
## Agent Routing Rules
| Trigger | Agent | Priority |
```
Priority: MUST (always) | PROACTIVE (auto on trigger) | ON-DEMAND (user-initiated)

### 7.2: Update Agent Descriptions
- **MUST**: "MUST BE USED for [trigger]..."
- **PROACTIVE**: "Use PROACTIVELY when [trigger]..."
- **ON-DEMAND**: "[Description]. Use when [scenarios]."

### 7.3: Validate Permissions (advisory)
Check `.claude/settings.local.json` for Read/Write/Edit patterns. Produce warnings, not errors.

### 7.4: Output Summary
```markdown
## Configuration Complete
- CLAUDE.md: Added N routing rules
- Descriptions updated: [agents]
- Permission validation: [status]
```

---

## Notes

- Phases 1-2 are read-only
- Phase 3 requires user input before changes
- Phases 4-7 modify files after approval
- Original agents remain in `~/.claude/_repo/`
- Each agent in `.claude/agents/` adds to system prompt — minimize via Phase 5
