# Architecture

ATEM Sandbox is arranged around one local state model. Browser controls and the ATEM UDP
server are adapters around that model; neither is allowed to keep its own routing state.

```text
React/Vite UI ── HTTP commands ─┐
ATEM UDP clients ───────────────┼── SandboxRuntime
                                │        │
                                │        ├── AtemProtocolControl facade ── AtemProtocolServer
                                │        │                                      │
                                │        └──────────── AtemStateStore ─────────┘
                                │                         │
                                └──── WebSocket snapshots ─┴── React/Vite UI
```

`SandboxRuntime` constructs the UDP server and supplies its `AtemProtocolControl` facade. The
facade exposes semantic switcher operations while keeping configuration persistence and the
shared `AtemStateStore` in the runtime. The protocol package retains only per-client transport
state; it never becomes a second source of routing state.

## Current packages

| Location                 | Responsibility                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `packages/shared`        | Browser-safe config schema, source references, ATEM source ID mapping, video-mode data                        |
| `packages/atem-state`    | State model, semantic controls, transition scheduler, media resolution                                        |
| `packages/server`        | Configuration repository, logging, HTTP API, WebSocket broadcast, safe media/static serving, composition root |
| `packages/atem-protocol` | UDP session/packet adapter, command decoder, and shared-state feedback projection                             |
| `apps/web`               | React control panel and clean Program/Preview output routes                                                   |
| `apps/desktop`           | Thin Electron host; starts the runtime but never owns switcher state                                          |

`AtemStateStore` uses semantic source references such as `{ kind: 'media-player', player: 1 }`.
Only the protocol boundary converts those references to ATEM's numeric source IDs. This
keeps UI, configuration, and tests independent of wire details.

## State behavior

The store exposes semantic operations rather than public mutation: set Program/Preview, CUT, AUTO,
Fade to Black, transitions, keyers, auxiliary routing, Media Pool allocation, and device settings.
It publishes a full versioned snapshot whenever state changes. Full snapshots are small and make
WebSocket reconnects reliable without patch ordering concerns.

AUTO captures its original Program and Preview endpoints, publishes progress, and swaps only at
completion. The transition clock is injected, which permits deterministic unit tests. Routing
changes during AUTO are rejected to avoid race conditions.

## Configuration and portability

`config.json` is read from the portable root: `ATEM_SANDBOX_PORTABLE_ROOT`, the directory from
which npm was invoked, or the process working directory, in that order. The Electron host uses
its per-user application data directory, while the container uses `/data`. `--config
configs/church.json` is resolved from the portable root. A missing config creates a validated
default; an invalid config stops startup with field-specific diagnostics and is never overwritten.

Device name and video mode, input appearance, transition and Fade to Black rates, Media Player
names/assignments, Media Pool stills/allocation, keyers, and auxiliary routing persist atomically to
the active profile. Live Program/Preview routing deliberately remains transient so a profile starts
predictably. Selecting an ATEM model starts a fresh sandbox with `Camera X` / `CAMX` defaults for
its supported HDMI camera inputs: four for Mini Pro and Mini Pro ISO, and eight for Mini Extreme
ISO (Gen 1) and Mini Extreme ISO G2. Each profile retains one M/E, up to two media players, and
twenty stills. The G2's ninth non-HDMI video path and other model-specific facilities remain out of
scope. `media/` is relative to the portable root.

The configuration controls export the active profile as portable JSON and import a complete JSON
profile after validation. Imported ATEM UDP listener host/port changes are persisted but take effect
only after restart. The browser UI and HTTP API bind to `127.0.0.1` locally, or all container
interfaces in Docker. A changed ATEM model or video mode requires UDP clients to reconnect.
Media files remain separate from the JSON profile.

## Diagnostics

The logger writes events to standard output and retains up to 2,000 entries in memory. The browser
console polls the latest 500 entries every second. Log history is session-only and is not written
to disk; verbose debug entries are included only when the server starts with `--debug`.

## HTTP and WebSocket contract

| Endpoint                          | Purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `GET /api/v1/health`              | Runtime health and ATEM UDP listener status         |
| `GET /api/v1/state`               | Current shared state snapshot                       |
| `GET /api/v1/status`              | Endpoint/client status                              |
| `GET /api/v1/logs`                | Recent in-memory diagnostics and debug status       |
| `GET /api/v1/sandbox/export`      | Download the complete portable JSON profile         |
| `POST /api/v1/sandbox/import`     | Validate and replace the complete JSON profile      |
| `POST /api/v1/control`            | Semantic switcher actions                           |
| `PATCH /api/v1/inputs/:id`        | Persisted input name/colour edits                   |
| `PATCH /api/v1/media-players/:id` | Persisted Media Player name edits                   |
| `PATCH /api/v1/device-profile`    | Start a fresh sandbox for the selected ATEM profile |
| `PATCH /api/v1/device-settings`   | Persist device name and video mode without reset    |
| `GET /media/<path>`               | Safely served media-pool images                     |
| `GET /ws`                         | Full snapshots on connection and every state change |

The browser routes `/output/program` and `/output/preview` are control-free 16:9 surfaces.
