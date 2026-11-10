/// <reference types="jest" />
const mockNative = {
  call: jest.fn(),
  beat: jest.fn(),
  watch: jest.fn(),
  unwatch: jest.fn(),
  // The module subscribes once; every test emits through the dispatcher it gave.
  onEvent: jest.fn((f: (e: { kind: string; json: string }) => void) => {
    mockDispatch.f = f;
    return { remove: jest.fn() };
  }),
};
const mockDispatch: { f: (e: { kind: string; json: string }) => void } = {
  f: () => {},
};
const emit = (e: { kind: string; json: string }) => mockDispatch.f(e);
jest.mock('../NativeOhrDeviceSdk', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));

import {
  call,
  fromBase64,
  listen,
  ohrException,
  OhrFailed,
  OhrFleetLocked,
  OhrInvalidConfig,
  OhrNotAllowed,
  OhrNotManaged,
  OhrUnsupported,
  toBase64,
  utf8Decode,
  utf8Encode,
} from '../core';
import { OhrKiosk } from '../areas';
import { WifiConfig } from '../wifi';

describe('errors', () => {
  it('turns each code into its OhrException', () => {
    expect(ohrException('NotManaged', 'm', {})).toBeInstanceOf(OhrNotManaged);
    expect(
      (ohrException('NotAllowed', 'm', { area: 'wifi' }) as OhrNotAllowed).area
    ).toBe('wifi');
    expect(
      (
        ohrException('FleetLocked', 'm', {
          key: 'wifi.enabled',
        }) as OhrFleetLocked
      ).key
    ).toBe('wifi.enabled');
    const u = ohrException('Unsupported', 'm', {
      reason: 'old',
      needsAgent: 1061,
    }) as OhrUnsupported;
    expect([u.reason, u.needsAgent, u.code]).toEqual([
      'old',
      1061,
      'Unsupported',
    ]);
    const i = ohrException('InvalidConfig', 'm', {
      field: 'alias',
      reason: '1 to 64',
    }) as OhrInvalidConfig;
    expect([i.field, i.reason]).toEqual(['alias', '1 to 64']);
    expect(ohrException('SomethingNew', 'm', {})).toBeInstanceOf(OhrFailed);
  });

  it('rejects a call with the module error as an OhrException', async () => {
    mockNative.call.mockRejectedValueOnce(
      Object.assign(new Error('The fleet locks wifi.enabled'), {
        code: 'FleetLocked',
        userInfo: { detailsJson: '{"key":"wifi.enabled"}' },
      })
    );
    await expect(call('wifiSetEnabled', { on: false })).rejects.toMatchObject({
      code: 'FleetLocked',
      key: 'wifi.enabled',
    });
  });

  it('parses a result', async () => {
    mockNative.call.mockResolvedValueOnce('{"deviceId":"dev_1"}');
    await expect(call('deviceInfo')).resolves.toEqual({ deviceId: 'dev_1' });
    expect(mockNative.call).toHaveBeenLastCalledWith('deviceInfo', '{}');
  });
});

describe('listeners', () => {
  it('watches from the first listener to the last remove', () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const sa = listen<{ level: number }, number>(
      'battery',
      (j) => j.level,
      (v) => a.push(v)
    );
    const sb = listen<{ level: number }, number>(
      'battery',
      (j) => j.level,
      (v) => b.push(v)
    );
    expect(mockNative.watch).toHaveBeenCalledTimes(1);
    emit({ kind: 'battery', json: '{"level":80}' });
    expect([a, b]).toEqual([[80], [80]]);
    sa.remove();
    sa.remove();
    expect(mockNative.unwatch).not.toHaveBeenCalled();
    sb.remove();
    expect(mockNative.unwatch).toHaveBeenCalledWith('battery');
  });

  it('hands a watch error to the listeners of that kind', () => {
    const errors: unknown[] = [];
    const s = listen(
      'usb',
      (j) => j,
      () => {},
      (e) => errors.push(e)
    );
    emit({
      kind: 'error',
      json: JSON.stringify({
        kind: 'usb',
        code: 'Unsupported',
        message: 'too old',
        details: { reason: 'too old', needsAgent: 1061 },
      }),
    });
    expect(errors[0]).toBeInstanceOf(OhrUnsupported);
    s.remove();
  });
});

describe('bytes', () => {
  it('round-trips base64', () => {
    const b = Uint8Array.from([0, 1, 2, 250, 251, 252, 253]);
    expect(toBase64(b)).toBe('AAEC+vv8/Q==');
    expect(Array.from(fromBase64('AAEC+vv8/Q=='))).toEqual(Array.from(b));
    expect(toBase64(new Uint8Array())).toBe('');
  });

  it('round-trips UTF-8, and marks bad bytes', () => {
    const s = 'Kiosk ✓ 日本 😀';
    expect(utf8Decode(utf8Encode(s))).toBe(s);
    expect(utf8Decode(Uint8Array.from([0x61, 0xc3]))).toBe('a�');
  });
});

it('WifiConfig builds the Wi-Fi model', () => {
  expect(WifiConfig.psk('Shop', 'secret123')).toEqual({
    ssid: 'Shop',
    security: 'psk',
    password: 'secret123',
  });
  expect(WifiConfig.open('Guest', true)).toEqual({
    ssid: 'Guest',
    security: 'open',
    hidden: true,
  });
});

it('the heartbeat refuses a timeout out of range before asking the Agent', async () => {
  await expect(OhrKiosk.heartbeat(1000)).rejects.toThrow(OhrInvalidConfig);
  expect(mockNative.beat).not.toHaveBeenCalled();
  expect(mockNative.call).not.toHaveBeenCalledWith(
    'kioskBeat',
    expect.anything()
  );
});
