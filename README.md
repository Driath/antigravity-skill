# antigravity-skill

A Claude Code skill that talks to Google Antigravity's AI models via the internal gRPC API.

## Install

```bash
# Clone with submodule
git clone --recursive https://github.com/Driath/antigravity-skill.git ~/.claude/skills/antigravity

# Install gagaclaw dependencies
cd ~/.claude/skills/antigravity/lib/gagaclaw && npm install --production
```

### Prerequisites

- [Google Antigravity](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/) must be running
- `bun` (recommended) or `node`

## What it does

From Claude Code, you can:
- **Ask Gemini** a question and get a response
- **Challenge** Claude's own responses by sending them to Gemini for review
- **Check quotas** across all available models
- **List workspaces** currently open in Antigravity

## Usage

```
/antigravity ask "your prompt"
/antigravity ask --model gemini-3-flash "your prompt"
/antigravity ask --workspace dotfiles "prompt"
/antigravity ask --agentic "read the code and audit it"
/antigravity challenge "text to review"
/antigravity models
/antigravity workspaces
/antigravity init
```

### Agent team support

The skill works with Claude Code agent teams. Define a subagent in `~/.claude/agents/gemini.md` that calls `run.js` via Bash — a Haiku-powered teammate becomes a zero-overhead bridge to Gemini.

## How it works

`run.js` injects auth tokens (discovered from local processes + Antigravity's state DB) into [gagaclaw](https://github.com/joeIvan2/gagaclaw)'s `core.js`, which handles streaming, polling, and response detection.

1. Reads `apiKey` from `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb`
2. Scans `language_server` processes for CSRF tokens and workspace IDs
3. Probes listening ports to find the gRPC endpoint
4. Creates a session via gagaclaw's `createExtraSession(auth)`
5. Sends prompt, receives response via streaming/polling

## Architecture

```
run.js              — Auth discovery + CLI, wraps gagaclaw
lib/gagaclaw/       — Git submodule, handles gRPC streaming/polling
SKILL.md            — Claude Code skill definition
```

## Credits

Built on [gagaclaw](https://github.com/joeIvan2/gagaclaw) by [@joeIvan2](https://github.com/joeIvan2) for the gRPC protocol reverse-engineering and streaming implementation.

## License

GPL v3
