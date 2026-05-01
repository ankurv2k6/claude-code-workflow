---
description: Analyze commands for context efficiency, token usage, output verbosity, and shared patterns. Generates optimization recommendations with preservation guarantees. Use --apply to optimize with ≥98% preservation verification.
---
<!-- Context Budget: ~10,000 tokens base. Spawns parallel agents in Phases 2/3/3B, 5.2, 5.4, and 6.2. -->

# Audit Commands

Analyze all commands in `~/.claude/commands/` for context window efficiency, token usage, output verbosity compliance, and shared extractable patterns. Produces actionable optimization recommendations with preservation guarantees.

### Parallelization Strategy

Maximize parallel agent usage at these points:

| Point | Phases | Agent Type | Why Parallel |
|-------|--------|------------|--------------|
| **Analysis fan-out** | 2 + 3 + 3B | 3× `Explore` agents | Independent read-only analysis, no data dependencies between them |
| **Shared file creation** | 5.2 | N× `general-purpose` agents | Each `_shared-*.md` file is independent |
| **Intra-command optimization** | 5.4 | N× `general-purpose` agents | Each command file is independent; merge change manifests after |
| **Per-command verification** | 6.2 | N× `code-reviewer` agents | Each command's verification is independent |

Launch parallel agents using **multiple Task tool calls in a single message**. Collect results before proceeding to the next dependent phase.

```
Execution Flow (→ = sequential, ⇉ = parallel fan-out, ⇊ = join/collect):

Phase 0 → Phase 1 → ⇉ Phase 2 (Explore agent)  ──\
                     ⇉ Phase 3 (Explore agent)  ───⇊── Phase 4 → Phase 5.1
                     ⇉ Phase 3B (Explore agent) ──/

  → ⇉ Phase 5.2 per-pattern (general-purpose) ──⇊── Phase 5.3 → ⇉ Phase 5.4 per-cmd (general-purpose) ──⇊── merge manifest → Phase 5.5

  → ⇉ Phase 6.2 per-command (code-reviewer)   ──⇊── Phase 6.3 (sequential) → Phase 6.4

  → Phase 7 → Phase 8
```

**Agent return format**: Each agent MUST return structured data (not prose). Use JSON or markdown tables that the main context can parse directly into Phase 4/6/7 outputs.

## Arguments

| Flag | Effect |
|------|--------|
| `$ARGUMENTS` | Optional: specific command to audit, or "all" (default) |
| `--dry-run` | Analyze only, no file changes (default) |
| `--apply` | Apply recommendations + run ≥98% preservation verification |
| `--verify-only` | Re-run verification on already-optimized commands |
| `--rollback` | Restore commands from baseline commit |
| `--quiet` | Minimal output: single-line summary |
| `--verbose` | Full details on all sections |

Use TodoWrite to track progress.

---

## Phase 0: Initialization

### 1. Parse Arguments
```
COMMAND_PATH = ~/.claude/commands/
TARGET = $ARGUMENTS or "all"
MODE = --apply | --verify-only | --rollback | --dry-run (default)
VERBOSITY = --quiet | --verbose | default
```

### 2. If --apply or --rollback: Create/Use Baseline
```bash
if MODE == --apply:
    # Create baseline BEFORE any changes
    mkdir -p context/audit-commands/baseline/  # Persistent baseline
    cp -r ~/.claude/commands/ context/audit-commands/baseline/  # Copy BEFORE stash
    cp -r ~/.claude/commands/ /tmp/audit-commands-baseline/  # Fast working copy
    git stash push -m "audit-commands-temp" 2>/dev/null  # Save uncommitted project work (not commands — those are in ~/.claude/)
    BASELINE_COMMIT = $(git rev-parse HEAD)
    echo "BASELINE: $BASELINE_COMMIT | $(date -Iseconds)" >> context/audit-commands/baseline.txt
    BASELINE_DIR = context/audit-commands/baseline/  # Set for Phase 6
    # NOTE: git stash pop runs at end of successful --apply (after Phase 7)

if MODE == --rollback:
    # Read baseline from file
    BASELINE = read context/audit-commands/baseline.txt (last line)
    # Try persistent first, fall back to /tmp/
    BASELINE_DIR = context/audit-commands/baseline/ OR /tmp/audit-commands-baseline/
    IF NOT exists BASELINE_DIR:
        ERROR: "No baseline found. Run --apply first."
        EXIT
    cp -r $BASELINE_DIR/* ~/.claude/commands/
    git stash pop 2>/dev/null  # Restore stashed work
    Output: "ROLLBACK: Restored commands from $BASELINE"
    EXIT

if MODE == --verify-only:
    # Verify baseline exists (persistent or /tmp/)
    BASELINE_DIR = context/audit-commands/baseline/ OR /tmp/audit-commands-baseline/
    IF NOT exists BASELINE_DIR:
        ERROR: "No baseline found. Run --apply first."
        EXIT
    # Pre-flight: check for partial --apply state (commands not yet updated but shared files exist)
    IF _shared-*.md files exist BUT commands still contain inline content matching shared files:
        WARN: "Possible partial --apply detected. Re-run --apply for clean state."
    # Skip directly to Phase 6 (Phases 1-5 are NOT executed in --verify-only mode)
```

