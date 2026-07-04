---
summary: "CLI reference and security model for Crestodian, the configless-safe setup and repair helper"
read_when:
  - You run openclaw with no command after setup and want to understand Crestodian
  - You need a configless-safe way to inspect or repair OpenClaw
  - You are designing or enabling message-channel rescue mode
title: "Crestodian"
---

# `openclaw crestodian`

Crestodian is OpenClaw's local setup, repair, and configuration helper. It is
designed to stay reachable when the normal agent path is broken — and it is the
default onboarding: on a fresh install, `openclaw onboard` (and bare
`openclaw`) opens the Crestodian conversation with a first-run proposal, so
saying **yes** configures everything. The macOS app onboarding drives the same
conversation through the gateway `crestodian.chat` method.

After a config file has authored settings, running `openclaw` with no command
opens the agent TUI, and `openclaw crestodian` starts the helper explicitly
(also when the config is broken).

## What Crestodian shows

On startup, interactive Crestodian opens the same TUI shell used by
`openclaw tui`, with a Crestodian chat backend. The chat log starts with a short
greeting:

- when to start Crestodian
- the model or deterministic planner path Crestodian is actually using
- config validity and the default agent
- Gateway reachability from the first startup probe
- the next debug action Crestodian can take

It does not dump secrets or load plugin CLI commands just to start. The TUI
still provides the normal header, chat log, status line, footer, autocomplete,
and editor controls.

Use `status` for the detailed inventory with config path, docs/source paths,
local CLI probes, API-key presence, agents, model, and Gateway details.

Crestodian uses the same OpenClaw reference discovery as regular agents. In a Git checkout,
it points itself at local `docs/` and the local source tree. In an npm package install, it
uses the bundled package docs and links to
[https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw), with explicit
guidance to review source whenever the docs are not enough.

## Examples

```bash
openclaw
openclaw crestodian
openclaw crestodian --json
openclaw crestodian --message "models"
openclaw crestodian --message "validate config"
openclaw crestodian --message "setup workspace ~/Projects/work model openai/gpt-5.5" --yes
openclaw crestodian --message "set default model openai/gpt-5.5" --yes
openclaw onboard --modern
```

Inside the Crestodian TUI:

```text
status
health
doctor
doctor fix
validate config
setup
setup workspace ~/Projects/work model openai/gpt-5.5
channels
connect telegram
config get gateway.auth
config schema channels.telegram
config set gateway.port 19001
config set-ref gateway.auth.token env OPENCLAW_GATEWAY_TOKEN
gateway status
restart gateway
agents
create agent work workspace ~/Projects/work
models
set default model openai/gpt-5.5
plugins list
plugins search slack
plugin install clawhub:openclaw-codex-app-server
plugin uninstall openclaw-codex-app-server
talk to work agent
talk to agent for ~/Projects/work
audit
quit
```

## Safe startup

Crestodian's startup path is deliberately small. It can run when:

- `openclaw.json` is missing
- `openclaw.json` is invalid
- the Gateway is down
- plugin command registration is unavailable
- no agent has been configured yet

`openclaw --help` and `openclaw --version` still use the normal fast paths.
Noninteractive bare `openclaw` exits with a short message instead of printing
root help. On a fresh install, the message points to non-interactive onboarding;
after setup, it points to one-shot Crestodian commands.

## Operations and approval

Crestodian uses typed operations instead of editing config ad hoc.

Read-only operations can run immediately:

- show overview
- list agents
- list installed plugins
- search ClawHub plugins
- show model/backend status
- run status or health checks
- check Gateway reachability
- run doctor without interactive fixes
- validate config
- read config values (`config get <path>`, secrets redacted)
- inspect the config schema (`config schema <path>`)
- show the audit-log path

Persistent operations require conversational approval in interactive mode unless
you pass `--yes` for a direct command:

- write config
- run `config set`
- set supported SecretRef values through `config set-ref`
- run setup/onboarding bootstrap
- connect a channel (`connect <channel>`)
- change the default model
- start, stop, or restart the Gateway
- create agents
- install plugins from ClawHub or npm
- uninstall plugins
- run doctor repairs that rewrite config or state

Config writes are schema-validated: invalid values or unknown keys are
rejected with the exact validation error, and after every applied write
Crestodian re-validates `openclaw.json` — if the file ends up invalid, the
issues come back into the conversation and the assistant proposes a corrective
command (still approval-gated).

Applied writes are recorded in:

```text
~/.openclaw/audit/crestodian.jsonl
```

Discovery is not audited. Only applied operations and writes are logged.

