import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type {
  Bindings,
  Client,
  Receipt,
  ReceiptItem,
  TaxRateOption,
  UpdateReceiptRequest,
} from '../types';
import { buildReceiptsCsv, type CsvReceiptRow } from './csv';
import {
  base64ToUint8Array,
  extractDriveFolderId,
  getGoogleDriveAccessToken,
  processPendingOcrForClient,
  processSingleReceiptOcr,
  saveReceiptImageToR2AndD1Pending,
  syncAllClientsDriveFolders,
  syncClientDriveFolder,
} from './drive';

export type { Bindings, Client, Receipt, ReceiptItem, TaxRateOption };

const app = new Hono<{ Bindings: Bindings }>();

// フロントエンドからのリクエストを許可
app.use('/api/*', cors());

/**
 * GET /api/r2-images/:key{.*}
 * R2バケットに保存されたレシート画像をWorkers経由で配信
 */
app.get('/api/r2-images/:key{.*}', async (c) => {
  const key = c.req.param('key');
  if (!key) {
    return c.json({ error: '画像キーが指定されていません' }, 400);
  }

  try {
    const object = await c.env.BUCKET.get(key);
    if (!object) {
      return c.json({ error: '画像が見つかりません' }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    if (!headers.get('content-type')) {
      headers.set('content-type', 'image/jpeg');
    }
    headers.set('cache-control', 'public, max-age=31536000, immutable');

    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    console.error('Failed to read image from R2:', error);
    return c.json({ error: 'R2からの画像取得に失敗しました' }, 500);
  }
});

/**
 * GET /api/clients
 * 顧客一覧を取得
 */
app.get('/api/clients', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, name, drive_folder_id, created_at FROM clients ORDER BY id ASC'
    ).all<Client>();

    return c.json({ clients: results });
  } catch (error) {
    console.error('Failed to fetch clients:', error);
    return c.json({ error: '顧客一覧の取得に失敗しました' }, 500);
  }
});

/**
 * POST /api/clients
 * 顧客を新規追加
 */
app.post('/api/clients', async (c) => {
  try {
    const body = await c.req.json<{ name?: string; drive_folder_id?: string }>();
    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: '顧客名を入力してください' }, 400);
    }

    const folderId = extractDriveFolderId(body.drive_folder_id ?? '');

    const res = await c.env.DB.prepare(
      'INSERT INTO clients (name, drive_folder_id) VALUES (?, ?)'
    )
      .bind(name, folderId)
      .run();

    const newId = Number(res.meta.last_row_id);
    const newClient = await c.env.DB.prepare(
      'SELECT id, name, drive_folder_id, created_at FROM clients WHERE id = ?'
    )
      .bind(newId)
      .first<Client>();

    return c.json({
      message: '顧客を登録しました',
      client: newClient,
    });
  } catch (error) {
    console.error('Failed to create client:', error);
    return c.json({ error: '顧客の登録に失敗しました' }, 500);
  }
});

/**
 * PUT /api/clients/:clientId
 * 顧客情報（名前・フォルダID）を更新
 */
app.put('/api/clients/:clientId', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  try {
    const body = await c.req.json<{ name?: string; drive_folder_id?: string }>();
    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: '顧客名を入力してください' }, 400);
    }

    const folderId = extractDriveFolderId(body.drive_folder_id ?? '');

    await c.env.DB.prepare(
      'UPDATE clients SET name = ?, drive_folder_id = ? WHERE id = ?'
    )
      .bind(name, folderId, clientId)
      .run();

    return c.json({ message: '顧客情報を更新しました' });
  } catch (error) {
    console.error('Failed to update client:', error);
    return c.json({ error: '顧客情報の更新に失敗しました' }, 500);
  }
});

/**
 * DELETE /api/clients/:clientId
 * 顧客を削除（紐づくレシートも自動削除）
 */
