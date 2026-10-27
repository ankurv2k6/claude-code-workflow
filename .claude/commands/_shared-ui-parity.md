---
description: Shared protocol, not a standalone command. Proves UI parity with real-browser screenshot pairs of the mockup and the running app in the same state.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: implement-plan, implement-batch, verify-ui, verify-implementation, design-ui
Generated: 2026-10-27 (four defects passed code review and showed only in a browser: a dialog under an
inert drawer layer, an unstyled drawer, a count never rendered, a flow that differed at 4 of 5 steps)
Last audit: 2026-10-27
-->

# UI parity in a real browser

**A screen matches its mockup when a screenshot of the running app and a screenshot of the mockup, in the
same state, show the same structure, copy and states.** Reading JSX against mockup HTML is not proof.

## Protocol

1. **Run the app** on your own ports (lane or verifier), seeded so every state can be reached.
2. **For each screen you own and each key state** in its mockup's state list, capture two screenshots
   with Playwright (or the project's browser tooling) at 1440×900 unless the project sets another size:
   - the mockup: `design/mockups/<area>/<screen>.html?state=<state>`;
   - the app, driven into the same state.
3. **Save the pair** as `<scratch>/parity/<screen>-<state>-{mockup,app}.png`.
4. **Look at both images.** List differences in structure, copy, state, and missing or extra elements.
5. **Triage** (`~/.claude/commands/_shared-triage.md`):
   - structure, copy and state differences a user can see: HIGH, fix them;
   - a few pixels of spacing or a shade: LOW, log them;
   - differences in seeded data only: not a finding.
6. **Report** every pair path, so the verifier and the owner can open them.

No browser available is not a pass: report UI parity as `NOT PROVEN` with the reason.

## Tokens, not hex

Implement with the project's theme tokens, never colour literals. Match the mockup's tokens, not its
hex values; keep the mockup sheet mirrored from the app sheet so matching tokens means matching colours.

## What design hands over, so parity can be checked

- **Reachable states:** every mockup exposes its states through `?state=<name>` and lists them.
- **An Information decisions table per wireframe:** what is shown, what is on demand, what is omitted.
  Implementation adds nothing the table omits.
- **Shared primitives first:** a foundation lane builds the components used on 2 or more screens and the
  theme port before any screen lane starts.
- **Accessibility signed off by a separate agent** from the one that chose the colours.
