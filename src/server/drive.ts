import type { Bindings, Client, OcrExtractedReceipt, Receipt, ReceiptItem } from '../types';
import { runOcrExtraction } from './ocr';

// ファイル名を安全なR2キー用文字列に整形
export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Google DriveフォルダURLまたはIDからフォルダIDだけを抽出
export function extractDriveFolderId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed.split('?')[0];
}

// Base64文字列をUint8Arrayに変換
export function base64ToUint8Array(base64: string): Uint8Array {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
  const binaryString = atob(cleaned);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncodeString(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * サービスアカウントの秘密鍵から JWT を生成し、Google OAuth2 トークンを取得
 */
export async function getGoogleDriveAccessToken(
  clientEmail: string,
  privateKeyPem: string
): Promise<string> {
  const pem = privateKeyPem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');

  const binaryDer = atob(pem);
  const derBuffer = new Uint8Array(binaryDer.length);
  for (let i = 0; i < binaryDer.length; i++) {
    derBuffer[i] = binaryDer.charCodeAt(i);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    derBuffer.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: nowSec + 3600,
    iat: nowSec,
  };

  const unsignedToken = `${base64UrlEncodeString(
    JSON.stringify(header)
  )}.${base64UrlEncodeString(JSON.stringify(payload))}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt = `${unsignedToken}.${base64UrlEncodeBuffer(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google認証トークンの取得に失敗しました: ${errText}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * 【ステップ1: 画像取り込み】
 * レシート画像を R2 に保存し、D1 に status='pending_ocr'（OCR解析待ち）として登録
 * ※ Gemini OCR は呼び出さないため、数秒で爆速完了しタイムアウトしません
 */
export async function saveReceiptImageToR2AndD1Pending(params: {
  clientId: number;
  imageBuffer: ArrayBuffer | Uint8Array;
  mimeType: string;
  originalFileName: string;
  driveFileId?: string;
  env: Bindings;
}): Promise<Receipt> {
  const {
    clientId,
    imageBuffer,
    mimeType,
    originalFileName,
    driveFileId = '',
    env,
  } = params;

  // 1. R2バケットへ画像を保存
  const uniqueKey = `clients/${clientId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}-${sanitizeFileName(originalFileName)}`;

  await env.BUCKET.put(uniqueKey, imageBuffer, {
    httpMetadata: {
      contentType: mimeType,
    },
  });

  const imageUrl = `/api/r2-images/${uniqueKey}`;
  const today = new Date().toISOString().slice(0, 10);

  // 2. D1データベースに status='pending_ocr' として保存
  const insertReceiptRes = await env.DB.prepare(
    `INSERT INTO receipts (client_id, drive_file_id, image_url, receipt_date, amount, payee, memo, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_ocr')`
  )
    .bind(
      clientId,
      driveFileId,
      imageUrl,
      today,
      0,
      originalFileName,
      'OCR解析待ち'
    )
    .run();

  const newReceiptId = Number(insertReceiptRes.meta.last_row_id);

  // 初期プレースホルダ明細行
  await env.DB.prepare(
    `INSERT INTO receipt_items
     (receipt_id, line_number, item_name, amount, tax_rate, is_reduced_tax, is_modified)
     VALUES (?, 1, ?, 0, 10, 0, 0)`
  )
    .bind(newReceiptId, '（OCR解析待ち）')
    .run();

  return {
    id: newReceiptId,
    client_id: clientId,
    drive_file_id: driveFileId,
    image_url: imageUrl,
    receipt_date: today,
    amount: 0,
    payee: originalFileName,
    memo: 'OCR解析待ち',
    status: 'pending_ocr',
    items: [
      {
        line_number: 1,
        item_name: '（OCR解析待ち）',
        amount: 0,
        tax_rate: 10,
        is_reduced_tax: 0,
        is_modified: 0,
      },
    ],
  };
}

/**
 * 【ステップ2: 単一レシートのOCR解析実行】
 * R2から画像を読み出して Gemini 3.8 Flash で解析し、D1 を更新して status='unreviewed' に変更
 */
export async function processSingleReceiptOcr(
  receiptId: number,
  env: Bindings
): Promise<Receipt> {
  const receipt = await env.DB.prepare(
    `SELECT id, client_id, drive_file_id, image_url, receipt_date, amount, payee, memo, status
     FROM receipts WHERE id = ?`
  )
    .bind(receiptId)
    .first<Receipt>();

  if (!receipt) {
    throw new Error(`レシート #${receiptId} が見つかりません`);
  }

  // R2キーを image_url から抽出
  const r2Key = receipt.image_url.replace(/^\/api\/r2-images\//, '');
  const r2Object = await env.BUCKET.get(r2Key);
  if (!r2Object) {
    throw new Error(`R2に画像データが存在しません: ${r2Key}`);
  }

  const imageBuffer = await r2Object.arrayBuffer();
  const mimeType = r2Object.httpMetadata?.contentType || 'image/jpeg';
  const fileName = r2Key.split('/').pop() || 'receipt.jpg';

  let ocrResult: OcrExtractedReceipt;
  try {
    ocrResult = await runOcrExtraction(imageBuffer, mimeType, fileName, env);
  } catch (ocrError) {
    console.error(`OCR extraction failed for receipt #${receiptId}:`, ocrError);
    const errMessage = ocrError instanceof Error ? ocrError.message : String(ocrError);
    const isTimeout = errMessage.includes('timeout') || errMessage.includes('aborted');
    const today = new Date().toISOString().slice(0, 10);
    ocrResult = {
      receipt_date: receipt.receipt_date || today,
      payee: receipt.payee || '（要確認：解析失敗）',
      amount: 0,
      memo: `※ 自動解析${isTimeout ? 'タイムアウト(90秒超過)' : '失敗'}。画像を確認して手入力してください。`,
      items: [
        {
          item_name: '（品名・金額を手入力）',
          amount: 0,
          tax_rate: 10,
          is_reduced_tax: 0,
        },
      ],
    };
  }

  // receipts テーブルの更新 (status を 'unreviewed' に昇格)
  await env.DB.prepare(
    `UPDATE receipts
     SET receipt_date = ?,
         amount = ?,
         payee = ?,
         memo = ?,
         status = 'unreviewed',
         updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      ocrResult.receipt_date,
      Math.trunc(ocrResult.amount),
      ocrResult.payee,
      ocrResult.memo ?? '',
      receiptId
    )
    .run();

  // 既存のプレースホルダ明細を削除し、OCR抽出明細行を保存
  await env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?')
    .bind(receiptId)
    .run();

  const itemStatements: D1PreparedStatement[] = ocrResult.items.map((item, idx) =>
    env.DB.prepare(
      `INSERT INTO receipt_items
       (receipt_id, line_number, item_name, amount, tax_rate, is_reduced_tax, is_modified)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).bind(
      receiptId,
      idx + 1,
      item.item_name,
      Math.trunc(item.amount),
      item.tax_rate,
      item.is_reduced_tax ? 1 : 0
    )
  );

  if (itemStatements.length > 0) {
    await env.DB.batch(itemStatements);
  }

  return {
    id: receiptId,
    client_id: receipt.client_id,
    drive_file_id: receipt.drive_file_id,
    image_url: receipt.image_url,
    receipt_date: ocrResult.receipt_date,
    amount: ocrResult.amount,
    payee: ocrResult.payee,
    memo: ocrResult.memo ?? '',
    status: 'unreviewed',
    items: ocrResult.items.map((item, idx) => ({
      line_number: idx + 1,
      ...item,
      is_modified: 0,
    })),
  };
}

/**
 * 特定顧客の pending_ocr レシートを一括で OCR 解析
 */
export async function processPendingOcrForClient(
  clientId: number,
  env: Bindings,
  limit = 20
): Promise<{ processed: number; receipts: Receipt[] }> {
  const { results: pendingReceipts } = await env.DB.prepare(
    `SELECT id FROM receipts WHERE client_id = ? AND status = 'pending_ocr' ORDER BY id ASC LIMIT ?`
  )
    .bind(clientId, limit)
    .all<{ id: number }>();

  const receipts: Receipt[] = [];
  for (const r of pendingReceipts) {
    try {
      const processed = await processSingleReceiptOcr(r.id, env);
      receipts.push(processed);
    } catch (err) {
      console.error(`Failed to process OCR for receipt #${r.id}:`, err);
    }
  }

  return { processed: receipts.length, receipts };
}

/**
 * 全顧客の pending_ocr レシートを順次 OCR 解析（Cron定期実行用）
 */
export async function processAllPendingOcrReceipts(
  env: Bindings,
  limit = 30
): Promise<number> {
  const { results: pendingReceipts } = await env.DB.prepare(
    `SELECT id FROM receipts WHERE status = 'pending_ocr' ORDER BY id ASC LIMIT ?`
  )
    .bind(limit)
    .all<{ id: number }>();

  let processedCount = 0;
  for (const r of pendingReceipts) {
    try {
      await processSingleReceiptOcr(r.id, env);
      processedCount++;
    } catch (err) {
      console.error(`Cron OCR failed for receipt #${r.id}:`, err);
    }
  }

  return processedCount;
}

/**
 * 特定顧客の Google Drive フォルダを巡回し、新規レシート画像をR2/D1に取り込む
 * （※ OCRは実行せず status='pending_ocr' として即時登録するため超高速）
 */
export async function syncClientDriveFolder(
  client: Client,
  accessToken: string,
  env: Bindings
): Promise<Receipt[]> {
  const folderId = extractDriveFolderId(client.drive_folder_id);
  if (!folderId) {
    return [];
  }

  // 1. 既に取り込み済みの drive_file_id 一覧をD1から取得（二重取り込み防止）
  const { results: existingRows } = await env.DB.prepare(
    `SELECT drive_file_id FROM receipts WHERE client_id = ? AND drive_file_id != ''`
  )
    .bind(client.id)
    .all<{ drive_file_id: string }>();

  const existingFileIds = new Set(existingRows.map((r) => r.drive_file_id));

  // 2. Google Drive API で指定フォルダ内の画像ファイル一覧を取得
  const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,mimeType,createdTime)&orderBy=createdTime asc&pageSize=50`;

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => '');
    throw new Error(
      `Google Driveフォルダ(${folderId})の読み取りに失敗しました: ${errText}`
    );
  }

  const listData = (await listRes.json()) as {
    files?: { id: string; name: string; mimeType: string }[];
  };

  const newFiles = (listData.files ?? []).filter(
    (f) => !existingFileIds.has(f.id)
  );

  const ingestedReceipts: Receipt[] = [];

  // 3. 新規ファイルを1件ずつダウンロード → R2保存 → D1に pending_ocr で保存
  for (const file of newFiles) {
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      file.id
    )}?alt=media`;
    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!fileRes.ok) {
      console.error(`Failed to download Drive file ${file.id}`);
      continue;
    }

    const imageBuffer = await fileRes.arrayBuffer();
    const receipt = await saveReceiptImageToR2AndD1Pending({
      clientId: client.id,
      imageBuffer,
      mimeType: file.mimeType || 'image/jpeg',
      originalFileName: file.name || `${file.id}.jpg`,
      driveFileId: file.id,
      env,
    });

    ingestedReceipts.push(receipt);
  }

  return ingestedReceipts;
}

/**
 * 全顧客のGoogle Driveフォルダを巡回するバッチ処理（Cron定期実行用）
 */
export async function syncAllClientsDriveFolders(env: Bindings): Promise<number> {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = env.GOOGLE_PRIVATE_KEY?.trim();

  if (!email || !privateKey) {
    console.warn(
      'Cron skipped: GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY is not configured.'
    );
    return 0;
  }

  const { results: clients } = await env.DB.prepare(
    `SELECT id, name, drive_folder_id, created_at FROM clients WHERE drive_folder_id != '' ORDER BY id ASC`
  ).all<Client>();

  if (clients.length === 0) {
    return 0;
  }

  const accessToken = await getGoogleDriveAccessToken(email, privateKey);
  let totalIngested = 0;

  for (const client of clients) {
    try {
      const receipts = await syncClientDriveFolder(client, accessToken, env);
      totalIngested += receipts.length;
    } catch (err) {
      console.error(`Failed to sync Drive folder for client #${client.id}:`, err);
    }
  }

  return totalIngested;
}
