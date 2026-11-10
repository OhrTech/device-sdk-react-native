import { AppState } from 'react-native';

import {
  beat,
  call,
  listen,
  OhrInvalidConfig,
  type OhrException,
  type OhrSubscription,
} from './core';

/** How the library's connection to the Agent stands. */
export type OhrConnection =
  'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'UNAVAILABLE';

type ErrorListener = (e: OhrException) => void;

/**
 * The library's connection to the OhrTech Agent. There is nothing to connect or close: the module binds
 * the Agent on the first call and keeps the binding; when the Agent stops (a crash, its own update) it
 * binds again, and every listener goes on.
 */
export const OhrDeviceSdk = {
  /** Whether this device has an OhrTech Agent with the Device SDK. */
  isAvailable: () => call<boolean>('isAvailable'),
  /** Connects now instead of on the first call. Throws OhrNotManaged, OhrUnsupported or OhrFailed. */
  connect: (timeoutMs = 10_000) =>
    call<null>('connect', { timeoutMs }).then(() => undefined),
  connection: () => call<OhrConnection>('connectionState'),
  /** The connection as it changes, starting with how it stands (for each listener). */
  addConnectionListener(
    listener: (c: OhrConnection) => void,
    onError?: ErrorListener
  ): OhrSubscription {
    let last: OhrConnection | undefined;
    let heard = false;
    let removed = false;
    const emit = (c: OhrConnection) => {
      if (removed || c === last) return;
      last = c;
      listener(c);
    };
    const sub = listen<OhrConnection, OhrConnection>(
      'connection',
      (c) => c,
      (c) => {
        heard = true;
        emit(c);
      },
      onError
    );
    // The shared watch gives the state only to its first listener: each later one asks.
    call<OhrConnection>('connectionState').then(
      (c) => {
        if (!heard) emit(c);
      },
      (e) => {
        if (!removed) onError?.(e);
      }
    );
    return {
      remove() {
        removed = true;
        sub.remove();
      },
    };
  },
};

/** Who the Agent takes this app for, and what the fleet lets it do. */
export interface OhrAccessInfo {
  /** The hub's id of this app ("app_…"). */
  app: string;
  packageName: string;
  /** The hub's id of the installed version, or null when it isn't one the hub shipped. */
  appVersion: string | null;
  /** What the app may use: always "device", "updates", "keys", "push", the reads ("wifi.read", ...), and each area the fleet grants. */
  areas: string[];
  agentVersion: number;
  agentInterface: number;
}

/** Asked of the Agent each time. */
export const OhrAccess = {
  info: () => call<OhrAccessInfo>('accessInfo'),
  /** Whether the fleet lets the app use (change) [area] now; reads of most areas are always allowed. */
  mayUse: async (area: string) =>
    (await call<OhrAccessInfo>('accessInfo')).areas.includes(area),
};

export interface OhrNamed {
  id: string;
  name: string;
}

export interface OhrDeviceInfo {
  /** "dev_…" (null until the hub sent the device its first policy). */
  deviceId: string | null;
  serial: string | null;
  fleet: OhrNamed | null;
  org: OhrNamed | null;
  osRelease: string;
  osBuild: string;
  securityPatch: string;
  osIncremental: string;
  agentVersion: number;
  /** The Agent is connected to the hub now. */
  online: boolean;
}

/** The device: who it is, as the OhrTech hub and the Management API name it. Always allowed. */
export const OhrDevice = {
  info: () => call<OhrDeviceInfo>('deviceInfo'),
};

export interface OhrUpdate {
  /** 0 when nothing is offered any more (in changes). */
  versionCode: number;
  versionName: string | null;
  notes: string | null;
  downloaded: boolean;
}

