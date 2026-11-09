import {
  call,
  fromBase64,
  listen,
  toBase64,
  utf8Decode,
  utf8Encode,
  type OhrException,
} from './core';

export type OhrAttestationSuite = 'ec' | 'ec-mldsa65';

/** The attested key(s) as `POST /v1/attestations/verify` takes them: chains of base64 DER. Send it to your server with the challenge. */
export interface OhrAttestationResult {
  suite: OhrAttestationSuite;
  ec: string[];
  mlDsa65?: string[];
}

/**
 * Device attestation: proof, for the app's server, that a request comes from this app, unmodified, on a
 * specific, genuine and secure OhrTech device. attest() once (the server checks the chain and keeps the key),
 * then a token() with each request.
 */
export const OhrAttestation = {
  /** A new attested key (or keys) bound to [challenge] (your server's nonce, 1 to 128 bytes). */
  attest: (challenge: Uint8Array, suite: OhrAttestationSuite = 'ec') =>
    call<OhrAttestationResult>('attestationAttest', {
      challenge: toBase64(challenge),
      suite,
    }),
  /** A short-lived proof for one request, signed by the attested key(s). */
  token: (
    audience: string,
    options: { ttlSeconds?: number; nonce?: string } = {}
  ) =>
    call<string>('attestationToken', {
      audience,
      ttlSeconds: options.ttlSeconds ?? 300,
      nonce: options.nonce ?? null,
    }),
  /** The suite of the current attested key, or null before attest(). */
  suite: () => call<OhrAttestationSuite | null>('attestationSuite'),
};

/**
 * A client certificate: [alias] as the app names it; [imported] from the fleet's PKCS#12. A device-made one
 * has two [paths] (base64 DER, leaf first): through the organisation's client root and through the OhrTech
 * Device Identity Root.
 */
export interface OhrCertificate {
  alias: string;
  paths: string[][];
  imported: boolean;
}

export interface OhrFetchInit {
  method?: string;
  headers?: Record<string, string>;
  /** A string (sent as UTF-8) or bytes. */
  body?: string | Uint8Array;
  /** The client certificate to present; any of the app's when absent. */
  alias?: string;
  timeoutMs?: number;
  redirect?: 'follow' | 'manual';
}

/** A response of OhrCertificates.fetch(): the body read whole. */
export interface OhrFetchResponse {
  status: number;
  ok: boolean;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  bytes(): Uint8Array;
  text(): string;
  json<T = unknown>(): T;
}

/**
 * The app's client certificates and trusted CAs (Agent 1061+). The keys live in the device's Android Keystore,
 * which fetch can't use: make requests with OhrCertificates.fetch(), which goes through Android's TLS.
 */
export const OhrCertificates = {
  /** Whether the fleet gives this app an issuing CA, so request() can work. */
  canRequest: () => call<boolean>('certificatesCanRequest'),
  /** A new key and certificate under [alias] (1 to 64 of A-Z a-z 0-9 . _ -), made in the TEE and attested. */
  request: (alias: string, timeoutMs = 60_000) =>
    call<OhrCertificate>('certificatesRequest', { alias, timeoutMs }),
  /** A new key and certificate for [alias] when less than a third of its lifetime is left; null when not due. */
  renewIfDue: (alias: string) =>
    call<OhrCertificate | null>('certificatesRenewIfDue', { alias }),
  /** The app's client certificates: device-made and imported. */
  list: () => call<OhrCertificate[]>('certificatesList'),
  /**
   * HTTP with the app's client certificate ([init.alias], or any) for servers that ask for one, trusting the
   * system's CAs and the private CAs the fleet gives the app. Bodies are sent and read whole.
   */
  async fetch(url: string, init: OhrFetchInit = {}): Promise<OhrFetchResponse> {
    const body =
      init.body === undefined
        ? null
        : toBase64(
            typeof init.body === 'string' ? utf8Encode(init.body) : init.body
          );
    const r = await call<{
      status: number;
      reason: string | null;
      headers: Record<string, string>;
      body: string;
      url: string;
    }>('httpSend', {
      method: init.method ?? 'GET',
      url,
      headers: init.headers ?? {},
      body,
      alias: init.alias ?? null,
      timeoutMs: init.timeoutMs ?? 30_000,
      followRedirects: init.redirect !== 'manual',
    });
    const bytes = fromBase64(r.body);
    const text = () => utf8Decode(bytes);
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      statusText: r.reason ?? '',
      headers: r.headers,
      url: r.url,
      bytes: () => bytes,
      text,
      json: <T>() => JSON.parse(text()) as T,
    };
  },
  /** The fleet changed the app's certificates (issuing CA, trusted CAs, imported bundles). */
  addChangeListener: (
    listener: () => void,
    onError?: (e: OhrException) => void
  ) =>
    listen<boolean, void>('certificates', () => undefined, listener, onError),
};

