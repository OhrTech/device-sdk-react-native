# Changelog

## 0.1.0 (2026-11-09)

The first release: every area of the OhrTech Device SDK (net.ohrtech:device-sdk 0.3.1) for React Native on
Android (New Architecture), needing the OhrTech Agent 1059 or later (1061 for diagnostics, USB devices,
certificates and the kiosk exit PIN).

- An object per area: `OhrDevice`, `OhrUpdates`, `OhrWifi`, `OhrNetwork`, `OhrKiosk`, `OhrPower`, `OhrSettings`,
  `OhrConfig`, `OhrAttestation`, `OhrCertificates`, `OhrUsb`, `OhrDiagnostics`, `OhrKeys`, `OhrPush`; `OhrAccess`
  and `OhrDeviceSdk` (the connection). Changes through `add…Listener`, which watch the Agent from the first
  listener to the last `remove()`.
- `<OhrWifiView>`: the Agent's Wi-Fi screen as a Fabric component.
- Push handled by a headless task, whether the app is open or not.
- `OhrCertificates.fetch()`: HTTPS with the app's client certificate and trusted CAs, over Android's TLS.
- `OhrKiosk.heartbeat()` beats from the JavaScript thread, paused while the app is in the background.
- An Expo config plugin that sets minSdkVersion 33.
