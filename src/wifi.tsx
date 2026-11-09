import { processColor, type ColorValue, type ViewProps } from 'react-native';

import { call, listen, ohrException, type OhrException } from './core';
import NativeWifiView from './OhrWifiViewNativeComponent';

export interface OhrWifiState {
  enabled: boolean;
  /** "on", "off", "turningOn" or "turningOff". */
  state: string;
  /** The current network (the Agent's JSON, with "ssid"), or null. */
  connected: Record<string, unknown> | null;
}

/** One network in range, as the Agent describes it. [key] joins it with OhrWifi.connect. */
export interface OhrWifiNetwork {
  key: string;
  title: string;
  ssid?: string | null;
  security: string[];
  /** Signal level, 0-4, or -1. */
  level: number;
  saved: boolean;
  /** "connected", "connecting" or absent. */
  connected?: string;
  internet?: boolean;
  metered?: boolean;
  /** One of the fleet's networks: read-only to apps. */
  fleet: boolean;
  [more: string]: unknown;
}

/** A network config of the OhrTech Wi-Fi model (the fleet setting "Saved Wi-Fi networks"). */
export type OhrWifiConfig = Record<string, unknown>;

/**
 * Wi-Fi: state and the networks around, read always; changes with the fleet's "wifi" grant. The fleet's own
 * networks are read-only (OhrFleetLocked "wifi.networks"). For a ready-made screen, use <OhrWifiView>.
 */
export const OhrWifi = {
  state: () => call<OhrWifiState>('wifiState'),
  networks: () => call<OhrWifiNetwork[]>('wifiNetworks'),
  scan: () => call<null>('wifiScan').then(() => undefined),
  /** Saved networks: {"ssid", "security", "fleet"} (or "passpoint"). */
  saved: () => call<Record<string, unknown>[]>('wifiSaved'),
  /** Saves [config]; returns its identity ("ssid:…", "passpoint:…"). OhrInvalidConfig names the field. */
  save: (config: OhrWifiConfig) => call<string>('wifiSave', { config }),
  /** Joins a network by its key or a saved identity. */
  connect: (keyOrIdentity: string) =>
    call<null>('wifiConnect', { keyOrIdentity }).then(() => undefined),
  /** Saves, then joins. Returns the identity. */
  connectConfig: (config: OhrWifiConfig) =>
    call<string>('wifiConnectConfig', { config }),
  disconnect: () => call<null>('wifiDisconnect').then(() => undefined),
  forget: (identity: string) =>
    call<null>('wifiForget', { identity }).then(() => undefined),
  /** OhrFleetLocked when the fleet locks wifi.enabled. */
  setEnabled: (on: boolean) =>
    call<null>('wifiSetEnabled', { on }).then(() => undefined),
  /** A Wi-Fi QR code the app scanned ("WIFI:…"): saves and joins it. Returns the identity. */
  connectQr: (text: string) => call<string>('wifiConnectQr', { text }),
  addStateListener: (
    listener: (s: OhrWifiState) => void,
    onError?: (e: OhrException) => void
  ) =>
    listen<OhrWifiState, OhrWifiState>(
      'wifiState',
      (s) => s,
      listener,
      onError
    ),
  addNetworksListener: (
    listener: (n: OhrWifiNetwork[]) => void,
    onError?: (e: OhrException) => void
  ) =>
    listen<OhrWifiNetwork[], OhrWifiNetwork[]>(
      'wifiNetworks',
      (n) => n,
      listener,
      onError
    ),
};

/** The common network configs. For enterprise and Passpoint, build the object. */
export const WifiConfig = {
  open: (ssid: string, hidden = false): OhrWifiConfig => ({
    ssid,
    security: 'open',
    ...(hidden ? { hidden: true } : {}),
  }),
  /** Enhanced Open. */
  owe: (ssid: string, hidden = false): OhrWifiConfig => ({
    ssid,
    security: 'owe',
    ...(hidden ? { hidden: true } : {}),
  }),
  /** WPA/WPA2 personal: 8-63 characters, or 64 hex digits. */
  psk: (ssid: string, password: string, hidden = false): OhrWifiConfig => ({
    ssid,
    security: 'psk',
    password,
    ...(hidden ? { hidden: true } : {}),
  }),
  /** WPA3 personal. */
  sae: (ssid: string, password: string, hidden = false): OhrWifiConfig => ({
    ssid,
    security: 'sae',
    password,
    ...(hidden ? { hidden: true } : {}),
  }),
};

/** The look of <OhrWifiView>. Unset values follow the system's Material You colours, as Settings does. */
export interface OhrWifiTheme {
  dark?: boolean;
  accent?: ColorValue;
  background?: ColorValue;
  text?: ColorValue;
  /** In dp. */
  cornerRadius?: number;
}

/** What <OhrWifiView> offers (all on by default). Read when the screen opens. */
export interface OhrWifiOptions {
  wifiSwitch?: boolean;
  addNetwork?: boolean;
  enterprise?: boolean;
  forget?: boolean;
  saved?: boolean;
}

export interface OhrWifiViewProps extends ViewProps {
  theme?: OhrWifiTheme;
  options?: OhrWifiOptions;
  /** The device joined the network named. */
  onConnected?: (ssid: string) => void;
  /** The screen couldn't open or stopped. */
  onError?: (e: OhrException) => void;
}

function themeJson(t: OhrWifiTheme = {}): string {
  const color = (c?: ColorValue) =>
    c === undefined ? undefined : processColor(c);
  return JSON.stringify({
    dark: t.dark,
    accent: color(t.accent),
    background: color(t.background),
    text: color(t.text),
    cornerRadius: t.cornerRadius,
  });
}

/**
 * The Wi-Fi screen of Android's Settings, drawn by the OhrTech Agent inside the app's own layout: the network
 * list, joining every type of network, saved networks, forgetting. It opens no other activity or window, so a
 * kiosk app stays a kiosk. Needs the fleet's "wifi" grant (onError says if not). Give it a size (flex: 1).
 */
export function OhrWifiView({
  theme,
  options,
  onConnected,
  onError,
  ...view
}: OhrWifiViewProps) {
  return (
    <NativeWifiView
      {...view}
      themeJson={themeJson(theme)}
      optionsJson={JSON.stringify(options ?? {})}
      onConnected={(e) => onConnected?.(e.nativeEvent.ssid)}
      onWifiError={(e) => {
        let details: Record<string, unknown> = {};
        try {
          details = JSON.parse(e.nativeEvent.detailsJson);
        } catch {}
        onError?.(
          ohrException(e.nativeEvent.code, e.nativeEvent.message, details)
        );
      }}
    />
  );
}
