# 記帳代行向け レシートOCRレビュー＆管理システム (kicho-daiko)

複数顧問先（クライアント）の Google Drive からレシート・領収書画像を自動巡回し、Gemini 3.8 Flash による高精度OCR解析、2ペイン画面での高速目視確認・手修正、そして次期基幹システム向けの階層JSON出力までを一気通貫で実現する、Cloudflare フルスタックWebアプリケーションです。

---

## 🏗️ システムアーキテクチャ

本システムは Cloudflare のサーバーレスエコシステムで構築されており、高セキュリティ・低レイテンシ・ゼロメンテナンス運用を実現しています。

```
【ブラウザ（ユーザー）】
       │
       ▼（Cloudflare Access One-time PIN 認証で完全保護）
【Cloudflare Pages】（https://kicho-daiko-88n.pages.dev）
  ├── フロントエンド（React 18 + TypeScript + Vite + Tailwind CSS）
  └── Pages Functions（/api/* - Hono v4）
        ├── 顧客管理・レシートCRUD
        ├── D1 データベース（kicho-daiko-db）
        ├── R2 ストレージ（kicho-daiko-receipts - 画像配信）
        ├── Gemini API（gemini-3.8-flash - 構造化OCR解析）
        └── 月別エクスポート（階層JSON出力 & UTF-8 BOM付きCSV出力）

────────────────────────────────────────────────────────────

【Cloudflare Workers (Cron専用)】（kicho-daiko-cron）
  └── 毎日 06:00 JST (21:00 UTC) に自動巡回バッチ実行
        └── 全顧客の Google Drive フォルダを走査し、未処理の新規画像のみを取り込み
        ※ 外部からの HTTP リクエストは完全遮断（攻撃面ゼロ）
```

---

## ✨ 主要機能

### 1. 顧客管理 & Google Drive 連携
* **マルチテナント対応**: 顧問先ごとに Google Drive のフォルダURLまたはIDを紐付け。
* **自動取り込み & 重複防止**: 各画像の Google Drive File ID を記録し、同一ファイルの二重取り込みを完全に防止。
* **手動即時同期**: 画面上の「🔄 Driveからレシート取込」ボタンから、いつでも即座に最新ファイルを取り込み可能。
* **ローカル直接アップロード**: 画面からの画像ファイル直接アップロードにも対応。

### 2. Gemini 3.8 Flash による高精度 OCR
* レシート写真から以下の情報を構造化データとして自動抽出：
  * **基本情報**: 日付 (`YYYY-MM-DD`)、支払先（店名）、合計金額
  * **明細行**: 品名、明細金額、適用税率（10%, 8%, 1%, 0%）、軽減税率フラグ
* **高可用性制御**: 混雑時の 503 / 429 エラーに対する指数バックオフ自動リトライ（最大3回）と 60秒タイムアウト制御を実装。

### 3. 高速レビューUI（2ペイン連動型）
* **左ペイン（画像ビューア）**:
  * レシート画像カード一覧。拡大・縮小・回転（90°単位）表示に対応。
  * 画像カードをクリックすると、右ペインの該当レシート行へスムーズに自動スクロール。
* **右ペイン（明細編集グリッド）**:
  * 日付・支払先・メモ・明細品名・金額・税率プリセット・軽減税率を手元で即座に修正可能。
  * **メモ欄**: 「誰それと会食」「2行目のみ経費」などの特記事項をレシート単位で記録。
  * **手修正ステータス**: 手動で変更を加えた明細行には最右列に「修正済」バッジが自動付与。
  * **一括承認**: 確認完了後、「全レシートを一括承認」ボタンでワンクリック処理。

### 4. 下流システム連携（月指定エクスポート）
* **⬇ JSON出力（主機能）**:
  * 会計システムや次期システムへのデータ連携用。
  * 顧客情報、対象年月、合計金額、レシートヘッダ（メモ含む）、および配下の全明細行を親子階層構造で出力。
* **CSV出力（補助機能）**:
  * Excel で文字化けしない UTF-8 BOM 付き CSV 形式での出力にも対応。

---

## 🔒 セキュリティ（Cloudflare Access）

* Cloudflare Zero Trust (Cloudflare Access) の **One-time PIN（ワンタイムメール認証）** により保護されています。
* API を Cloudflare Pages Functions に統合しているため、**画面の閲覧だけでなく、バックエンド API への通信も含めて丸ごと完全保護** されます。

> **Access 設定の注意点**:
> 宛先の「サブドメイン (optional)」欄は必ず **空欄** にしてください（`*` を入れると apex ドメインが保護から外れてしまいます）。

---

## 📁 ディレクトリ構成

```
kicho-daiko/
├── functions/               # Cloudflare Pages Functions
│   └── api/
│       └── [[route]].ts     # API エントリポイント（Hono ハンドラ）
├── src/
│   ├── cron.ts              # Cron 専用 Worker（朝6時のDrive自動巡回バッチ）
│   ├── index.ts             # 共通エントリポイント
│   ├── types/
│   │   └── index.ts         # TypeScript 共有型定義
│   ├── server/
│   │   ├── app.ts           # Hono API ルーティング & 各種エンドポイント
│   │   ├── drive.ts         # Google Drive サービスアカウント JWT 認証 & 同期処理
│   │   ├── ocr.ts           # Gemini 3.8 Flash OCR 解析 & リトライロジック
│   │   └── csv.ts           # BOM付き CSV 生成ヘルパー
│   ├── App.tsx              # フロントエンド メインUI（React 2ペイン画面）
│   └── main.tsx             # React マウント
├── schema.sql               # Cloudflare D1 データベース初期化 SQL
├── wrangler.toml            # Cloudflare Pages 設定ファイル（D1 / R2 バインディング）
├── wrangler.cron.toml       # Cron 専用 Worker 設定ファイル
├── package.json
└── tsconfig.json
```

---

## 🚀 開発 & デプロイ手順

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 環境変数の設定 (`.dev.vars`)
プロジェクトルートに `.dev.vars` を作成し、以下を設定します：

```ini
# Gemini API Key (Google AI Studio: https://aistudio.google.com/apikey)
GEMINI_API_KEY="AIzaSy..."
GEMINI_MODEL="gemini-3.8-flash"

# Google Drive サービスアカウント設定 (JSONキーの該当項目)
GOOGLE_SERVICE_ACCOUNT_EMAIL="drive-receipt-sync@xxx.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 3. データベースの初期化 (Cloudflare D1)
```bash
# ローカル環境の初期化
npm run db:init

# リモート環境の初期化
npx wrangler d1 execute kicho-daiko-db --remote --file=./schema.sql
```

### 4. ローカル開発サーバーの起動
```bash
npm run dev
```

### 5. 本番デプロイ
```bash
# 全体デプロイ（Pages + Cron Worker の両方）
npm run deploy

# Pages (画面 & API) のみデプロイ
npm run deploy:pages

# Cron Worker のみデプロイ
npm run deploy:cron
```

---

## 🗄️ データベース設計 (D1)

* **`clients`**: 顧問先情報（顧客名、Google Drive フォルダID）
* **`receipts`**: レシート基本情報（顧客ID、DriveファイルID、R2画像キー、取引日、支払先、合計金額、メモ、ステータス）
* **`receipt_items`**: レシート明細行（レシートID、行番号、品名、金額、税率、軽減税率フラグ、手修正フラグ）
* **`tax_rates`**: 税率マスタ（10%, 8%, 1%, 0% など柔軟に拡張可能）
