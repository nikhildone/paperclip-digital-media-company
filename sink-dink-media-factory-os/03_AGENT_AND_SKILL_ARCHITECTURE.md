# Agent and Skill Architecture

## Main Agents
1. CEO Agent
2. Research Agent
3. Trend Intelligence Agent
4. Content Strategy Agent
5. Script Writing Agent
6. Carousel Writing Agent
7. Design Brief Agent
8. Media Rendering Agent
9. QA Agent
10. Artifact Packaging Agent
11. Analytics Agent
12. System Improvement Agent
13. Connector and Automation Agent

## Core Skill Packs
- sink-dink-research
- sink-dink-trend-intelligence
- sink-dink-content-strategy
- sink-dink-hook-writing
- sink-dink-reel-script-writing
- sink-dink-carousel-writing
- sink-dink-caption-hashtag-writing
- sink-dink-design-brief
- sink-dink-media-rendering
- sink-dink-qa-review
- sink-dink-artifact-packaging
- sink-dink-self-learning
- sink-dink-automation-orchestrator

## Agent Handoff Rule
Every agent output must be formatted for the next agent.

Example:
Research Agent output should become Strategy Agent input.
Strategy Agent output should become Content Agent input.
Content Agent output should become Media Rendering Agent input.
Media Rendering output should become QA Agent input.
QA output should become Artifact Packaging input.

## Permission Rules
Agents may create drafts, internal documents, subtasks, and artifact drafts.
Agents must not publish content, spend money, expose secrets, or change system settings without approval.

## Human Role
The human reviews final packs and manually uploads to platforms.
