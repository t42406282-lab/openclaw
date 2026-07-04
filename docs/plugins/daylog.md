---
summary: "Optional automatic work journal built from periodic screen snapshots"
read_when:
  - You want a Dayflow-style timeline of your day in the Control UI
  - You are enabling or configuring the bundled Daylog plugin
  - You want standup summaries or day recall grounded in screen activity
title: "Daylog plugin"
---

The Daylog plugin turns screen activity into an automatic work journal. It
captures periodic screen snapshots from a paired node (for example the OpenClaw
Mac app), summarizes them with a vision model into timestamped observations,
and synthesizes those into timeline cards you can browse in the
[Control UI](/web/control-ui). On top of the timeline it generates daily
standup notes and answers questions about your day.

Everything stays local: snapshots and the timeline database live under the
Gateway state directory. Only analysis batches are sent to the model you
configure, so pick a local model if snapshots must never leave the machine.

## Default state

Daylog is a bundled plugin and is disabled by default. Screen capture is
opt-in.

Enable it with:

```bash
openclaw plugins enable daylog
openclaw gateway restart
```

Then open the dashboard and pick the Daylog tab:

```bash
openclaw dashboard
```

The tab shows a plugin-unavailable state while the plugin is disabled or
blocked by `plugins.allow` / `plugins.deny`.

## Requirements

- A connected node that can capture the screen. The macOS app node advertises
  `screen.snapshot` by default (see [Nodes](/nodes)); headless macOS node
  hosts (`openclaw node host run`) get a plugin-provided `daylog.snapshot`
  command backed by the system `screencapture` tool when Daylog is enabled.
- A vision model whose media-understanding provider supports structured
  extraction (the bundled Codex plugin does, for example `codex/gpt-5.5`).
  Daylog resolves the model in order:
  1. `plugins.entries.daylog.config.visionModel` (`"provider/model"` ref)
  2. the first image-capable entry under `tools.media.image.models` or
     `tools.media.models`
- Timeline card synthesis, standup notes, and "ask your day" answers use the
  default agent model via the plugin LLM runtime.

## How it works

1. **Capture**: every `captureIntervalSeconds` (default 30s) Daylog invokes
   `screen.snapshot` on the capture node and stores a scaled JPEG frame.
   Consecutive identical frames are marked idle and excluded from analysis.
2. **Observe**: once an analysis window (default 15 minutes) elapses, the
   frames are sent to the vision model, which returns timestamped activity
   observations ("VS Code: editing store.ts, fixing a type error").
3. **Synthesize**: observations plus the last 45 minutes of existing cards are
   revised into timeline cards (10-60 minutes each) with a title, summary,
   category, main app, and any brief distractions.
4. **Prune**: frames older than `retentionDays` (default 14) are deleted.
   Cards, observations, and standups are kept.

Frames and the timeline database live under `<state-dir>/daylog/`.

## Configuration

```json
{
  "plugins": {
    "entries": {
      "daylog": {
        "enabled": true,
        "config": {
          "captureIntervalSeconds": 30,
          "analysisIntervalMinutes": 15,
          "screenIndex": 0,
          "maxWidth": 1440,
          "nodeId": "my-mac",
          "visionModel": "codex/gpt-5.5",
          "retentionDays": 14,
          "captureEnabled": true
        }
      }
    }
  }
}
```

All keys are optional. Leave `nodeId` unset to use the first connected node
that supports `screen.snapshot`. Set `captureEnabled: false` to keep the
timeline UI available without capturing; the dashboard also has a session-only
pause toggle.

## Dashboard tab

- **Timeline**: expandable cards per activity with category colors, the main
  app, distraction chips, and a snapshot keyframe.
- **Day at a glance**: focus ratio, category breakdown, top apps.
- **Daily standup**: turns yesterday plus today into a ready-to-paste update.
- **Ask your day**: natural-language questions answered from the tracked
  timeline ("when did I review the gateway PR?").
- **Analyze now**: closes the current capture window immediately instead of
  waiting for the analysis interval.

## Gateway methods

Daylog registers Gateway RPC methods for the dashboard: `daylog.status`,
`daylog.days`, `daylog.timeline`, `daylog.frames`, `daylog.frame`,
`daylog.standup`, `daylog.ask`, `daylog.capture.set`, and
`daylog.analyze.now`.

## Privacy notes

- Snapshots can contain anything on screen, including secrets. Frames never
  leave the machine except as model input for analysis batches.
- Use a local vision model (for example via a local provider endpoint) for a
  fully on-device pipeline.
- `screen.snapshot` is part of the default node command allowlist on macOS;
  remove it from `gateway.nodes.allowCommands` to block capture entirely.
