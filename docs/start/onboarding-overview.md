---
summary: "Overview of OpenClaw onboarding options and flows"
read_when:
  - Choosing an onboarding path
  - Setting up a new environment
title: "Onboarding overview"
sidebarTitle: "Onboarding Overview"
---

OpenClaw onboarding is a conversation with [Crestodian](/cli/crestodian),
OpenClaw's setup custodian. Whether you install from the website one-liner, npm,
or the macOS app, you land in the same chat: Crestodian detects AI access you
already have (a Claude Code or Codex login, or API keys), proposes a complete
setup, and applies it when you say **yes**. Inference is the only required
decision — workspace, Gateway, and background service use quickstart defaults.

## Which surface am I in?

|               | CLI onboarding                          | macOS app onboarding       |
| ------------- | --------------------------------------- | -------------------------- |
| **Platforms** | macOS, Linux, Windows (native or WSL2)  | macOS only                 |
| **Interface** | Crestodian chat in the terminal         | Crestodian chat in the app |
| **Command**   | `openclaw onboard` (or bare `openclaw`) | Launch the app             |

Automation and full manual control use the classic step wizard:
`openclaw onboard --classic` or `openclaw onboard --non-interactive ...`.

## What onboarding configures

Say **yes** to Crestodian's proposal and it sets up:

1. **Model provider** — reuses a detected Claude Code/Codex login or API key
   (switch anytime: `set default model <provider/model>`)
2. **Workspace** — directory for agent files, bootstrap templates, and memory
3. **Gateway** — quickstart defaults: loopback bind, token auth
4. **Daemon** — background service so the Gateway starts automatically (CLI)

Then, still in the conversation:

- **Channels** — say `connect discord`, `connect slack`, `connect telegram`,
  `connect whatsapp`, … (`channels` lists everything available)
- **Meet your agent** — say `talk to agent` to hand off to your agent's
  first-run bootstrap

## CLI onboarding

Run in any terminal:

```bash
openclaw onboard
```

Bare `openclaw` on a fresh machine opens the same conversation.

Classic step wizard: [Onboarding (CLI)](/start/wizard)
CLI command docs: [`openclaw onboard`](/cli/onboard)

## macOS app onboarding

Open the OpenClaw app. The first-run wizard walks you through the same steps
with a visual interface.

Full reference: [Onboarding (macOS App)](/start/onboarding)

## Custom or unlisted providers

If your provider is not listed in onboarding, choose **Custom Provider** and
enter:

- API compatibility mode (OpenAI-compatible, Anthropic-compatible, or auto-detect)
- Base URL and API key
- Model ID and optional alias

Multiple custom endpoints can coexist — each gets its own endpoint ID.

## Related

- [Getting started](/start/getting-started)
- [CLI setup reference](/start/wizard-cli-reference)
