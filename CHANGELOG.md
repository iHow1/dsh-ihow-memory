# Changelog

All notable changes to `dsh-ihow-memory` are documented in this file.

## [0.1.0-alpha.5] — 2026-09-01

### Changed

- Pin iHow Memory Core `0.1.0-alpha.34` exactly so automatic DSH session-start handoffs stay scoped to the current repository or directory. Explicit `memory.continue` still supports cross-project discovery.
- Drain queued lifecycle and checkpoint writes through Cordis effect teardown so a real Host shutdown waits for `agent/disposed` finalization instead of depending on a nonexistent `dispose` event.

### Notes

- Alpha.5 supersedes Alpha.4 after live dogfood showed that Alpha.4/Core Alpha.33 could inject an unrelated project handoff during automatic startup. The DSH lifecycle surface is otherwise unchanged.

## [0.1.0-alpha.4] — 2026-08-26

### Added

- Native DeepSeek Harness `0.1.1-rc.2` lifecycle integration: bounded session-start handoff injection, first-step prompt recall, after-turn observation, metadata-only compaction checkpoints, and partial session-end checkpoints.
- Hashed, content-free DSH activation evidence. Replayable local completion remains `READY — WAITING FOR FIRST ACTIVITY` with `ACTIVATION_COMPLETION_UNATTESTED`, not authenticated `ACTIVE`.
- A real Host smoke that mounts the namespaced MCP tools, creates and disposes a real agent, verifies lifecycle evidence/checkpoint persistence, and repeats write/search/forget/remember across rebuilt Host instances.

### Changed

- Pin iHow Memory Core `0.1.0-alpha.33` exactly and target the official DSH `0.1.1-rc.2` peer contracts.
- Add explicit `space` configuration so per-session working directories can share one logical iHow Memory state lane.

### Notes

- The adapter and Core use independent versions. Publishing Core does not install, update, or activate this DSH bundle; release and restart the target DSH profile separately.
- Lifecycle hooks fail open for model execution. The adapter never copies raw prompts, summaries, transcripts, session identifiers, or configuration keys into activation evidence.
