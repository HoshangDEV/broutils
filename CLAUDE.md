# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BroUtils — a Tauri v2 desktop app. Multi-tool toolbox; currently one tool (Bulk Rename). New tools are added as tabs.

Tech stack: React 19 + TypeScript 5 (Vite 7) frontend, Rust backend via Tauri v2 IPC.

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
