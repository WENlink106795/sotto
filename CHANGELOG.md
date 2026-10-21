# Changelog

All notable changes to this project will be documented in this file.

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