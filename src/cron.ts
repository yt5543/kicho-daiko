import type { Bindings } from './types';
import { processAllPendingOcrReceipts, syncAllClientsDriveFolders } from './server/drive';

export default {
  // HTTP リクエストは受け付けない（攻撃面ゼロ）
  async fetch() {
    return new Response('Not Found', { status: 404 });
  },

  // 毎日 06:00 JST (21:00 UTC) の定期巡回バッチ
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    console.log('[Cron Worker] Starting daily Google Drive sync...');
    ctx.waitUntil(
      (async () => {
        // ステップ1: 全顧客の Drive フォルダから新規画像を高速取り込み（status='pending_ocr'）
        const ingestedCount = await syncAllClientsDriveFolders(env);
        console.log(`[Cron Worker] Ingested ${ingestedCount} new receipt images (pending_ocr)`);

        // ステップ2: 取り込んだ画像（および過去の未処理分）を Gemini OCR で解析（status='unreviewed'へ）
        const processedCount = await processAllPendingOcrReceipts(env, 50);
        console.log(`[Cron Worker] Processed OCR for ${processedCount} receipts`);
      })().catch((err) => console.error('[Cron Worker] Daily batch failed:', err))
    );
  },
};
