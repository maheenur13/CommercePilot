import { type MoneyDto, toMoney } from '../../common/http/money.js';
import type { ImportJob, ImportStatus } from '../../generated/prisma/client.js';
import type { ImportRow, RowError } from '../rows.js';

export class ImportRowErrorDto {
  /** Spreadsheet line number (the header is line 1). */
  row!: number;
  field!: string;
  message!: string;
}

/** A stored preview line (`ImportJob.preview`). A type alias so it is assignable to Prisma JSON. */
export type PreviewLine = ImportRow & { action: 'create' | 'update' };

export class ImportPreviewRowDto {
  row!: number;
  /** What applying does: create a new product or update the one with this SKU. */
  action!: 'create' | 'update';
  sku!: string;
  name!: string;
  price!: MoneyDto;
  description?: string;
  category?: string;
  brand?: string;
  /** Applied only when the product is created; existing stock is never overwritten. */
  stock?: number;
  active?: boolean;
  attributes!: Record<string, string>;
}

export class ImportJobResponseDto {
  id!: string;
  sourceUrl!: string;
  /** PREVIEW: dry run, nothing written. APPLIED: valid rows were upserted by SKU. */
  status!: ImportStatus;
  /** Data rows in the file. */
  totalRows!: number;
  /** Rows created (or that would be, for a preview). */
  created!: number;
  /** Rows updated (or that would be, for a preview). */
  updated!: number;
  /** Rows rejected by validation; see `errors`. */
  skipped!: number;
  /** CSV header -> product field. Unmapped columns are stored in `attributes`. */
  columnMap!: Record<string, string>;
  /** Row errors, capped at the first 200. */
  errors!: ImportRowErrorDto[];
  /** The first 20 valid rows as they would be written. */
  preview!: ImportPreviewRowDto[];
  createdAt!: Date;
}

export function toImportJobResponse(job: ImportJob): ImportJobResponseDto {
  return {
    id: job.id,
    sourceUrl: job.sourceUrl,
    status: job.status,
    totalRows: job.totalRows,
    created: job.created,
    updated: job.updated,
    skipped: job.skipped,
    columnMap: job.columnMap as Record<string, string>,
    errors: job.errors as RowError[],
    preview: (job.preview as PreviewLine[]).map(({ priceCents, currency, ...line }) => ({
      ...line,
      // Matches the write: a new product without a currency is USD; an update keeps its own.
      price: toMoney(priceCents, currency ?? 'USD'),
    })),
    createdAt: job.createdAt,
  };
}
