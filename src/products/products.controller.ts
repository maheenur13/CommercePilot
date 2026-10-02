import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../common/auth/auth.js';
import { ApiEnvelope, Paginated } from '../common/http/envelope.js';
import { CreateProductDto, ListProductsQueryDto, UpdateProductDto } from './dto/product.dto.js';
import { ProductResponseDto, toProductResponse } from './dto/product-response.dto.js';
import { ProductsService } from './products.service.js';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Search and filter the active catalog. */
  @Get()
  @ApiEnvelope(ProductResponseDto, { paginated: true })
  async list(@Query() query: ListProductsQueryDto): Promise<Paginated<ProductResponseDto>> {
    return Paginated.of(await this.products.list(query), toProductResponse);
  }

  /** Distinct categories of active products. */
  @Get('categories')
  @ApiEnvelope(String, { isArray: true })
  categories(): Promise<string[]> {
    return this.products.categories();
  }

  /** A single active product. */
  @Get(':id')
  @ApiEnvelope(ProductResponseDto)
  async get(@Param('id') id: string): Promise<ProductResponseDto> {
    return toProductResponse(await this.products.get(id));
  }
}

@ApiTags('admin')
@ApiSecurity('admin-key')
@UseGuards(AdminGuard)
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Creates a product. */
  @Post()
  @ApiEnvelope(ProductResponseDto, { status: 201 })
  async create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return toProductResponse(await this.products.create(dto));
  }

  /** Partial update. Stock is adjusted only via a relative `stockDelta`. */
  @Patch(':id')
  @ApiEnvelope(ProductResponseDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return toProductResponse(await this.products.update(id, dto));
  }
}
