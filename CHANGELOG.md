# Changelog

## 0.1.2 (2026-11-10)

Builds on net.ohrtech:device-sdk 0.4.0.

- The module's methods and changes are the library's `OhrJsonApi`, which OhrTech web apps' Device SDK shares: the same
  names, arguments and JSON as before.

## 0.1.1 (2026-11-10)

Builds on net.ohrtech:device-sdk 0.3.2.

- A push message that doesn't reach your handler is no longer lost silently: the hub shows it as dropped, and its id is forgotten, so the sender may send it again (before, it was logged and counted as delivered). The reason says why:
  `app_no_handler` (no `OhrPush.setHandlers` at the entry point), `app_no_engine` (React Native didn't start),
  `app_handler_timeout` (over 25 s) or `app_handler` (the handler threw). A handler that throws no longer keeps the
  headless task running for 25 s.
- `OhrKiosk.heartbeat` returns a Promise, which rejects with `OhrUnsupported` (needs Agent 1061) instead of beating
  into nothing on an older Agent.
- `OhrDeviceSdk.addConnectionListener` starts with how the connection stands for every listener, not only the first.
- `OhrCertificates.fetch` drops its cached TLS setup when the fleet changes the app's certificates (trusted CAs,
  bundles), not only after `request` or a renewal: with Agent 1061 or later, such a change applies to the next request.

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
