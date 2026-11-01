# ATEM protocol adapter notes

`packages/atem-protocol` is the server-side UDP adapter used by ATEM Sandbox. It listens on the
configured UDP port (9910 by default), translates the supported inbound controls to the shared
state model, and sends matching feedback to active UDP sessions.

This is a deliberately small interoperability surface, not an ATEM hardware emulator or a
claim of universal ATEM-client compatibility. The automated local integration test reaches
`connected` with the lockfile-pinned `atem-connection@3.9.0` client. A separate manual Companion
routing smoke test is documented in the [compatibility reference](compatibility.md); it is
not comprehensive validation of the Companion application.

## Scope and sources

The compatibility target was informed by Bitfocus Companion's `bmd-atem` module. In its
[v4.1.2 source](https://github.com/bitfocus/companion-module-bmd-atem/tree/5b4c7285c146eef72494df5525b729ce424e3598),
the module declares `atem-connection` 3.9.0 as its ATEM transport dependency in
[its package manifest](https://github.com/bitfocus/companion-module-bmd-atem/blob/5b4c7285c146eef72494df5525b729ce424e3598/package.json#L35-L40).
It creates an `Atem` client, waits for its `connected` event, and derives device information
from the resulting state; see
[its connection lifecycle](https://github.com/bitfocus/companion-module-bmd-atem/blob/5b4c7285c146eef72494df5525b729ce424e3598/src/main.ts#L592-L701).

Both that module and [sofie-atem-connection](https://github.com/Sofie-Automation/sofie-atem-connection)
are MIT licensed. `atem-connection` is a client transport, not an ATEM server. ATEM Sandbox
uses it as a behavioral reference and a development-test client only; the UDP server does not
import it at runtime.

The [OpenSwitcher UDP transport notes](https://docs.openswitcher.org/udptransport.html)
corroborate the packet format. No third-party emulator source has been copied into this repository.

## Implemented transport behavior

ATEM control uses UDP, normally port 9910. Each datagram starts with a 12-byte header:

| Bytes | Meaning                                                                   |
| ----- | ------------------------------------------------------------------------- |
| 0–1   | Big-endian header flags plus datagram length; the length mask is `0x07ff` |
| 2–3   | Session ID                                                                |
| 4–5   | Acknowledgement number when the ACK-reply flag is present                 |
| 6–7   | Retransmit-from sequence when retransmit is requested                     |
| 8–9   | Second retransmit/reserved sequence field                                 |
| 10–11 | Sender packet sequence ID                                                 |

Relevant flag bits are ACK request (`0x01`), new session/SYN (`0x02`), retransmit (`0x04`),
retransmit request (`0x08`), and ACK reply (`0x10`). Sequence numbers are 15-bit and wrap
after 32767. These constants and the retry behavior are visible in the current
[atemSocketChild implementation](https://github.com/Sofie-Automation/sofie-atem-connection/blob/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/lib/atemSocketChild.ts#L7-L34).

Each remote UDP endpoint has separate session state: an allocated server session ID, inbound
and outbound sequence counters, ACK/retry outbox, duplicate-command guard, and last-seen time.
The implemented flow is:

1. Receive a client new-session/SYN datagram.
2. Allocate a server session ID for that endpoint and send the v1 SYN response at sequence
   zero.
3. On the client's acknowledgement of sequence zero, send the initial state dump as reliable
   packet sequence(s).
4. Promptly ACK reliable inbound controls, apply each inbound sequence only once, retain
   reliable outbound packets until acknowledged, and resend on retry or retransmit request.
5. Broadcast shared-state updates to all ready sessions. When the outbox is clear, send a
   reliable heartbeat about every second; inactive sessions expire after a short timeout.

The current implementation uses a 75 ms retry interval with a bounded retry count. Those
timings are implementation details, not a hardware timing guarantee.

The client payload is a sequence of command records:

```text
u16be record length | 00 00 | four-byte ASCII command name | command payload
```

The record length includes the eight-byte record header. See the upstream
[packet record parser](https://github.com/Sofie-Automation/sofie-atem-connection/blob/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/lib/atemSocket.ts#L180-L220).

## Initial client state

After the handshake ACK, the adapter sends an ordered reliable snapshot. In addition to the
records described below, it includes modeled recording, streaming, keyer, audio, multiviewer,
macro, and profile-dependent SuperSource state. The projection implementation defines the
complete current record sequence.

The significant records are:

- `_ver` reports ATEM protocol v9.4 (`0x0002001f`).
- `_pin` identifies the selected v1-compatible ATEM identity profile. The default is `ATEM Mini
Extreme ISO (Gen 1)`. The selector also reports HDMI input ports consistently with the selected
  Mini identity.
- `_top` precedes M/E-dependent state and declares one M/E plus the selected profile's media
  player and downstream-keyer counts; `_MeC` advertises the selected profile's upstream-keyer
  count. The
  [topology state parser](https://github.com/Sofie-Automation/sofie-atem-connection/blob/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/commands/DeviceProfile/topologyCommand.ts)
  confirms the dependency ordering.
- `InPr` exposes the selected profile's camera inputs (1–4 or 1–8) and its supported
  media-player source IDs: MP1 (3010) or MP1/MP2 (3010/3020).
- `PrgI` and `PrvI` provide the M/E 1 Program and Preview source IDs.
- `TrSS`, `TMxP`, and `TrPs` expose transition style, rate, and in-progress state.
- `MPfe` announces configured stills, while `MPCE` identifies each player's selected still.
  Media-player IDs and still indexes are zero-based in wire records.
- `InCm` is the final, non-empty record. The client reaches its ready parsing state only once it
  receives a non-empty record; see
  [atem.ts](https://github.com/Sofie-Automation/sofie-atem-connection/blob/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/atem.ts#L225-L295).

An upstream [Mini Extreme ISO v9.5 capture](https://github.com/Sofie-Automation/sofie-atem-connection/blob/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/__tests__/connection/mini-extreme-iso-v9.5.data)
is a useful semantic fixture. It is not replayed: the sandbox generates feedback from its single
live state model.

### Identity profile boundary

The Model selector resets the sandbox to one of these identities. Existing UDP sessions are
cleared so clients reconnect and receive a coherent initial snapshot:

| Identity profile                       | HDMI inputs | Media Players | Upstream Keyers | Downstream Keyers | Reported input interface |
| -------------------------------------- | ----------- | ------------- | --------------- | ----------------- | ------------------------ |
| ATEM Mini Extreme ISO G2               | 8           | 2             | 4               | 2                 | HDMI                     |
| ATEM Mini Extreme ISO (Gen 1, default) | 8           | 2             | 4               | 2                 | HDMI                     |
| ATEM Mini Pro ISO                      | 4           | 1             | 1               | 1                 | HDMI                     |
| ATEM Mini Pro                          | 4           | 1             | 1               | 1                 | HDMI                     |

All profiles retain the supported v1 sandbox transition/routing surface of one M/E and twenty
still slots, while advertising model-accurate HDMI input, media-player, and keyer counts. The
sandbox also models subsets of recording and streaming control/state, disk lifecycle, service
validation, audio controls, SuperSource, macros, and auxiliary routing. It does not emulate
arbitrary ATEM hardware topology, actual video recording or streaming, format conversion, audio
signals, or complete hardware behavior for those features. The Mini Extreme ISO G2's ninth
non-HDMI video path and other extra hardware features are not projected.

## Supported control mapping

The adapter maps supported commands into `AtemStateStore` and broadcasts the resulting feedback
to all ready UDP sessions. The following table shows the core routing and media subset, not the
complete command surface:

| Inbound command | Shared-state operation   | Feedback                                   |
| --------------- | ------------------------ | ------------------------------------------ |
| `CPgI`          | `setProgram`             | `PrgI`                                     |
| `CPvI`          | `setPreview`             | `PrvI`                                     |
| `DCut`          | `cut`                    | `PrgI`, `PrvI`                             |
| `DAut`          | `auto`                   | starting/final `TrPs`, then `PrgI`, `PrvI` |
| `CTTp`          | `setTransitionType`      | `TrSS`                                     |
| `CTMx`          | `setTransitionRate`      | `TMxP`                                     |
| `MPSS`          | `selectMediaPlayerStill` | `MPCE`                                     |

The upstream serializers are useful field-level references for
[Program](https://github.com/Sofie-Automation/sofie-atem-connection/blob/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/commands/MixEffects/ProgramInputCommand.ts),
[Preview](https://github.com/Sofie-Automation/sofie-atem-connection/blob/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/commands/MixEffects/PreviewInputCommand.ts),
[transitions](https://github.com/Sofie-Automation/sofie-atem-connection/tree/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/commands/MixEffects/Transition),
and [media-player selection](https://github.com/Sofie-Automation/sofie-atem-connection/blob/4af354321d7fdf4be5381c9343f28a50e25c43f1/src/commands/Media/MediaPlayerSourceCommand.ts).
Companion's basic Program/Preview feedback compares Program and Preview fields directly, so
basic v1 feedback does not require tally emulation; see its
[feedback implementation](https://github.com/bitfocus/companion-module-bmd-atem/blob/5b4c7285c146eef72494df5525b729ce424e3598/src/feedback/mixeffect/programPreview.ts).

Only M/E 1 is exposed. The adapter advertises the selected profile's four or eight physical HDMI
inputs and its supported media-player count (MP1 or MP1/MP2); it supports still sources for the
media players and mix, dip, and wipe transitions. Unsupported commands and unavailable sources are
ignored with a diagnostic rather than being fabricated.

## Implementation boundary and validation

`packages/atem-protocol` owns transport concerns only: packet/record codec, command decoder,
state projection, session manager, ACK/retry outbox, and heartbeat. It receives a narrow
state-controller interface rather than mutating the store directly.

One global `AtemStateStore` remains the source of truth. State changes from the web UI and UDP
clients use that same model and are projected to each active UDP session. Per-session transport
state never becomes a second routing authority.

The test suite covers packet/record framing, initial-state projection, and a real local UDP
connection through `atem-connection@3.9.0`. The integration test verifies `connected`, initial
Program/Preview/device state, and Program, Preview, CUT, AUTO, transition rate/style, and
media-player still controls, as well as other supported surfaces including macro operations.
Broader manual Bitfocus Companion validation and client/device coverage remain follow-up work.
