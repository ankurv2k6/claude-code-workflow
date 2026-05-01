---
name: codebase-audit
description: Comprehensive codebase analysis for maintainability, security, performance, and production-readiness. Generates an actionable report without making changes.
---

# Codebase Audit

**Command**: `/codebase-audit [section]`
**Usage**: `/codebase-audit` (full) | `/codebase-audit security` | `/codebase-audit performance`

**CRITICAL**: READ-ONLY audit. Do NOT make code changes.

---

## Pre-Audit Setup

1. Read: `claude.md`, `context/project_structure.md`, `context/CONTEXT_GUIDE.md`
2. Scan: `/lib/`, `/app/api/`, `/components/`, `/hooks/`, config files
---

## 10 Audit Sections

### 1. CODE QUALITY

- Duplicate logic, copy-paste patterns
- Complexity: cyclomatic >10, nesting >3, files >500 lines, params >5
- SOLID violations, naming inconsistencies
- Error handling gaps, code smells (dead code, magic numbers, tight coupling)

### 2. ARCHITECTURE

- M0-M9 module boundaries, circular dependencies
- Layer separation (API, services, data)
- Reusability, dependency direction, config separation
- Scalability concerns

### 3. PERFORMANCE

- O(n²) algorithms, missing memoization, N+1 queries
- Caching gaps, over/under-fetching
- Memory leaks, async pattern issues

### 4. SECURITY

- Input validation, injection risks (SQL, XSS, command)
- Auth/authz gaps, secrets handling
- File upload risks, rate limiting gaps
- COPPA compliance, PII in logs

### 5. RESILIENCE

- Error propagation, silent failures
- HTTP response consistency
- Retry logic, circuit breakers, observability

### 6. TESTING

- Coverage gaps (unit, integration, E2E, accessibility)
- Test quality, MSW/Vitest patterns
- Missing edge case coverage

### 7. CONFIGURATION

- Env var validation, hardcoded values
- Build config, developer experience, CI/CD

### 8. CODE STYLE

- Formatting, type safety (`any` usage, unsafe casts)
- Constants/enums, shared types, lint gaps

### 9. PRIORITIZATION

- Group by category/severity/module
- Impact assessment, effort estimation
- Quick wins vs architectural changes

### 10. ROADMAP

- Phase 1: Critical fixes (Week 1)
- Phase 2: High-impact improvements (Weeks 2-3)
- Phase 3: Quality polish (Weeks 4+)

---

## Output Format

```markdown
# Codebase Audit Report

**Generated**: [Date] | **Scope**: [Full/Section]

## Executive Summary

| Category     | Score | Status                |
| ------------ | ----- | --------------------- |
| Code Quality | X/10  | Good/Warning/Critical |
| Architecture | X/10  | ...                   |
| Performance  | X/10  | ...                   |
| Security     | X/10  | ...                   |
| Testing      | X/10  | ...                   |

**Issues**: Total X | Critical X | High X | Medium X | Low X

### Top 5 Priority Items

1. [Issue]
2. [Issue]
   ...

## Critical Issues

### [Title]

- **Severity**: CRITICAL
- **Location**: `file:line`
- **Impact**: [What breaks]
- **Fix**: [How to fix]

## Roadmap

| Phase | Task   | Effort | Priority |
| ----- | ------ | ------ | -------- |
| 1     | [Task] | X days | CRITICAL |
```

---

## Project-Specific Checks

- Safety contracts: `character_rules.md`, `story_rules.md`
- COPPA: Photo handling <5 min, consent flows
- UI/UX: `ui-ux-rules.md`, `parent-ui-ux-rules.md`
- Module boundaries: M0-M9 separation
- Logging: `createLogger()` usage, error codes

---

## Severity Ratings

- **CRITICAL**: Immediate exploitation risk
- **HIGH**: Exploitable with effort
- **MEDIUM**: Risk under specific conditions
- **LOW**: Hardening opportunity
