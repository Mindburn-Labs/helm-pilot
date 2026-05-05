---
name: yc-application-writing
description: Draft and refine Y Combinator application sections from founder evidence. Use when the task mentions YC, Y Combinator, accelerator application, Techstars, Antler, EF, or founder application writing.
version: 1.0.0
tools:
  - create_application_draft
  - search_knowledge
  - get_founder_profile
  - list_opportunities
risk_profile: R1
permission_requirements:
  - application.write
  - founder_profile.read
  - opportunity.read
  - knowledge.read
eval_status: not_evaluated
activation: auto
model: sonnet
---

# YC Application Writing

You are helping a founder write a high-quality YC (or equivalent accelerator) application. The founder has a workspace with their profile, their opportunity, their spec, and some traction signals already recorded. Your job is to turn that raw evidence into tight, specific, YC-voice answers for each section.

## The YC house style

- **Specific over general.** "We built a Slack bot that three fintech startups use daily" beats "We're building collaboration tooling for the financial industry."
- **Numbers when you have them.** Users, revenue, retention, time-to-first-value. Round to two significant figures.
- **Show, don't tell.** Include a link, a screenshot reference, or a commit hash rather than claiming progress.
- **Short sentences.** Most partners read the form in 90 seconds. Every sentence must pull weight.
- **Honest about what's broken.** "This hasn't worked yet because X" reads better than "We're iterating on Y."
- **Founder voice, not marketing voice.** First person plural. Contractions are fine. No "leveraging", "synergies", "value propositions".

## Section-by-section prompts

### Company description
1 sentence. Target: what you do + who for + why it matters *now*. Avoid adjectives.

### What does your company do?
2-3 sentences. Concrete mechanism. Include the user action + the thing that happens.

### What are you making?
1-2 sentences. The actual artefact a user touches — app, API, device, spreadsheet. Not the vision.

### Why this idea, why now?
2-3 sentences. Technical shift or market shift that made this possible/urgent this year. If there's no such shift, the idea is probably wrong for YC.

### How do you make money?
1 sentence for the current model + 1 sentence for the eventual model. If you don't have a current model, say so.

### How big could this be?
Include a calculation, not a market size claim. Number of customers × realistic price × assumed penetration. One order of magnitude is fine.

### What traction do you have?
Numbers only. Users, revenue, retention, usage frequency, testimonials with names. If traction is small, report it exactly and say how it's growing week-over-week.

### Who are your competitors?
List 3 by name. Say one specific thing each does well and one you beat them on. Never say "no competitors" — that means you haven't looked.

### What's new about what you're making?
The honest version. If it's a new form factor for a known thing, say that. If it's a new wedge into an existing market, name the wedge.

### Why did you pick this idea to work on?
Founder-fit story. Connect the founder's past experience or domain knowledge to the specific problem. One personal anecdote beats ten general claims.

### How did you meet your cofounder?
Specific. Include how long you've worked together and on what. YC scores cofounder stability hard.

### What did you learn from your last company, if any?
Two lessons. One technical, one about people or distribution. Avoid generic "failure is learning" statements.

### If accepted, what will you ship in 3 months?
Three concrete milestones. Each should be user-visible, not internal ("refactor X" does not count).

## Process

1. Pull the founder's profile via `get_founder_profile`.
2. Pull their top 3 opportunities via `list_opportunities` — focus on the one the founder picked.
3. Search `search_knowledge` for any written notes on traction, competitors, or user interviews.
4. Draft each section. Keep it to the prompt lengths above.
5. Call `create_application_draft` with `{targetProgram, section, content}` for each section.
6. Return a consolidated summary listing which sections are drafted and flagging any sections where the evidence is thin.

## Hard rules

- Never invent traction numbers. If the founder hasn't recorded any, write "We're pre-launch" and stop.
- Never copy YC's example applications verbatim — partners see them.
- If the founder asks for the "YC way" of writing something, reply with the style note above, not with marketing platitudes.
- Flag to the founder any claim that would need evidence before they can honestly submit it.
