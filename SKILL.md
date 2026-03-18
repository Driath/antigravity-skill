---
name: antigravity
description: "Talk to Gemini 3.1 Pro / Flash via Google Antigravity's internal gRPC API. Use when user says /antigravity, 'ask Gemini', 'challenge with Gemini', or wants a second opinion from another AI model."
user_invocable: true
---

# Antigravity — Gemini Bridge

Control Google Antigravity and talk to Gemini (or Claude/GPT) via the internal gRPC API.

## Setup check

Before running any command, verify the setup. Run this once:

```bash
ls ~/.agents/skills/antigravity/lib/gagaclaw/core.js 2>/dev/null && echo "OK" || echo "NEEDS_SETUP"
```

If `NEEDS_SETUP`, run these commands to initialize the submodule:
```bash
cd ~/.agents/skills/antigravity && git submodule update --init --recursive && cd lib/gagaclaw && npm install --production
```

If the skill directory is elsewhere (e.g. `~/.claude/skills/antigravity`), use that path instead.

## Runtime

Detect the runtime:

1. Check `bun --version` → `bun <skill-path>/run.js`
2. Else `node --version` → `node <skill-path>/run.js`
3. If neither → tell user: `curl -fsSL https://bun.sh/install | bash`

The skill path is wherever `run.js` lives (usually `~/.agents/skills/antigravity/` or `~/.claude/skills/antigravity/`).

Use the detected runtime + script path as `$AG` prefix for all commands below.

## Prerequisite

Google Antigravity must be running. If a command fails with "No Antigravity language servers found", the script will try to launch it automatically. If that fails, tell the user to open Antigravity manually.

## Commands

### `/antigravity ask <prompt>`
Send a prompt and get the response. Auto-selects the best model with remaining quota.
```bash
$AG ask "<prompt>"
```

With a specific model (use keys from `models` command):
```bash
$AG ask --model gemini-3-flash "<prompt>"
```

On a specific workspace:
```bash
$AG ask --workspace dotfiles "<prompt>"
```

With tool access (file read, etc.):
```bash
$AG ask --agentic "<prompt>"
```

### `/antigravity challenge`
Send your last substantive response for critical review:
```bash
$AG challenge "<your last response>"
```
Show the critique to the user.

### `/antigravity models`
List available models with quota status. Check this before choosing a model.
```bash
$AG models
```

### `/antigravity workspaces`
List active Antigravity workspaces:
```bash
$AG workspaces
```

### `/antigravity init` (optional)
Cache workspace tokens for faster subsequent calls.
```bash
$AG init
```

## Error handling

| Error | Fix |
|-------|-----|
| `Cannot find module 'gagaclaw/core'` | Run setup: `cd <skill-path> && git submodule update --init --recursive && cd lib/gagaclaw && npm install --production` |
| `No apiKey found` | Open Antigravity and log in with your Google account |
| `No Antigravity language servers found` | Open Antigravity (the script tries to auto-launch) |
| `No gRPC port for workspace` | Run `/antigravity init` to refresh discovery |
| `timeout` | Model may be overloaded, try `--model` with a different model |

## Model selection guide

Check quotas first with `models`, then pick based on task complexity and available quota. The script auto-selects the first model with remaining quota when no `--model` is specified.

## Notes
- No CDP or remote-debugging-port needed — talks directly to the language server gRPC API
- Auto-discovers workspaces, ports, and CSRF tokens from running processes
- Uses [gagaclaw](https://github.com/joeIvan2/gagaclaw) as submodule for streaming/polling
