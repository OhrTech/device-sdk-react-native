# OhrTech Device SDK for React Native

`@ohrtech/device-sdk-react-native`: what an app on an OhrTech device can ask the OhrTech Agent for. Who the
device is, the app's own updates, Wi-Fi (with Android's Wi-Fi screen embedded in your layout), mobile data and
airplane mode, kiosk mode, power, settings, managed configuration, KEM keys and attestation in the device's
TEE, client certificates, pre-approved USB devices, its own events and logs, and push from your own server,
end to end.

**Documentation: <https://docs.ohrtech.net/device-sdk/>**

```sh
npm install @ohrtech/device-sdk-react-native
```

Android only, 13 (API 33) and up, on OhrTech devices with the OhrTech Agent 1059 or later. React Native's New
Architecture (a Turbo Module and a Fabric component). Set `minSdkVersion = 33` in `android/build.gradle`; with
Expo, add the config plugin, which does it, and use a development build:

```json
{ "expo": { "plugins": ["@ohrtech/device-sdk-react-native"] } }
```

It wraps the Kotlin library ([net.ohrtech:device-sdk](https://github.com/OhrTech/device-sdk-android)), so the
Agent protocol and its checks are the same as for Kotlin apps.

## Who may use what

The Agent answers apps your organisation installed through OhrTech; others get `OhrNotManaged`. Reading is
mostly always allowed. Changing something needs the fleet's grant for that area, set in the portal under the
fleet's apps: `wifi`, `network`, `kiosk`, `power`, `settings`. Settings and networks the fleet locks stay
locked (`OhrFleetLocked`).

## Use

```ts
import { OhrAccess, OhrDevice, OhrKiosk, OhrWifi } from '@ohrtech/device-sdk-react-native';

const info = await OhrDevice.info();                    // deviceId "dev_…", fleet, org, OS, Agent
if (await OhrAccess.mayUse('kiosk')) await OhrKiosk.start();
const sub = OhrWifi.addStateListener((s) => console.log(s.connected?.ssid));   // sub.remove() to stop
```

Each area is an object; there is nothing to connect or close. The module binds the Agent on the first call and
keeps the binding; when the Agent stops (a crash, its own update) it binds again, and every listener goes on.
`OhrDeviceSdk.addConnectionListener` says how it stands.

| Object | |
|---|---|
| `OhrDevice` | `info()`: device id, serial, fleet, org, OS version and patch, Agent version, online |
| `OhrUpdates` | `available()`, `install({ whenIdle })`, `addChangeListener`: the app's own updates the hub offers |
| `OhrWifi` | state, networks around, saved networks, `save`, `connect`, `forget`, `setEnabled`, `connectQr` |
| `OhrNetwork` | `state()`, `setMobileData`, `setAirplaneMode`, `setDataRoaming` |
| `OhrKiosk` | `start(features)`, `stop()`, `state()`, `requestExit()`, `heartbeat()` |
| `OhrPower` | `battery()`, `reboot`, `scheduleReboot`, `setScreenTimeout`, `setBrightness` |
| `OhrSettings` | `keys()`, `get(key)`, `set(key, value)`: the device settings apps may change |
| `OhrConfig` | the app's managed configuration, as its fleet or device sets it |
| `OhrAttestation` | `attest(challenge)`, `token(audience)`: proof for your server of this app on this device |
| `OhrCertificates` | client certificates made on the device or imported; `fetch()` for HTTPS with them |
| `OhrUsb` | the USB devices the fleet pre-approves for the app: no permission prompt |
| `OhrDiagnostics` | the app's own events and log lines for the hub; crashes are reported without it |
| `OhrKeys` | TEE KEM keys: ML-KEM, X-Wing, X25519 for HPKE |
| `OhrPush` | end-to-end push: see below |

Every call can throw an `OhrException`; switch on its `code`: `NotManaged`, `NotAllowed` (`area`),
`FleetLocked` (`key`), `Unsupported` (`reason`, `needsAgent`), `InvalidConfig` (`field`, `reason`), `Refused`
(`reason`) or `Failed` (`reason`). Each is also a class (`OhrFleetLocked`, ...) for `instanceof`.

## The Wi-Fi screen

```tsx
<OhrWifiView
  style={{ flex: 1 }}
  theme={{ accent: '#3f51b5' }}
  onConnected={(ssid) => console.log(`joined ${ssid}`)}
  onError={(e) => console.log(e.message)}
/>
```

The Agent draws Android's Wi-Fi screen inside the component: no other activity or window opens, so a kiosk app
stays a kiosk.

## Kiosk heartbeat

`OhrKiosk.heartbeat()` beats from the JavaScript thread: if it hangs for longer than the timeout, the Agent stops
the app and starts it again. Call it after `OhrKiosk.start()`. JavaScript timers stop while the app is in the
background (the screen off, say), so the watch pauses there and resumes when the app is active again.

## Push

Messages from your server, sealed to the device's TEE key and signed by your sender key; the OhrTech hub only
carries them. The handlers run as a headless task, whether the app is open or not, so set them in `index.js`,
before `AppRegistry.registerComponent`:

```js
import { OhrPush } from '@ohrtech/device-sdk-react-native';

OhrPush.setHandlers({
  onMessage: async (message) => {
    // message.data: your server's bytes, verified, opened, in date and not seen before
  },
});
AppRegistry.registerComponent(appName, () => App);
```

```ts
const token = await OhrPush.register([{ ed25519: ED25519_PUBLIC_KEY_BASE64 }]);
// Send token.token and token.publicKey to your server.
```

The module declares the push service in its manifest; your app needs nothing more.

## Client certificates

The keys stay in the device's Android Keystore, which `fetch` can't use, so make requests that need the app's
client certificate with the module's, which goes through Android's TLS:

```ts
const r = await OhrCertificates.fetch('https://api.example.com/orders', { alias: 'orders' });
const orders = r.json();
```

It also trusts the private CAs the fleet gives the app. Bodies are sent and read whole.

## License

MIT
