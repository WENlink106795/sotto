# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-10-22

### Added

- Cross-folder subtitle matching up to three directory levels; cover candidates can include explicitly named covers from parent/sibling folders.
- Per-file FFmpeg progress via `-progress pipe:1`: filename, elapsed time, operation index and file percentage.
- Optional FFmpeg thread count (automatic CPU-based or manual); no misleading GPU audio toggle.
- Update checker, daily in-app update prompt, silent GitHub Release download with SHA-256 verification and install flow.
- Settings export/import JSON and manual GitHub repository link.
- Opt-in diagnostic logging with a consent dialog; crash dialogs show the log path.
- Green privacy badge styling.
- Local rotating diagnostic log for main/renderer errors, uncaught exceptions, IPC failures, and scan/plan/apply summaries.
- One-click diagnostics export in Settings > Tools, bundling environment details, settings summary, recent app log, and recent apply logs with home-directory redaction.
- Renderer error boundary and global error/unhandled-rejection reporting to the local log.

### Notes

- This release is Chinese-first; full Chinese/English/Japanese UI localization is still pending.
- Multi-threading controls FFmpeg encoder threads, not concurrent multi-file conversion; GPU audio encoding is intentionally not offered.

## [0.1.0] - 2026-10-21

### Added

- VTT / SRT to LRC conversion with UTF-8, UTF-8 BOM and GB18030 output.
- Content-based `.txt` lyric detection: WebVTT/SRT/LRC content is converted; plain scripts/readmes are ignored.
- Support for double-extension subtitles such as `track.mp3.vtt`, matched exactly after stripping the media suffix.
- Smart audio/subtitle pairing across folders with fuzzy confidence and manual override.
- Filename sanitizer that removes emoji, symbols and Windows-illegal characters while keeping audio and subtitles in sync.
- Cover candidate gallery, configurable cover name, optional JPEG conversion and opt-in automatic cover selection for batch runs.
- Optional WAV / FLAC / APE / AIFF / ALAC / WMA to MP3 / M4A transcoding through ffmpeg.
- Dry-run plan, two-phase safe renames, run journal, history and undo.
- Fluent, Material You and Studio themes with accent, radius, density and font-scale customization.
- Batch mode: drag a whole `[ASMR]` root, use saved settings as a preset, review one plan and apply once.
- Optional Authenticode signing flow (self-signed local certificate; CA certificate recommended for release).
- Local-first desktop app (Electron + React + TypeScript), x64 and ia32 packaging.