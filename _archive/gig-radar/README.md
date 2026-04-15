# gig-radar 🎯

An OpenClaw skill that hunts for paid freelance gigs across Reddit r/forhire, the Hacker News monthly hiring thread, Algora bounties, and GitHub bounty-labeled issues. Scores by budget × urgency × skill-fit × AI-friendliness. Drafts personalized pitches. Sends top leads to Telegram for one-tap human approval.

**Built for vibe-coders + indie hackers + solo founders** — not for "Senior X Engineer" applicants. The scoring rules disqualify leads requiring deep stack expertise the operator can't credibly deliver, and downscores buyers who'd be unhappy if they discovered AI assistance was used.

## Why this exists

Manually hunting freelance gigs across 5 sources every day is a 2-hour-a-day chore. Most of the time you find nothing. Occasionally you find one $1-3k gig and it pays for the week. The bottleneck isn't writing pitches — it's TIME spent reading low-signal posts.

`gig-radar` runs every 30 minutes via cron. When it finds a high-scoring lead, it pings your Telegram with the post + a draft pitch. You read it in 30 seconds, edit in 1 minute, send in another 30 seconds. The skill turns a 2-hour daily chore into a 2-minute decision flow.

It's intentionally **human-in-the-loop**. Auto-sending pitches gets you banned and burns leads. The skill finds + drafts; you approve + send.

## Install

```bash
# 1. Clone or copy the skill into your OpenClaw workspace
mkdir -p ~/.openclaw/workspace/skills/
cp -r /path/to/gig-radar ~/.openclaw/workspace/skills/

# 2. Initialize state directory
mkdir -p ~/.openclaw/skills-state/gig-radar
cp ~/.openclaw/workspace/skills/gig-radar/profile.yaml ~/.openclaw/skills-state/gig-radar/profile.yaml

# 3. Edit your profile (skills, rates, voice)
nano ~/.openclaw/skills-state/gig-radar/profile.yaml

# 4. Set up Telegram bot via @BotFather, get bot token + your chat ID
# (no phone needed if you have an existing Telegram account — use Telegram web)

# 5. Configure OpenClaw with the Telegram bot token
openclaw config set telegram.botToken <your-token>

# 6. Test interactively (will print leads to stdout, no Telegram)
openclaw skill run gig-radar --dry-run

# 7. Test sending to Telegram
openclaw skill run gig-radar --notify-channel <your-chat-id>

# 8. Schedule via cron (every 30 minutes)
crontab -e
# add:
*/30 * * * * openclaw skill run gig-radar --cron --notify-channel <your-chat-id> >> ~/.openclaw/logs/gig-radar.log 2>&1
```

## Configuration

All operator-specific configuration lives in `~/.openclaw/skills-state/gig-radar/profile.yaml`. Edit this file to:

- Tune your skill keywords (used for fit-scoring)
- Set red_skills that should disqualify leads
- Set your hourly rate, fixed price range, preferred billing
- Customize the pitch voice (tone, style, length preferences)
- Enable/disable the AI-friendliness filter

The skill keeps a dedup cache at `~/.openclaw/skills-state/gig-radar/seen.json`. Entries older than 30 days are auto-evicted.

## Sources

| Source | Auth required? | Notes |
|---|---|---|
| Reddit `/r/forhire` JSON | No | User-Agent header required to avoid Cloudflare 403 |
| HN monthly "Who is hiring?" thread | No | Auto-discovers latest thread via Algolia date search |
| Algora bounties | No | Public TRPC endpoint; falls back to HTML scrape if it changes |
| GitHub bounty-labeled issues | Optional (for higher rate limit) | Searches `label:"💰 Bounty" is:open` sorted by created-desc |

Adding more sources is straightforward: add a new section to Phase 4 in `SKILL.md` with a `curl | jq` pipeline that emits the same normalized lead JSON shape.

## Scoring

Leads are scored 0-100 across 4 dimensions:

| Dimension | Max points | Notes |
|---|---|---|
| Budget | 40 | Parsed from title/body; ≥$5k or ≥$200/hr = max |
| Skill fit | 30 | Keyword overlap with profile.skills; -50 hard penalty for any red_skill match |
| Recency | 15 | <6h = max; >72h = 0 |
| AI-friendliness | 15 | Green signals (claude, cursor, mvp, ai-native, etc.) +3 each; red signals (principal, 10+ years, no ai, etc.) -5 each |

Default minimum score to send: 60. Tune via `--min-score`.

## Roadmap

Pro version (sold separately as a $99 lifetime founders deal on Gumroad):

- More sources (Indie Hackers help threads, Twitter advanced search via nitter, Upwork RSS, Codementor, Replit Bounties, Gitcoin)
- LLM-assisted scoring (replace keyword-match with embedding similarity)
- Inline Telegram approve/edit/skip buttons (uses Telegram inline keyboards)
- Per-lead deep-dive: agent visits the link, scrapes contact info, suggests delivery channel
- Multi-operator profiles (run multiple gig-radar instances with different filters)
- Lead history / pipeline view (which leads got replies, which closed, lifetime $$ tracker)

## License

MIT

## Built by

[Ivan] — vibe-coder, indie hacker, EU. If you want help setting this up, DM me — I offer a $199 done-for-you OpenClaw + gig-radar install service.
