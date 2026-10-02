import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { ApiEnvelope } from '../common/http/envelope.js';
import { PrismaService } from '../common/prisma.module.js';
import { APP_VERSION } from '../config/version.js';
import { HealthResponseDto } from './health-response.dto.js';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness + readiness: 200 when the API and its database are reachable, 503 otherwise. */
  @Get()
  @ApiEnvelope(HealthResponseDto)
  async check(): Promise<HealthResponseDto> {
    const started = performance.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Database is unreachable',
      });
    }
    return {
      status: 'ok',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date(),
      checks: { database: { status: 'up', latencyMs: Math.round(performance.now() - started) } },
    };
  }
}
