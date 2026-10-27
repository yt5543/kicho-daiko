import type { Bindings } from './types';
import { syncAllClientsDriveFolders } from './server/drive';

export default {
  // HTTP リクエストは受け付けない（攻撃面ゼロ）
  async fetch() {
    return new Response('Not Found', { status: 404 });
  },

  // 毎日 06:00 JST (21:00 UTC) の定期巡回バッチ
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    console.log('[Cron Worker] Starting daily Google Drive sync...');
    ctx.waitUntil(
      syncAllClientsDriveFolders(env)
        .then(() => console.log('[Cron Worker] Daily sync completed successfully'))
        .catch((err) => console.error('[Cron Worker] Daily sync failed:', err))
    );
  },
};
