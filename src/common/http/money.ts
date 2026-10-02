import { ApiProperty } from '@nestjs/swagger';

/** Money is exposed as integer minor units plus a display string; clients never do float math. */
export class MoneyDto {
  @ApiProperty({ example: 19900 }) amountCents!: number;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ example: '$199.00' }) formatted!: string;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function toMoney(amountCents: number, currency: string): MoneyDto {
  let fmt = formatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    formatters.set(currency, fmt);
  }
  return { amountCents, currency, formatted: fmt.format(amountCents / 100) };
}
