import React from 'react';
import type { EditableReceipt } from '../types';
import { OcrStatusBadge } from './OcrStatusBadge';

interface ReceiptImageListProps {
  receipts: EditableReceipt[];
  activeReceiptId: number | null;
  imageCardRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onFocusGridSection: (receiptId: number) => void;
  onOpenFocusReview: (receiptId: number) => void;
}

export const ReceiptImageList: React.FC<ReceiptImageListProps> = ({
  receipts,
  activeReceiptId,
  imageCardRefs,
  onFocusGridSection,
  onOpenFocusReview,
}) => {
  return (
    <div className="lg:col-span-5 bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between text-xs text-slate-300 shrink-0">
        <span className="font-semibold">レシート画像一覧（縦スクロールで連続確認）</span>
        <span className="text-[11px] text-slate-400">全 {receipts.length} 枚</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {receipts.map((receipt, index) => {
          const isActive = activeReceiptId === receipt.id;
          const hasModified = receipt.items.some((item) => item.is_modified);

          return (
            <div
              key={receipt.id}
              ref={(el) => {
                if (el) imageCardRefs.current.set(receipt.id, el);
                else imageCardRefs.current.delete(receipt.id);
              }}
              onClick={() => onFocusGridSection(receipt.id)}
              className={`rounded-xl border-2 transition-all cursor-pointer overflow-hidden ${
                isActive
                  ? 'border-indigo-400 ring-2 ring-indigo-500/40 bg-slate-800'
                  : hasModified
                  ? 'border-amber-500/60 bg-slate-800/60'
                  : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
              }`}
            >
              {/* 画像カードヘッダ */}
              <div className="px-3.5 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 rounded bg-indigo-600 text-white font-mono font-bold text-[11px] shrink-0">
                    #{index + 1} (ID:{receipt.id})
                  </span>
                  <span className="text-slate-200 font-medium truncate">
                    {receipt.payee}
                  </span>
                  <span className="text-slate-400 font-mono shrink-0">
                    {receipt.receipt_date}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <OcrStatusBadge
                    ocrStatus={receipt.ocr_status}
                    retryCount={receipt.ocr_retry_count}
                    ocrError={receipt.ocr_error}
                    hasModified={hasModified}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFocusReview(receipt.id);
                    }}
                    className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer transition-colors flex items-center gap-0.5 shadow-2xs"
                    title="サイドバーを隠して大画面で画像とグリッドを並べて集中確認"
                  >
                    🔍 拡大
                  </button>
                </div>
              </div>

              {/* メモプレビュー */}
              {receipt.memo && (
                <div className="px-3.5 py-1.5 bg-slate-800/90 border-b border-slate-700/80 text-xs text-amber-200 flex items-center gap-1.5">
                  <span>📝</span>
                  <span className="truncate">{receipt.memo}</span>
                </div>
              )}

              {/* レシート画像本体 */}
              <div className="p-3 flex justify-center bg-slate-900/60">
                <img
                  src={receipt.image_url}
                  alt={`Receipt #${receipt.id}`}
                  className="max-h-[420px] w-auto object-contain rounded shadow"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

