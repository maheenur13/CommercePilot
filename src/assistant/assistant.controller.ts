import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  type AuthedCustomer,
  OptionalCustomer,
  OptionalCustomerAuthGuard,
} from '../common/auth/auth.js';
import { ApiEnvelope } from '../common/http/envelope.js';
import { AssistantService, CONFIRM_MESSAGE } from './assistant.service.js';
import { ChatRequestDto } from './dto/chat.dto.js';
import { ChatResponseDto, toChatResponse } from './dto/chat-response.dto.js';

@ApiTags('assistant')
@ApiBearerAuth()
@UseGuards(OptionalCustomerAuthGuard)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /**
   * Ask the shopping assistant. Bearer token optional (needed for orders); only the starter can
   * continue a conversation. Send `confirmQuoteId` to place an order the assistant prepared.
   */
  @Post('chat')
  @HttpCode(200)
  // Model calls cost money: tighter than the global limit.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiEnvelope(ChatResponseDto)
  async chat(
    @OptionalCustomer() customer: AuthedCustomer | null,
    @Body() dto: ChatRequestDto,
  ): Promise<ChatResponseDto> {
    const result = await this.assistant.chat(customer, {
      message: dto.message ?? CONFIRM_MESSAGE,
      conversationId: dto.conversationId,
      confirmQuoteId: dto.confirmQuoteId,
    });
    return toChatResponse(result);
  }
}
