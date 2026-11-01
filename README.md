# ATEM Sandbox

ATEM Sandbox is an independent, portable development utility for rehearsing ATEM control
workflows away from a venue. It visually models Program, Preview, simple inputs, Media Player
1/2, and still media so a control workflow can be tested without real video hardware.

It is not affiliated with Blackmagic Design or Bitfocus, is not a real ATEM device, and does
not capture, route, encode, record, or output video.

## Features

The state engine, local web sandbox, and ATEM-compatible UDP endpoint are implemented. The
endpoint listens on the configured ATEM port (9910 by default) and shares state with the web UI.
It models control and feedback for a subset of ATEM workflows, not a complete hardware switcher.

An automated local UDP integration test reaches `connected` with the lockfile-resolved
`atem-connection@3.9.0` client and exercises Program, Preview, CUT, AUTO, transition settings,
and still-media selection. A focused manual Companion smoke test also verified a Preview action
and live variable updates on one profile. Neither is a comprehensive Companion validation or a
claim of full ATEM-device compatibility. See [docs/protocol-notes.md](docs/protocol-notes.md)
for the supported wire surface and limits.

Working now:

- One shared, strongly typed Program/Preview/transition/media-player state model
- Preview selection, Program selection, CUT, and timed AUTO/MIX
- Program/Preview visual monitors and clean `/output/program` and `/output/preview` routes
- Four or eight colour-configurable camera inputs, generated stills, and PNG/JPEG/WebP media-pool paths
- Validated portable JSON configuration, import/export, profile selection, and atomic persisted UI edits
- Live terminal and browser diagnostics held in memory for the current session
- REST commands plus live WebSocket state snapshots
- UDP session handshake, ACK/retry handling, heartbeats, and per-client state fan-out
- ATEM control and feedback for routing, transitions, media, keyers, aux, and other modeled surfaces
- Simulated recording and streaming controls and status; no video is recorded or streamed
- Persistent macro recording and playback for supported actions, including timed and user waits

Broader manual Companion validation and wider ATEM command/state coverage remain outstanding.
See [ATEM and Companion compatibility](docs/compatibility.md)
for feature limits, including unsupported macro operations.

## Develop locally

Requires Node.js 22 or newer.

```text
npm install
npm run dev
```

Open the development control panel at `http://127.0.0.1:5173`. The API/WebSocket server listens
on port 3000. To create the production-style web bundle and serve it from port 3000:

```text
npm run build
npm start
```

Then open `http://127.0.0.1:3000`, with clean output pages at:

```text
http://127.0.0.1:3000/output/program
http://127.0.0.1:3000/output/preview
```

Useful checks:

```text
npm test
npm run typecheck
npm run lint
npm run format:check
```

## Desktop

Download an installer or portable package from a `desktop-v*` GitHub release. The desktop app
stores its configuration in the operating system's per-user application data directory. It uses
an available local HTTP port and listens on UDP port 9910 by default; stop any other service
using that UDP port before starting it. Packages are currently unsigned and macOS builds are not
notarized, so the operating system may warn before opening them.

To run or package locally:

```text
npm run desktop
npm run dist:desktop
```

See [apps/desktop/README.md](apps/desktop/README.md) for build details.

## Docker

Build locally or pull a published image:

```sh
docker build -t atem-sandbox .
docker pull ghcr.io/smoonlee/faketem:latest
```

Start the local image with persistent configuration and media:

```sh
docker run -d --name atem-sandbox \
  -p 127.0.0.1:3000:3000 -p 9910:9910/udp \
  -v atem-sandbox-data:/data atem-sandbox
```

Open `http://127.0.0.1:3000`. Replace the image name with
`ghcr.io/smoonlee/faketem:<version>` to run a published version. The image listens on all
container interfaces; the web API has no authentication, so do not publish its TCP port beyond
localhost without adding appropriate access controls. UDP is exposed to the network in this
example for ATEM clients. The `/data` volume contains `config.json` and any referenced `media/`
files. Changing a configured listener port also requires updating the Docker port mapping.

## Releases and maintenance

GitHub Actions runs tests, static checks, npm auditing, a container smoke test, and a scan for
fixable high/critical image vulnerabilities, including a scheduled weekly check. Dependabot
checks npm, the pinned Docker base image, and GitHub Actions weekly; PRs are assigned to
`smoonlee`. Enable Dependabot security updates in the repository settings so security fixes can
also be proposed as they are detected.

