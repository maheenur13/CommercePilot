import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url(),
    ADMIN_API_KEY: z.string().min(16, 'ADMIN_API_KEY must be at least 16 characters'),
    LLM_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),
    LLM_MODEL: z.string().default('openai/gpt-4o-mini'),
    // Optional on purpose: the shop must boot without a model key.
    OPENROUTER_API_KEY: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    // Test-only SSRF exemption: exact `host:port` pairs the importer may fetch despite a private IP.
    IMPORT_ALLOWED_HOSTS: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((h) => h.trim().toLowerCase()) : [])),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.IMPORT_ALLOWED_HOSTS.length === 0, {
    message: 'IMPORT_ALLOWED_HOSTS must not be set in production',
    path: ['IMPORT_ALLOWED_HOSTS'],
  });

export type Env = z.infer<typeof envSchema>;

/** Fail fast at boot with a readable message instead of a runtime crash later. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
