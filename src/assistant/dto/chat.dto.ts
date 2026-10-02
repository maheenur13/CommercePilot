import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChatRequestDto {
  /** Continue an existing conversation (must belong to the caller). Omit to start a new one. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  /** The shopper's message. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;
}