app.delete('/api/clients/:clientId', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  try {
    // 顧客削除（schema.sql の ON DELETE CASCADE により receipts, receipt_items も連鎖削除）
    const res = await c.env.DB.prepare('DELETE FROM clients WHERE id = ?')
      .bind(clientId)
      .run();

    if (res.meta.changes === 0) {
      return c.json({ error: '対象の顧客が見つかりません' }, 404);
    }

    return c.json({ message: '顧客を削除しました' });
  } catch (error) {
    console.error('Failed to delete client:', error);
    return c.json({ error: '顧客の削除に失敗しました' }, 500);
  }
});

/**
 * PUT /api/clients/:clientId/drive-folder
 * 顧客ごとのGoogle DriveフォルダID（またはURL）を保存
 */
app.put('/api/clients/:clientId/drive-folder', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  const body = await c.req
    .json<{ drive_folder_id?: string }>()
    .catch(() => ({ drive_folder_id: '' }));
  const folderId = extractDriveFolderId(body.drive_folder_id ?? '');

  try {
    await c.env.DB.prepare('UPDATE clients SET drive_folder_id = ? WHERE id = ?')
      .bind(folderId, clientId)
      .run();

    return c.json({
      message: 'Google DriveフォルダIDを保存しました',
      drive_folder_id: folderId,
    });
  } catch (error) {
    console.error('Failed to update drive_folder_id:', error);
    return c.json({ error: 'フォルダIDの保存に失敗しました' }, 500);
  }
});

/**
 * POST /api/clients/:clientId/sync-drive
 * 選択中の顧客のGoogle Driveフォルダから新規レシートを取り込む
 */
app.post('/api/clients/:clientId/sync-drive', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  const email = c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = c.env.GOOGLE_PRIVATE_KEY?.trim();

  if (!email || !privateKey) {
    return c.json(
      {
        error:
          '.dev.vars に GOOGLE_SERVICE_ACCOUNT_EMAIL と GOOGLE_PRIVATE_KEY を設定してください',
      },
      400
    );
  }

  try {
    const client = await c.env.DB.prepare(
      'SELECT id, name, drive_folder_id, created_at FROM clients WHERE id = ?'
    )
      .bind(clientId)
      .first<Client>();

    if (!client) {
      return c.json({ error: '指定された顧客が存在しません' }, 404);
    }

    if (!client.drive_folder_id) {
      return c.json(
        { error: 'この顧客のGoogle DriveフォルダIDが設定されていません' },
        400
      );
    }

    const accessToken = await getGoogleDriveAccessToken(email, privateKey);
    const ingestedReceipts = await syncClientDriveFolder(client, accessToken, c.env);

    return c.json({
      message:
        ingestedReceipts.length > 0
          ? `Google Driveから ${ingestedReceipts.length} 枚の画像を取り込みました（OCR解析待ち）`
          : 'Google Driveに未取り込みの新規レシート画像はありませんでした',
      ingested_count: ingestedReceipts.length,
      receipts: ingestedReceipts,
    });
  } catch (error) {
    console.error('Failed to sync Drive:', error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Google Driveからの取り込みに失敗しました',
      },
      500
    );
  }
});

/**
 * POST /api/clients/:clientId/run-ocr
 * OCR未実行（pending_ocr）のレシートを一括でGemini OCR解析
 */
app.post('/api/clients/:clientId/run-ocr', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  try {
    const result = await processPendingOcrForClient(clientId, c.env, 20);
    return c.json({
      message:
        result.processed > 0
          ? `${result.processed} 枚のレシートをOCR解析しました`
          : 'OCR解析待ちのレシートはありません',
      processed_count: result.processed,
      receipts: result.receipts,
    });
  } catch (error) {
    console.error('Failed to run OCR batch:', error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'OCR解析の実行中にエラーが発生しました',
      },
      500
    );
  }
});

/**
 * POST /api/clients/:clientId/receipts/ingest
 * ローカル画像ファイルまたはBase64からの直接取り込みAPI
 */