### 3. Scan Command Files
```
FILES = glob ~/.claude/commands/*.md
Exclude: _*.md (shared files like _output-patterns.md, _shared-*.md)

If TARGET != "all":
    FILES = filter FILES where name matches TARGET
```

---

## Phase 1: Command Inventory & Token Counting

**Goal**: Accurate baseline of all commands (target: ±5% accuracy)

### For Each Command File:

1. **Read file content**
2. **Count tokens** using character-based estimation:
   - Tokens ≈ characters / 4 (Claude tokenizer approximation)
   - More accurate: count words × 1.3
   - Target accuracy: ±5% of actual token count
3. **Parse sections** by `##` headers
4. **Analyze content types**:
   - **Inline code**: Count tokens in ``` code blocks ```
   - **Tables**: Count tokens in markdown tables (| ... |)
   - **Prose**: Count tokens in paragraph text
5. **Record metrics**:
   ```
   {
     name: "implement-batch",
     path: "~/.claude/commands/implement-batch.md",
     lines: 885,
     characters: 32387,
     tokens_estimate: ~8100,
     content_breakdown: {
       code_blocks: ~2100 (26%),
       tables: ~1400 (17%),
       prose: ~4600 (57%)
     },
     sections: [
       { header: "## Phase 0: Initialization", lines: 45, tokens: ~350 },
       { header: "## Phase 1-N: Layer Implementation", lines: 180, tokens: ~1400 },
       ...
     ],
     largest_section: { header: "...", tokens: ... }
   }
   ```

### Output Inventory:
```
COMMAND INVENTORY
=================
| Command | Lines | Tokens | Largest Section |
|---------|-------|--------|-----------------|
| implement-batch | 885 | ~8,100 | Phase 1-N Loop (1,400) |
| verify-implementation | 520 | ~5,800 | Phase 2: Analysis (1,200) |
| ... | ... | ... | ... |
TOTAL: {N} commands | ~{total} tokens
```

---

## Phases 2 + 3 + 3B: Parallel Analysis Fan-Out

> **PARALLEL EXECUTION**: After Phase 1 completes, launch Phases 2, 3, and 3B as **three parallel agents in a single message**. They have no data dependencies on each other. Phase 2 uses Phase 1 token data (pass as context). Phases 3 and 3B only need the command file list.

```
# Launch in a SINGLE message with 3 Task tool calls:
Agent 1 (Explore): Phase 2 — Shared Pattern Analysis
  Input: Phase 1 inventory JSON (token counts per section per command) + all command file paths
  Prompt: "Read all command files in ~/.claude/commands/ (exclude _*.md). Use the following
    Phase 1 token data: {INVENTORY_JSON}. For each of the 7 known patterns (AGENT_TIMEOUT,
    AUTONOMOUS, PLAN_DISCOVERY, BLUEPRINT_MODE, CONTEXT_CHECK, ERROR_HANDLING, COMMIT_PROTOCOL),
    search for matching sections across commands, calculate text similarity (≥70% threshold,
    ≥3 commands). For savings: combined_tokens = sum of matched section tokens across commands;
    shared_tokens = max section tokens + 10% overhead; savings = combined - (shared + 20 × command_count).
    Also identify critical items in each pattern (timeout values, error codes, config values).
    Return as JSON: [{pattern_id, similarity_pct, commands: [], combined_tokens, shared_tokens,
    savings, preserves: [critical items found in pattern]}]"
  Output: Extractable patterns with savings estimates + preservation items

Agent 2 (Explore): Phase 3 — Verbosity Compliance Check
  Input: Command file list + _output-patterns.md path
  Prompt: "Read ~/.claude/commands/_output-patterns.md for patterns A-D. Then for each command
    file (exclude _*.md), find output/report sections and check compliance against patterns.
    Return as JSON: [{command, section, patterns_used: [], compliant: bool, issue: str|null}]"
  Output: Per-command compliance table

Agent 3 (Explore): Phase 3B — Intra-Command Efficiency Analysis
  Input: Command file list
  Prompt: "Read each command in ~/.claude/commands/ (exclude _*.md). For each, analyze:
    (1) prose density per section, (2) intra-command redundancies, (3) trimmable code blocks
    (>20 lines illustrative), (4) mergeable small sections (<3 lines), (5) formatting overhead.
    Skip lines with MUST/NEVER/BLOCKING/CRITICAL/WARNING/IMPORTANT.
    Return as JSON: [{command, prose_density_pct, redundancies: N, condensable_sections: N,
    est_savings_tokens, findings: [{type, section, detail}]}]"
  Output: Per-command efficiency findings

# WAIT for all 3 agents to complete before proceeding to Phase 4
```

---

## Phase 2: Shared Pattern Analysis

**Goal**: Identify extractable patterns appearing in 3+ commands

### Pattern Detection:

1. **Extract comparable sections** from each command:
   - Agent timeout/collection blocks
   - No-pause/autonomous execution rules
   - Plan discovery logic
   - Blueprint mode detection
   - Context compaction checks
   - Error handling tables

2. **Compare sections across commands** (false positive prevention):
   ```
   For each section_type:
     sections = collect matching sections from all commands
     if len(sections) >= 3:                    # Minimum 3 commands threshold
       similarity = calculate_similarity(sections)
       if similarity >= 70%:                   # Similarity threshold reduces false positives
         FLAG as extractable pattern

   # False positive guards:
   # - Require 3+ commands (not 2) to avoid coincidental matches
   # - 70% similarity excludes sections with minor textual overlap
   # - Manual review in recommendations (not auto-applied without --apply)
   ```

3. **Calculate extraction savings**:
   ```
   combined_tokens = sum(section.tokens for section in sections)
   shared_tokens = max(section.tokens) + (10% overhead for variations)
   reference_cost = ~20 tokens  # Cost of "See `_shared-{name}.md` for {description}." line per command
   savings = combined_tokens - (shared_tokens + reference_cost × len(sections))
   ```

### Known Patterns to Detect:

| Pattern ID | Search For | Extract To |
|------------|------------|------------|
| AGENT_TIMEOUT | "TaskOutput", "timeout:", "graceful degradation" | `_shared-agent-timeout.md` |
| AUTONOMOUS | "NO PAUSES", "Do NOT pause", "autonomously" | `_shared-autonomous.md` |
| PLAN_DISCOVERY | "Find Plan", "Locate Plan", "$ARGUMENTS" → paths | `_shared-plan-discovery.md` |
| BLUEPRINT_MODE | "blprnt-*.md", "three-layer", "BLUEPRINT_MODE" | `_shared-blueprint-mode.md` |
| CONTEXT_CHECK | "context > 70%", "/compact", "CONTEXT_HIGH" | `_shared-context-check.md` |
| ERROR_HANDLING | "\| Error \|", "\| Situation \|", "Error Handling" section | `_shared-error-handling.md` |
| COMMIT_PROTOCOL | "Co-Authored-By", "git commit", "Conventional commits" | `_shared-commit-protocol.md` |

### Output:
```
SHARED PATTERN ANALYSIS
=======================
Pattern: AGENT_TIMEOUT (Agent Timeout Configuration)
  Similarity: 85%
  Commands: analyze-plan, verify-implementation, implement-batch
  Lines: 92 (combined) → 35 (shared) = 57 lines saved
  Tokens: ~920 → ~350 = 570 tokens saved

Pattern: AUTONOMOUS (No-Pause Execution Rules)
  Similarity: 92%
  Commands: implement-batch, implement-plan, verify-implementation
  ...

Total extractable: {N} patterns | ~{tokens} tokens saveable
```

---

## Phase 3: Verbosity Compliance Check

**Goal**: Verify output sections follow patterns A-D from `_output-patterns.md`

### Read Verbosity Patterns:
Load `~/.claude/commands/_output-patterns.md` for reference patterns:
- **Pattern A**: Conditional verbosity (expand only on failure)
- **Pattern B**: Progressive disclosure (summary first)
- **Pattern C**: Aggregated progress (phase-level, not item-level)
- **Pattern D**: Inline metrics (single-line summaries)

### Check Each Command:

1. **Find output/report sections**:
   - Headers containing: "Output", "Report", "Summary", "Final"
   - Code blocks with output examples

2. **Analyze compliance**:
   ```
   For each output_section:
     has_conditional = contains "IF" or "ELSE" for pass/fail
     has_quiet_mode = references --quiet
     has_verbose_mode = references --verbose
     uses_inline_metrics = single-line format present

     COMPLIANT if:
       - has_conditional OR has_quiet_mode + has_verbose_mode
       - uses compact format for success case
   ```

3. **Flag non-compliant**:
   ```
   NON_COMPLIANT: {command} - {section}
     Issue: No conditional verbosity
     Fix: Add IF pass/fail branches per _output-patterns.md
   ```

### Output:
```
VERBOSITY COMPLIANCE
====================
| Command | Output Section | Patterns | Status |
|---------|----------------|----------|--------|
| implement-batch | Final Phase Summary | A+B | ✅ Compliant |
| verify-implementation | Phase 5 Report | A+B+D | ✅ Compliant |
| sync-context | Status Output | - | ⚠️ Non-compliant |
| codebase-audit | Audit Report | - | ⚠️ Non-compliant |

Compliant: {N}/15 | Non-compliant: {M}
```

---

## Phase 3B: Intra-Command Efficiency Analysis

**Goal**: Identify optimization opportunities within individual commands (not cross-command)

### For Each Command:

1. **Prose Density Analysis**:
   ```
   For each prose section (non-code, non-table):
     density = meaningful_keywords / total_words
     IF density < 60%: FLAG as condensable
   ```
   Condensable patterns (rewrite, not remove):
   - Filler phrases: "You should make sure to always" → "Always"
   - Passive voice: "should be run by the agent" → "agent runs"
   - Redundant qualifiers: "completely and fully remove all" → "remove all"
   - Verbose transitions: "After completing the above step, proceed to" → "Then"
   - Repeated context: restating what the phase does when the header says it