/** The app's own updates: a version the hub offers as available, downloaded ahead. Always allowed. */
export const OhrUpdates = {
  available: () => call<OhrUpdate | null>('updatesAvailable'),
  /** Installs the offered update: now, or when the screen is next off. The app is replaced, so it stops. */
  install: (options: { whenIdle?: boolean } = {}) =>
    call<null>('updatesInstall', { whenIdle: options.whenIdle ?? false }).then(
      () => undefined
    ),
  addChangeListener: (
    listener: (u: OhrUpdate) => void,
    onError?: ErrorListener
  ) => listen<OhrUpdate, OhrUpdate>('updates', (u) => u, listener, onError),
};

export interface OhrNetworkState {
  /** The network in use, or null for none. transport: "wifi", "cellular", "ethernet", "vpn" or "other". */
  active: {
    transport: string;
    validated: boolean;
    captive: boolean;
    metered: boolean;
    vpn: boolean;
  } | null;
  mobileData: boolean;
  airplaneMode: boolean;
  dataRoaming: boolean;
  ethernetConnected: boolean;
}

/** Mobile data, airplane mode, roaming: read always, change with the fleet's "network" grant. */
export const OhrNetwork = {
  state: () => call<OhrNetworkState>('networkState'),
  setMobileData: (on: boolean) =>
    call<null>('networkSetMobileData', { on }).then(() => undefined),
  setAirplaneMode: (on: boolean) =>
    call<null>('networkSetAirplaneMode', { on }).then(() => undefined),
  /** OhrFleetLocked when the fleet locks network.data_roaming. */
  setDataRoaming: (on: boolean) =>
    call<null>('networkSetDataRoaming', { on }).then(() => undefined),
  addChangeListener: (
    listener: (s: OhrNetworkState) => void,
    onError?: ErrorListener
  ) =>
    listen<OhrNetworkState, OhrNetworkState>(
      'networkState',
      (s) => s,
      listener,
      onError
    ),
};

export interface OhrKioskState {
  /** This app is the one pinned. */
  pinned: boolean;
  /** "none", "locked" or "pinned". */
  mode: string;
  features: number;
  appMayExit: boolean;
}

/** What stays available in kiosk mode (combine with |). */
export const OhrKioskFeature = {
  SYSTEM_INFO: 1,
  NOTIFICATIONS: 2,
  HOME: 4,
  OVERVIEW: 8,
  GLOBAL_ACTIONS: 16,
  KEYGUARD: 32,
  BLOCK_ACTIVITY_START_IN_TASK: 64,
} as const;

let beats: ReturnType<typeof setInterval> | null = null;
let beatTimeout = 0;
let appState: { remove(): void } | null = null;

function startBeats() {
  if (beats) clearInterval(beats);
  beat(beatTimeout);
  beats = setInterval(() => beat(beatTimeout), beatTimeout / 4);
}

// JavaScript timers don't run while the app is in the background (the screen off, say), so the beats would
// stop and the watchdog would take a sleeping app for a hung one: pause the watch there, beat again on return.
function followAppState() {
  appState ??= AppState.addEventListener('change', (state) => {
    if (beatTimeout === 0) return;
    if (state === 'active') startBeats();
    else {
      if (beats) clearInterval(beats);
      beats = null;
      call<null>('kioskStopHeartbeat').catch(() => {});
    }
  });
}

/**
 * Kiosk mode: pins the app with Android's lock task, as the system, so the app can't be left (and can't
 * unpin itself either). Needs the fleet's "kiosk" grant. stop() works only if the fleet lets kiosk apps leave.
 */
