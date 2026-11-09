import { AppRegistry } from 'react-native';
import { OhrPush } from '@ohrtech/device-sdk-react-native';
import App from './src/App';
import { name as appName } from './app.json';

// Push handlers first, at the entry point: a message can start the app with no UI.
OhrPush.setHandlers({
  onMessage: async (m) =>
    console.log(
      `PUSH RECEIVED ${m.id} (${m.pushId}): ${String.fromCharCode(...m.data)}`
    ),
  onDropped: async (pushId, reason) =>
    console.log(`PUSH DROPPED ${pushId}: ${reason}`),
  onTokenChanged: async (t) =>
    console.log(`PUSH TOKEN now ${t?.token ?? null}`),
});

AppRegistry.registerComponent(appName, () => App);
