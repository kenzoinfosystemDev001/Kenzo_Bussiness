import type { ErrorCode, FieldError } from '@kenzo/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  MFA_REQUIRED: 403,
  MFA_INVALID: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_INACTIVE: 403,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  COMPANY_ACCESS_DENIED: 403,
  SEGREGATION_OF_DUTIES: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
  TOKEN_INVALID: 400,
  RATE_LIMITED: 429,
  APPROVAL_NO_POLICY: 422,
  APPROVAL_NO_ELIGIBLE_APPROVER: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
};

/**
 * Domain/application error with a stable code. Thrown anywhere in the service
 * layer and rendered by the global exception filter into the standard envelope.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly options: { fieldErrors?: FieldError[]; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = STATUS_BY_CODE[code];
  }

  static notFound(what = 'Record'): AppError {
    // Deliberately identical for "does not exist" and "exists in another company"
    // so callers cannot probe other tenants' IDs.
    return new AppError('NOT_FOUND', `${what} not found`);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static invalidState(message: string, details?: Record<string, unknown>): AppError {
    return new AppError('INVALID_STATE', message, { details });
  }

  static versionConflict(): AppError {
    return new AppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
  }

  static validation(fieldErrors: FieldError[], message = 'Some fields are invalid'): AppError {
    return new AppError('VALIDATION_FAILED', message, { fieldErrors });
  }
}