2. **Intra-Command Redundancy Detection**:
   ```
   For each command:
     Extract all instruction sentences
     Find semantically duplicate instructions within same file
     FLAG repeated rules/instructions (keep most complete, remove duplicates)
   ```

3. **Example & Code Block Analysis**:
   ```
   For each code block:
     IF lines > 20 AND is illustrative (not executable syntax):
       FLAG as trimmable
     IF output example has >5 repetitive rows:
       FLAG: reduce to 3 rows + "..." pattern
   ```
   **NEVER modify**: Actual command syntax, agent configs, bash commands, error code tables

4. **Section Structure Analysis**:
   ```
   For each ## or ### section:
     IF content < 3 lines AND adjacent section is semantically related:
       FLAG as merge candidate
     IF blank_lines > content_lines:
       FLAG as format-heavy
   ```

5. **Formatting Overhead**:
   - Count tokens spent on formatting (blank lines, dividers, repeated `---`) vs content
   - Flag excessive blank lines between sections
   - Flag redundant horizontal rules

### Untouchable Content (NEVER condense):
- Lines containing: MUST, NEVER, BLOCKING, CRITICAL, WARNING, IMPORTANT
- Code blocks with actual command/script syntax
- Agent configuration values (subagent_type, max_turns, timeout)
- Error codes, timeout values, file paths
- Table rows with error definitions or configuration
- `> ⚠️` and `> 🚫` callouts

### Output:
```
INTRA-COMMAND EFFICIENCY
========================
| Command | Prose Density | Redundancies | Condensable Sections | Est. Savings |
|---------|---------------|--------------|----------------------|--------------|
| implement-batch | 52% | 3 | 8 sections | ~1,200 tokens |
| blueprint | 61% | 1 | 4 sections | ~600 tokens |
| verify-implementation | 58% | 2 | 5 sections | ~800 tokens |
| ... | ... | ... | ... | ... |

Total intra-command savings potential: ~{tokens} tokens ({percent}%)
```

---

## Phase 4: Optimization Recommendations

**Goal**: Generate actionable recommendations with preservation guarantees

### Generate Recommendations:

For each extractable pattern (Phase 2), intra-command finding (Phase 3B), and non-compliant section (Phase 3):

```markdown
[{priority}] {IMPACT} IMPACT | {RISK} RISK
Action: {Extract pattern | Update verbosity | Condense section}
Target: {commands affected}
Savings: ~{tokens} tokens

PRESERVES:
  ✓ {critical item 1}
  ✓ {critical item 2}
  ✓ {critical item 3}

CHANGES:
  - {change description}

IMPLEMENTATION:
  {specific steps}
```

### Recommendation Types:
```
Type A: SHARED EXTRACTION    — Cross-command deduplication (Phase 2)
Type B: INTRA-COMMAND CONDENSE — Prose/example/format tightening (Phase 3B)
Type C: VERBOSITY UPDATE      — Output pattern compliance (Phase 3)
```

### Priority Scoring:
```
IMPACT = tokens_saved / 100  (HIGH if >500, MEDIUM if >200, LOW if <200)
RISK = based on content type:
  - Error handling: HIGH risk
  - Agent config: MEDIUM risk
  - Prose condensation: LOW risk (meaning-preserving rewrites)
  - Workflow refs: LOW risk
PRIORITY = IMPACT_SCORE - RISK_PENALTY
```

### Output:
```
OPTIMIZATION RECOMMENDATIONS
============================
Sorted by priority (highest first)

[1] Type A | HIGH IMPACT | LOW RISK
Extract: Agent timeout/collection → _shared-agent-timeout.md
Commands: analyze-plan, verify-implementation, implement-batch
Savings: ~570 tokens
Preserves:
  ✓ 120s default timeout
  ✓ Graceful degradation fallbacks
  ✓ TaskOutput block/timeout params
  ✓ Agent status tracking format

[2] Type B | MEDIUM IMPACT | LOW RISK
Condense: implement-batch prose sections (8 sections, density 52%)
Savings: ~1,200 tokens
Preserves:
  ✓ All phase workflows intact
  ✓ All MUST/NEVER/CRITICAL rules verbatim
  ✓ All agent configs unchanged
Changes:
  - Rewrite verbose prose (meaning-preserving)
  - Trim illustrative examples (3 rows + ...)
  - Remove 3 redundant instruction repeats

[3] Type A | MEDIUM IMPACT | LOW RISK
Extract: Autonomous execution rules → _shared-autonomous.md
...

[N] Type C | LOW IMPACT | LOW RISK
Update: sync-context verbosity → add --quiet/--verbose support
...

SAVINGS BREAKDOWN:
  Shared extraction: ~{n} tokens
  Intra-command condensation: ~{n} tokens
  Verbosity updates: ~{n} tokens
TOTAL POTENTIAL SAVINGS: ~{tokens} tokens ({percent}% reduction)
```

