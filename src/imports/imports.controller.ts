import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AdminGuard } from '../common/auth/auth.js';
import { ApiEnvelope } from '../common/http/envelope.js';
import { CreateImportDto } from './dto/import.dto.js';
import { ImportJobResponseDto, toImportJobResponse } from './dto/import-response.dto.js';
import { ImportsService } from './imports.service.js';

@ApiTags('admin')
@ApiSecurity('admin-key')
@UseGuards(AdminGuard)
@Controller('admin/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /**
   * Import products from a CSV or Google Sheets link, upserting by SKU. Dry run by default:
   * review `preview` and `errors`, then send the same link with `dryRun: false` (and optionally
   * `previewId`, to require the content you reviewed) to apply.
   */
  @Post()
  // Each call fetches a remote file and may call the model.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiEnvelope(ImportJobResponseDto, { status: 201 })
  async create(@Body() dto: CreateImportDto): Promise<ImportJobResponseDto> {
    return toImportJobResponse(await this.imports.run(dto.url, dto.dryRun ?? true, dto.previewId));
  }

  /** A past import's result. */
  @Get(':id')
  @ApiEnvelope(ImportJobResponseDto)
  async get(@Param('id') id: string): Promise<ImportJobResponseDto> {
    return toImportJobResponse(await this.imports.get(id));
  }
}
