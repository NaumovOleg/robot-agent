
// LLM Provider Abstraction
export interface LLMProvider {
  generate(
    prompt: string,
    options?: GenerateOptions
  ): AsyncIterable<GenerateResponse>;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

export interface GenerateResponse {
  text: string;
  done: boolean;
}

// OpenAI Provider Stub
export class OpenAIProvider implements LLMProvider {
  async *generate(
    prompt: string,
    _options?: GenerateOptions
  ): AsyncIterable<GenerateResponse> {
    // Stub implementation
    yield { text: `OpenAI response to: ${prompt}`, done: false };
    await new Promise((r) => setTimeout(r, 500));
    yield { text: "[streaming chunk 1]", done: false };
    await new Promise((r) => setTimeout(r, 500));
    yield { text: "[streaming chunk 2]", done: true };
  }
}

// Anthropic Provider Stub
export class AnthropicProvider implements LLMProvider {
  async *generate(
    prompt: string,
    _options?: GenerateOptions
  ): AsyncIterable<GenerateResponse> {
    // Stub implementation
    yield { text: `Anthropic response to: ${prompt}`, done: false };
    await new Promise((r) => setTimeout(r, 500));
    yield { text: "[streaming chunk A]", done: false };
    await new Promise((r) => setTimeout(r, 500));
    yield { text: "[streaming chunk B]", done: true };
  }
}