---

## Phase 5: Apply Optimizations (--apply mode only)

**SKIP if** MODE != --apply

**Phases 5.2 → 5.3 → 5.4 → 5.5 MUST execute sequentially.** Phase 5.4 depends on Phase 5.3 output for its guard clause.

### 5.1 Confirm Baseline
Verify `BASELINE_DIR` exists from Phase 0 (persistent or /tmp/ fallback).

### 5.2 Create Shared Files

> **PARALLEL EXECUTION**: Each shared file is independent. Launch **one agent per extractable pattern** in a single message using `general-purpose` subagent_type. Each agent reads the relevant sections from source commands, merges content, and writes the shared file.

For each extractable pattern (launch in parallel):

1. **Merge content** from all source commands
2. **Preserve all unique content** (union, not intersection)
3. **Add header**:
   ```markdown
   <!--
   CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
   Source commands: {list}
   Generated: {timestamp}
   Last audit: {timestamp}
   -->

   # {Pattern Name}

   {merged content}
   ```

4. **Write to** `~/.claude/commands/_shared-{name}.md`

Wait for all shared file agents to complete before Phase 5.3.

### 5.3 Update Commands

For each command referencing extracted content:

1. **Replace extracted section** with reference:
   ```markdown
   ### {Section Name}
   See `_shared-{name}.md` for {description}.
   ```

2. **Alternative: Use include directive** (for larger sections):
   ```markdown
   <!-- @include _shared-{name}.md -->
   ```

3. **Preserve command-specific variations** inline:
   ```markdown
   ### {Section Name}
   See `_shared-{name}.md`. Command-specific: {variation}.
   ```

### 5.4 Apply Intra-Command Optimizations

> **PARALLEL EXECUTION**: Each command's intra-command optimizations are independent (different files). Launch **one `general-purpose` agent per command** with Phase 3B findings for that command. Each agent applies condensation and returns its CHANGE_LOG entries. After all agents complete, merge their CHANGE_LOG entries into a single manifest and persist to disk.

For each command with Phase 3B findings (launch in parallel):

**GUARD**: Skip lines/sections that contain `See \`_shared-` references OR `@include _shared-` directives added by Phase 5.3. These preserve command-specific variations and MUST NOT be condensed.

1. **Condense verbose prose** (meaning-preserving rewrites):
   - Rewrite flagged low-density sections to be more concise
   - Remove filler words, redundant qualifiers, passive constructions
   - Keep all factual content, instructions, and rules intact
   - **NEVER touch lines with**: MUST, NEVER, BLOCKING, CRITICAL, WARNING, IMPORTANT

2. **Remove intra-command redundancies**:
   - Keep the most complete version of duplicated instructions
   - Remove duplicate, add "See [section above]" cross-ref if needed

3. **Trim illustrative examples**:
   - Reduce repetitive output example rows (>5 → 3 + `...`)
   - Shorten code blocks that illustrate patterns (not exact syntax)
   - **NEVER modify**: Actual command syntax, agent configs, bash snippets

4. **Merge small sections**:
   - Combine sections with <3 lines into semantically related neighbors
   - Preserve all content from both sections in the merge

5. **Clean formatting overhead**:
   - Single blank line between sections (not double)
   - Remove redundant `---` dividers between sub-sections
   - Remove trailing whitespace

6. **Record change manifest entries** (required for Phase 6 verification):
   ```
   Each agent returns its CHANGE_LOG entries for its command:
     { type: "prose-condensed", section: "{header}", original: "{text}", condensed: "{text}" }
     { type: "redundancy-removed", section: "{header}", removed_line: "{text}", kept_at: "{section}" }
     { type: "example-trimmed", section: "{header}", original_lines: N, trimmed_to: M }
     { type: "sections-merged", from: ["{header1}", "{header2}"], into: "{header}" }
     { type: "formatting-cleaned", section: "{header}", tokens_saved: N }
   ```

7. **Merge and persist change manifest** (after all agents complete):
   ```
   # Collect CHANGE_LOG entries from all parallel agents
   # Merge into single CHANGE_LOG keyed by command name
   # Persist to disk for --verify-only access in future sessions
   Write merged CHANGE_LOG to context/audit-commands/change-manifest.json
   ```
   Phase 6.2 reads this manifest for merge handling and Content Completeness spot-checks.
   Phase 6.3 uses it to apply targeted remediation per change type.

### 5.5 Update Verbosity (Non-Compliant Commands)

For each non-compliant output section:

1. **Add --quiet/--verbose flags** to Arguments section
2. **Add conditional output blocks** per `_output-patterns.md`

---

## Phase 6: Post-Optimization Verification (--apply or --verify-only mode)

**CRITICAL**: Verify ≥98% preservation for each optimized command.

**Mode behavior**:
- `--apply`: Run after Phase 5 optimizations
- `--verify-only`: Jump directly to this phase, compare current commands against baseline

