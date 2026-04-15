"""
Telegram Bot API sender.
Sends one message per lead to the configured chat, with Markdown formatting.
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error, time
from datetime import datetime, timezone


def format_relative_time(iso_ts: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_ts.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        hours = delta.total_seconds() / 3600
        if hours < 1:
            return f"{int(delta.total_seconds() / 60)}m ago"
        if hours < 24:
            return f"{int(hours)}h ago"
        return f"{int(hours / 24)}d ago"
    except Exception:
        return iso_ts or '?'


def escape_md_v2(text: str) -> str:
    """Escape Telegram MarkdownV2 special chars."""
    if not text:
        return ''
    chars = r'_*[]()~`>#+-=|{}.!\\'
    for c in chars:
        text = text.replace(c, '\\' + c)
    return text


def build_lead_message(lead: dict) -> str:
    llm = lead.get('llm', {})
    score = llm.get('score', 0)
    shape = llm.get('employment_shape', '?')
    budget_usd = llm.get('real_budget_usd')
    budget_kind = llm.get('budget_kind', '?')
    posted_rel = format_relative_time(lead.get('posted_at', ''))
    source = lead.get('source', '?')
    title = (lead.get('title', '') or '')[:160]
    url = lead.get('url', '')
    reasoning = llm.get('fit_reasoning', '')
    concerns = llm.get('concerns', '')
    draft = lead.get('draft', '') or '_(no draft — would_pitch=false)_'

    budget_str = f"${budget_usd}" if budget_usd else "?"

    # Use plain text (not MarkdownV2) to avoid escaping headaches
    category = llm.get('category', '?')
    delivery_mode = llm.get('delivery_mode', '?')
    mode_emoji = "🔨" if delivery_mode == "personal" else "🤝"

    msg = f"""🎯 NEW GIG — score {score}/100
{mode_emoji} {category} | {delivery_mode} | {shape}
💰 {budget_str} {budget_kind}
📅 {posted_rel}  📍 {source}

📌 {title}

🔗 {url}

🧠 Why: {reasoning}
⚠️  Concerns: {concerns}

📝 Draft pitch:
{draft}

Reply:
  ✅ to mark approved & sent
  ✏️ <new draft> to revise
  ❌ to skip"""
    return msg


def send_telegram(bot_token: str, chat_id: str, text: str, parse_mode: str | None = None) -> dict:
    """Send a single message. Returns the Telegram API response."""
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text[:4096],   # Telegram message length cap
        "disable_web_page_preview": False,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        return {"ok": False, "error_code": e.code, "description": body}
    except Exception as e:
        return {"ok": False, "description": str(e)}


def send_leads(leads: list, bot_token: str, chat_id: str, dry_run: bool = False) -> int:
    sent = 0
    for L in leads:
        msg = build_lead_message(L)
        if dry_run or not bot_token or not chat_id:
            print("=" * 60)
            print(msg)
            print()
            sent += 1
            continue
        resp = send_telegram(bot_token, chat_id, msg)
        if resp.get('ok'):
            print(f"[telegram] sent lead {L.get('post_id')} (score {L.get('llm',{}).get('score')})", file=sys.stderr)
            sent += 1
        else:
            print(f"[telegram] FAILED to send {L.get('post_id')}: {resp.get('description','?')}", file=sys.stderr)
        time.sleep(0.35)  # rate limit friendly
    return sent
