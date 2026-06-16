# Agent Roles and Handoff Rules

## Core Rule
Every agent must produce output in the format needed by the next agent. No isolated answers.

## Agents

### CEO Agent
Purpose: Orchestrates daily work, assigns tasks, requests approval, and presents final output.

Output: CEO Daily Report with status, blockers, approvals needed, final pack links.

### Organisation Builder Agent
Purpose: Builds and improves the organisation itself.

Tasks:
- propose new agents
- propose new skills
- test API routes
- diagnose errors
- propose architecture improvements
- update memory after approval

Rule: Must not apply major changes without human approval.

### Trend Research Agent
Purpose: Find current content opportunities, trends, questions, and social patterns.

Output to Strategy Agent:
- trend summary
- audience pain
- competitor clue
- suggested angle
- risk note

### Audience Psychology Agent
Purpose: Understand why the audience will share, save, comment, or relate.

Output to Strategy Agent:
- emotional trigger
- social pressure
- comment bait question
- share/save reason

### Competitor Study Agent
Purpose: Study top page formats and convert lessons into original formats.

Output:
- format pattern
- hook pattern
- visual style clue
- originality warning

### Strategy Agent
Purpose: Choose content angle and map to content pillar.

Output to Hook/Script Agent:
- topic
- pillar
- angle
- target emotion
- key message
- blocked direction

### Hook and Script Agent
Purpose: Create hook, reel script, carousel copy, and voiceover base.

Output to Media Direction Agent:
- hook
- scene script
- voiceover
- overlay text
- CTA

### Media Direction Agent
Purpose: Convert script into visual scenes and media render instructions.

Output to Media Worker:
- scene list
- visual style
- overlay text
- duration
- audio mood
- cover text

### Audio/Voice Agent
Purpose: Prepare voiceover and sound direction.

Output:
- voiceover script
- voice tone
- pacing
- pronunciation notes

### Remote Media Worker
Purpose: Render actual media files.

Output:
- final_reel.mp4
- cover image
- voiceover.wav
- subtitles
- media_pack.json

### Caption and Hashtag Agent
Purpose: Create upload-ready caption and hashtags.

Output:
- caption.txt
- hashtags.txt
- pinned comment suggestion

### QA / Brand Safety Agent
Purpose: Reject wrong outputs and approve safe media packs.

Checks:
- brand fit
- SINK/DINK no-kids signal
- parenting/kids drift
- anti-family tone
- copyright risk
- upload readiness

### Growth Analytics Agent
Purpose: Convert performance data into improvement actions.

Output:
- repeat format
- stop format
- hook lessons
- topic lessons

### Memory / Self-Improvement Agent
Purpose: Store learnings and make the next run better.

Output:
- learning_note.md
- error_log.md
- improvement recommendation

## Handoff Format
Every agent handoff must include:

- Task ID
- Input summary
- Output produced
- Next agent
- Risk note
- Approval requirement
