/**
 * Stable machine-readable error codes. Clients branch on `code`, never on the
 * human `message`. Every error response uses the ApiErrorBody envelope.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_INACTIVE',
  'FORBIDDEN',
  'CSRF_INVALID',
  'COMPANY_ACCESS_DENIED',
  'SEGREGATION_OF_DUTIES',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'INVALID_STATE',
  'TOKEN_INVALID',
  'RATE_LIMITED',
  'APPROVAL_NO_POLICY',
  'APPROVAL_NO_ELIGIBLE_APPROVER',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldError {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: FieldError[];
    correlationId: string;
    details?: Record<string, unknown>;
  };
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
