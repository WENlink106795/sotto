# Security Policy

## Secrets

This repository must never contain:

- GitHub / npm / cloud API tokens or personal access tokens
- passwords, private keys, PFX/PVK/PEM files, or signing passwords
- real user data or ASMR library contents

The local signing material lives in `build/signing/`, which is ignored by git. Release executables are published only through GitHub Releases and are also ignored by git.

## Reporting

If you find a leaked credential or a vulnerability, please open a private security advisory on GitHub rather than a public issue. Do not include live secrets in an issue.

## Scope

Sotto processes files locally and makes no network requests by default. Only a manual update check or opt-in auto-update contacts GitHub Releases; it never uploads files, paths, or logs. The main risk surface is malformed media/subtitle files passed to bundled ffmpeg; keep the app and ffmpeg build up to date for public releases.
