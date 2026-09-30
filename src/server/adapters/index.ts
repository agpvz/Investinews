import type { Adapter } from './types.ts';
import { secAdapter } from './sec.ts';
import { rssAdapter } from './rss.ts';

const ADAPTERS: Record<string, Adapter> = { sec_submissions: secAdapter, rss: rssAdapter };
export function getAdapter(type: string): Adapter | null { return ADAPTERS[type] || null; }
export { sourceStatus, safeJson } from './types.ts';
