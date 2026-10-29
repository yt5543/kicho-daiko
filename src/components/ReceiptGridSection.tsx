import React from 'react';
import type { EditableItem, EditableReceipt, TaxRateOption } from '../types';
import { OcrStatusBadge } from './OcrStatusBadge';

interface ReceiptGridSectionProps {
  receipts: EditableReceipt[];
  activeReceiptId: number | null;
  submittingIds: Set<number>;
  taxRateOptions: TaxRateOption[];
  gridSectionRefs: React.MutableRefObject<Map<number, HTMLTableSectionElement>>;
  onFocusReceiptImage: (receiptId: number) => void;
  onOpenFocusReview: (receiptId: number) => void;
  onReceiptFieldChange: (
    receiptId: number,
    field: 'receipt_date' | 'payee' | 'amount' | 'memo',
    value: string
  ) => void;
  onItemChange: (
    receiptId: number,
    itemKey: string,
    field: keyof EditableItem,
    value: string | boolean
  ) => void;
  onTaxPresetChange: (receiptId: number, itemKey: string, presetValue: string) => void;
  onAddItem: (receiptId: number) => void;
  onRemoveItem: (receiptId: number, itemKey: string) => void;
  onApproveReceipt: (receipt: EditableReceipt) => void;
}

export const ReceiptGridSection: React.FC<ReceiptGridSectionProps> = ({
  receipts,
  activeReceiptId,
  submittingIds,
  taxRateOptions,
  gridSectionRefs,
  onFocusReceiptImage,
  onOpenFocusReview,
  onReceiptFieldChange,
  onItemChange,
  onTaxPresetChange,
  onAddItem,
  onRemoveItem,
  onApproveReceipt,
}) => {
  return (
    <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600 shrink-0">
        <span className="font-semibold text-slate-800">
          OCR文字起こし確認グリッド（品名・金額・税率・修正済＋レシート別メモ）
        </span>
        <span className="text-[11px] text-slate-500">
          値を手入力で直すと自動で「修正済」になります
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-left">
          {/* スティッキーテーブルヘッダ */}
          <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-300 text-[11px] font-bold text-slate-600 uppercase">
            <tr>
              <th className="py-2.5 px-3 w-12 text-center">行</th>
              <th className="py-2.5 px-3">品名（文字起こし内容）</th>
              <th className="py-2.5 px-3 w-32 text-right">金額 (税込)</th>
              <th className="py-2.5 px-3 w-48">税率区分 / 直接入力</th>
              <th className="py-2.5 px-2 w-10 text-center">削</th>
              <th className="py-2.5 px-3 w-24 text-center bg-amber-100/70 text-amber-900 border-l border-slate-300">
                修正済
              </th>
            </tr>
          </thead>

          {receipts.map((receipt, rIdx) => {
            const itemsTotal = receipt.items.reduce(
              (sum, item) => sum + (Number(item.amount) || 0),
              0
            );
            const receiptTotal = Number(receipt.amount) || 0;
            const isDiff = itemsTotal !== receiptTotal;
            const modifiedCount = receipt.items.filter((item) => item.is_modified).length;
            const isSubmitting = submittingIds.has(receipt.id);
            const isActive = activeReceiptId === receipt.id;

            return (
              <tbody
                key={receipt.id}
                ref={(el) => {
                  if (el) gridSectionRefs.current.set(receipt.id, el);
                  else gridSectionRefs.current.delete(receipt.id);
                }}
                onClick={() => onFocusReceiptImage(receipt.id)}
                className={`border-b-4 border-slate-200 ${
                  isActive ? 'bg-indigo-50/15' : ''
                }`}
              >
                {/* レシート区切りヘッダ行 */}
                <tr className="bg-slate-800 text-slate-100 text-xs">
                  <td colSpan={6} className="px-3 py-2.5 space-y-2">
                    {/* 1段目: レシート番号・日付・支払先・合計・アクション */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-indigo-500 text-white font-mono font-bold text-[11px]">
                          レシート #{rIdx + 1}
                        </span>

                        <input
                          type="date"
                          value={receipt.receipt_date}
                          onChange={(e) =>
                            onReceiptFieldChange(receipt.id, 'receipt_date', e.target.value)
                          }
                          className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-indigo-400"
                        />

                        <input
                          type="text"
                          value={receipt.payee}
                          onChange={(e) =>
                            onReceiptFieldChange(receipt.id, 'payee', e.target.value)
                          }
                          placeholder="支払先"
                          className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-0.5 text-xs w-44 focus:outline-none focus:border-indigo-400"
                        />

                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-slate-400">領収書計:¥</span>
                          <input
                            type="number"
                            step="1"
                            value={receipt.amount}
                            onChange={(e) =>
                              onReceiptFieldChange(receipt.id, 'amount', e.target.value)
                            }
                            className="bg-slate-700 text-white border border-slate-600 rounded px-1.5 py-0.5 text-xs w-20 font-mono text-right focus:outline-none focus:border-indigo-400"
                          />
                        </div>

                        <span className="text-[11px] text-slate-300 font-mono">
                          (明細計: ¥{itemsTotal.toLocaleString()})
                        </span>

                        <OcrStatusBadge
                          ocrStatus={receipt.ocr_status}
                          retryCount={receipt.ocr_retry_count}
                          ocrError={receipt.ocr_error}
                          showCompletedBadge={false}
                        />

                        {receipt.ocr_status === 'completed' && isDiff && (
                          <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[11px]">
                            差額あり
                          </span>
                        )}
                        {modifiedCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 text-[11px] font-medium">
                            ✎ {modifiedCount}件修正済
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFocusReview(receipt.id);
                          }}
                          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-indigo-300 text-[11px] font-bold cursor-pointer flex items-center gap-1"
                          title="サイドバーを隠して大画面で画像とグリッドを並べて確認"
                        >
                          🔍 集中拡大
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddItem(receipt.id);
                          }}
                          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-[11px] font-medium cursor-pointer"
                        >
                          ＋ 行追加
                        </button>

                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={(e) => {
                            e.stopPropagation();
                            onApproveReceipt(receipt);
                          }}
                          className="px-2.5 py-1 rounded text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
                        >
                          {isSubmitting ? '保存中...' : '承認完了'}
                        </button>
                      </div>
                    </div>

                    {/* 2段目: レシートごとのメモ欄 */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-300 shrink-0">📝 メモ:</span>
                      <input
                        type="text"
                        value={receipt.memo}
                        onChange={(e) =>
                          onReceiptFieldChange(receipt.id, 'memo', e.target.value)
                        }
                        placeholder="例: 〇〇様と会食 / 2行目が経費です など自由に記入"
                        className="w-full bg-slate-700/80 text-white placeholder-slate-400 border border-slate-600 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-400 focus:bg-slate-700"
                      />
                    </div>
                  </td>
                </tr>

                {/* 各明細行（グリッド） */}
                {receipt.items.map((item, idx) => {
                  const currentPresetKey = `${Number(item.tax_rate)}:${
                    item.is_reduced_tax ? 1 : 0
                  }`;
                  const isPresetMatched = taxRateOptions.some(
                    (opt) => `${opt.rate}:${opt.is_reduced}` === currentPresetKey
                  );

                  return (
                    <tr
                      key={item.key}
                      className={`border-b border-slate-200 transition-colors ${
                        item.is_modified
                          ? 'bg-amber-50/70 hover:bg-amber-50'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-1.5 px-2 text-center font-mono text-xs text-slate-400">
                        {idx + 1}
                      </td>

                      <td className="py-1.5 px-2">
                        <input
                          type="text"
                          value={item.item_name}
                          onChange={(e) =>
                            onItemChange(receipt.id, item.key, 'item_name', e.target.value)
                          }
                          placeholder="品名を入力"
                          className="w-full rounded border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white bg-transparent px-2 py-1 text-sm text-slate-900 focus:outline-none"
                        />
                      </td>

                      <td className="py-1.5 px-2">
                        <div className="relative flex items-center">
                          <span className="absolute left-2 text-xs text-slate-400 pointer-events-none">
                            ¥
                          </span>
                          <input
                            type="number"
                            step="1"
                            value={item.amount}
                            onChange={(e) =>
                              onItemChange(receipt.id, item.key, 'amount', e.target.value)
                            }
                            className="w-full rounded border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white bg-transparent pl-5 pr-2 py-1 text-right font-mono text-sm text-slate-900 focus:outline-none"
                          />
                        </div>
                      </td>

                      <td className="py-1.5 px-2">
                        <div className="flex items-center gap-1">
                          <select
                            value={isPresetMatched ? currentPresetKey : 'custom'}
                            onChange={(e) => {
                              if (e.target.value !== 'custom') {
                                onTaxPresetChange(receipt.id, item.key, e.target.value);
                              }
                            }}
                            className={`rounded border px-1.5 py-1 text-xs font-medium focus:outline-none ${
                              item.is_reduced_tax
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-white border-slate-200 text-slate-700'
                            }`}
                          >
                            {taxRateOptions.map((opt) => (
                              <option
                                key={opt.id}
                                value={`${opt.rate}:${opt.is_reduced}`}
                              >
                                {opt.name}
                              </option>
                            ))}
                            {!isPresetMatched && <option value="custom">カスタム</option>}
                          </select>

                          <div className="flex items-center">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              title="税率(%)を直接入力"
                              value={item.tax_rate}
                              onChange={(e) =>
                                onItemChange(receipt.id, item.key, 'tax_rate', e.target.value)
                              }
                              className="w-11 rounded border border-slate-200 bg-white px-1 py-1 text-right font-mono text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                            />
                            <span className="text-[11px] text-slate-400 ml-0.5">%</span>
                          </div>
                        </div>
                      </td>

                      <td className="py-1.5 px-1 text-center">
                        <button
                          type="button"
                          disabled={receipt.items.length <= 1}
                          onClick={() => onRemoveItem(receipt.id, item.key)}
                          title="行を削除"
                          className="text-slate-300 hover:text-red-500 disabled:opacity-20 text-xs px-1 cursor-pointer"
                        >
                          ✕
                        </button>
                      </td>

                      <td
                        onClick={() =>
                          onItemChange(
                            receipt.id,
                            item.key,
                            'is_modified',
                            !item.is_modified
                          )
                        }
                        title="クリックで「修正済」状態を切り替え"
                        className="py-1.5 px-2 text-center border-l border-slate-200 cursor-pointer select-none"
                      >
                        <button
                          type="button"
                          className={`inline-flex items-center justify-center w-16 h-7 rounded-md font-bold text-xs transition-all cursor-pointer ${
                            item.is_modified
                              ? 'bg-amber-500 text-white shadow-2xs'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200 border border-slate-200'
                          }`}
                        >
                          {item.is_modified ? '✎ 修正済' : '未修正'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
};
