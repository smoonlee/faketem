# ATEM protocol adapter

This package is the server-side UDP adapter for ATEM Sandbox. `AtemProtocolServer` listens on
the configured UDP host and port, runs a small ATEM-compatible session layer, decodes the
supported controls, and projects shared state back to each connected client.

It has four deliberately separate responsibilities:

- packet and command-record framing;
- per-endpoint handshake, ACK/retry, retransmit, heartbeat, and timeout handling;
- decoding supported ATEM control commands into semantic operations;
- projecting the shared state into initial and incremental ATEM feedback records.

The package never owns Program/Preview state. Its `AtemProtocolControl` facade is implemented
by the runtime, so web and UDP controls observe and change the same `AtemStateStore`.

The advertised device surface includes one M/E, the selected profile's HDMI inputs (1–4 or 1–8),
its supported media-player and keyer counts, still media, and additional modeled control/state
surfaces. It is not a complete ATEM emulator; unsupported commands and unavailable sources are
deliberately not simulated. See [ATEM and Companion compatibility](../../docs/compatibility.md)
for the current feature boundaries.

`test/protocol-server.test.ts` starts the real UDP server and connects the lockfile-pinned
`atem-connection@3.9.0` client with multithreading disabled. The test reaches `connected` and
exercises routing, transitions, media, macros, and other supported controls. A separate manual
Companion routing smoke test is documented in the compatibility reference; broader manual validation
remains outstanding.

See [`docs/protocol-notes.md`](../../docs/protocol-notes.md) for packet/session details,
compatibility scope, and source/license notes.