app.post('/api/clients/:clientId/receipts/ingest', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  try {
    const client = await c.env.DB.prepare('SELECT id, name FROM clients WHERE id = ?')
      .bind(clientId)
      .first<Client>();
    if (!client) {
      return c.json({ error: '指定された顧客が存在しません' }, 404);
    }

    const contentTypeHeader = c.req.header('content-type') ?? '';
    let imageBuffer: ArrayBuffer | Uint8Array;
    let mimeType = 'image/jpeg';
    let originalFileName = 'receipt.jpg';

    if (contentTypeHeader.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof File)) {
        return c.json({ error: 'file フィールドに画像ファイルを指定してください' }, 400);
      }
      imageBuffer = await file.arrayBuffer();
      mimeType = file.type || 'image/jpeg';
      originalFileName = file.name || 'receipt.jpg';
    } else if (contentTypeHeader.includes('application/json')) {
      const json = await c.req.json<{
        image_base64?: string;
        mime_type?: string;
        file_name?: string;
      }>();
      if (!json.image_base64) {
        return c.json({ error: 'image_base64 が指定されていません' }, 400);
      }
      imageBuffer = base64ToUint8Array(json.image_base64);
      mimeType = json.mime_type || 'image/jpeg';
      originalFileName = json.file_name || 'receipt.jpg';
    } else {
      return c.json(
        { error: 'multipart/form-data または application/json で送信してください' },
        400
      );
    }

    // 1. R2/D1に pending_ocr として保存
    const pendingReceipt = await saveReceiptImageToR2AndD1Pending({
      clientId,
      imageBuffer,
      mimeType,
      originalFileName,
      env: c.env,
    });

    // 2. そのまま即時OCRを実行
    const receipt = await processSingleReceiptOcr(pendingReceipt.id, c.env);

    return c.json({
      message: 'レシート画像を保存し、Gemini OCRで解析して登録しました',
      receipt,
    });
  } catch (error) {
    console.error('Failed to ingest receipt:', error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'レシートの取り込み・OCR解析処理に失敗しました',
      },
      500
    );
  }
});

/**
 * GET /api/tax-rates
 * 有効な税率マスタ一覧を取得
 */
app.get('/api/tax-rates', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, rate, name, is_reduced, is_active, sort_order FROM tax_rates WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
    ).all<TaxRateOption>();

    return c.json({ tax_rates: results });
  } catch (error) {
    console.error('Failed to fetch tax rates:', error);
    return c.json({ error: '税率マスタの取得に失敗しました' }, 500);
  }
});

/**
 * GET /api/clients/:clientId/receipts?status=unreviewed
 * 特定顧客のレシート一覧と明細行を取得
 */
app.get('/api/clients/:clientId/receipts', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  const status = c.req.query('status') ?? 'unreviewed';

  try {
    const isUnreviewedQuery = status === 'unreviewed';
    const statusCondition = isUnreviewedQuery
      ? `status IN ('pending_ocr', 'unreviewed')`
      : `status = ?`;
    const bindParams: (string | number)[] = isUnreviewedQuery
      ? [clientId]
      : [clientId, status];

    const { results: receiptRows } = await c.env.DB.prepare(
      `SELECT id, client_id, drive_file_id, image_url, receipt_date, amount, payee, memo, status, created_at, updated_at
       FROM receipts
       WHERE client_id = ? AND ${statusCondition}
       ORDER BY id ASC`
    )
      .bind(...bindParams)
      .all<Omit<Receipt, 'items'>>();

    if (receiptRows.length === 0) {
      return c.json({ receipts: [] });
    }

    const { results: itemRows } = await c.env.DB.prepare(
      `SELECT ri.id, ri.receipt_id, ri.line_number, ri.item_name, ri.amount, ri.tax_rate, ri.is_reduced_tax, ri.is_modified
       FROM receipt_items ri
       INNER JOIN receipts r ON r.id = ri.receipt_id
       WHERE r.client_id = ? AND r.${statusCondition}
       ORDER BY ri.receipt_id ASC, ri.line_number ASC, ri.id ASC`
    )
      .bind(...bindParams)
      .all<ReceiptItem>();

    const itemsByReceiptId = new Map<number, ReceiptItem[]>();
    for (const item of itemRows) {
      if (!item.receipt_id) continue;
      const list = itemsByReceiptId.get(item.receipt_id) ?? [];
      list.push(item);
      itemsByReceiptId.set(item.receipt_id, list);
    }

    const receipts: Receipt[] = (receiptRows ?? []).map((r: Omit<Receipt, 'items'>) => ({
      ...r,
      memo: r.memo ?? '',
      items: itemsByReceiptId.get(r.id) ?? [],
    }));

    return c.json({ receipts });
  } catch (error) {
    console.error('Failed to fetch receipts:', error);
    return c.json({ error: 'レシート一覧の取得に失敗しました' }, 500);
  }
});

