# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BroUtils — a Tauri v2 desktop app. Multi-tool toolbox; tools are Bulk Rename, Convert Images, Stack Images, and Compress Videos. New tools are added as tabs.

Tech stack: React 19 + TypeScript 5 (Vite 7) frontend, Rust backend via Tauri v2 IPC.

## Shared frontend primitives

Reusable pieces live alongside the tools so each tab stays thin:
- `src/components/shared/drop-zone.tsx` — the drag-and-drop / file-picker surface used by every tab (configurable icon, hint, dialog filters, optional `accept` predicate).
- `src/lib/use-file-drop.ts` — hook wrapping the Tauri native drag-drop listener; returns `isDragging` and reports dropped paths.
- `src/lib/files.ts` — `basename`, `extensionOf`, `formatSize`, `datedStem`. `rename.ts`/`convert.ts` re-export `basename` for backwards compatibility.
- Paste: `DropZone`'s `pasteable` prop adds a Paste button and the ⌘V/Ctrl+V shortcut (`src/lib/use-paste-shortcut.ts`, ignored inside text fields). `read_clipboard_files` (`src-tauri/src/clipboard.rs`) returns copied files' paths, or saves copied image data to a temp folder (PNG/TIFF bytes as-is on macOS, via `arboard` elsewhere). Outputs made from pasted images go to Downloads — use `clipboard::output_dir` for any new tool that writes next to its source.

## System dependencies

HEIC/HEIF input (`src-tauri/src/heic.rs`) is decoded with the system **ImageIO** framework on macOS, so the app bundle links no third-party libraries and nothing extra needs installing to build it. Other Unix targets use the `libheif-rs` crate, which links against the **system libheif** library. HEIC input is unsupported on Windows. The macOS bundle is ad-hoc signed (`bundle.macOS.signingIdentity: "-"`) — without it, Gatekeeper reports the downloaded app as damaged. Keep the macOS binary free of Homebrew dylibs: hardened runtime refuses to load them, and they don't exist on users' Macs.

Compress Videos shells out to a bundled **FFmpeg sidecar** (`src-tauri/binaries/ffmpeg-<target-triple>`, declared as `externalBin` in `tauri.conf.json` and allowed via `shell:allow-execute` in capabilities). The macOS ARM64 binary is committed; the ~200MB Windows binary is gitignored — fetch it before a Windows build with `bash scripts/download-ffmpeg-windows.sh`. The tool also uses `tauri-plugin-notification` to notify when a batch finishes.

Stack Images (`src-tauri/src/stack.rs`) reuses the Convert Images decode/encode helpers. Previews are decoded in Rust and sent as base64 WebP data URLs (so HEIC previews work); row reordering uses `@dnd-kit/react`, which is pointer-based and so doesn't clash with Tauri's native file-drop listener.

## Package manager

Use `bun` (not npm). All scripts run via `bun run <script>`.

## Key commands

| Command | Purpose |
|---|---|
| `bun run dev:tauri` | Start dev (watches both frontend + Rust) |
| `bun run build:tauri` | Production build for current platform |
| `bun run build:tauri:windows` | Cross-compile to Windows x86_64 |
| `bun run types` | TypeScript type-check |
| `bun run lint` | ESLint (TypeScript + React hooks rules) |

Do not use `bun run dev` alone — it starts only the Vite server without Tauri.

## TypeScript

- Strict mode + `noUnusedLocals`, `noUnusedParameters`
- `@/` alias maps to `./src/`
- Target: ES2020, module resolution: bundler

## Frontend conventions

- Styling: Tailwind CSS 4 + shadcn/ui components
- Icons: `@hugeicons/react` (import per-icon for tree-shaking)
- Font: Figtree (loaded via CSS import in App.css)
- File naming: kebab-case (`bulk-rename.tsx`, `rename.ts`)
- No formatter configured — no prettier or biome

## Tauri IPC

Rust commands are invoked from `src/lib/rename.ts` using `invoke` from `@tauri-apps/api/core`. Return types are typed structs (`RenameResult`). Capabilities live in `src-tauri/capabilities/default.json`; add new capability entries there when a new Tauri plugin is used.

## Commit style

Use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, etc. Bullet points in the body for multi-concern commits.

## Adding a new tool

1. Create `src/components/<tool-name>.tsx` (kebab-case)
2. Add a `<TabsTrigger>` and `<TabsContent>` in `src/App.tsx`
3. Add the Rust handler in `src-tauri/src/lib.rs` and register it in `.invoke_handler()`
4. If the tool needs new Tauri plugins: add the plugin to `src-tauri/Cargo.toml` and a capability entry in `src-tauri/capabilities/default.json`
