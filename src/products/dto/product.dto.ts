import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/pagination.dto.js';

export class ListProductsQueryDto extends PaginationQueryDto {
  /** Free-text search over name, description, brand and category. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceCents?: number;

  /** Only return products with stock > 0. */
  @IsOptional()
  // Only the literal strings map to booleans; anything else reaches @IsBoolean and is a 400.
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  inStock?: boolean;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'sku may only contain letters, digits, . _ -' })
  sku!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock!: number;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string | number | boolean>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * Stock is never overwritten with an absolute value (that would erase concurrent order
 * decrements); it is adjusted relative to the current value instead.
 */
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['stock'] as const)) {
  /** Relative stock adjustment, e.g. +10 for a restock or -2 for shrinkage. */
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  stockDelta?: number;
}