`openclaw onboard --modern` is a deprecated alias for `openclaw crestodian`.
Plain `openclaw onboard` opens the same conversation with the first-run setup
proposal; `openclaw onboard --classic` runs the classic step wizard.

## Setup bootstrap

`setup` is the chat-first onboarding bootstrap. It writes only through typed
config operations and asks for approval first. On approval it applies the full
first-run state: workspace and model in `openclaw.json`, quickstart Gateway
defaults (loopback, token auth), workspace bootstrap files, and — when run from
the local CLI — the Gateway background service. Inside the macOS app the app
manages the Gateway process, so setup only writes config and workspace files.

```text
setup
setup workspace ~/Projects/work
setup workspace ~/Projects/work model openai/gpt-5.5
```

When no model is configured, setup selects the first usable backend in this
order and tells you what it chose:

- existing explicit model, if already configured
- `OPENAI_API_KEY` -> `openai/gpt-5.5`
- `ANTHROPIC_API_KEY` -> `anthropic/claude-opus-4-8`
- Claude Code CLI -> `claude-cli/claude-opus-4-8`
- Codex -> `openai/gpt-5.5` through the Codex app-server harness

Claude Code and Codex detection is login-aware where credentials are readable
without keychain prompts: a CLI that is definitively logged out ranks below a
logged-in one, and the choice is reported as such.

If none are available, setup still writes the default workspace and leaves the
model unset. Install or log into Codex/Claude Code, or expose
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, then run setup again.

## Connect channels

`connect <channel>` (for example `connect telegram`) walks through that
channel's setup wizard inside the chat: options come back as numbered lists,
credentials as plain questions, and `cancel` stops the flow. After approval the
wizard writes channel config through the same typed operations, records a
`channels.setup` audit entry, and suggests `restart gateway` to apply the
change. `channels` lists the available channel plugins.

## Model-Assisted Planner

Interactive Crestodian is AI-first. Exact typed commands run instantly and
deterministically. Every other message runs through the same embedded agent
loop as regular OpenClaw agents, restricted to one ring-zero `crestodian` tool
that wraps the typed operations (read actions run freely; mutations require
your conversational yes and are audited, with automatic config validation fed
back into the loop). The agent session persists, so the custodian has real
multi-turn memory. It first uses the configured OpenClaw model; with no usable
model it can fall back to local runtimes already present on the machine:

- Claude Code CLI: `claude-cli/claude-opus-4-8` (agent loop; the ring-zero
  tool is served over MCP, see the trust model below)
- Codex app-server harness: `openai/gpt-5.5` (agent loop with an enforced
  single-tool allow-list)

When the agent loop is unavailable, Crestodian degrades to a bounded
single-turn planner, and without any model to deterministic typed commands.
The assistant cannot mutate config directly. It replies in its own voice and
may propose at most one of Crestodian's typed commands per turn; the normal
approval and audit rules apply, and Crestodian prints the model it used and the
interpreted command before anything runs. When no model is usable, Crestodian
degrades to deterministic typed commands only. Configless fallback planner turns are
temporary, tool-disabled where the runtime supports it, and use a temporary
workspace/session.

Message-channel rescue mode does not use the model-assisted planner. Remote
rescue stays deterministic so a broken or compromised normal agent path cannot
be used as a config editor.

### CLI harness trust model

Embedded runtimes and the Codex app-server harness enforce the ring-zero
restriction directly: the run carries a tool allow-list with only the
`crestodian` tool. CLI harnesses (Claude Code, Gemini CLI) cannot enforce an
OpenClaw tool allow-list — the CLI owns its native tools and its own permission
policy, so OpenClaw fails closed if asked to restrict one. For CLI-harness
models Crestodian instead:

- injects a dedicated MCP server that serves only the `crestodian` tool and
  replaces OpenClaw's normal MCP tool surface for the run (for Claude Code the
  generated config is applied with `--strict-mcp-config`, so no other MCP
  servers are loaded),
- keeps every config mutation inside the tool's approval and audit contract —
  reads run freely, writes require your conversational yes, and every applied
  write is audited and re-validated,
- leaves native tools (file reads, shell) to the harness. They follow the same
  permission posture as normal OpenClaw agent runs on this machine: with
  OpenClaw's default exec settings Claude Code runs with permissions bypassed,
  and a restricted `tools.exec` config falls back to the CLI's own permission
  policy.

