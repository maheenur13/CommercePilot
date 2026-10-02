import { Module } from '@nestjs/common';

import { LlmClient } from '../assistant/llm.client.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService, LlmClient],
})
export class ImportsModule {}
