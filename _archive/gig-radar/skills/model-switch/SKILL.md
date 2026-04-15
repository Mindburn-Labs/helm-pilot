---
name: model-switch
description: "Live-list, inspect, and switch the OpenClaw agent's primary LLM. Models are fetched live from the OpenRouter API so new releases are available immediately. Usage: /model current | /model list [filter] | /model set <id> | /model fallbacks <id1,id2,id3>"
user-invocable: true
metadata:
  {
    "openclaw":
      {
        "emoji": "🔄",
        "requires": { "bins": ["curl", "jq"] },
        "primaryEnv": "OPENROUTER_API_KEY",
      },
  }
---

# model-switch — Live OpenRouter Model Manager

You manage the agent's primary LLM model. The user can list available models, inspect any one, switch the primary model, or update the fallback chain — all from Telegram or CLI. Models are fetched LIVE from `https://openrouter.ai/api/v1/models` so the latest releases are always available without restarting OpenClaw.

**Hard rules:**
- NEVER set the primary model without user confirmation if the chosen model has cost > $5/1M output tokens. Warn first.
- NEVER overwrite the fallback chain unless explicitly told to.
- ALWAYS show the current model + cost after a successful switch.
- The OpenClaw config file lives at `~/.openclaw/openclaw.json` (or `${OPENCLAW_CONFIG_PATH}` if set). After editing, the gateway must be restarted for the change to take effect.

---

## Phase 1 — Parse the subcommand

The user input after `/model` (or natural language: "switch to sonnet", "what model are we on", "list free models", etc.) maps to one of:

| Subcommand | Example invocations |
|---|---|
| `current` | `/model current`, `/model`, "what model are we using", "current model" |
| `list [filter]` | `/model list`, `/model list claude`, `/model list :free`, "show me free models", "list claude models" |
| `set <id>` | `/model set anthropic/claude-sonnet-4-6`, "switch to sonnet 4.6", "use opus", "default to gpt-oss" |
| `fallbacks <id1,id2,...>` | `/model fallbacks openai/gpt-oss-120b:free,google/gemma-4-31b-it:free` |

If the input is ambiguous or doesn't fit, ask the user to be specific. Map natural-language alias requests to the canonical OpenRouter model ID (e.g. "haiku" → `anthropic/claude-haiku-4-5`, "sonnet" → `anthropic/claude-sonnet-4-6`, "opus" → `anthropic/claude-opus-4-6`). If you can't resolve the alias confidently, run `list <alias>` and ask which one.

---

## Phase 2 — Resolve the config path

```bash
CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/openclaw.json}"
```

If the file doesn't exist, abort with: "OpenClaw config not found at $CONFIG_PATH — is OpenClaw installed?"

---

## Phase 3 — Subcommand: `current`

Read the config and report:

```bash
jq -r '
  "Current model: \(.agents.defaults.model.primary // "NOT SET")",
  "Fallbacks: \([(.agents.defaults.model.fallbacks // [])[]] | join(", ") // "(none)")"
' "$CONFIG_PATH"
```

Format the response for Telegram:

```
🔄 Current LLM model

Primary:    {primary}
Fallbacks:  {fallback_list, comma-separated, or "(none)")}
Config:     {CONFIG_PATH}
```

Done. Exit.

---

## Phase 4 — Subcommand: `list [filter]`

Live-fetch the OpenRouter model catalog:

```bash
RAW=$(curl -s --max-time 15 "https://openrouter.ai/api/v1/models")
```

Parse and filter. The filter is case-insensitive substring match against the model `id`. Special filters:
- `:free` → only free models (`id` ends with `:free`)
- `claude` → only Claude family
- `gpt` → only GPT family
- (empty) → top 20 by parameter count or popularity

```bash
FILTER="${1:-}"
echo "$RAW" | jq -c --arg f "$FILTER" '
  .data
  | map(select($f == "" or (.id | test($f; "i"))))
  | map({
      id: .id,
      ctx: .context_length,
      tools: ((.supported_parameters // []) | index("tools") != null),
      in_price: (.pricing.prompt // "0"),
      out_price: (.pricing.completion // "0"),
      modality: .architecture.modality
    })
  | sort_by(-(.ctx // 0))
  | .[0:20]
'
```

Pretty-print as a Telegram message:

```
🔍 OpenRouter models matching "{filter}"

  • anthropic/claude-haiku-4-5     ctx=200k  tools=✓  $0.80/$4.00 per 1M  (current)
  • anthropic/claude-sonnet-4-6    ctx=200k  tools=✓  $3.00/$15.00 per 1M
  • anthropic/claude-opus-4-6      ctx=200k  tools=✓  $15.00/$75.00 per 1M
  • openai/gpt-oss-120b:free       ctx=128k  tools=✓  FREE
  ...

Run `/model set <id>` to switch.
```

Mark the currently active model with `(current)`. Convert prices from per-token to per-1M for readability. Use `FREE` if the price is `"0"` or `"free"`.

