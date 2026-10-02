import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../../config/env.js';
import { PrismaService } from '../prisma.module.js';
import { hashToken, safeEqual } from './token.js';

export interface AuthedCustomer {
  id: string;
  email: string;
  name: string;
}

type AuthedRequest = Request & { customer?: AuthedCustomer };

function bearerToken(req: Request): string | undefined {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Resolves the customer from `Authorization: Bearer <token>`.
 * Identity is only ever derived here, server-side, never from request bodies or LLM output.
 */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  protected readonly optional: boolean = false;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    if (!token) {
      if (this.optional) return true;
      throw new UnauthorizedException('Missing bearer token');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { apiTokenHash: hashToken(token) },
      select: { id: true, email: true, name: true },
    });
    // A bad token is always a 401, never a silent downgrade to anonymous.
    if (!customer) throw new UnauthorizedException('Invalid token');

    req.customer = customer;
    return true;
  }
}

/** Like `CustomerAuthGuard`, but a request without a token proceeds as anonymous. */
@Injectable()
export class OptionalCustomerAuthGuard extends CustomerAuthGuard {
  protected override readonly optional = true;
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = req.headers['x-admin-key'];
    if (typeof key !== 'string' || !safeEqual(key, this.config.get('ADMIN_API_KEY'))) {
      throw new UnauthorizedException('Invalid admin key');
    }
    return true;
  }
}

export const CurrentCustomer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedCustomer => {
    const customer = ctx.switchToHttp().getRequest<AuthedRequest>().customer;
    if (!customer) throw new UnauthorizedException();
    return customer;
  },
);

/** For routes behind `OptionalCustomerAuthGuard`: the customer, or null when anonymous. */
export const OptionalCustomer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedCustomer | null =>
    ctx.switchToHttp().getRequest<AuthedRequest>().customer ?? null,
);
