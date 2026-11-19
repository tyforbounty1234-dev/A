/**
 * OpenAI Chat Completions client with Structured Outputs (strict JSON schema).
 * Runs only on the server; the API key never reaches the app.
 */
import { LlmError, type Llm, type LlmMessage } from '../_shared/lexicore/domain/ai/tutorCore.ts';

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  fetch?: typeof fetch;
  /** Delay before the single retry of a transient failure (ms). */
  retryDelayMs?: number;
}

export class OpenAiLlm implements Llm {
  constructor(private readonly opts: OpenAiOptions) {}

  async complete(req: { messages: LlmMessage[]; schemaName: string; schema: Record<string, unknown> }): Promise<{ text: string; model: string }> {
    try {
      return await this.once(req);
    } catch (e) {
      if (!(e instanceof LlmError) || !e.retryable) throw e;
      await new Promise((r) => setTimeout(r, this.opts.retryDelayMs ?? 800));
      return await this.once(req);
    }
  }

  private async once(req: { messages: LlmMessage[]; schemaName: string; schema: Record<string, unknown> }) {
    const doFetch = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.opts.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.opts.model,
          messages: req.messages,
          response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
          max_completion_tokens: this.opts.maxOutputTokens ?? 4000,
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 45_000),
      });
    } catch (e) {
      throw new LlmError(`request failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    const bodyText = await res.text();
    if (!res.ok) {
      throw new LlmError(`OpenAI HTTP ${res.status}: ${bodyText.slice(0, 300)}`, res.status === 429 || res.status >= 500);
    }
    let json: { model?: string; choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[] };
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new LlmError('OpenAI returned a non-JSON body', true);
    }
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) throw new LlmError(`model refused: ${choice.message.refusal.slice(0, 200)}`, false);
    if (choice?.finish_reason === 'length') throw new LlmError('model output was cut off (max tokens)', false);
    const text = choice?.message?.content;
    if (typeof text !== 'string' || text.length === 0) throw new LlmError('model returned no content', true);
    return { text, model: json.model ?? this.opts.model };
  }
}