### 6.1 Preservation Scoring

For each optimized command, compare against baseline:

| Category | Weight | Check |
|----------|--------|-------|
| Workflow Integrity | 20% | All `## Phase` headers, ALL `###` subheaders (not just Step N.N), phase order, loop structures |
| Critical Rules | 20% | Lines with MUST/NEVER/BLOCKING/CRITICAL/WARNING/IMPORTANT preserved verbatim |
| Content Completeness | 15% | Non-keyword instructions semantically preserved, illustrative examples representative, no meaning drift from prose condensation |
| Error Handling | 15% | All error codes, error tables (`| Error |`, `| Situation |`), response actions |
| Safety Guards | 10% | Timeouts, validation, security checks, sanitization, path traversal checks |
| Agent Configuration | 10% | subagent_type, max_turns, timeout, run_in_background values |
| Cross-References | 10% | File paths, command links, skill references, @include directives |

### 6.2 Comparison Engine

> **PARALLEL EXECUTION**: Launch **one `code-reviewer` agent per command** in a single message. Each agent independently verifies its assigned command against the baseline. Collect all agent results before proceeding to 6.3 remediation.

```
Per-command agent prompt template:
  subagent_type: code-reviewer
  prompt: "Compare the optimized command at ~/.claude/commands/{command}.md against
    baseline at {BASELINE_DIR}/{command}.md. Also read any _shared-*.md files referenced.
    Read the change manifest at context/audit-commands/change-manifest.json.
    Score preservation across 7 categories (weights: workflow=0.20, rules=0.20,
    content=0.15, errors=0.15, safety=0.10, agents=0.10, refs=0.10).
    Return JSON: {command, total_score, categories: [{name, original_count,
    preserved_count, score}], missing_items: [{item, category}],
    content_score, content_flags: [{item, status: PRESERVED|FLAG|LOW_FLAG|MISSING}]}"
```

```
For each command (launch as parallel agents):
    original = read BASELINE_DIR/{command}.md  # context/audit-commands/baseline/ or /tmp/
    optimized = read ~/.claude/commands/{command}.md
    shared_refs = find all _shared-*.md references in optimized  # Match BOTH: "See `_shared-*.md`" AND "<!-- @include _shared-*.md -->"
    shared_content = read all referenced _shared-*.md files
    combined = optimized + shared_content
    change_log = read context/audit-commands/change-manifest.json (if exists, else empty)

    # --- Pattern-match categories (exact text comparison) ---
    all_pattern_missing = []  # Accumulate across ALL categories for Phase 6.3

    For category in [workflow, rules, errors, safety, agents, refs]:
        original_items = extract_items(original, category)
        preserved_items = extract_items(combined, category)

        # Note: extract_items searches the ENTIRE combined text regardless of header location.
        # Non-workflow categories (errors, safety, agents, refs) find items by content pattern,
        # so section merges do not affect them. Workflow uses header matching, so needs merge compensation.
        IF category == "workflow" AND change_log exists:
            For merge in change_log where type == "sections-merged":
                IF merge.into in preserved_items:
                    For header in merge.from:
                        Add header to preserved_items  # Merged, not lost

        IF len(original_items) == 0:
            category_score = 100  # Nothing to preserve = fully preserved
        ELSE:
            category_score = len(preserved_items ∩ original_items) / len(original_items) × 100
        all_pattern_missing += (original_items - preserved_items)  # Accumulate misses

    # --- Content Completeness (semantic comparison, not string match) ---
    # This category catches intra-command condensation drift AND example trimming
    content_score = evaluate_content_completeness(original, combined, change_log):

        ## A. Prose instructions (semantic match)
        1. Extract all non-keyword instructional sentences from original
           (exclude lines matching MUST/NEVER/BLOCKING/CRITICAL/WARNING/IMPORTANT)
        2. For each original instruction:
           a. Search combined for exact match → PRESERVED (full score)
           b. If no exact match, search for key action verbs + objects
              e.g., "Run tests before committing" → look for "run" + "tests" + "commit"
           c. If partial match found, check for meaning loss:
              - Missing timing constraints ("before X", "after Y") → FLAG
              - Missing conditions ("if X", "when Y") → FLAG
              - Missing scope ("all", "each", "every") → FLAG
              - Missing purpose ("to ensure", "so that") → LOW_FLAG
           d. If no match at all → MISSING

        ## B. Illustrative examples (trimming verification)
        3. For each "example-trimmed" entry in change_log:
           a. Verify trimmed example still contains ≥1 representative row → PRESERVED
           b. Verify "..." or continuation marker present → PRESERVED
           c. If all rows removed or example eliminated → MISSING
           Score examples: PRESERVED = 1.0, MISSING = 0.0

        ## C. Combined score
        4. all_items = prose_items + example_items
           Score: (PRESERVED × 1.0 + LOW_FLAG × 0.8 + FLAG × 0.5) / len(all_items) × 100

        ## D. Spot-check (score-bearing)
        5. Pick 5 random condensed items from change_log (skip if change_log has <5 entries or is empty)
           Verify each preserves: action, target, constraints, conditions
           Adjust: If spot-check finds issues not caught in A-C, deduct 1% per issue from content_score

    # Weights as decimals: workflow=0.20, rules=0.20, errors=0.15, safety=0.10, agents=0.10, refs=0.10
    total_score = Σ(category_score × weight_decimal) + (content_score × 0.15)
```

