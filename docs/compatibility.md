# ATEM and Companion compatibility

ATEM Sandbox models a subset of ATEM control and feedback for developing and rehearsing
workflows. It is not a hardware emulator, and an advertised device profile does not imply full
feature parity. Validate show-critical workflows on the actual switcher.

## Device profiles

The selectable profiles advertise one M/E and twenty still slots, with the following supported
inputs and keyers:

| Profile                       | HDMI inputs | Media players | Upstream keyers | Downstream keyers |
| ----------------------------- | ----------: | ------------: | --------------: | ----------------: |
| ATEM Mini Extreme ISO G2      |           8 |             2 |               4 |                 2 |
| ATEM Mini Extreme ISO (Gen 1) |           8 |             2 |               4 |                 2 |
| ATEM Mini Pro ISO             |           4 |             1 |               1 |                 1 |
| ATEM Mini Pro                 |           4 |             1 |               1 |                 1 |

SuperSource is modeled for the Extreme profiles, but not the Pro profiles. The G2's ninth
non-HDMI video path is not modeled. Hardware effects such as DVE, chroma and pattern keying are
not fully implemented, even where the corresponding hardware supports them.

## Modeled controls and feedback

The sandbox supports the following control and state surfaces, within the selected profile's
limits:

- Program and Preview routing, CUT, AUTO, mix/dip/wipe transition settings, and Fade to Black.
- Media Player still selection, twenty Media Pool stills, auxiliary routing, and tally feedback.
- Upstream keyer on-air, type, fill and cut sources; downstream keyer on-air, tie, rate and auto.
- Multiviewer layout and window sources, display clock, timecode, and camera control messages.
- Simulated recording and streaming controls, status, elapsed time, disk lifecycle, service
  validation and streaming statistics. No video is recorded or streamed.
- Classic audio master controls and Fairlight master and stereo mic/XLR input mix and fader
  state. The sandbox does not produce, meter, process or mix audio.
- SuperSource art, border and box controls on Extreme profiles. The simulated composite
  approximates art keying and borders; bevel, softness and lighting are not simulated.
- Persistent macros for routing, CUT/AUTO, transition settings, key on-air/tie, auxiliary
  routing, Media Player stills, timed pauses and user waits. Run, stop, continue and looping
  are modeled. Unsupported recorded operations prevent playback; macro file import/export and
  hardware-exact timing are not supported.

Control or feedback availability does not guarantee every Companion action, variable, or
feedback variant is supported. Advanced keying, compositing, transitions, audio processing and
macro workflows require particular care when transferring to hardware.

## Validation

Automated tests exercise the UDP adapter with `atem-connection@3.9.0`, including routing,
transitions, media and other modeled controls. They also cover profile-specific topology and
recording and streaming state.

A focused manual smoke test used Companion 5.1.1 and the `bmd-atem` module 4.4.0 with one ATEM
Mini Extreme ISO profile. Companion detected the model, a Preview action changed the sandbox
input, and a sandbox Preview change updated Companion input variables. This does not establish
comprehensive Companion, multi-profile, macro, or real-hardware compatibility.

See [protocol notes](protocol-notes.md) for wire behavior and source references.
