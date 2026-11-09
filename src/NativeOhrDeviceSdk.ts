import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

/** A change from the Agent: [kind] says which stream, [json] the value. */
export type OhrNativeEvent = { kind: string; json: string };

/**
 * The module's native side. The TypeScript API (index.ts) is typed; across the bridge, arguments and
 * results are JSON, so this spec stays small while the API grows.
 */
export interface Spec extends TurboModule {
  /** Runs [method] with its arguments on a worker thread; resolves with the result as JSON. */
  call(method: string, argsJson: string): Promise<string>;
  /** One kiosk heartbeat (one way). */
  beat(timeoutMs: number): void;
  /** Starts watching a kind of change (the first listener); [unwatch] stops (the last). */
  watch(kind: string): void;
  unwatch(kind: string): void;
  readonly onEvent: CodegenTypes.EventEmitter<OhrNativeEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('OhrDeviceSdk');
