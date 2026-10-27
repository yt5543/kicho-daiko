import type { Bindings, Client, OcrExtractedReceipt, Receipt } from '../types';
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
 * Google サービスアカウントの秘密鍵(PEM)を使ってOAuth2アクセストークンを取得
 */
export async function getGoogleDriveAccessToken(
  serviceAccountEmail: string,
  privateKeyPem: string
): Promise<string> {
  const pemContents = privateKeyPem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const binaryDer = base64ToUint8Array(pemContents);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer as ArrayBuffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
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
 * 1件のレシート画像を R2 に保存 → Gemini OCR実行 → D1 に status='unreviewed' で登録
 */
export async function ingestReceiptImageToR2AndD1(params: {
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

  // 2. Gemini APIでOCR実行（タイムアウトやエラー時はフォールバックして登録を継続）
  let ocrResult: OcrExtractedReceipt;
  try {
    ocrResult = await runOcrExtraction(
      imageBuffer,
      mimeType,
      originalFileName,
      env
    );
  } catch (ocrError) {
    console.error(`OCR extraction failed for ${originalFileName}:`, ocrError);
    const errMessage = ocrError instanceof Error ? ocrError.message : String(ocrError);
    const isTimeout = errMessage.includes('timeout') || errMessage.includes('aborted');
    const today = new Date().toISOString().slice(0, 10);
    ocrResult = {
      receipt_date: today,
      payee: '（要確認：解析失敗）',
      amount: 0,
      memo: `※ 自動解析${isTimeout ? 'タイムアウト(90秒超過)' : '失敗'}。画像を確認して日付・店名・金額を入力してください。`,
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

  // 3. D1データベースに status='unreviewed' として保存
  const insertReceiptRes = await env.DB.prepare(
    `INSERT INTO receipts (client_id, drive_file_id, image_url, receipt_date, amount, payee, memo, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unreviewed')`
  )
    .bind(
      clientId,
      driveFileId,
      imageUrl,
      ocrResult.receipt_date,
      Math.trunc(ocrResult.amount),
      ocrResult.payee,
      ocrResult.memo ?? ''
    )
    .run();

  const newReceiptId = Number(insertReceiptRes.meta.last_row_id);

  // 明細行の保存
  const itemStatements: D1PreparedStatement[] = ocrResult.items.map((item, idx) =>
    env.DB.prepare(
      `INSERT INTO receipt_items
       (receipt_id, line_number, item_name, amount, tax_rate, is_reduced_tax, is_modified)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).bind(
      newReceiptId,
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
    id: newReceiptId,
    client_id: clientId,
    drive_file_id: driveFileId,
    image_url: imageUrl,
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
 * 特定顧客の Google Drive フォルダを巡回し、未取り込みのレシート画像を取り込む
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

  // 3. 新規ファイルを1件ずつダウンロード → R2保存 → Gemini OCR → D1保存
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
    const receipt = await ingestReceiptImageToR2AndD1({
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