After updating both the root and desktop package versions and lockfile, push matching tags from
the tested commit: `desktop-v0.1.0` creates a desktop release, and `docker-v0.1.0` creates a
separate Docker release and publishes `ghcr.io/smoonlee/faketem:0.1.0` and `:latest`. Substitute
the actual version. Release workflows rerun CI before publishing; the container image is scanned
again before push. New GHCR packages may require their visibility to be changed in GitHub package
settings before anonymous pulls work. Releases are not published until those tags are pushed.

## Controls

Click an input tile to set Preview. Double-click a tile to set Program. CUT immediately swaps
Program and Preview. AUTO animates a MIX using the configured rate; with the default 1080p50
and 25 frames it lasts 500 ms. This preserves the useful previous-source pattern: Preview MP1,
AUTO, then AUTO returns to the previous Program source. Fade to Black uses its separately
configured frame rate and the FTB control toggles between picture and black.

The Media Pool buttons assign a still to MP1 or MP2. If that media player is active on Program
or Preview, its monitor updates immediately. Input appearance includes a native colour picker;
saved changes are written back to the selected config profile.

The server writes timestamped diagnostics to the terminal as events occur. The Settings logs /
console button opens a separate window that refreshes every second and shows the latest 500 entries
from the current server session. Entries are held in memory and are lost on restart; no log files
are written. Existing log files from earlier versions are not removed. To include verbose debug
entries, start the server with `npm run start --workspace=@atem-sandbox/server -- --debug` (or add
`--debug` to the server command in development).

## Configuration and profiles

The root [`config.json`](config.json) is a portable default profile. A missing config is created
automatically. Invalid configurations stop startup and report exact field paths rather than
silently repairing or overwriting data.

Run a named profile relative to the portable root:

```text
npm start -- --config configs/church.json
```

The following settings persist when changed in the UI:

- device name and video mode;
- input names and colours;
- transition type and rate, including Fade to Black rate;
- Media Player names and still assignments;
- Media Pool stills and frame allocation;
- upstream/downstream keyer settings and auxiliary source routing;
- ATEM identity profile;
- recorded macros and their properties.

Program and Preview routing is deliberately session-only so profiles start
with predictable `initialState` values.

The dashboard can export the full portable configuration as JSON and import it later. Import
validates the entire file before replacing the live sandbox. Referenced media files are not bundled
into the JSON export. Imported ATEM UDP listener host/port changes take effect after restart;
image-file references and listener settings are edited in the portable JSON profile. The normal
local and desktop HTTP servers bind to `127.0.0.1`; the container binds to all container interfaces.
Remote Companion clients can connect to the configured UDP endpoint.

### ATEM identity profiles

The Model selector starts a new sandbox for the selected **ATEM identity profile**. New inputs are
always labelled `Camera 1` / `CAM1`, `Camera 2` / `CAM2`, and so on. It is not a simulation of
every hardware feature belonging to that product line. The currently selectable profiles are:

- ATEM Mini Extreme ISO G2;
- ATEM Mini Extreme ISO (Gen 1, the default);
- ATEM Mini Pro ISO;
- ATEM Mini Pro.

Mini Pro and Mini Pro ISO sandboxes provide four HDMI camera inputs; Mini Extreme ISO (Gen 1) and
Mini Extreme ISO G2 sandboxes provide eight HDMI camera inputs. All profiles provide one M/E,
one or two media players, and twenty still slots. Profile selection does not imply full emulation
of each model's hardware features. The G2's ninth non-HDMI video path is not yet modelled.
Existing ATEM UDP clients must reconnect after a sandbox reset.

## Media

Place PNG, JPEG, or WebP files in `media/` and reference their relative paths in an `image`
media-pool slot. PNG transparency is preserved by the browser. Generated stills need no file:

```json
{
  "slot": 8,
  "type": "generated",
  "name": "Media Player #2",
  "background": "#0047AB",
  "foreground": "#FFFFFF",
  "text": "Media Player #2"
}
```

## Project structure

See [docs/architecture.md](docs/architecture.md) for dependency direction and the shared-state
contract. The UDP adapter is intentionally isolated in `packages/atem-protocol`, so the same
core supports Electron, headless Node, Docker, and other hosts.

## License and third-party work

This project is MIT licensed. The test suite uses the MIT-licensed `atem-connection@3.9.0`
client as an interoperability test fixture; the server is an independent implementation. The
protocol notes also cite Bitfocus Companion and public OpenSwitcher documentation. No emulator
implementation was copied into this project. See [docs/protocol-notes.md](docs/protocol-notes.md)
for sources and the license assessment.
