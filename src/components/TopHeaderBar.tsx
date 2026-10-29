import React, { useRef } from 'react';
import type { Client, ReceiptStats } from '../types';

interface TopHeaderBarProps {
  selectedClient: Client | undefined;
  clientsCount: number;
  receiptsCount: number;
  stats: ReceiptStats;
  exportMonth: string;
  exportingJson: boolean;
  exportingCsv: boolean;
  driveFolderInput: string;
  savingFolder: boolean;
  syncingDrive: boolean;
  runningOcr: boolean;
  uploadingFiles: boolean;
  onChangeExportMonth: (val: string) => void;
  onDownloadExport: (format: 'json' | 'csv') => void;
  onBatchApproveAll: () => void;
  onChangeDriveFolderInput: (val: string) => void;
  onSaveDriveFolder: () => void;
  onSyncDriveNow: () => void;
  onRunOcrBatch: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const TopHeaderBar: React.FC<TopHeaderBarProps> = ({
  selectedClient,
  clientsCount,
  receiptsCount,
  stats,
  exportMonth,
  exportingJson,
  exportingCsv,
  driveFolderInput,
  savingFolder,
  syncingDrive,
  runningOcr,
  uploadingFiles,
  onChangeExportMonth,
  onDownloadExport,
  onBatchApproveAll,
  onChangeDriveFolderInput,
  onSaveDriveFolder,
  onSyncDriveNow,
  onRunOcrBatch,
  onFileUpload,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFileUpload(e);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 px-5 py-2.5 space-y-2 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-base font-bold text-slate-900 truncate">
            {selectedClient
              ? selectedClient.name
              : clientsCount === 0
              ? '顧客が登録されていません'
              : '顧客を選択してください'}
          </h2>
          {selectedClient && (
            <div className="flex items-center gap-2 text-xs shrink-0">
              <span className="px-2.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                未レビュー: <strong>{receiptsCount}</strong> 枚 ({stats.totalItems} 行)
              </span>
              {stats.pendingOcrCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  ⚡ OCR待ち: <strong>{stats.pendingOcrCount}</strong> 枚
                </span>
              )}
              {stats.failedOcrCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full font-bold bg-red-100 text-red-800 border border-red-300">
                  ⚠️ 解析失敗: <strong>{stats.failedOcrCount}</strong> 枚
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full font-medium bg-amber-50 text-amber-800 border border-amber-200">
                手修正済: <strong>{stats.modifiedItems}</strong> 行
              </span>
            </div>
          )}
        </div>

        {selectedClient && (
          <div className="flex items-center gap-2.5 shrink-0">
            {/* 月指定エクスポート（JSON出力メイン・CSV出力併設） */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200">
              <label
                htmlFor="export-month"
                className="text-xs font-medium text-slate-600 pl-2"
              >
                対象月:
              </label>
              <input
                id="export-month"
                type="month"
                value={exportMonth}
                onChange={(e) => onChangeExportMonth(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                disabled={exportingJson || !exportMonth}
                onClick={() => onDownloadExport('json')}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-2xs disabled:opacity-50 transition-colors cursor-pointer"
                title="下流システム連携用の階層JSONを出力"
              >
                <span>{exportingJson ? '出力中...' : '⬇ JSON出力'}</span>
              </button>
              <button
                type="button"
                disabled={exportingCsv || !exportMonth}
                onClick={() => onDownloadExport('csv')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-300 shadow-2xs disabled:opacity-50 transition-colors cursor-pointer"
                title="補助用CSV出力"
              >
                <span>{exportingCsv ? '出力中...' : 'CSV'}</span>
              </button>
            </div>

            {receiptsCount > 0 && (
              <button
                type="button"
                onClick={onBatchApproveAll}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-colors cursor-pointer"
              >
                <span>全レシートを一括承認 ({receiptsCount}枚)</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 上部バー（2段目: Google Drive連携・レシート取り込みボタン） */}
      {selectedClient && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            <span className="text-slate-500 font-medium shrink-0">
              📁 DriveフォルダID / URL:
            </span>
            <input
              type="text"
              value={driveFolderInput}
              onChange={(e) => onChangeDriveFolderInput(e.target.value)}
              placeholder="Google DriveのフォルダURLまたはIDを入力（毎日Cronで自動巡回）"
              className="max-w-md w-full rounded border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              disabled={savingFolder}
              onClick={onSaveDriveFolder}
              className="px-2.5 py-1 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium cursor-pointer shrink-0"
            >
              {savingFolder ? '保存中...' : 'フォルダ保存'}
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Google Driveから今すぐ画像を取り込むボタン */}
            <button
              type="button"
              disabled={syncingDrive}
              onClick={onSyncDriveNow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 disabled:opacity-50 transition-colors cursor-pointer"
              title="Google Driveから新規画像を高速取り込み（OCR解析待ちとして登録）"
            >
              <span>{syncingDrive ? 'Drive取込中...' : '🔄 Driveから画像取込'}</span>
            </button>

            {/* pending_ocr がある場合に表示するOCR解析実行ボタン */}
            <button
              type="button"
              disabled={runningOcr || stats.pendingOcrCount === 0}
              onClick={onRunOcrBatch}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                stats.pendingOcrCount > 0
                  ? 'text-white bg-amber-600 hover:bg-amber-700 shadow-xs'
                  : 'text-slate-400 bg-slate-100 border border-slate-200 cursor-not-allowed opacity-60'
              }`}
              title="OCR解析待ちのレシート画像をGeminiで自動解析して明細を抽出"
            >
              <span>
                {runningOcr
                  ? '⚡ OCR解析中...'
                  : `⚡ OCR解析を実行 (${stats.pendingOcrCount}件)`}
              </span>
            </button>

            {/* ローカルPC/スマホから直接画像をアップロードするボタン */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleUploadChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploadingFiles}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <span>{uploadingFiles ? '取込中...' : '＋ ローカル画像取込'}</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
