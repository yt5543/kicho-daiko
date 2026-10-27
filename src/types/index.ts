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