export type OhrKeyAlgorithm =
  'ML-KEM-768' | 'ML-KEM-1024' | 'X-Wing' | 'X25519';

export interface OhrKeyInfo {
  alias: string;
  algorithm: OhrKeyAlgorithm;
  createdAtMs: number;
}

/** Proof that [publicKey] was made in this device's TEE for this app (base64 fields, as the Management API takes them). */
export interface OhrKeyAttestation {
  algorithm: OhrKeyAlgorithm;
  publicKey: string;
  /** How the TEE names this app ("app:<the Agent's UUID for the app>:<package>"), as signed. */
  owner: string;
  coseSign1: string;
  diceChain: string;
}

/** HPKE (RFC 9180) identifiers for OhrKeys.hpkeOpen. */
export const OhrHpke = {
  KDF_HKDF_SHA256: 1,
  AEAD_AES_128_GCM: 1,
  AEAD_AES_256_GCM: 2,
  AEAD_CHACHA20_POLY1305: 3,
} as const;

/**
 * Post-quantum and classical KEM keys whose private halves never leave the device's TEE: ML-KEM-768,
 * ML-KEM-1024, X-Wing, and X25519 for HPKE. Each app has its own keys, by alias.
 */
export const OhrKeys = {
  /** Whether this device's OS has the OhrTech KEM app. */
  isAvailable: () => call<boolean>('keysIsAvailable'),
  /** A new key under [alias], replacing any key of that alias. Returns its public key. At most 32 keys per app. */
  generate: async (alias: string, algorithm: OhrKeyAlgorithm) =>
    fromBase64(await call<string>('keysGenerate', { alias, algorithm })),
  list: () => call<OhrKeyInfo[]>('keysList'),
  /** The public key, or null if there's no such key. */
  publicKey: async (alias: string) => {
    const k = await call<string | null>('keysPublicKey', { alias });
    return k === null ? null : fromBase64(k);
  },
  delete: (alias: string) =>
    call<null>('keysDelete', { alias }).then(() => undefined),
  /** The 32-byte shared secret of [ciphertext] (ML-KEM and X-Wing keys). */
  decapsulate: async (alias: string, ciphertext: Uint8Array) =>
    fromBase64(
      await call<string>('keysDecapsulate', {
        alias,
        ciphertext: toBase64(ciphertext),
      })
    ),
  /** Encapsulates to anyone's public key of [algorithm] (ML-KEM, X-Wing); needs no key of yours. */
  encapsulate: async (algorithm: OhrKeyAlgorithm, publicKey: Uint8Array) => {
    const e = await call<{ ciphertext: string; sharedSecret: string }>(
      'keysEncapsulate',
      { algorithm, publicKey: toBase64(publicKey) }
    );
    return {
      ciphertext: fromBase64(e.ciphertext),
      sharedSecret: fromBase64(e.sharedSecret),
    };
  },
  /** HPKE base mode, one message, with the key's own KEM. OhrFailed ("does not open") if it isn't for this key. */
  hpkeOpen: async (
    alias: string,
    enc: Uint8Array,
    ciphertext: Uint8Array,
    options: {
      kdf?: number;
      aead?: number;
      info?: Uint8Array;
      aad?: Uint8Array;
    } = {}
  ) =>
    fromBase64(
      await call<string>('keysHpkeOpen', {
        alias,
        kdf: options.kdf ?? OhrHpke.KDF_HKDF_SHA256,
        aead: options.aead ?? OhrHpke.AEAD_AES_128_GCM,
        enc: toBase64(enc),
        info: toBase64(options.info ?? new Uint8Array()),
        aad: toBase64(options.aad ?? new Uint8Array()),
        ciphertext: toBase64(ciphertext),
      })
    ),
  /** Proof the key is this app's, in this device's TEE, bound to [challenge] (at most 128 bytes). */
  attest: (alias: string, challenge: Uint8Array) =>
    call<OhrKeyAttestation>('keysAttest', {
      alias,
      challenge: toBase64(challenge),
    }),
};
