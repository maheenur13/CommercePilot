import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class ChatRequestDto {
  /** Continue an existing conversation (must belong to the caller). Omit to start a new one. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  /** The shopper's message. Optional only when confirming a quote. */
  @ValidateIf((o: ChatRequestDto) => o.confirmQuoteId == null || o.message !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message?: string;

  /**
   * Place the order from a `pendingOrder` the assistant prepared (signed-in shoppers only).
   * The server confirms it without calling the model.
   */
  @IsOptional()
  @IsUUID('4')
  confirmQuoteId?: string;
}
