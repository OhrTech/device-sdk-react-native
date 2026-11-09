import { AppRegistry } from 'react-native';

import { call, fromBase64, toBase64 } from './core';

export type OhrPushSuite = 'x25519' | 'xwing-mldsa65';

/** A sender's public keys, as your server's OhrTech SDK gives them (base64): ed25519 (32 bytes) and, for xwing-mldsa65, mlDsa65 (1,952 bytes). */
export interface OhrSenderKey {
  ed25519: string;
  mlDsa65?: string;
}

/** What your server needs to push to this app on this device: [token] ("psh_…") and [publicKey] (base64). */
export interface OhrPushToken {
  token: string;
  suite: OhrPushSuite;
  publicKey: string;
}

/** A message your server sent, verified and opened. */
export interface OhrPushMessage {
  /** Your server's id for it. */
  id: string;
  /** Its bytes (at most 4,096). */
  data: Uint8Array;
  expiresAtMs: number;
  highPriority: boolean;
  /** The hub's id ("pmsg_…"). */
  pushId: string;
}

export interface OhrPushHandlers {
  /** Each message, verified, opened, in date and not seen before. */
  onMessage: (message: OhrPushMessage) => Promise<void>;
  /** The token changed or ended (null: register again). Send a new token to your server. */
  onTokenChanged?: (token: OhrPushToken | null) => Promise<void>;
  /** A message was dropped: [reason] "signature", "expired", "duplicate", "malformed", ... */
  onDropped?: (pushId: string, reason: string) => Promise<void>;
}

/**
 * OhrTech push: messages from the app's own server, end to end. The server seals each message to the device's
 * push key (in the TEE) and signs it with its sender key; the OhrTech hub only carries it.
 *
 * 1. setHandlers() in index.js, before AppRegistry.registerComponent: they run as a headless task, whether the
 *    app is open or not (the Agent starts the app for a message).
 * 2. register() once (and when onTokenChanged gets null), with your server's sender public keys. Send the token
 *    (token and public key) to your server.
 * 3. Your server seals and sends through the Management API (POST /v1/push).
 */
export const OhrPush = {
  /** Makes the app's push key in the TEE, has the hub issue a token, and keeps [senderKeys]. Waits for the hub (up to 30 s). */
  register: (senderKeys: OhrSenderKey[], suite: OhrPushSuite = 'x25519') =>
    call<OhrPushToken>('pushRegister', { senderKeys, suite }),
  /** The current token, or null if the app isn't registered (or its token ended). */
  token: () => call<OhrPushToken | null>('pushToken'),
  /** Ends the token and deletes the push key. */
  unregister: () => call<null>('pushUnregister').then(() => undefined),
  /** Replaces the sender keys messages are checked against (e.g. when your server rotates them). */
  setSenderKeys: (keys: OhrSenderKey[]) =>
    call<null>('pushSetSenderKeys', { keys }).then(() => undefined),
  senderKeys: () => call<OhrSenderKey[]>('pushSenderKeys'),
  /** The app's handlers: call it in index.js, at the app's entry point, so a message that starts the app finds them. */
  setHandlers(handlers: OhrPushHandlers) {
    AppRegistry.registerHeadlessTask(
      'OhrDevicePush',
      () => async (event: { kind: string; json: string }) => {
        const d = JSON.parse(event.json);
        switch (event.kind) {
          case 'message':
            await handlers.onMessage({
              id: d.id,
              data: fromBase64(d.data),
              expiresAtMs: d.expiresAtMs,
              highPriority: d.highPriority,
              pushId: d.pushId,
            });
            break;
          case 'token':
            await handlers.onTokenChanged?.(d.token ?? null);
            break;
          case 'dropped':
            await handlers.onDropped?.(d.pushId, d.reason);
            break;
        }
      }
    );
  },
};

/** A sender key from bytes. */
export function senderKey(
  ed25519: Uint8Array,
  mlDsa65?: Uint8Array
): OhrSenderKey {
  return {
    ed25519: toBase64(ed25519),
    ...(mlDsa65 ? { mlDsa65: toBase64(mlDsa65) } : {}),
  };
}
