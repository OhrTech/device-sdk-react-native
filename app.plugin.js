// Expo config plugin: `"plugins": ["@ohrtech/device-sdk-react-native"]` in app.json. The module needs
// Android 13 (API 33), so it raises the app's minSdkVersion to 33. The push service needs nothing: it is in
// the module's own manifest, which Android merges into the app's.
const { withGradleProperties } = require('@expo/config-plugins');

const MIN_SDK = 33;

module.exports = function withOhrDeviceSdk(config) {
  return withGradleProperties(config, (c) => {
    const props = c.modResults;
    const entry = props.find((p) => p.type === 'property' && p.key === 'android.minSdkVersion');
    if (!entry) props.push({ type: 'property', key: 'android.minSdkVersion', value: String(MIN_SDK) });
    else if (Number(entry.value) < MIN_SDK) entry.value = String(MIN_SDK);
    return c;
  });
};
