# Changelog

Docs: https://docs.openclaw.ai

## 2026.5.28

### Highlights

- Agent and Codex runtime recovery is steadier: subagents keep cwd/workspace separation, hook context stays prompt-local, session locks release on timeout abort, stale restart continuations are avoided, and Codex app-server/helper failures no longer tear down shared runtime state. (#87218, #86875, #87409, #87399, #87375)
- Channel delivery and session identity got safer across outbound plugin hooks, Matrix room ids, iMessage reactions/approvals, Slack final replies, Discord recovered tool warnings, and Microsoft Teams service URL trust checks. (#73706, #75670, #87366, #87451, #87334)
- Mobile and chat surfaces got a broader refresh: the iOS Pro UI, Gateway chat transport, onboarding, Talk permissions, WebChat reconnect delivery, and session picker behavior now preserve more state across reconnects and empty searches. (#87367, #87531, #87682)
- CLI, auth, doctor, and provider paths fail faster and recover more clearly: malformed numeric/version options are rejected, OAuth and local service startup requests are bounded, legacy `api_key` auth profiles migrate to canonical form, and restart guidance is actionable. (#87398, #86281, #87361)
- Plugin and Gateway hot paths do less repeated work while preserving cache correctness for install records, config JSON parsing, tool search catalogs, session stores, manifest model rows, auto-enabled plugin config, browser tokens, and viewer assets. (#86699)
- Release, QA, and E2E validation now bound more log, artifact, harness, and cross-OS waits so failing lanes produce proof instead of hanging or false-greening.

### Changes

- Status: show active subagent details in status output.
- Diffs: split the default language pack and expand default Diffs language coverage while keeping the host floor aligned. (#87370, #87372) Thanks @RomneyDa.
- ClawHub: add plugin display names plus skill verification and trust surfaces. (#87354, #86699) Thanks @thewilloftheshadow and @Patrick-Erichsen.
- iOS: refresh the dev app with Pro Command, Chat, Agents, and Settings tabs wired to gateway sessions, diagnostics, chat, and realtime Talk. (#87367) Thanks @Solvely-Colin.
- Docs: clarify Codex computer-use setup, paste-token stdin auth setup, macOS gateway sleep troubleshooting, native Codex hook relay recovery, container model auth, install deployment cards, device-token admin gating, and backport targets. (#87313, #63050) Thanks @bdjben, @liaoandi, and @thewilloftheshadow.
- PDF/tools: use ClawPDF for PDF extraction and surface MCP structured content in agent tool results. (#87670)

### Fixes

- Agents: fall back to local config pruning when the optional `agents delete` Gateway probe cannot authenticate, so offline installs can still delete agents without removing shared workspaces.
- Tighten phone-control mutation authorization [AI]. (#87150) Thanks @pgondhi987.
- Clarify directive persistence authorization policy [AI]. (#86369) Thanks @pgondhi987.
- Agents/Codex: keep spawned agent cwd/workspace state separated, keep hook context prompt-local, release session locks on timeout abort, avoid session event queue self-wait, preserve shared app-server state across startup or helper failures, keep native hook relay alive across restarts, route workspace memory through tools, resolve Codex runtime models first, report quarantined dynamic tools, format `skills` command output, and bound compaction/steering retries. (#87218, #86875, #86123, #87399, #87375, #87383, #87400) Thanks @mbelinky, @Alix-007, @luoyanglang, @yetval, and @sjf.
- Channels: thread canonical session keys into outbound hooks, preserve Matrix room-id case, keep fallback tool warnings mention-inert, retain delivered Slack final replies during late cleanup, continue iMessage polling after denied reactions, suppress duplicate native exec approvals, preserve Telegram SecretRef prompt config, suppress Discord recovered tool warnings, and block untrusted Teams service URLs. (#73706, #75670, #87366, #87451, #87334) Thanks @zeroaltitude, @lukeboyett, @xiaotian, and @eleqtrizit.
- CLI/auth/doctor/providers: reject malformed numeric/timeout/subcommand-version inputs, wait for respawn child shutdown, bound Codex and GitHub Copilot OAuth/token requests, warm provider auth off the main thread, honor Codex response timeouts, bound local service startup, resolve GPT-5.5 without cached catalog, migrate legacy memory auto-provider config, rewrite non-canonical `api_key` auth profiles, and make doctor restart follow-ups actionable. (#87398, #86281, #87361) Thanks @Patrick-Erichsen, @samzong, @giodl73-repo, and @alkor2000.
- Gateway/security/session state: expire browser tokens after auth rotation, scope assistant idempotency dedupe, drain probe client closes, avoid stale restart continuation reuse, preserve retry-after fallbacks, bound webchat image and artifact transcript scans, include seconds in inbound metadata timestamps, and evict current plugin-state namespaces at row caps.
- Config/parsing/network: reject partial numeric parsing, parse provider/Discord retry headers and dates strictly, honor IPv6 and bare IPv6 `no_proxy` entries, canonicalize secret target array indexes, and reject malformed media content lengths, inspected TCP ports, marketplace content lengths, cron epochs, and sandbox stat fields.
- Providers/agents: preserve seeded Anthropic signatures, concatenate signature-delta chunks, preserve DeepSeek `reasoning_content` replay across tier suffixes, apply OpenRouter strict9 ids to Mistral routes, promote Ollama plain-text tool calls, and recover empty preflight compaction. (#87593)
- File transfer: handle late tar stdin pipe errors after archive validation or unpacking has already settled.
- Performance: trust install-record caches between reloads, prefer native JSON parsing, reuse unchanged tool-search catalogs, skip unchanged store serialization, add precomputed session patch writers, reduce store clone allocations, cache manifest model catalog rows and auto-enabled plugin config, and slim current metadata identity caches.
- Docker/release/QA: package runtime workspace templates, stream cross-OS served artifacts, preserve sparse Crabbox run artifacts, bound OpenClaw instance logs, plugin gauntlet relay logs, MCP channel buffers, kitchen-sink scans, agent-turn assertions, and release scenario logs, and keep release/google live guards current.
