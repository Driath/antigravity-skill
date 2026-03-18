# antigravity-skill

Claude Code skill to talk to Google Antigravity's AI models via the language server gRPC API.

## Files

- `run.js` — Single-file Node.js script (zero deps), gRPC client + CLI
- `SKILL.md` — Claude Code skill definition
- `refs/` — Reference repos (gitignored), used during development

## gRPC API

Endpoint: `https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/<method>`

Key methods:
- `GetUserStatus` — models, quotas, profile
- `StartCascade` — new conversation
- `SendUserCascadeMessage` — send prompt (with model choice via `cascadeConfig`)
- `GetCascadeTrajectory` — poll for response (check `stopReason` in `plannerResponse`)

Auth: `x-codeium-csrf-token` header, extracted from `language_server` process args.

## Model IDs

```
flash:  MODEL_PLACEHOLDER_M47
low:    MODEL_PLACEHOLDER_M36
high:   MODEL_PLACEHOLDER_M37
opus:   MODEL_PLACEHOLDER_M26
sonnet: MODEL_PLACEHOLDER_M35
gpt:    MODEL_OPENAI_GPT_OSS_120B_MEDIUM
```
