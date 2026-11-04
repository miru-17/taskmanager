import { config } from "../../core/config";

/**
 * The only thing that talks to a model. Any OpenAI-compatible /chat/completions endpoint works:
 * Ollama (http://localhost:11434/v1), LM Studio, vLLM, or a hosted API with a key.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** Returns the model's text, or throws AIError */
  complete(messages: ChatMessage[], opts: { json: boolean; maxTokens?: number }): Promise<string>;
}

export class AIError extends Error {
  constructor(
    public readonly kind: "timeout" | "unreachable" | "http" | "empty",
    message: string
  ) {
    super(message);
  }
}

export const openAICompatible = (baseUrl: string, model: string, apiKey: string | undefined, timeoutMs: number): AIProvider => ({
  name: "openai-compatible",
  model,
  async complete(messages, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: opts.maxTokens ?? config.AI_MAX_OUTPUT_TOKENS,
          stream: false,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (err) {
      throw new AIError(ctrl.signal.aborted ? "timeout" : "unreachable", ctrl.signal.aborted ? "The AI service took too long" : `Couldn't reach the AI service: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // Never echo the provider's body (it can include the request); status is enough to diagnose
      throw new AIError("http", `The AI service answered ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new AIError("empty", "The AI service returned nothing");
    return text;
  },
});

let override: AIProvider | null | undefined;

/** The configured provider, or null when AI isn't set up. Tests can swap it. */
export const getProvider = (): AIProvider | null => {
  if (override !== undefined) return override;
  return config.aiBaseUrl ? openAICompatible(config.aiBaseUrl, config.AI_MODEL, config.AI_API_KEY, config.AI_TIMEOUT_MS) : null;
};
export const setProviderForTests = (p: AIProvider | null | undefined) => {
  override = p;
};
