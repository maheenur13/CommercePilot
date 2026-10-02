import { Module } from '@nestjs/common';

import { ProductsModule } from '../products/products.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { LlmClient } from './llm.client.js';

@Module({
  imports: [ProductsModule],
  controllers: [AssistantController],
  providers: [AssistantService, LlmClient],
})
export class AssistantModule {}