### 6.3 Auto-Remediation (Sequential)

> **NOT parallel**: Remediation modifies command files and must run sequentially to avoid write conflicts. Process commands with `total_score < 98%` one at a time.

```
IF total_score < 98%:
    # Collect missing items from ALL 7 categories
    # all_pattern_missing accumulated across 6 categories in the loop above
    content_missing = items scored as FLAG or MISSING in Content Completeness
    missing_items = all_pattern_missing + content_missing

    FOR attempt in 1..3:
        FOR item in missing_items:
            # Determine change type by looking up item in change_log
            cl_entry = change_log.find(entry where entry.original contains item)

            IF item exists in any _shared-*.md file:
                # Extracted to shared file but reference missing
                Add explicit "See _shared-*.md" reference to command
            ELIF cl_entry AND cl_entry.type == "prose-condensed":
                # Meaning drift from condensation — restore original wording
                EXPAND: replace cl_entry.condensed with cl_entry.original in command
            ELIF cl_entry AND cl_entry.type == "redundancy-removed":
                # Duplicate removal lost unique nuance
                RESTORE cl_entry.removed_line at cl_entry.section in command
            ELIF cl_entry AND cl_entry.type == "example-trimmed":
                # Example trimmed too aggressively — restore from baseline
                RESTORE original example block from baseline
            ELIF cl_entry AND cl_entry.type == "sections-merged":
                # Merge lost content — restore original section structure from baseline
                RESTORE original sections (cl_entry.from headers) from baseline
            ELIF cl_entry AND cl_entry.type == "formatting-cleaned":
                # Formatting removal affected readability — restore section formatting from baseline
                RESTORE original formatting for cl_entry.section from baseline
            ELSE:
                # Item missing entirely (no change_log entry) — restore from baseline
                Restore item from baseline to command

        Recalculate score
        IF score >= 98%: BREAK

    IF still < 98%:
        Rollback: cp $BASELINE_DIR/{command}.md ~/.claude/commands/
        Mark: ❌ ROLLBACK
        FLAG for manual review
```

### 6.4 Per-Command Report

```markdown
## Command: {name}.md

### Preservation Score: {score}% {✅ PASS | ⚠️ REMEDIATED | ❌ ROLLBACK}

| Category | Original | Preserved | Score |
|----------|----------|-----------|-------|
| Workflow Integrity | {n} | {m} | {%} |
| Critical Rules | {n} | {m} | {%} |
| Content Completeness | {n} | {m} | {%} |
| Error Handling | {n} | {m} | {%} |
| Safety Guards | {n} | {m} | {%} |
| Agent Config | {n} | {m} | {%} |
| Cross-References | {n} | {m} | {%} |

**Weighted Total**: {score}%

### Token Savings
- Original: {n} tokens
- Optimized: {m} tokens
- Savings: {diff} tokens ({percent}%)

### Changes Applied
{list of extractions and updates}

### Remediation Applied (if any)
{list of restored items}
```

---

## Phase 7: Report Generation

### Write Audit Report

Write to `context/audit-commands/audit-{YYYY-MM-DD}.md` (mkdir -p `context/audit-commands/` if needed):

```markdown
# Command Optimization Audit Report
Generated: {timestamp} | Mode: {mode} | Baseline: {commit_sha}

## Executive Summary
- Commands analyzed: {N}
- Total tokens (original): {n}
- Shared patterns detected: {M}
- Verbosity compliant: {X}/{N}
- Potential savings: ~{tokens} ({percent}%)

## Command Inventory
{Phase 1 output}

## Shared Pattern Analysis
{Phase 2 output}

## Intra-Command Efficiency
{Phase 3B output}

## Verbosity Compliance
{Phase 3 output}

## Optimization Recommendations
{Phase 4 output — Types A, B, C}

## Verification Results (only if --apply or --verify-only; omit section in --dry-run)
{Phase 6 output - per-command scores}

### Overall Verification
| Metric | Value |
|--------|-------|
| Commands Optimized | {N} |
| Commands Passed (≥98%) | {X} |
| Commands Remediated | {Y} |
| Commands Rolled Back | {Z} |
| Average Preservation Score | {avg}% |
| Total Token Savings | {tokens} ({percent}%) |

### Savings Breakdown
| Optimization Type | Tokens Saved | % of Total |
|-------------------|--------------|------------|
| Shared Extraction (Type A) | {n} | {%} |
| Intra-Command Condensation (Type B) | {n} | {%} |
| Verbosity Updates (Type C) | {n} | {%} |

### Shared Files Created
| File | Token Cost | Commands Using | Net Savings |
|------|------------|----------------|-------------|
| _shared-agent-timeout.md | {n} | {count} | {savings} |
| _shared-autonomous.md | {n} | {count} | {savings} |
| ... | ... | ... | ... |

### Category Breakdown (All Commands)
| Category | Avg Score | Min Score | Commands Below 98% |
|----------|-----------|-----------|-------------------|
| Workflow Integrity | {%} | {%} | {n} |
| Critical Rules | {%} | {%} | {n} |
| Content Completeness | {%} | {%} | {n} |
| Error Handling | {%} | {%} | {n} |
| Safety Guards | {%} | {%} | {n} |
| Agent Config | {%} | {%} | {n} |
| Cross-References | {%} | {%} | {n} |

### Rollback Instructions (if needed)
cp -r context/audit-commands/baseline/* ~/.claude/commands/

## Next Steps
{recommendations based on mode}
```

