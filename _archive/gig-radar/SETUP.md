# gig-radar — 10-minute setup guide

You need three things: an **OpenRouter API key** (free), a **Telegram bot token** (free), and a **Telegram chat ID** (your own).

---

## 1. OpenRouter API key (2 min)

OpenRouter has a free tier with function-calling-capable models. `gpt-oss-120b` is the default and works well for scoring + drafting.

1. Go to https://openrouter.ai and sign up (email or GitHub login, no card required for the free tier)
2. Go to https://openrouter.ai/keys and create a new API key
3. Name it `gig-radar` and copy the `sk-or-v1-...` value

---

## 2. Telegram bot via @BotFather (3 min)

You can do this entirely via https://web.telegram.org/ — no phone needed if you have an existing Telegram account.

1. Open Telegram web → search for **@BotFather**
2. Send `/newbot`
3. Pick a display name (e.g. "Gig Radar Bot")
4. Pick a username ending in `bot` (e.g. `ivan_gig_radar_bot`) — must be globally unique
5. @BotFather replies with a token that looks like `123456789:ABCdefGhIJklmNoPQRsTUVwxyZ`
6. **Copy the token** — that's `TELEGRAM_BOT_TOKEN`

---

## 3. Your Telegram chat ID (2 min)

The bot can only send messages to chats it knows about. To get YOUR personal chat ID:

1. In Telegram, search for your new bot by its username
2. Click "Start" and send it any message (e.g. `hi`)
3. Open in your browser: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   (replace `<YOUR_BOT_TOKEN>` with the token from step 2)
4. Look for `"chat":{"id":123456789,...}` — that number is your `TELEGRAM_CHAT_ID`
5. Copy it

(Alternative: message **@userinfobot** on Telegram — it replies with your user ID, which works as a chat ID for DMs from your own bot.)

---

## 4. Set environment variables

In the `gig-radar/` directory, create a file called `.env`:

```bash
cd "~/Code/projects/HELM Pilot/gig-radar"
cat > .env <<'EOF'
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJklmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=123456789
GIG_RADAR_MODEL=openai/gpt-oss-120b
GIG_RADAR_STATE_DIR=~/.gig-radar
EOF
chmod 600 .env
```

Then source it when you run the script:

```bash
set -a; source .env; set +a
```

(Or use `direnv` if you have it installed — just `direnv allow` after creating `.envrc` with the same contents.)

---

## 5. First test run — dry run, no Telegram send

This runs the full pipeline but prints Telegram messages to stdout instead of sending. No real delivery yet, so it's safe.

```bash
cd "~/Code/projects/HELM Pilot/gig-radar"
set -a; source .env; set +a
python3 run.py --dry-run --limit 3
```

Expected output: fetch → sanitize → dedupe → prefilter → shortlist → LLM scoring → 3 lead cards printed to stdout with scores + draft pitches.

If you see `[llm] OPENROUTER_API_KEY not set`, your env vars didn't load. Re-run the `source .env` step.

If the LLM call fails with HTTP 401, the OpenRouter key is wrong.

If you see stats but no leads, either there weren't enough high-score leads this run, or the shortlist was empty. Try `--skip-llm` + lower `--min-score`:

```bash
python3 run.py --skip-llm --min-score 30 --dry-run --limit 5
```

---

## 6. First real send

Once the dry run works, drop the `--dry-run` flag:

```bash
python3 run.py --limit 3
```

Check Telegram — you should see up to 3 message cards from your bot, each with a lead + draft pitch.

---

## 7. Run it every 30 minutes via cron

Once you're happy with the output, schedule it. Open your crontab:

```bash
crontab -e
```

Add this line (adjust the path):

```cron
*/30 * * * * cd "$HOME/Code/projects/HELM Pilot/gig-radar" && set -a && . ./.env && set +a && python3 run.py --cron --limit 3 >> ~/.gig-radar/logs/run.log 2>&1
```

This runs every 30 minutes, silent unless leads were sent. Logs go to `~/.gig-radar/logs/run.log`.

Verify it's working:

```bash
tail -f ~/.gig-radar/logs/run.log
```

---

## 8. Tuning

All the dials are in `profile.yaml` and on the CLI:

- **Too many noisy leads?** Raise `--min-score` (default 70). Try 80 or 85.
- **Not enough leads?** Lower `--min-score` to 60.
- **Want faster feedback while tuning?** Use `--prefilter-only` to skip LLM scoring entirely and see what the cheap filter produces.
- **Hit OpenRouter rate limits?** Switch `GIG_RADAR_MODEL=openrouter/free` (smart router that picks any free tool-calling model).
- **Want to add a new source?** Edit `sources.yaml` — append an entry under `sources:`. Or run `python3 run.py --discover` once we build that feature.
- **Profile edits:** tweak `profile.yaml` to adjust your skill list, red_skills (stacks to disqualify), pitch voice, and rate range.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `[llm] HTTPError 401` | OpenRouter key invalid. Regenerate at openrouter.ai/keys. |
| `[llm] HTTPError 429` | Rate limited. Wait 1 minute, or switch to `openrouter/free` model. |
| `[telegram] FAILED ... chat not found` | Bot can't message you until you send it at least one message first. Open the bot in Telegram, hit Start, send any message, retry. |
| `[fetch_all] reddit_forhire: curl failed` | Reddit is rate-limiting your User-Agent. Change it in `fetchers/fetch_all.sh`. |
| No leads ever sent | Your `--min-score` might be too high for the current market day. Drop to 60 and see. |
| Prefilter drops everything | Check `profile.yaml` red_skills — they may be matching too aggressively. |
| Too many duplicate messages | Check `~/.gig-radar/seen.json` exists and is writable. If not, the dedup cache isn't persisting. |

---

## 10. What happens next

Once this is humming, the same codebase becomes three revenue layers:

1. **Your gigs** — pitch every lead that hits your Telegram. Close 1-2 = $5k.
2. **Sell the skill** — package `SKILL.md` + `sources.yaml` + `profile.yaml` as a $99 lifetime deal on Gumroad. Publish a free teaser version to ClawHub.
3. **Done-for-you setup** — charge $199-$499 to install + configure this on other freelancers' machines.

See `/Users/ivan/.claude/plans/quirky-orbiting-pancake.md` for the full plan.