export const OhrKiosk = {
  /** Pins the app's task, keeping [features] (default: the power menu and status bar info). */
  start: (
    // eslint-disable-next-line no-bitwise -- feature flags
    features: number = OhrKioskFeature.GLOBAL_ACTIONS |
      OhrKioskFeature.SYSTEM_INFO
  ) => call<null>('kioskStart', { features }).then(() => undefined),
  /** Ends kiosk mode, if the fleet lets kiosk apps leave (OhrNotAllowed otherwise). */
  stop: () => call<null>('kioskStop').then(() => undefined),
  state: () => call<OhrKioskState>('kioskState'),
  /** Opens the Agent's exit PIN keypad over the app, for staff to leave kiosk mode for a while. */
  requestExit: () => call<null>('kioskRequestExit').then(() => undefined),
  /** The device-wide lock task mode as it changes ("none", "locked", "pinned"). */
  addModeListener: (
    listener: (mode: string) => void,
    onError?: ErrorListener
  ) => listen<string, string>('kioskMode', (m) => m, listener, onError),
  /**
   * Tells the Agent's kiosk watchdog that the app's JavaScript thread is alive: beats from it a few times per
   * [timeoutMs]. If the beats stop for longer (the JS thread hangs), the Agent stops the app and starts it
   * again. Only while the app is pinned; call it again after start(). One per app. JavaScript timers stop while
   * the app is in the background (the screen off, say), so the watch pauses there and resumes on return.
   * With Agent 1062+, the fleet's response timeout for the app (portal or Management API), when set, replaces
   * [timeoutMs], and the Agent itself doesn't count hangs while the screen is off. Rejects with OhrUnsupported
   * on an Agent before 1061, and then doesn't beat.
   */
  async heartbeat(timeoutMs = 10_000): Promise<void> {
    if (timeoutMs < 2000 || timeoutMs > 600_000)
      throw new OhrInvalidConfig(
        'timeoutMs: 2 s to 10 minutes',
        'timeoutMs',
        '2 s to 10 minutes'
      );
    // The first beat through the checked path: an Agent without the watchdog says so here.
    await call<null>('kioskBeat', { timeoutMs });
    beatTimeout = timeoutMs;
    followAppState();
    startBeats();
  },
  /** Stops the heartbeat (and the Agent's watch on it). */
  stopHeartbeat: () => {
    if (beats) clearInterval(beats);
    beats = null;
    beatTimeout = 0;
    return call<null>('kioskStopHeartbeat').then(() => undefined);
  },
};

export interface OhrBattery {
  level: number | null;
  charging: boolean;
  /** "ac", "usb", "wireless", "dock" or null. */
  plugged: string | null;
  health: string;
  temperatureC: number;
  screenOn: boolean;
}

/** A reboot schedule: [time] "HH:mm", [days] 1-7 (Monday = 1). */
export interface OhrRebootSchedule {
  time: string;
  days: number[];
  reason: string;
}

/** Battery (always), reboots, screen timeout and brightness (with the fleet's "power" grant). */
export const OhrPower = {
  battery: () => call<OhrBattery>('powerBattery'),
  /** Reboots in a few seconds; the hub records [reason]. */
  reboot: (reason: string) =>
    call<null>('powerReboot', { reason }).then(() => undefined),
  /** Reboots on a schedule (the device's one; the last app to set it wins); null stops it. */
  scheduleReboot: (schedule: OhrRebootSchedule | null) =>
    call<null>('powerScheduleReboot', { schedule }).then(() => undefined),
  rebootSchedule: () => call<OhrRebootSchedule | null>('powerRebootSchedule'),
  /** Any whole number of seconds, 1 to 2147483 (Android's limit). OhrFleetLocked if the fleet locks it. */
  setScreenTimeout: (seconds: number) =>
    call<null>('powerSetScreenTimeout', { seconds }).then(() => undefined),
  /** 0-100 (turns adaptive brightness off). OhrFleetLocked if the fleet locks it. */
  setBrightness: (percent: number) =>
    call<null>('powerSetBrightness', { percent }).then(() => undefined),
  addBatteryListener: (
    listener: (b: OhrBattery) => void,
    onError?: ErrorListener
  ) => listen<OhrBattery, OhrBattery>('battery', (b) => b, listener, onError),
};

