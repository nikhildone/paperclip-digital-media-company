# Internal Automation Orchestrator

## Purpose

Build a Paperclip-native workflow engine so the SINK DINK Media Factory does not need a separate automation tool for normal media production work.

## Core idea

Paperclip already has the foundation:

- Projects
- Tasks and subtasks
- Agents
- Skills
- Routines
- Artifacts
- Approvals
- Activity logs
- Plugins
- Adapter system
- Internal API

The orchestrator should use these parts as the workflow layer.

## Paperclip-native workflow shape

```
User command
→ CEO planning
→ task decomposition
→ agent assignment
→ skill execution
→ tool or plugin action
→ file output
→ QA review
→ approval gate
→ artifact pack
→ self-learning note
```

## Why this is better than a generic node workflow

A generic node workflow moves data between boxes. This organisation model should move work between responsible AI roles and keep an auditable trail of why each action happened.

## Required orchestrator components

### 1. Trigger layer

Supported triggers:

- Manual user command
- Routine schedule
- Comment on task
- Task blocker resolved
- Child tasks completed
- Future webhook input

### 2. Router layer

The router decides:

- Which project owns the work
- Which agent should handle it
- Which skill should be used
- Which output format is required
- Whether approval is needed

### 3. Execution layer

Execution happens through agents and skills, not random scripts.

### 4. Output layer

All important outputs must become reviewable files or artifacts.

### 5. Approval layer

No public publishing or paid external action should happen without explicit approval.

### 6. Learning layer

Every finished output should produce a small improvement note:

- what worked
- what was weak
- which template should improve
- what should be tried next

## MVP scope

The first version should handle:

- one user command
- one content pack
- one review flow
- one artifact pack
- one improvement note

## Final target

A daily workflow where the user can say:

```
CEO, create today's SINK DINK upload-ready media pack.
```

And the system prepares the full pack for manual upload.
