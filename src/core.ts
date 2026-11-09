/* eslint-disable no-bitwise -- base64 and UTF-8 are bit work */
import Native, { type OhrNativeEvent } from './NativeOhrDeviceSdk';

/** Why the OhrTech Agent refused or couldn't do what the app asked. Every call can throw one; switch on [code]. */
export abstract class OhrException extends Error {
  abstract readonly code: OhrExceptionCode;
  constructor(message: string) {
    super(message);
    // So instanceof works whatever the class transform.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

export type OhrExceptionCode =
  | 'NotManaged'
  | 'NotAllowed'
  | 'FleetLocked'
  | 'Unsupported'
  | 'InvalidConfig'
  | 'Refused'
  | 'Failed';

/** This app is not one the organisation installed on this device through OhrTech. */
export class OhrNotManaged extends OhrException {
  readonly code = 'NotManaged';
}

/** The fleet doesn't let this app use [area]. */
export class OhrNotAllowed extends OhrException {
  readonly code = 'NotAllowed';
  constructor(
    message: string,
    readonly area: string
  ) {
    super(message);
  }
}

/** The fleet locks the setting or network [key]. */
export class OhrFleetLocked extends OhrException {
  readonly code = 'FleetLocked';
  constructor(
    message: string,
    readonly key: string
  ) {
    super(message);
  }
}

/** This device, OS or Agent can't do it. [needsAgent]: the Agent version that can, when the Agent is only too old. */
export class OhrUnsupported extends OhrException {
  readonly code = 'Unsupported';
  constructor(
    message: string,
    readonly reason: string,
    readonly needsAgent: number | null
  ) {
    super(message);
  }
}

/** A value the app passed is invalid: [field], and why. */
export class OhrInvalidConfig extends OhrException {
  readonly code = 'InvalidConfig';
  constructor(
    message: string,
    readonly field: string,
    readonly reason: string
  ) {
    super(message);
  }
}

/** The hub refused a request it checks itself (a certificate: [reason] says why). */
export class OhrRefused extends OhrException {
  readonly code = 'Refused';
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
  }
}

/** The Agent tried and it failed, or the Agent can't be reached. */
export class OhrFailed extends OhrException {
  readonly code = 'Failed';
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
  }
}

/** The module's error (code, message, details) as the OhrException it stands for. */
export function ohrException(
  code: string,
  message: string,
  details: Record<string, unknown>
): OhrException {
  const s = (k: string) =>
    typeof details[k] === 'string' ? (details[k] as string) : message;
  switch (code) {
    case 'NotManaged':
      return new OhrNotManaged(message);
    case 'NotAllowed':
      return new OhrNotAllowed(message, s('area'));
    case 'FleetLocked':
      return new OhrFleetLocked(message, s('key'));
    case 'Unsupported':
      return new OhrUnsupported(
        message,
        s('reason'),
        typeof details.needsAgent === 'number' ? details.needsAgent : null
      );
    case 'InvalidConfig':
      return new OhrInvalidConfig(message, s('field'), s('reason'));
    case 'Refused':
      return new OhrRefused(message, s('reason'));
    default:
      return new OhrFailed(message, s('reason'));
  }
}

function fromRejection(e: unknown): OhrException {
  if (e instanceof OhrException) return e;
  const err = e as {
    code?: string;
    message?: string;
    userInfo?: { detailsJson?: string };
  };
  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(err.userInfo?.detailsJson ?? '{}');
  } catch {}
  return ohrException(err.code ?? 'Failed', err.message ?? String(e), details);
}

/** Runs a native method; its JSON result, parsed. Errors as OhrException. */
export async function call<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  try {
    return JSON.parse(await Native.call(method, JSON.stringify(args))) as T;
  } catch (e) {
    throw fromRejection(e);
  }
}

export function beat(timeoutMs: number) {
  Native.beat(timeoutMs);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes as standard base64. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      B64[(n >> 18) & 63]! +
      B64[(n >> 12) & 63]! +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') +
      (i + 2 < bytes.length ? B64[n & 63]! : '=');
  }
  return out;
}

/** Standard base64 as bytes. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0,
    value = 0,
    j = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (value >> bits) & 255;
    }
  }
  return out.subarray(0, j);
}

/** Text as UTF-8 bytes (no reliance on TextEncoder, which not every engine has). */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000)
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63)
      );
  }
  return Uint8Array.from(out);
}

/** UTF-8 bytes as text (invalid sequences as U+FFFD). */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    let n: number;
    let c: number;
    if (b < 0x80) {
      n = 0;
      c = b;
    } else if (b >= 0xc0 && b < 0xe0) {
      n = 1;
      c = b & 0x1f;
    } else if (b >= 0xe0 && b < 0xf0) {
      n = 2;
      c = b & 0x0f;
    } else if (b >= 0xf0 && b < 0xf8) {
      n = 3;
      c = b & 0x07;
    } else {
      out += '\ufffd';
      i++;
      continue;
    }
    let ok = i + n < bytes.length;
    for (let k = 1; ok && k <= n; k++) {
      const x = bytes[i + k]!;
      if ((x & 0xc0) !== 0x80) ok = false;
      else c = (c << 6) | (x & 0x3f);
    }
    if (!ok) {
      out += '\ufffd';
      i++;
      continue;
    }
    out += String.fromCodePoint(c);
    i += n + 1;
  }
  return out;
}

/** A listener's subscription: remove() stops it. */
export interface OhrSubscription {
  remove(): void;
}

type Listener = {
  onValue: (json: unknown) => void;
  onError?: (e: OhrException) => void;
};
const listeners = new Map<string, Set<Listener>>();
let nativeSubscription: { remove(): void } | null = null;

function dispatch(event: OhrNativeEvent) {
  if (event.kind === 'error') {
    const e = JSON.parse(event.json) as {
      kind: string;
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
    for (const l of listeners.get(e.kind) ?? [])
      l.onError?.(ohrException(e.code, e.message, e.details ?? {}));
    return;
  }
  const value = JSON.parse(event.json);
  for (const l of listeners.get(event.kind) ?? []) l.onValue(value);
}

/**
 * Listens to a kind of change: the module watches the Agent from the first listener to the last
 * remove(). [map] turns the JSON into what the listener gets.
 */
export function listen<J, T>(
  kind: string,
  map: (json: J) => T,
  onValue: (value: T) => void,
  onError?: (e: OhrException) => void
): OhrSubscription {
  nativeSubscription ??= Native.onEvent(dispatch);
  let set = listeners.get(kind);
  if (!set) listeners.set(kind, (set = new Set()));
  const l: Listener = { onValue: (json) => onValue(map(json as J)), onError };
  set.add(l);
  if (set.size === 1) Native.watch(kind);
  let removed = false;
  return {
    remove() {
      if (removed) return;
      removed = true;
      set.delete(l);
      if (set.size === 0) {
        listeners.delete(kind);
        Native.unwatch(kind);
      }
    },
  };
}
