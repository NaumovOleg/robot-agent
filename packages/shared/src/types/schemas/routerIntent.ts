import type { IntentRouterSchema } from '../../schemas';
import type { z } from 'zod';

export type RouterIntentOutput = z.infer<typeof IntentRouterSchema>;
