import { useEffect, useState } from 'react';
import { Button, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import {
  OhrAccess,
  OhrDevice,
  OhrException,
  OhrKiosk,
  OhrWifiView,
} from '@ohrtech/device-sdk-react-native';

import { Checks } from './Checks';

/** The sample screen, or the device checks when started with `--es route /checks/<name>?…`. */
export default function App({ route }: { route?: string }) {
  if (route?.startsWith('/checks/')) return <Checks route={route} />;
  return <Sample />;
}

/** A kiosk app's page: who the device is, kiosk on and off, and the Agent's Wi-Fi screen below. */
function Sample() {
  const [status, setStatus] = useState('Asking the Agent…');
  const show = (s: string) => {
    console.log(s);
    setStatus(s);
  };
  useEffect(() => {
    (async () => {
      try {
        const info = await OhrDevice.info();
        const access = await OhrAccess.info();
        show(
          `${info.deviceId} · ${info.fleet?.name} · Agent ${info.agentVersion}\nmay use: ${access.areas.join(', ')}`
        );
      } catch (e) {
        show(`Device SDK: ${(e as OhrException).message}`);
      }
    })();
  }, []);
  const run = (label: string, action: () => Promise<void>) => async () => {
    try {
      await action();
      show(label);
    } catch (e) {
      show(
        `${label}: ${(e as OhrException).code}: ${(e as OhrException).message}`
      );
    }
  };
  return (
    <SafeAreaView style={styles.page}>
      <Text style={styles.status}>{status}</Text>
      <View style={styles.buttons}>
        <Button
          title="Kiosk on"
          onPress={run('kiosk on', () => OhrKiosk.start())}
        />
        <Button title="Kiosk off" onPress={run('kiosk off', OhrKiosk.stop)} />
      </View>
      <OhrWifiView
        style={styles.wifi}
        onConnected={(ssid) => show(`joined ${ssid}`)}
        onError={(e) => show(`Wi-Fi screen: ${e.message}`)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  status: { padding: 12 },
  buttons: { flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
  wifi: { flex: 1, marginTop: 8 },
});
