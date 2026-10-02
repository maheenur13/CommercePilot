import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiExtraModels,
  ApiProperty,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';

/**
 * Response contract for every endpoint:
 *   success → { success: true,  data, meta: { requestId, ...pagination } }
 *   failure → { success: false, error: { code, message, details?, requestId } }  (AllExceptionsFilter)
 */
export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta: { requestId?: string } & Partial<PageMeta>;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Returned by controllers for list endpoints; the interceptor moves paging info into `meta`. */
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: PageMeta,
  ) {}

  static of<S, T>(
    page: { items: S[]; total: number; page: number; pageSize: number },
    mapItem: (item: S) => T,
  ): Paginated<T> {
    return new Paginated(page.items.map(mapItem), {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: Math.ceil(page.total / page.pageSize),
    });
  }
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<SuccessEnvelope<unknown>> {
    const requestId = ctx.switchToHttp().getRequest<Request & { id?: string }>().id;
    return next
      .handle()
      .pipe(
        map((body: unknown) =>
          body instanceof Paginated
            ? { success: true, data: body.items, meta: { ...body.meta, requestId } }
            : { success: true, data: body ?? null, meta: { requestId } },
        ),
      );
  }
}

// ---- Swagger models for the envelope -------------------------------------------------------

class MetaDto {
  @ApiProperty({ example: '4f1c2b8e-1d2a-4c7e-9a51-2f0f1f7f1a10' })
  requestId!: string;
}

class PageMetaDto extends MetaDto {
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) pageSize!: number;
  @ApiProperty({ example: 48 }) total!: number;
  @ApiProperty({ example: 3 }) totalPages!: number;
}

export class ErrorDetailDto {
  @ApiProperty({ example: 'items.0.quantity' }) field!: string;
  @ApiProperty({ example: ['quantity must not be less than 1'] }) messages!: string[];
}

class ErrorBodyDto {
  @ApiProperty({ example: 'VALIDATION_FAILED' }) code!: string;
  @ApiProperty({ example: 'Request validation failed' }) message!: string;
  @ApiProperty({ type: [ErrorDetailDto], required: false }) details?: ErrorDetailDto[];
  @ApiProperty({ example: '4f1c2b8e-1d2a-4c7e-9a51-2f0f1f7f1a10' }) requestId!: string;
}

export class ErrorEnvelopeDto {
  @ApiProperty({ example: false }) success!: false;
  @ApiProperty({ type: ErrorBodyDto }) error!: ErrorBodyDto;
}

/** Documents `{ success, data: Model | Model[], meta }` for an endpoint. */
export function ApiEnvelope(
  model: Type<unknown>,
  opts: { paginated?: boolean; isArray?: boolean; status?: number } = {},
) {
  const item = model === String ? { type: 'string' } : { $ref: getSchemaPath(model) };
  const data = opts.paginated || opts.isArray ? { type: 'array', items: item } : item;
  const meta = { $ref: getSchemaPath(opts.paginated ? PageMetaDto : MetaDto) };
  return applyDecorators(
    ApiExtraModels(...(model === String ? [] : [model]), MetaDto, PageMetaDto),
    ApiResponse({
      status: opts.status ?? 200,
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: { success: { type: 'boolean', example: true }, data, meta },
      },
    }),
    ApiDefaultResponse({ description: 'Error envelope (4xx/5xx)', type: ErrorEnvelopeDto }),
  );
}