/**
 * GET /api/clients/:clientId/receipts/json?month=YYYY-MM
 * 指定顧客・指定年月（YYYY-MM）のレシート＆明細行をシステム連携用階層JSON形式で出力
 */
app.get('/api/clients/:clientId/receipts/json', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  const month = c.req.query('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: 'month パラメータは YYYY-MM 形式で指定してください' }, 400);
  }

  try {
    const client = await c.env.DB.prepare(
      'SELECT id, name FROM clients WHERE id = ?'
    )
      .bind(clientId)
      .first<Client>();

    if (!client) {
      return c.json({ error: '指定された顧客が存在しません' }, 404);
    }

    // 対象月のレシート一覧を取得
    const { results: receiptRows } = await c.env.DB.prepare(
      `SELECT id, client_id, drive_file_id, image_url, receipt_date, amount, payee, memo, status, created_at, updated_at
       FROM receipts
       WHERE client_id = ? AND receipt_date LIKE ?
       ORDER BY receipt_date ASC, id ASC`
    )
      .bind(clientId, `${month}-%`)
      .all<Receipt>();

    if (receiptRows.length === 0) {
      const emptyPayload = {
        client_id: client.id,
        client_name: client.name,
        target_month: month,
        exported_at: new Date().toISOString(),
        receipt_count: 0,
        total_amount: 0,
        receipts: [],
      };
      return new Response(JSON.stringify(emptyPayload, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="receipts_${encodeURIComponent(
            client.name
          )}_${month}.json"`,
        },
      });
    }

    // 対象レシートの明細行を取得
    const { results: itemRows } = await c.env.DB.prepare(
      `SELECT ri.id, ri.receipt_id, ri.line_number, ri.item_name, ri.amount, ri.tax_rate, ri.is_reduced_tax, ri.is_modified
       FROM receipt_items ri
       INNER JOIN receipts r ON r.id = ri.receipt_id
       WHERE r.client_id = ? AND r.receipt_date LIKE ?
       ORDER BY ri.receipt_id ASC, ri.line_number ASC, ri.id ASC`
    )
      .bind(clientId, `${month}-%`)
      .all<ReceiptItem>();

    const itemsByReceiptId = new Map<number, ReceiptItem[]>();
    for (const item of itemRows) {
      if (!item.receipt_id) continue;
      const list = itemsByReceiptId.get(item.receipt_id) ?? [];
      list.push(item);
      itemsByReceiptId.set(item.receipt_id, list);
    }

    let overallTotal = 0;
    const receiptsFormatted = (receiptRows ?? []).map((r: Receipt) => {
      overallTotal += r.amount;
      const items = (itemsByReceiptId.get(r.id) ?? []).map((i) => ({
        line_number: i.line_number,
        item_name: i.item_name,
        amount: i.amount,
        tax_rate: i.tax_rate,
        is_reduced_tax: Boolean(i.is_reduced_tax),
        is_modified: Boolean(i.is_modified),
      }));

      return {
        id: r.id,
        receipt_date: r.receipt_date,
        payee: r.payee,
        total_amount: r.amount,
        memo: r.memo ?? '',
        status: r.status,
        image_url: r.image_url,
        items,
      };
    });

    const exportPayload = {
      client_id: client.id,
      client_name: client.name,
      target_month: month,
      exported_at: new Date().toISOString(),
      receipt_count: receiptsFormatted.length,
      total_amount: overallTotal,
      receipts: receiptsFormatted,
    };

    const jsonString = JSON.stringify(exportPayload, null, 2);
    const filename = `receipts_${encodeURIComponent(client.name)}_${month}.json`;

    return new Response(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Failed to export JSON:', error);
    return c.json({ error: 'JSON出力に失敗しました' }, 500);
  }
});

