/* GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit. */

/**
 * Index of all schema types; not an API payload.
 */
export interface SchemaRegistry {
  ApiError?: ApiError
  HealthResponse?: HealthResponse
}
/**
 * Error body for every non-2xx API response; each code maps to a UI state (§16).
 */
export interface ApiError {
  code: string
  message: string
  hint: string | null
}
/**
 * GET /health. Model and VRAM fields arrive with the llama process (step 1, unit 6).
 */
export interface HealthResponse {
  status: 'ok'
}
