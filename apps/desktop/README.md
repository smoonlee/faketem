# Desktop wrapper

The Electron host starts the shared runtime and opens its local control panel. Configuration and
media are stored in the user's application data directory, separately from the source checkout.
The HTTP port is selected automatically; the configured ATEM UDP port must be available.

From the repository root, `npm run desktop` runs the application and `npm run dist:desktop`
builds packages for the current platform in `release/desktop`. The GitHub desktop release
workflow builds Windows, macOS, and Linux packages on their respective platforms. Windows
packages include an installer, a portable executable, and a ZIP containing the unpacked app.
Builds are unsigned and macOS packages are not notarized.
