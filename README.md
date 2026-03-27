<p align="center">
  <img src="assets/icon.png" alt="Kanna" width="80" />
</p> 

<h1 align="center">Kanna</h1>

<p align="center">
  <strong>A beautiful web UI for the Claude Code & Codex CLIs</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kanna-code"><img src="https://img.shields.io/npm/v/kanna-code.svg?style=flat&colorA=18181b&colorB=f472b6" alt="npm version" /></a>
</p>

<br />

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshot.png" />
    <source media="(prefers-color-scheme: light)" srcset="assets/screenshot-light.png" />
    <img src="assets/screenshot.png" alt="Kanna screenshot" width="800" />
  </picture>
</p>

<br />

## Quickstart

```bash
bun install -g kanna-code
```

If Bun isn't installed, install it first:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then run from any project directory:

```bash
kanna
```

That's it. Kanna opens in your browser at [`localhost:3210`](http://localhost:3210).

## Features

- **Multi-provider support** — switch between Claude and Codex (OpenAI) from the chat input, with per-provider model selection, reasoning effort controls, and Codex fast mode
- **Project-first sidebar** — chats grouped under projects, with live status indicators (idle, running, waiting, failed)
- **Drag-and-drop project ordering** — reorder project groups in the sidebar with persistent ordering
- **Local project discovery** — auto-discovers projects from both Claude and Codex local history
- **Codex history import** — when you open a local project, Kanna imports matching `~/.codex/sessions` threads into its own persisted chat store
- **Rich transcript rendering** — hydrated tool calls, collapsible tool groups, plan mode dialogs, and interactive prompts with full result display
- **Quick responses** — lightweight structured queries (e.g. title generation) via Haiku with automatic Codex fallback
- **Plan mode** — review and approve agent plans before execution
- **Persistent local history** — refresh-safe routes backed by JSONL event logs and compacted snapshots
- **Auto-generated titles** — chat titles generated in the background via Claude Haiku
- **Session resumption** — resume agent sessions with full context preservation
- **WebSocket-driven** — real-time subscription model with reactive state broadcasting

## Architecture

```
Browser (React + Zustand)
    ↕  WebSocket
Bun Server (HTTP + WS)
    ├── WSRouter ─── subscription & command routing
    ├── AgentCoordinator ─── multi-provider turn management
    ├── ProviderCatalog ─── provider/model/effort normalization
    ├── QuickResponseAdapter ─── structured queries with provider fallback
    ├── EventStore ─── JSONL persistence + snapshot compaction
    ├── CodexHistoryImporter ─── external Codex session import + transcript mapping
    └── ReadModels ─── derived views (sidebar, chat, projects)
    ↕  stdio
Claude Agent SDK / Codex App Server (local processes)
    ↕
Local File System (~/.kanna/data/, ~/.codex/sessions/, project dirs)
```

**Key patterns:** Event sourcing for all state mutations. CQRS with separate write (event log) and read (derived snapshots) paths. Reactive broadcasting — subscribers get pushed fresh snapshots on every state change. Multi-provider agent coordination with tool gating for user-approval flows. Provider-agnostic transcript hydration for unified rendering. External Codex history is imported into the same local event store instead of being rendered from a transient in-memory view.

## Requirements

