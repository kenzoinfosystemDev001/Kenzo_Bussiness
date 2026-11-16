import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Server-side validation for request bodies, params and queries. Unknown keys
 * are stripped by zod object parsing, so clients cannot mass-assign fields
 * (e.g. `status`, `companyId`) that the schema does not declare.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw AppError.validation(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
}

export const zod = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);
