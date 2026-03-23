/**
 * Type declaration for the EXT_disjoint_timer_query_webgl2 WebGL extension.
 * Not included in TypeScript's lib.dom.d.ts.
 *
 * Usage: cast the result of gl.getExtension() at the call site:
 *   gl.getExtension('EXT_disjoint_timer_query_webgl2') as EXT_disjoint_timer_query_webgl2 | null
 */
// eslint-disable-next-line sonarjs/class-name -- Must match WebGL extension name
interface EXT_disjoint_timer_query_webgl2 {
  readonly QUERY_COUNTER_BITS_EXT: number;
  readonly TIME_ELAPSED_EXT: number;
  readonly TIMESTAMP_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}