If filter returns 0 results, suggest 3 fuzzy alternatives.

---

## Phase 5 — Subcommand: `set <id>`

### 5.1 Validate the model ID

Fetch the model catalog and confirm the ID exists:

```bash
NEW_ID="$1"
EXISTS=$(curl -s --max-time 15 "https://openrouter.ai/api/v1/models" \
  | jq --arg id "$NEW_ID" '.data | map(.id == $id) | any')
if [ "$EXISTS" != "true" ]; then
  echo "❌ Model '$NEW_ID' not found in OpenRouter catalog. Run /model list <part-of-name> to find the right ID."
  exit 1
fi
```

### 5.2 Cost guardrail

Look up the price. If the output cost is > $5 per 1M tokens, ask for explicit confirmation BEFORE writing the config:

```bash
OUT_PRICE=$(curl -s "https://openrouter.ai/api/v1/models" \
  | jq -r --arg id "$NEW_ID" '.data[] | select(.id == $id) | (.pricing.completion // "0")')
PRICE_PER_M=$(echo "$OUT_PRICE * 1000000" | bc -l 2>/dev/null || python3 -c "print(float('$OUT_PRICE') * 1_000_000)")
if [ "$(echo "$PRICE_PER_M > 5" | bc -l 2>/dev/null)" = "1" ]; then
  echo "⚠️  $NEW_ID costs \$${PRICE_PER_M} per 1M output tokens. Send '/model set $NEW_ID --confirm' to proceed."
  exit 0
fi
```

### 5.3 Write the new model to config (atomic)

```bash
TMP="$(mktemp)"
jq --arg id "$NEW_ID" '.agents.defaults.model.primary = $id' "$CONFIG_PATH" > "$TMP" \
  && mv "$TMP" "$CONFIG_PATH"
```

### 5.4 Restart the gateway so the new model takes effect

```bash
# Hot restart — kill the gateway process and re-launch
pkill -9 -f openclaw-gateway || true
sleep 1
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
```

Wait 5 seconds for the gateway to come back, then verify:

```bash
sleep 5
openclaw channels status 2>&1 | head -5
ACTIVE=$(jq -r '.agents.defaults.model.primary' "$CONFIG_PATH")
```

### 5.5 Report

```
✅ Switched primary model to {NEW_ID}
   Cost: ${in_price}/${out_price} per 1M tokens
   Fallbacks unchanged: {fallbacks}
   Gateway restarted (5s downtime)
   Active model verified: {ACTIVE}
```

If the gateway fails to restart, report the error from `/tmp/openclaw-gateway.log` and suggest manual restart.

---

## Phase 6 — Subcommand: `fallbacks <id1,id2,id3>`

Same validation flow as `set`, but for the fallback array. Each ID is validated against the OpenRouter catalog. The user provides a comma-separated list:

```bash
FALLBACKS_CSV="$1"
# Convert to JSON array
FB_JSON=$(echo "$FALLBACKS_CSV" | jq -R -c 'split(",") | map(gsub("^\\s+|\\s+$"; ""))')
```

Validate each:

```bash
echo "$FB_JSON" | jq -c '.[]' | while read -r fb; do
  fb_clean=$(echo "$fb" | tr -d '"')
  EXISTS=$(curl -s "https://openrouter.ai/api/v1/models" \
    | jq --arg id "$fb_clean" '.data | map(.id == $id) | any')
  if [ "$EXISTS" != "true" ]; then
    echo "❌ Fallback '$fb_clean' not in catalog. Aborting."
    exit 1
  fi
done
```

Write the new fallback chain:

```bash
TMP="$(mktemp)"
jq --argjson fb "$FB_JSON" '.agents.defaults.model.fallbacks = $fb' "$CONFIG_PATH" > "$TMP" \
  && mv "$TMP" "$CONFIG_PATH"
```

Restart gateway (same as 5.4). Report the new chain.

---

## Phase 7 — Error handling

- If `OPENROUTER_API_KEY` is not in env, the catalog fetch still works (it's a public endpoint), but warn the user that switching to a paid model won't work without the key set in the OpenClaw config's `env.OPENROUTER_API_KEY`.
- If `jq` is not installed, abort with an install hint.
- If the gateway fails to come back after restart, dump the last 30 lines of the gateway log.
- If the user requests an invalid subcommand, print usage from the description field.

---

## Notes

- The OpenClaw `agents.defaults.model.primary` field is THE field that determines which model the agent uses for inference. Changing it + restarting is sufficient.
- Some providers (gpt-oss, o1, deepseek-reasoner) burn reasoning tokens before output. The agent should handle these via `reasoning.effort: low` if set, but cost can still spike. Warn the user when they switch to a known reasoning model.
- New OpenRouter models appear daily — this skill ALWAYS shows the current catalog without needing OpenClaw upgrades.
- Free models (`:free` suffix) share a global rate limit pool — multiple free models can be rate-limited simultaneously. Keep at least one paid Claude in the fallback chain for reliability.
