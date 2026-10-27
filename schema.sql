-- Cloudflare D1 Schema: マルチテナント・レシートOCR目視レビューシステム（OCR状態・リトライ管理・Google Drive自動同期・階層JSON出力対応版）

DROP TABLE IF EXISTS receipt_items;
DROP TABLE IF EXISTS receipts;
DROP TABLE IF EXISTS tax_rates;
DROP TABLE IF EXISTS clients;

-- 1. 顧客管理テーブル（顧客別のGoogle DriveフォルダIDを保持）
CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    drive_folder_id TEXT NOT NULL DEFAULT '',    -- 顧客用のGoogle DriveフォルダID
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. 税率マスタテーブル（将来の税率変更・1%軽減税率導入などにも設定追加のみで対応可能）
CREATE TABLE tax_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rate REAL NOT NULL,                          -- 税率（%: 10, 8, 1, 0 など任意の数値）
    name TEXT NOT NULL,                          -- 表示名（例: '10% (標準)', '8% (軽減※)', '1% (軽減※)'）
    is_reduced INTEGER NOT NULL DEFAULT 0,       -- 1: 軽減税率対象, 0: 標準/非課税など
    is_active INTEGER NOT NULL DEFAULT 1,        -- 1: 有効, 0: 無効
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- 3. レシート親テーブル（業務ステータス + OCR状態 + リトライ回数 + メモ）
CREATE TABLE receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    drive_file_id TEXT NOT NULL DEFAULT '',      -- Google Drive上のファイルID（二重取り込み防止用）
    image_url TEXT NOT NULL,
    receipt_date TEXT NOT NULL,                  -- YYYY-MM-DD
    amount INTEGER NOT NULL DEFAULT 0,           -- レシート合計金額（整数）
    payee TEXT NOT NULL DEFAULT '',              -- 支払先
    memo TEXT NOT NULL DEFAULT '',               -- レシート単位のメモ（例: 〇〇様と会食、2行目が経費 など）
    status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed', 'approved')), -- 業務承認ステータス
    ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'processing', 'completed', 'failed')), -- OCR処理状態
    ocr_retry_count INTEGER NOT NULL DEFAULT 0,  -- OCR試行回数
    ocr_error TEXT NOT NULL DEFAULT '',          -- 最終エラーメッセージ
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- 4. レシート明細行テーブル（1品ごとの品名・金額・税率・手修正フラグ）
CREATE TABLE receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL,
    line_number INTEGER NOT NULL DEFAULT 1,
    item_name TEXT NOT NULL,                     -- 品名（1行ずつ）
    amount INTEGER NOT NULL DEFAULT 0,           -- 明細金額（税込・整数）
    tax_rate REAL NOT NULL DEFAULT 10,           -- 適用税率（%: 10, 8, 1, 0 等、固定制約なし）
    is_reduced_tax INTEGER NOT NULL DEFAULT 0,   -- 1: 軽減税率対象, 0: 通常
    is_modified INTEGER NOT NULL DEFAULT 0,      -- 1: 手で修正済, 0: OCR読み取りのまま
    account_item TEXT NOT NULL DEFAULT '',       -- 勘定科目（任意・将来用）
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
);

-- 検索パフォーマンス向上のためのインデックス
CREATE INDEX idx_receipts_client_status ON receipts(client_id, status);
CREATE INDEX idx_receipts_client_ocr ON receipts(client_id, ocr_status);
CREATE INDEX idx_receipts_client_date ON receipts(client_id, receipt_date);
CREATE INDEX idx_receipts_drive_file_id ON receipts(client_id, drive_file_id);
CREATE INDEX idx_receipt_items_receipt_id ON receipt_items(receipt_id, line_number);

-- 初期データ: 税率マスタ
INSERT INTO tax_rates (rate, name, is_reduced, is_active, sort_order) VALUES
  (10, '10% (標準)', 0, 1, 10),
  (8,  '8% (軽減※)', 1, 1, 20),
  (1,  '1% (軽減※)', 1, 1, 30),
  (0,  '0% (非課税)', 0, 1, 40);

-- 初期データ: 顧客
INSERT INTO clients (name, drive_folder_id) VALUES
  ('株式会社サンプル商事', ''),
  ('合同会社テックラボ', ''),
  ('鈴木税理士事務所', '');
