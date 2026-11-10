import { AppRegistry } from 'react-native';
import { OhrPush } from '@ohrtech/device-sdk-react-native';
import App from './src/App';
import { name as appName } from './app.json';

// Push handlers first, at the entry point: a message can start the app with no UI.
OhrPush.setHandlers({
  onMessage: async (m) => {
    const text = String.fromCharCode(...m.data);
    // The device checks' failing handler: the hub then shows the message as dropped (app_handler).
    if (text.includes('"fail"'))
      throw new Error('the handler failed, as asked');
    console.log(`PUSH RECEIVED ${m.id} (${m.pushId}): ${text}`);
  },
  onDropped: async (pushId, reason) =>
    console.log(`PUSH DROPPED ${pushId}: ${reason}`),
  onTokenChanged: async (t) =>
    console.log(`PUSH TOKEN now ${t?.token ?? null}`),
});

AppRegistry.registerComponent(appName, () => App);
