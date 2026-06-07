const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00, cacheRead: 0.30 },
  'claude-opus-4-8':           { input: 15.00, output: 75.00, cacheRead: 1.50 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00,  cacheRead: 0.08 },
};

export function computeCost(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }
): number {
  const prices = PRICES[model] ?? PRICES['claude-sonnet-4-6'];
  return (
    usage.input_tokens * prices.input +
    usage.output_tokens * prices.output +
    (usage.cache_read_input_tokens ?? 0) * prices.cacheRead
  ) / 1_000_000;
}
