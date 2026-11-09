import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  OhrAccess,
  OhrAttestation,
  OhrCertificates,
  OhrConfig,
  OhrDevice,
  OhrDeviceSdk,
  OhrDiagnostics,
  OhrInvalidConfig,
  OhrKeys,
  OhrKiosk,
  OhrNetwork,
  OhrPower,
  OhrPush,
  OhrSettings,
  OhrUpdates,
  OhrUsb,
  OhrWifi,
  type OhrSubscription,
} from '@ohrtech/device-sdk-react-native';

/**
 * Device checks of the module against the real Agent and TEE, as the Kotlin library's:
 * `am start -n <pkg>/net.ohrtech.device.reactnative.example.MainActivity --es route '/checks/<name>?<args>'`.
 * Logs "CHECK PASS|FAIL name detail" and "CHECK DONE" (logcat tag ReactNativeJS).
 */
export function Checks({ route }: { route: string }) {
  const [summary, setSummary] = useState('running…');
  useEffect(() => {
    run(route).then(setSummary);
  }, [route]);
  return (
    <View style={styles.page}>
      <Text>{summary}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 24 },
});

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function expect(ok: boolean, what: string) {
  if (!ok) throw new Error(what);
}

async function run(route: string): Promise<string> {
  const [path, query = ''] = route.split('?');
  const check = path!.split('/').pop()!;
  const args = Object.fromEntries(
    query
      .split('&')
      .filter(Boolean)
      .map((kv) => kv.split('=').map(decodeURIComponent) as [string, string])
  );
  let passed = 0,
    failed = 0;
  const step = async (name: string, body: () => Promise<unknown> | unknown) => {
    try {
      const r = await body();
      passed++;
      console.log(`CHECK PASS ${name} ${typeof r === 'string' ? r : ''}`);
    } catch (e) {
      failed++;
      console.log(
        `CHECK FAIL ${name}: ${(e as Error).name}: ${(e as Error).message}`
      );
    }
  };

  switch (check) {
    case 'basics':
      await step('connect', () => OhrDeviceSdk.connect());
      await step('connection', () => OhrDeviceSdk.connection());
      await step('access', async () => (await OhrAccess.info()).app);
      await step('device', async () => (await OhrDevice.info()).deviceId);
      await step(
        'updates',
        async () => `${(await OhrUpdates.available())?.versionCode}`
      );
      await step('wifi state', async () => {
        const s = await OhrWifi.state();
        return `${s.state} ${s.connected?.ssid}`;
      });
      await step(
        'wifi networks',
        async () => `${(await OhrWifi.networks()).length} networks`
      );
      await step(
        'network',
        async () => `${(await OhrNetwork.state()).active?.transport}`
      );
      await step('kiosk state', async () => (await OhrKiosk.state()).mode);
      await step('battery', async () => `${(await OhrPower.battery()).level}%`);
      await step(
        'settings keys',
        async () => `${(await OhrSettings.keys()).length} keys`
      );
      await step('timeout 0 refused', async () => {
        try {
          await OhrSettings.set('display.timeout', 0);
        } catch (e) {
          if (e instanceof OhrInvalidConfig) return e.reason;
          throw e;
        }
        throw new Error('accepted 0');
      });
      await step('timeout 45 accepted', async () => {
        const before = (await OhrSettings.get('display.timeout')).value;
        await OhrSettings.set('display.timeout', 45);
        const now = (await OhrSettings.get('display.timeout')).value;
        await OhrSettings.set('display.timeout', before);
        expect(`${now}` === '45', `read back ${now}`);
        return `45 (back to ${before})`;
      });
      await step('config', async () =>
        JSON.stringify(await OhrConfig.values())
      );
      await step(
        'usb',
        async () => `${(await OhrUsb.devices()).length} attached`
      );
      await step('diag events', async () => {
        await OhrDiagnostics.event('rn_checks', { run: 1 });
        await OhrDiagnostics.i('Checks', 'a line from the React Native checks');
        return '1 event, 1 line';
      });
      await step('bad event refused', async () => {
        try {
          await OhrDiagnostics.event('Bad Name');
        } catch (e) {
          if (e instanceof OhrInvalidConfig) return e.field;
          throw e;
        }
        throw new Error('accepted a bad name');
      });
      await step(
        'listener: connection',
        () =>
          new Promise<string>((resolve, reject) => {
            const t = setTimeout(
              () => reject(new Error('nothing in 5 s')),
              5000
            );
            const s = OhrDeviceSdk.addConnectionListener((c) => {
              clearTimeout(t);
              s.remove();
              resolve(c);
            });
          })
      );
      break;
    case 'security':
      await step('attest ec', async () => {
        const a = await OhrAttestation.attest(bytes('rn-checks'));
        return `${a.ec.length} certificates, ${a.suite}`;
      });
      await step(
        'token ec',
        async () =>
          `${(await OhrAttestation.token('https://example.test')).split('.').length} parts`
      );
      await step('attest ec+ml-dsa-65', async () => {
        const a = await OhrAttestation.attest(bytes('rn-checks'), 'ec-mldsa65');
        return `ec ${a.ec.length}, ml-dsa ${a.mlDsa65!.length}`;
      });
      await step('kem x-wing', async () => {
        const pub = await OhrKeys.generate('r.xwing', 'X-Wing');
        const e = await OhrKeys.encapsulate('X-Wing', pub);
        const s = await OhrKeys.decapsulate('r.xwing', e.ciphertext);
        expect(
          s.length === 32 && s.every((b, i) => b === e.sharedSecret[i]),
          'secrets differ'
        );
        return `${pub.length} B key, ${e.ciphertext.length} B ciphertext`;
      });
      await step('key attest', async () => {
        const a = await OhrKeys.attest('r.xwing', bytes('c'));
        expect(a.owner.startsWith('app:'), a.owner);
        return `owner ${a.owner.split(':').pop()}`;
      });
      await step('key delete', async () => {
        await OhrKeys.delete('r.xwing');
        expect((await OhrKeys.publicKey('r.xwing')) === null, 'still there');
        return 'ok';
      });
      await step('certificates', async () => {
        if (!(await OhrCertificates.canRequest()))
          return 'no issuing CA for this app';
        const c = await OhrCertificates.request('rn-checks');
        return `${c.paths.length} paths, ${(await OhrCertificates.list()).length} listed`;
      });
      if (args.tlsUrl) {
        await step('mutual TLS', async () => {
          const r = await OhrCertificates.fetch(args.tlsUrl!, {
            alias: args.tlsAlias ?? 'rn-checks',
          });
          return `HTTP ${r.status}, ${r.bytes().length} bytes`;
        });
      }
      break;
    case 'push':
      await step('register', async () => {
        const t = await OhrPush.register([{ ed25519: args.senderKey! }]);
        console.log(`CHECK TOKEN ${JSON.stringify(t)}`);
        return t.token;
      });
      await step('token', async () => (await OhrPush.token())?.token);
      break;
    case 'unregister':
      await step('unregister', async () => {
        await OhrPush.unregister();
        expect((await OhrPush.token()) === null, 'token left');
        return 'no token';
      });
      break;
    case 'reconnect': {
      const states: string[] = [];
      const heard: Record<string, number> = {};
      let back = false;
      const hear = (n: string) => () => {
        if (back) heard[n] = (heard[n] ?? 0) + 1;
      };
      const subs: OhrSubscription[] = [
        OhrDeviceSdk.addConnectionListener((c) => {
          states.push(c);
          if (c === 'CONNECTED' && states.includes('RECONNECTING')) back = true;
        }),
        OhrPower.addBatteryListener(hear('battery')),
        OhrNetwork.addChangeListener(hear('network')),
        OhrKiosk.addModeListener(hear('kiosk')),
      ];
      await sleep(1000);
      console.log('CHECK READY reconnect');
      const until = Date.now() + 120_000;
      while (Date.now() < until && !(back && Object.keys(heard).length === 3))
        await sleep(250);
      await step('agent stopped and came back', () => {
        expect(back, `states ${states.join(' > ')}`);
        return states.join(' > ');
      });
      await step('listeners heard again', () => {
        expect(
          Object.keys(heard).length === 3,
          `heard ${JSON.stringify(heard)}`
        );
        return JSON.stringify(heard);
      });
      await step('calls after', async () => (await OhrDevice.info()).deviceId);
      subs.forEach((s) => s.remove());
      break;
    }
    case 'kiosk-idle':
      // Kiosk mode with a 3 s heartbeat that goes on after DONE; the harness then turns the screen off.
      await step('kiosk start', () => OhrKiosk.start());
      await step('heartbeat', () => OhrKiosk.heartbeat(3000));
      break;
    case 'kiosk-stop':
      await step('stop heartbeat', () => OhrKiosk.stopHeartbeat());
      await step('kiosk stop', async () => {
        await OhrKiosk.stop();
        return (await OhrKiosk.state()).mode;
      });
      break;
    case 'heartbeat':
      await step('kiosk start', () => OhrKiosk.start());
      await step('heartbeat, then hang', async () => {
        // Beats every 750 ms from the JS thread; then the JS thread stops for 30 s: the Agent restarts the app.
        OhrKiosk.heartbeat(3000);
        await sleep(2000);
        console.log('CHECK HANGING');
        const until = Date.now() + 30_000;
        while (Date.now() < until) {}
        throw new Error('still alive 30 s later');
      });
      break;
  }
  const s = `CHECK DONE ${check}: ${passed} passed, ${failed} failed`;
  console.log(s);
  return s;
}
