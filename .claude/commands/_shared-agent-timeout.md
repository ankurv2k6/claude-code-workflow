<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: analyze-plan, verify-implementation, design-ui, implement-batch
Generated: 2026-02-25
Last audit: 2026-02-25
-->

# Agent Timeout & Collection Strategy

**After launching agents, collect results with timeout:**

1. **Wait with timeout** (use command's configured timeout per agent):
   ```
   For each agent task_id:
     Use TaskOutput with:
       block: true
       timeout: AGENT_TIMEOUT  # Command-specific: see agent config
   ```

2. **Graceful degradation** — If an agent times out:
   - Use `TaskOutput` with `block: false` to get partial results
   - Mark that agent's section as `[PARTIAL - TIMEOUT]` in report
   - Log which agent timed out and at what stage
   - Continue with available data

3. **Status tracking** (use command-specific agent/item names):
   ```
   AGENTS: [✓] Agent1 | [✓] Agent2 | [TIMEOUT] Agent3 | [✓] Agent4
   ```

4. **Fallback for timed-out agents**: Each command defines domain-specific fallbacks.

5. **Recovery**: Timed-out items can be re-run individually. Partial results are preserved.

**IMPORTANT**: Do NOT wait indefinitely. After the total timeout ceiling, proceed to the next phase with whatever data was collected.
