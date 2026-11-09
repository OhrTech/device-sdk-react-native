import {
  codegenNativeComponent,
  type CodegenTypes,
  type ViewProps,
} from 'react-native';

type ConnectedEvent = Readonly<{ ssid: string }>;
type WifiErrorEvent = Readonly<{
  code: string;
  message: string;
  detailsJson: string;
}>;

export interface NativeProps extends ViewProps {
  themeJson?: string;
  optionsJson?: string;
  onConnected?: CodegenTypes.DirectEventHandler<ConnectedEvent>;
  onWifiError?: CodegenTypes.DirectEventHandler<WifiErrorEvent>;
}

export default codegenNativeComponent<NativeProps>('OhrWifiView');
