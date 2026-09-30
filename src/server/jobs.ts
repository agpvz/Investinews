import type { AppCtx } from './env.ts';
import * as repo from './repo.ts';
import { pollSources, type PollSummary } from './ingest.ts';
import { flushDeliveries } from './notify.ts';

export interface JobResult { ran: boolean; reason?: string; poll?: PollSummary; deliveries?: { sent: number; failed: number; expired: number; skipped: number }; pruned?: { articles: number; events: number }; ms?: number }

/** One scheduler tick. Overlap-safe via a DB lock, so external cron, the local timer and manual refresh can all call it. */
export async function runPollJob(ctx: AppCtx, opts: { force?: boolean; sourceIds?: string[]; fetchImpl?: typeof fetch; skipPrune?: boolean } = {}): Promise<JobResult> {
  const started = Date.now();
  if (!(await repo.acquireJobLock(ctx.db, 'poll', 10 * 60_000))) return { ran: false, reason: 'locked' };
  try {
    const poll = await pollSources(ctx, opts);
    const deliveries = await flushDeliveries(ctx, opts.fetchImpl);
    let pruned: { articles: number; events: number } | undefined;
    if (!opts.skipPrune) {
      const lastPrune = Number(await repo.getSetting(ctx.db, 'last_prune')) || 0;
      if (Date.now() - lastPrune > 6 * 3600_000) { pruned = await repo.prune(ctx.db, ctx.cfg.retentionDays); await repo.setSetting(ctx.db, 'last_prune', String(Date.now())); }
    }
    const ms = Date.now() - started;
    await repo.releaseJobLock(ctx.db, 'poll', 'ok', JSON.stringify({ ...poll, deliveries, ms }));
    ctx.log('job.poll', { ...poll, errors: poll.errors.length, deliveries, ms });
    return { ran: true, poll, deliveries, pruned, ms };
  } catch (e) {
    await repo.releaseJobLock(ctx.db, 'poll', 'error', String((e as Error).message).slice(0, 300));
    throw e;
  }
}
