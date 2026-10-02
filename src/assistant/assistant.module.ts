import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module.js';
import { ProductsModule } from '../products/products.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { LlmClient } from './llm.client.js';

@Module({
  imports: [ProductsModule, OrdersModule],
  controllers: [AssistantController],
  providers: [AssistantService, LlmClient],
})
export class AssistantModule {}
