/**
 * Application error used by services and controllers alike (GRASP: Low Coupling — services do not depend on the
 * HTTP/auth layer). The global error handler in app.ts turns it into `{ error: code, details? }` with the status.
 */
export class AppError extends Error {
  /**
   * @param statusCode HTTP status the handler should answer with (e.g. 403, 404, 409, 422)
   * @param code stable machine-readable error code; the web app translates it via `err.<code>` i18n keys
   * @param details optional extra codes (e.g. all failed validation rules)
   */
  constructor(
    public statusCode: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}
