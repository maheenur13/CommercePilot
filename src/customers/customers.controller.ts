import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { type AuthedCustomer, CurrentCustomer, CustomerAuthGuard } from '../common/auth/auth.js';
import { ApiEnvelope } from '../common/http/envelope.js';
import { CustomerResponseDto } from './dto/customer-response.dto.js';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(CustomerAuthGuard)
@Controller('me')
export class CustomersController {
  /** The authenticated customer. */
  @Get()
  @ApiEnvelope(CustomerResponseDto)
  me(@CurrentCustomer() customer: AuthedCustomer): CustomerResponseDto {
    return { id: customer.id, email: customer.email, name: customer.name };
  }
}