export interface OhrSetting {
  key: string;
  /** A boolean, number, string, array, object or null. */
  value: unknown;
  /** "unmanaged", "set" or "locked". */
  mode: string;
}

/**
 * The device's settings, by the OhrTech settings catalogue's keys: read always, change with the fleet's
 * "settings" grant. A key the fleet locks refuses (OhrFleetLocked).
 */
export const OhrSettings = {
  /** The keys apps may read and change on this device. */
  keys: () => call<string[]>('settingsKeys'),
  get: (key: string) => call<OhrSetting>('settingsGet', { key }),
  set: (key: string, value: unknown) =>
    call<null>('settingsSet', { key, value }).then(() => undefined),
  addChangeListener: (
    listener: (s: OhrSetting) => void,
    onError?: ErrorListener
  ) => listen<OhrSetting, OhrSetting>('settings', (s) => s, listener, onError),
};

/**
 * The app's managed configuration: the values its fleet (or one device's overrides) sets for the settings
 * the app declares in its own res/xml/app_restrictions.xml. Needs no Agent connection.
 */
export const OhrConfig = {
  /** Every managed value (bundles as objects, bundle arrays as lists of objects). */
  values: () => call<Record<string, unknown>>('configValues'),
  /** A string, choice or hidden setting: the managed value, else the declared default, else [fallback]. */
  string: (key: string, fallback: string | null = null) =>
    call<string | null>('configString', { key, fallback }),
  integer: (key: string, fallback = 0) =>
    call<number>('configInt', { key, fallback }),
  boolean: (key: string, fallback = false) =>
    call<boolean>('configBool', { key, fallback }),
  /** A multi-select setting. */
  strings: (key: string) => call<string[]>('configStrings', { key }),
  /** Whether the fleet sets [key]. */
  isSet: (key: string) => call<boolean>('configIsSet', { key }),
  addChangeListener: (
    listener: (values: Record<string, unknown>) => void,
    onError?: ErrorListener
  ) =>
    listen<Record<string, unknown>, Record<string, unknown>>(
      'config',
      (v) => v,
      listener,
      onError
    ),
};

export interface OhrUsbDevice {
  accessory: boolean;
  /** Android's name for it: opens with UsbManager. */
  deviceName: string | null;
  vendorId: number;
  productId: number;
  manufacturer: string | null;
  product: string | null;
  model: string | null;
  version: string | null;
  serial: string | null;
  /** The fleet's label for it. */
  name: string | null;
  hasPermission: boolean;
}

/** The USB devices the fleet pre-approves for this app: no "Allow access?" prompt (Agent 1061+). */
export const OhrUsb = {
  devices: () => call<OhrUsbDevice[]>('usbDevices'),
  addChangeListener: (
    listener: (c: { attached: boolean; device: OhrUsbDevice }) => void,
    onError?: ErrorListener
  ) =>
    listen<
      { attached: boolean; device: OhrUsbDevice },
      { attached: boolean; device: OhrUsbDevice }
    >('usb', (c) => c, listener, onError),
};

/** The app's own diagnostics for the hub (Agent 1061+). Crashes need nothing: the Agent reports them. */
export const OhrDiagnostics = {
  /** An event of the app's own ("order_failed"): lower camel or snake case, up to 64 characters; [data] up to 2 KB as JSON. */
  event: (name: string, data: Record<string, unknown> = {}) =>
    call<null>('diagnosticsEvent', { name, data }).then(() => undefined),
  /** A log line for log bundles; [priority] is Android's (4 info, 5 warn, 6 error). */
  log: (priority: number, tag: string, message: string) =>
    call<null>('diagnosticsLog', { priority, tag, message }).then(
      () => undefined
    ),
  i: (tag: string, message: string) => OhrDiagnostics.log(4, tag, message),
  w: (tag: string, message: string) => OhrDiagnostics.log(5, tag, message),
  e: (tag: string, message: string) => OhrDiagnostics.log(6, tag, message),
};