### Post-Report Cleanup (--apply mode only)
```bash
git stash pop 2>/dev/null  # Restore any stashed project work from Phase 0
```

---

## Phase 8: Console Output

Use conditional verbosity per `_output-patterns.md`.

### Default Output (--dry-run or no flags):
```
AUDIT: {N} commands | {tokens} tokens
Shared patterns: {M} detected ({extractable} tokens extractable)
Intra-command: {condensable} sections flagged ({intra_tokens} tokens condensable)
Verbosity: {X}/{N} compliant
Report: context/audit-commands/audit-{date}.md
Next: Review report, run /audit-commands --apply
```

### --apply Output:
```
AUDIT: {N} commands | {original} → {optimized} tokens ({percent}% saved)
Savings: shared {n} + intra-command {n} + verbosity {n}
Verification: {passed}/{N} PASS | {remediated} remediated | {rollback} rollback
Avg preservation: {score}%
Report: context/audit-commands/audit-{date}.md
```

### --verify-only Output:
```
VERIFY: {N} commands | Avg preservation: {score}%
Passed: {passed} | Remediated: {remediated} | Rollback: {rollback}
Categories: Workflow {%} | Rules {%} | Content {%} | Errors {%} | Safety {%} | Agents {%} | Refs {%}
Report: context/audit-commands/audit-{date}.md
```

### --quiet Output:
```
AUDIT: {N} commands | {percent}% saveable | {compliant}/{N} compliant
```

### --verbose Output:
Full report content to console (inventory, patterns, compliance, recommendations, verification).

---

## Error Handling

| Error | Response |
|-------|----------|
| No command files found | FATAL: "No commands in ~/.claude/commands/" |
| Baseline not found (--rollback) | ERROR: "No baseline found. Run --apply first." |
| Git not available | WARN: "Git unavailable, using file backup only" |
| `_output-patterns.md` not found | WARN: "Verbosity reference missing, skipping Phase 3 compliance check". Phase 3B (intra-command efficiency) still runs — it does not depend on `_output-patterns.md`. |
| Command parse error | WARN: "Failed to parse {file}, skipping" |
| Verification <98% after 3 attempts | Rollback command, flag for manual review |
| Shared file write error | ERROR: "Cannot write {file}", abort --apply |

---

## Usage Examples

```bash
# Audit all commands (default, dry-run)
/audit-commands

# Audit specific command
/audit-commands verify-implementation

# Full verbose audit
/audit-commands --verbose

# Apply optimizations with verification
/audit-commands --apply

# Check verification of existing optimizations
/audit-commands --verify-only

# Rollback to pre-optimization state
/audit-commands --rollback
```

---

## Critical Files

| File | Role |
|------|------|
| `~/.claude/commands/*.md` | Input: Commands to audit |
| `~/.claude/commands/_output-patterns.md` | Reference: Verbosity patterns A-D |
| `~/.claude/commands/_shared-*.md` | Output: Extracted shared patterns (if --apply) |
| `context/audit-commands/audit-*.md` | Output: Audit report |
| `context/audit-commands/baseline.txt` | State: Baseline commit tracking |
| `context/audit-commands/change-manifest.json` | State: Phase 5.4 change log for verification |
| `context/audit-commands/baseline/` | Persistent: Original commands for comparison |
| `/tmp/audit-commands-baseline/` | Temp: Fast working copy (volatile, falls back to persistent copy if missing) |
| `plan-output-verbosity-optimization-2026-02-25.md` | Reference: Verbosity targets |

---

## Workflow Integration

```
/audit-commands (dry-run)
  ↓
Review recommendations in report
  ↓
/audit-commands --apply
  ├── Creates baseline (git stash + copy)
  ├── Applies optimizations (shared files + command updates)
  ├── Verifies ≥98% preservation per command
  │     ├── If PASS → continue
  │     ├── If <98% → auto-remediate (max 3 iterations)
  │     └── If still <98% → rollback command
  └── Generates verification report
  ↓
Review verification report
  ↓
/commit
```

---

## Preservation Checklist (Automated)

The verification engine checks the specific patterns defined in Phase 6.1 Preservation Scoring (7 categories with weights). Phase 6.2 Comparison Engine implements the detailed checking logic for each category.
