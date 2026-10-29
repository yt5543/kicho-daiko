// Cloudflare Workers バインディング型定義
export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
};

// 顧客
export interface Client {
  id: number;
  name: string;
  drive_folder_id: string;
  created_at: string;
}

// 税率プリセットマスタ
export interface TaxRateOption {
  id: number;
  rate: number;
  name: string;
  is_reduced: number; // 1: 軽減税率対象, 0: 通常
  is_active: number;
  sort_order: number;
}

// レシート明細行
export interface ReceiptItem {
  id?: number;
  receipt_id?: number;
  line_number: number;
  item_name: string;
  amount: number;
  tax_rate: number;
  is_reduced_tax: number; // 1: 軽減税率対象, 0: 通常
  is_modified: number;    // 1: 手で修正済, 0: OCR初期値のまま
}

// OCR処理状態
export type OcrStatus = 'pending' | 'processing' | 'completed' | 'failed';

// レシート親データ
export interface Receipt {
  id: number;
  client_id: number;
  drive_file_id?: string;
  image_url: string;
  receipt_date: string;
  amount: number;
  payee: string;
  memo: string;
  status: 'unreviewed' | 'approved';
  ocr_status: OcrStatus;
  ocr_retry_count: number;
  ocr_error: string;
  created_at?: string;
  updated_at?: string;
  items: ReceiptItem[];
}

// レシート更新リクエスト
export interface UpdateReceiptRequest {
  receipt_date: string;
  amount: number;
  payee: string;
  memo?: string;
  status?: 'unreviewed' | 'approved';
  ocr_status?: OcrStatus;
  items: {
    item_name: string;
    amount: number;
    tax_rate: number;
    is_reduced_tax: boolean | number;
    is_modified?: boolean | number;
  }[];
}

// OCR抽出結果
export interface OcrExtractedReceipt {
  receipt_date: string;
  payee: string;
  amount: number;
  memo?: string;
  items: {
    item_name: string;
    amount: number;
    tax_rate: number;
    is_reduced_tax: number;
  }[];
}

// ==========================================
// フロントエンド編集用 型定義 & ヘルパー
// ==========================================

export interface EditableItem {
  key: string;
  item_name: string;
  amount: string;
  tax_rate: string;
  is_reduced_tax: boolean;
  is_modified: boolean; // 手で修正したかどうかのフラグ
}

export interface EditableReceipt {
  id: number;
  client_id: number;
  image_url: string;
  receipt_date: string;
  amount: string;
  payee: string;
  memo: string;
  status: 'unreviewed' | 'approved';
  ocr_status: OcrStatus;
  ocr_retry_count: number;
  ocr_error: string;
  items: EditableItem[];
}

export interface ReceiptStats {
  totalItems: number;
  modifiedItems: number;
  pendingOcrCount: number;
  failedOcrCount: number;
}

export const DEFAULT_TAX_RATES: TaxRateOption[] = [
  { id: 1, rate: 10, name: '10% (標準)', is_reduced: 0, is_active: 1, sort_order: 10 },
  { id: 2, rate: 8, name: '8% (軽減※)', is_reduced: 1, is_active: 1, sort_order: 20 },
  { id: 3, rate: 1, name: '1% (軽減※)', is_reduced: 1, is_active: 1, sort_order: 30 },
  { id: 4, rate: 0, name: '0% (非課税)', is_reduced: 0, is_active: 1, sort_order: 40 },
];

export function createRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function mapReceiptToEditable(r: Receipt): EditableReceipt {
  return {
    id: r.id,
    client_id: r.client_id,
    image_url: r.image_url,
    receipt_date: r.receipt_date ?? '',
    amount: String(r.amount ?? 0),
    payee: r.payee ?? '',
    memo: r.memo ?? '',
    status: r.status ?? 'unreviewed',
    ocr_status: r.ocr_status ?? 'pending',
    ocr_retry_count: r.ocr_retry_count ?? 0,
    ocr_error: r.ocr_error ?? '',
    items:
      r.items && r.items.length > 0
        ? r.items.map((item) => ({
            key: createRowKey(),
            item_name: item.item_name ?? '',
            amount: String(item.amount ?? 0),
            tax_rate: String(item.tax_rate ?? 10),
            is_reduced_tax: Boolean(item.is_reduced_tax),
            is_modified: Boolean(item.is_modified),
          }))
        : [
            {
              key: createRowKey(),
              item_name: '明細1',
              amount: String(r.amount ?? 0),
              tax_rate: '10',
              is_reduced_tax: false,
              is_modified: false,
            },
          ],
  };
}