Only Crestodian sessions get the crestodian MCP server; normal agent runs
never see this tool. Treat a Crestodian session on a CLI-harness model like a
normal local agent run on the same host: the ring-zero tool adds an audited,
approval-gated path for config repair, but it does not prevent the harness's
native tools from touching files directly. The Codex app-server fallback and
API-key models enforce the strict single-tool loop; prefer those when you want
the hard restriction.

## Switching to an agent

Use a natural-language selector to leave Crestodian and open the normal TUI:

```text
talk to agent
talk to work agent
switch to main agent
```

`openclaw tui`, `openclaw chat`, and `openclaw terminal` still open the normal
agent TUI directly. They do not start Crestodian.

After switching into the normal TUI, use `/crestodian` to return to Crestodian.
You can include a follow-up request:

```text
/crestodian
/crestodian restart gateway
```

Agent switches inside the TUI leave a breadcrumb that `/crestodian` is available.

## Message rescue mode

Message rescue mode is the message-channel entrypoint for Crestodian. It is for
the case where your normal agent is dead, but a trusted channel such as WhatsApp
still receives commands.

Supported text command:

- `/crestodian <request>`

Operator flow:

```text
You, in a trusted owner DM: /crestodian status
OpenClaw: Crestodian rescue mode. Gateway reachable: no. Config valid: no.
You: /crestodian restart gateway
OpenClaw: Plan: restart the Gateway. Reply /crestodian yes to apply.
You: /crestodian yes
OpenClaw: Applied. Audit entry written.
```

Agent creation can also be queued from the local prompt or rescue mode:

```text
create agent work workspace ~/Projects/work model openai/gpt-5.5
/crestodian create agent work workspace ~/Projects/work
```

Remote rescue mode is an admin surface. It must be treated like remote config
repair, not like normal chat.

Security contract for remote rescue:

- Disabled when sandboxing is active. If an agent/session is sandboxed,
  Crestodian must refuse remote rescue and explain that local CLI repair is
  required.
- Default effective state is `auto`: allow remote rescue only in trusted YOLO
  operation, where the runtime already has unsandboxed local authority.
- Require an explicit owner identity. Rescue must not accept wildcard sender
  rules, open group policy, unauthenticated webhooks, or anonymous channels.
- Owner DMs only by default. Group/channel rescue requires explicit opt-in.
- Plugin search and list are read-only. Plugin install is local-only by default
  because it downloads executable code. Plugin uninstall can be allowed as an
  approved repair operation when rescue policy permits persistent writes.
- Remote rescue cannot open the local TUI or switch into an interactive agent
  session. Use local `openclaw` for agent handoff.
- Persistent writes still require approval, even in rescue mode.
- Audit every applied rescue operation. Message-channel rescue records channel,
  account, sender, and source-address metadata. Config-mutating operations also
  record config hashes before and after.
- Never echo secrets. SecretRef inspection should report availability, not
  values.
- If the Gateway is alive, prefer Gateway typed operations. If the Gateway is
  dead, use only the minimal local repair surface that does not depend on the
  normal agent loop.

Config shape:

```jsonc
{
  "crestodian": {
    "rescue": {
      "enabled": "auto",
      "ownerDmOnly": true,
    },
  },
}
```

`enabled` should accept:

- `"auto"`: default. Allow only when the effective runtime is YOLO and
  sandboxing is off.
- `false`: never allow message-channel rescue.
- `true`: explicitly allow rescue when the owner/channel checks pass. This
  still must not bypass the sandboxing denial.

The default `"auto"` YOLO posture is:

- sandbox mode resolves to `off`
- `tools.exec.security` resolves to `full`
- `tools.exec.ask` resolves to `off`

Remote rescue is covered by the Docker lane:

```bash
pnpm test:docker:crestodian-rescue
```

Configless local planner fallback is covered by:

```bash
pnpm test:docker:crestodian-planner
```

An opt-in live channel command-surface smoke checks `/crestodian status` plus a
persistent approval roundtrip through the rescue handler:

```bash
pnpm test:live:crestodian-rescue-channel
```

Configless setup through explicit Crestodian commands is covered by:

```bash
pnpm test:docker:crestodian-first-run
```

That lane starts with an empty state dir, verifies the modern onboard Crestodian
entrypoint, sets the default model, creates an additional agent, configures
Discord through a plugin enablement plus token SecretRef, validates config, and
checks the audit log. QA Lab also has a repo-backed scenario for the same Ring 0
flow:

```bash
pnpm openclaw qa suite --scenario crestodian-ring-zero-setup
```

## Related

- [CLI reference](/cli)
- [Doctor](/cli/doctor)
- [TUI](/cli/tui)
- [Sandbox](/cli/sandbox)
- [Security](/cli/security)
