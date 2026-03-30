# Project Memory Manager Skill

## Purpose
Maintain persistent, cross-session project context so Claude always understands the current state of the simulation, what has been built, what decisions were made, and what comes next.

## Core Rules
- CLAUDE.md is the single source of project memory — always read it at session start
- Decision rationale is recorded (not just what, but why)
- Completed milestones are marked — Claude should not re-implement finished work
- Open questions and blockers are tracked explicitly

## Memory Structure (CLAUDE.md sections)

### Project Overview
- What is being built
- Who it's for
- Key constraints

### Architecture Decisions (ADRs — lightweight)
Format: `Decision: X | Reason: Y | Alternatives considered: Z`

### Build Status
- What's done (with file paths)
- What's in progress
- What's next

### Open Questions
- Unresolved design choices
- Dependencies waiting on external input

### Conventions
- Naming conventions
- File organization rules
- Patterns enforced across the codebase

## Patterns
- After each major feature, update CLAUDE.md build status
- When a design decision is made mid-build, log it as an ADR entry
- Use checkboxes for task tracking: `- [x] done`, `- [ ] todo`

## File Structure
```
project-root/
  CLAUDE.md          # primary memory file — always present
  skills/            # skill definitions — always present
  ADR.md             # optional: long-form architecture decision records
```

## Anti-patterns
- Do not store code snippets in CLAUDE.md — link to files instead
- Do not store things derivable from git history
- Do not let CLAUDE.md grow stale — update it when work completes