/**
 * GET /api/clients/:clientId/receipts/csv?month=YYYY-MM
 * 指定顧客・指定年月（YYYY-MM）のレシート＆明細行をCSV形式で出力
 */
app.get('/api/clients/:clientId/receipts/csv', async (c) => {
  const clientId = Number(c.req.param('clientId'));
  if (Number.isNaN(clientId)) {
    return c.json({ error: '不正な clientId です' }, 400);
  }

  const month = c.req.query('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: 'month パラメータは YYYY-MM 形式で指定してください' }, 400);
  }

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
         r.id AS receipt_id,
         r.receipt_date,
         r.payee,
         r.amount AS receipt_amount,
         r.memo,
         r.status,
         ri.line_number,
         ri.item_name,
         ri.amount AS item_amount,
         ri.tax_rate,
         ri.is_reduced_tax,
         ri.is_modified
       FROM receipts r
       LEFT JOIN receipt_items ri ON r.id = ri.receipt_id
       WHERE r.client_id = ? AND r.receipt_date LIKE ?
       ORDER BY r.receipt_date ASC, r.id ASC, ri.line_number ASC`
    )
      .bind(clientId, `${month}-%`)
      .all<CsvReceiptRow>();

    const csvContent = buildReceiptsCsv(results);
    const filename = `receipts_client${clientId}_${month}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Failed to export CSV:', error);
    return c.json({ error: 'CSV出力に失敗しました' }, 500);
  }
});

/**
 * PUT /api/receipts/:receiptId
 * レシート基本情報および明細行を更新
 */
app.put('/api/receipts/:receiptId', async (c) => {
  const receiptId = Number(c.req.param('receiptId'));
  if (Number.isNaN(receiptId)) {
    return c.json({ error: '不正な receiptId です' }, 400);
  }

  let body: UpdateReceiptRequest;
  try {
    body = await c.req.json<UpdateReceiptRequest>();
  } catch {
    return c.json({ error: 'リクエストボディのJSONが不正です' }, 400);
  }

  const { receipt_date, amount, payee, memo = '', items, status = 'approved' } = body;

  if (
    !receipt_date ||
    typeof amount !== 'number' ||
    Number.isNaN(amount) ||
    !payee ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return c.json(
      { error: '日付、合計金額、支払先、および1件以上の明細行を入力してください' },
      400
    );
  }

  try {
    const existing = await c.env.DB.prepare('SELECT id FROM receipts WHERE id = ?')
      .bind(receiptId)
      .first<{ id: number }>();

    if (!existing) {
      return c.json({ error: '対象のレシートが見つかりません' }, 404);
    }

    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `UPDATE receipts
         SET receipt_date = ?,
             amount = ?,
             payee = ?,
             memo = ?,
             status = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      ).bind(receipt_date, Math.trunc(amount), payee.trim(), memo.trim(), status, receiptId),
      c.env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(receiptId),
    ];

    items.forEach((item, index) => {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO receipt_items
           (receipt_id, line_number, item_name, amount, tax_rate, is_reduced_tax, is_modified, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(
          receiptId,
          index + 1,
          item.item_name.trim(),
          Math.trunc(item.amount),
          item.tax_rate,
          item.is_reduced_tax ? 1 : 0,
          item.is_modified ? 1 : 0
        )
      );
    });

    await c.env.DB.batch(statements);

    return c.json({
      message: 'レシートを更新しました',
      receipt_id: receiptId,
    });
  } catch (error) {
    console.error('Failed to update receipt:', error);
    return c.json({ error: 'レシートの更新に失敗しました' }, 500);
  }
});

export default app;
