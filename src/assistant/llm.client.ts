import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { Env } from '../config/env.js';

/** OpenAI-compatible chat message (the subset this app sends and receives). */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                // Some OpenAI-compatible providers omit `type`.
                type: z.literal('function').default('function'),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
});

export type ToolChoice = 'auto' | 'none';

export type Completion = { content: string | null; toolCalls: ToolCall[] };

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1024;

/**
 * Thin client for an OpenAI-compatible `/chat/completions` endpoint (OpenRouter by default).
 * Native fetch on purpose: one endpoint doesn't justify an SDK. Tests replace this provider.
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** `toolChoice: 'none'` forces a text answer (an empty `tools` array is rejected by OpenAI-style APIs). */
  async complete(
    messages: ChatMessage[],
    tools: ToolSpec[],
    toolChoice: ToolChoice = 'auto',
  ): Promise<Completion> {
    const apiKey = this.config.get('OPENROUTER_API_KEY', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Assistant is not configured (no model API key)',
      });
    }

    let body: unknown;
    try {
      const res = await fetch(
        `${this.config.get('LLM_BASE_URL', { infer: true })}/chat/completions`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.config.get('LLM_MODEL', { infer: true }),
            messages,
            tools,
            tool_choice: toolChoice,
            temperature: 0,
            // Bounds cost per call and the size of replies that get stored and replayed.
            max_tokens: MAX_OUTPUT_TOKENS,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      body = await res.json();
    } catch (err) {
      this.logger.error(err);
      throw unavailable();
    }

    const parsed = completionSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.error(`Unexpected LLM response: ${z.prettifyError(parsed.error)}`);
      throw unavailable();
    }
    const { message } = parsed.data.choices[0]!;
    return { content: message.content ?? null, toolCalls: message.tool_calls ?? [] };
  }
}

function unavailable() {
  return new ServiceUnavailableException({
    code: 'DEPENDENCY_UNAVAILABLE',
    message: 'The assistant model is unavailable, try again later',
  });
}