- [Bun](https://bun.sh) v1.3.5+
- A working [Claude Code](https://docs.anthropic.com/en/docs/claude-code) environment
- *(Optional)* [Codex CLI](https://github.com/openai/codex) for Codex provider support

Embedded terminal support uses Bun's native PTY APIs and currently works on macOS/Linux.

## Install

Install Kanna globally:

```bash
bun install -g kanna-code
```

If Bun isn't installed, install it first:

```bash
curl -fsSL https://bun.sh/install | bash
```

Or clone and build from source:

```bash
git clone https://github.com/jakemor/kanna.git
cd kanna
bun install
bun run build
```

## Usage

```bash
kanna                  # start with defaults (localhost only)
kanna --port 4000      # custom port
kanna --no-open        # don't open browser
```

Default URL: `http://localhost:3210`

### Network access (Tailscale / LAN)

By default Kanna binds to `127.0.0.1` (localhost only). Use `--host` to bind a specific interface, or `--remote` as a shorthand for `0.0.0.0`:

```bash
kanna --remote                     # bind all interfaces — browser opens localhost:3210
kanna --host dev-box               # bind to a specific hostname — browser opens http://dev-box:3210
kanna --host 192.168.1.x           # bind to a specific LAN IP
kanna --host 100.64.x.x            # bind to a specific Tailscale IP
```

When `--host <hostname>` is given, the browser opens `http://<hostname>:3210` automatically. Other machines on your network can connect to the same URL:

## Development

```bash
bun run dev
```

The same `--remote` and `--host` flags can be used with `bun run dev` for remote development.
Use `bun run dev --port 4000` to run the Vite client on `4000` and the backend on `4001`.

Or run client and server separately:

```bash
bun run dev:client   # http://localhost:5174
bun run dev:server   # http://localhost:5175
```

## Scripts

| Command              | Description                  |
| -------------------- | ---------------------------- |
| `bun run build`      | Build for production         |
| `bun run check`      | Typecheck + build            |
| `bun run dev`        | Run client + server together |
| `bun run dev:client` | Vite dev server only         |
| `bun run dev:server` | Bun backend only             |
| `bun run start`      | Start production server      |

## Project Structure

```
src/
├── client/          React UI layer
│   ├── app/         App router, pages, central state hook, socket client
│   ├── components/  Messages, chat chrome, dialogs, buttons, inputs
│   ├── hooks/       Theme, standalone mode detection
│   ├── stores/      Zustand stores (chat input, preferences, project order)
│   └── lib/         Formatters, path utils, transcript parsing
├── server/          Bun backend
│   ├── cli.ts       CLI entry point & browser launcher
│   ├── server.ts    HTTP/WS server setup & static serving
│   ├── agent.ts     AgentCoordinator (multi-provider turn management)
│   ├── codex-app-server.ts  Codex App Server JSON-RPC client
│   ├── provider-catalog.ts  Provider/model/effort normalization
│   ├── quick-response.ts    Structured queries with provider fallback
│   ├── ws-router.ts WebSocket message routing & subscriptions
│   ├── event-store.ts  JSONL persistence, replay & compaction
│   ├── discovery.ts Auto-discover projects from Claude and Codex local state
│   ├── read-models.ts  Derive view models from event state
│   └── events.ts    Event type definitions
└── shared/          Shared between client & server
    ├── types.ts     Core data types, provider catalog, transcript entries
    ├── tools.ts     Tool call normalization and hydration
    ├── protocol.ts  WebSocket message protocol
    ├── ports.ts     Port configuration
    └── branding.ts  App name, data directory paths
```

## Data Storage

All state is stored locally at `~/.kanna/data/`:

| File             | Purpose                                   |
| ---------------- | ----------------------------------------- |
| `projects.jsonl` | Project open/remove events                |
| `chats.jsonl`    | Chat create/rename/delete events          |
| `messages.jsonl` | Transcript message entries                |
| `turns.jsonl`    | Agent turn start/finish/cancel events     |
| `snapshot.json`  | Compacted state snapshot for fast startup |

Event logs are append-only JSONL. On startup, Kanna replays the log tail after the last snapshot, then compacts if the logs exceed 2 MB.

## Codex Import Notes

- Kanna keeps project discovery and session import separate: discovery finds candidate projects, and opening a project imports matching Codex sessions from `~/.codex/sessions`.
- Imported Codex threads become normal Kanna chats stored in the local event log, so chat IDs stay stable across refreshes and restarts.
- Re-import is idempotent: the same external session reuses the existing chat and only appends newly discovered transcript entries.
- Imported Codex chats bind their original session/thread ID into Kanna's `sessionToken`, so sending another message resumes the original Codex thread when that local session is still resumable.
- Current import support focuses on user messages, assistant text, tool calls, tool results, interrupts, and selected session metadata. Unsupported Codex record types are skipped best-effort instead of failing the whole import.

## License

[MIT](LICENSE)
