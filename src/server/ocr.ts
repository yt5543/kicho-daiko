import type { Bindings, OcrExtractedReceipt } from '../types';

// 大容量画像でもスタックオーバーフローしないチャンク分割型 ArrayBuffer -> Base64 変換
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * 【Gemini API によるレシート構造化OCR解析】
 * - 和暦変換、店舗名、合計金額、明細1行ごとの品名・金額・税率（軽減税率判定）を抽出
 * - 混雑(503)時の自動リトライ機能付き
 */
export async function runOcrExtraction(
  imageBytes: ArrayBuffer | Uint8Array,
  mimeType: string,
  fileName: string,
  env: Bindings,
  rawOcrTextHint?: string
): Promise<OcrExtractedReceipt> {
  const today = new Date().toISOString().slice(0, 10);
  const apiKey = env.GEMINI_API_KEY?.trim();

  // APIキー未設定時のフォールバック
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    return {
      receipt_date: today,
      payee: '（要確認：APIキー未設定）',
      amount: 0,
      memo: '※ .dev.vars に GEMINI_API_KEY を設定すると自動OCRが動作します',
      items: [
        {
          item_name: `取り込み画像: ${fileName}`,
          amount: 0,
          tax_rate: 10,
          is_reduced_tax: 0,
        },
      ],
    };
  }

  const model = env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  const base64Image = arrayBufferToBase64(imageBytes);

  let svgTextHint = '';
  if (mimeType.includes('svg') || fileName.toLowerCase().endsWith('.svg')) {
    try {
      const text = new TextDecoder('utf-8').decode(imageBytes);
      const matches = Array.from(text.matchAll(/<text[^>]*>(.*?)<\/text>/gi)).map(
        (m) => m[1]
      );
      svgTextHint = matches.join('\n') || text;
    } catch {
      // ignore
    }
  }

  const systemPrompt = `あなたは日本の税務・記帳代行業務に特化した超高精度なレシートOCR解析エンジンです。
レシート・領収書の画像またはテキストから以下の情報を正確に読み取り、指定されたJSONスキーマに従って出力してください。

【抽出ルール】
1. receipt_date (日付):
   - レシートに記載された取引日を「YYYY-MM-DD」形式で出力してください。
   - 和暦（例: 令和8年/R8 = 2026年、令和7年/R7 = 2025年）は西暦に変換してください。
   - 日付が読み取れない場合は "${today}" を設定してください。

2. payee (支払先):
   - 店名・会社名（支店名がある場合は「セブン-イレブン 渋谷駅前店」のように含める）を正確に抽出してください。

3. amount (レシート合計金額):
   - 支払った税込の合計金額（整数）を出力してください。

4. items (明細行の配列 - 1品ずつ):
   - レシートに印字されている購入商品を上から順番に1行ずつ抽出してください。
   - 単価と数量が2行に分かれている場合（例: 1行目に品名、2行目に「@150 × 2  ¥300」）は、1つの明細行にまとめ、amount には行の小計金額（300）を入れてください。
   - 値引き・割引行（例:「値引 -50」）がある場合は、amount をマイナス整数（-50）として1行の明細として含めてください。
   - 外税方式のレシートで、各商品の金額が税抜で印字され、末尾に「外税 10% ¥XXX」「外税 8% ¥YYY」と印字されている場合は、明細行の合計とレシート税込合計(amount)が一致するよう、外税行も「消費税(10%)」「消費税(8%※)」として明細行に追加してください。
   - tax_rate (税率%) と is_reduced_tax (軽減税率フラグ):
     * 品名や金額の横に「*」「※」「軽」「★」「W」などの軽減税率マークが付いている商品、または軽減税率対象（飲食料品・新聞など）は tax_rate: 8（またはレシート記載の軽減税率%）, is_reduced_tax: true にしてください。
     * 標準税率の商品は tax_rate: 10, is_reduced_tax: false にしてください。
     * 非課税・不課税（印紙代・切手・商品券など）は tax_rate: 0, is_reduced_tax: false にしてください。
   - 重要: 全明細行の amount の合計が、レシート全体の税込合計金額 (amount) と一致するように入念に検算してください。`;

  const extraContext = [
    rawOcrTextHint ? `【補助OCRテキスト(Cloud Vision)】\n${rawOcrTextHint}` : '',
    svgTextHint ? `【SVG内の印字テキスト】\n${svgTextHint}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const parts: Record<string, unknown>[] = [
    { text: extraContext ? `${systemPrompt}\n\n${extraContext}` : systemPrompt },
  ];

  if (!mimeType.includes('svg') && !fileName.toLowerCase().endsWith('.svg')) {
    parts.push({
      inlineData: {
        mimeType: mimeType || 'image/jpeg',
        data: base64Image,
      },
    });
  }

  const requestBody = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          receipt_date: { type: 'STRING' },
          payee: { type: 'STRING' },
          amount: { type: 'INTEGER' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                item_name: { type: 'STRING' },
                amount: { type: 'INTEGER' },
                tax_rate: { type: 'NUMBER' },
                is_reduced_tax: { type: 'BOOLEAN' },
              },
              required: ['item_name', 'amount', 'tax_rate', 'is_reduced_tax'],
            },
          },
        },
        required: ['receipt_date', 'payee', 'amount', 'items'],
      },
    },
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let isOverloaded = false;
  let lastErrorText = '';
  let jsonText = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000), // 高解像度レシートや混雑時にも耐えられるよう60秒に延長
      });

      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (jsonText) break;
      }

      const errText = await res.text().catch(() => '');
      console.warn(
        `Gemini [${model}] attempt ${attempt} returned HTTP ${res.status}: ${errText}`
      );

      if (res.status === 503 || res.status === 429) {
        isOverloaded = true;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      } else {
        lastErrorText = `(HTTP ${res.status}) ${errText}`;
        break;
      }
    } catch (fetchErr) {
      lastErrorText = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.warn(`Gemini [${model}] attempt ${attempt} network error:`, fetchErr);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (!jsonText) {
    if (isOverloaded) {
      throw new Error(
        'GoogleのOCR解析サーバーが一時的に混雑しています（High demand）。数十秒ほど待ってから再度お試しください。'
      );
    }
    throw new Error(`レシートの自動解析に失敗しました。詳細: ${lastErrorText}`);
  }

  const parsed = JSON.parse(jsonText) as {
    receipt_date?: string;
    payee?: string;
    amount?: number;
    items?: {
      item_name?: string;
      amount?: number;
      tax_rate?: number;
      is_reduced_tax?: boolean;
    }[];
  };

  const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(parsed.receipt_date ?? '')
    ? parsed.receipt_date!
    : today;

  const normalizedItems =
    parsed.items && parsed.items.length > 0
      ? parsed.items.map((item) => ({
          item_name: item.item_name?.trim() || '（品名不明）',
          amount: Math.trunc(Number(item.amount) || 0),
          tax_rate: typeof item.tax_rate === 'number' ? item.tax_rate : 10,
          is_reduced_tax: item.is_reduced_tax ? 1 : 0,
        }))
      : [
          {
            item_name: parsed.payee || '明細1',
            amount: Math.trunc(Number(parsed.amount) || 0),
            tax_rate: 10,
            is_reduced_tax: 0,
          },
        ];

  return {
    receipt_date: normalizedDate,
    payee: parsed.payee?.trim() || '（支払先不明）',
    amount: Math.trunc(Number(parsed.amount) || 0),
    memo: '',
    items: normalizedItems,
  };
}

