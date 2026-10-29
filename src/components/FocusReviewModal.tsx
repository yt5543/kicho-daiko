import React, { useEffect, useRef, useState } from 'react';
import type { EditableItem, EditableReceipt, TaxRateOption } from '../types';

interface FocusReviewModalProps {
  receipt: EditableReceipt;
  receipts: EditableReceipt[];
  taxRateOptions: TaxRateOption[];
  onSelectReceiptId: (receiptId: number | null) => void;
  onApproveReceipt: (receipt: EditableReceipt) => Promise<void>;
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
}

export const FocusReviewModal: React.FC<FocusReviewModalProps> = ({
  receipt,
  receipts,
  taxRateOptions,
  onSelectReceiptId,
  onApproveReceipt,
  onReceiptFieldChange,
  onItemChange,
  onTaxPresetChange,
  onAddItem,
  onRemoveItem,
}) => {
  const [focusZoom, setFocusZoom] = useState<number>(1.0);
  const [focusRotation, setFocusRotation] = useState<number>(0);
  const [focusPan, setFocusPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDraggingImage, setIsDraggingImage] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });

  const resetFocusView = () => {
    setFocusZoom(1.0);
    setFocusRotation(0);
    setFocusPan({ x: 0, y: 0 });
  };

  // レシート切り替え時にズームと位置を初期状態にリセット
  useEffect(() => {
    resetFocusView();
  }, [receipt.id]);

  // Escキー押下時に閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSelectReceiptId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectReceiptId]);

  const currentIdx = receipts.findIndex((r) => r.id === receipt.id);
  const itemsTotal = receipt.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const isDiff = Number(receipt.amount) !== itemsTotal;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col animate-in fade-in duration-150 text-slate-100">
      {/* 上部コントロールバー */}
      <header className="h-12 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between shrink-0 select-none">
        {/* 左側: レシート番号・支払先・日付・前後切り替え */}
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded bg-indigo-600 text-white font-mono font-bold text-xs">
            #{currentIdx + 1} / {receipts.length}
          </span>
          <span className="text-sm font-bold text-slate-100 truncate max-w-xs">
            {receipt.payee || '（支払先未定）'}
          </span>
          <span className="text-xs text-slate-400 font-mono">{receipt.receipt_date}</span>

          {/* 前後レシート切り替え */}
          <div className="flex items-center gap-1 ml-2 border-l border-slate-700 pl-3">
            <button
              type="button"
              disabled={currentIdx <= 0}
              onClick={() => {
                if (currentIdx > 0) {
                  onSelectReceiptId(receipts[currentIdx - 1].id);
                }
              }}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold cursor-pointer transition-colors"
              title="前のレシートへ"
            >
              ◀ 前へ
            </button>
            <button
              type="button"
              disabled={currentIdx >= receipts.length - 1}
              onClick={() => {
                if (currentIdx < receipts.length - 1) {
                  onSelectReceiptId(receipts[currentIdx + 1].id);
                }
              }}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold cursor-pointer transition-colors"
              title="次のレシートへ"
            >
              次へ ▶
            </button>
          </div>
        </div>

        {/* 中央: ズーム & 表示切替ツール */}
        <div className="flex items-center gap-1.5 bg-slate-800/90 px-3 py-1 rounded-lg border border-slate-700 text-xs">
          <button
            type="button"
            onClick={resetFocusView}
            className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
              focusZoom === 1.0 && focusPan.x === 0 && focusPan.y === 0
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
            }`}
            title="初期位置・全体表示にリセットします"
          >
            ↕ 全体表示リセット
          </button>
          <button
            type="button"
            onClick={() => {
              setFocusZoom(1.8);
              setFocusPan({ x: 0, y: 120 });
            }}
            className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
              focusZoom >= 1.7 && focusZoom <= 1.9
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
            }`}
            title="文字を大きく拡大してレシート上部を表示します"
          >
            🔍 文字大 (180%)
          </button>

          <div className="h-4 w-px bg-slate-600 mx-1" />

          <button
            type="button"
            onClick={() => setFocusZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(1))))}
            className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center font-bold text-slate-200 cursor-pointer"
            title="縮小"
          >
            ー
          </button>
          <span className="w-12 text-center font-mono text-[11px] text-indigo-300 font-bold">
            {Math.round(focusZoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setFocusZoom((z) => Math.min(4.0, Number((z + 0.2).toFixed(1))))}
            className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center font-bold text-slate-200 cursor-pointer"
            title="拡大"
          >
            ＋
          </button>

          <div className="h-4 w-px bg-slate-600 mx-1" />

          <button
            type="button"
            onClick={() => setFocusRotation((r) => (r + 90) % 360)}
            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 cursor-pointer ml-1 flex items-center gap-1"
            title="時計回りに90°回転"
          >
            ⟳ 回転
          </button>
        </div>

        {/* 右側: 承認ボタン & 閉じる */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              await onApproveReceipt(receipt);
              if (receipts.length > 1) {
                const nextReceipt =
                  currentIdx < receipts.length - 1
                    ? receipts[currentIdx + 1]
                    : receipts[currentIdx - 1];
                onSelectReceiptId(nextReceipt.id);
              } else {
                onSelectReceiptId(null);
              }
            }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm transition-colors cursor-pointer"
          >
            ✓ このレシートを承認して次へ
          </button>

          <button
            type="button"
            onClick={() => onSelectReceiptId(null)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
            title="Escキーでも閉じられます"
          >
            ✕ 閉じる (Esc)
          </button>
        </div>
      </header>

      {/* メイン 2分割エリア */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左半分 (58%): 特大レシート画像ビューア（ホイール拡大縮小 ＆ ドラッグ移動） */}
        <div
          className={`w-[58%] h-full bg-slate-950 border-r border-slate-800 flex items-center justify-center p-6 overflow-hidden select-none relative ${
            isDraggingImage ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.18 : -0.18;
            setFocusZoom((z) => Math.min(4.0, Math.max(0.4, Number((z + delta).toFixed(2)))));
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            setIsDraggingImage(true);
            dragStartRef.current = {
              x: e.clientX,
              y: e.clientY,
              panX: focusPan.x,
              panY: focusPan.y,
            };
          }}
          onMouseMove={(e) => {
            if (!isDraggingImage) return;
            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;
            setFocusPan({
              x: dragStartRef.current.panX + dx,
              y: dragStartRef.current.panY + dy,
            });
          }}
          onMouseUp={() => setIsDraggingImage(false)}
          onMouseLeave={() => setIsDraggingImage(false)}
          onDoubleClick={() => {
            if (focusZoom === 1.0 && focusPan.x === 0 && focusPan.y === 0) {
              setFocusZoom(1.8);
              setFocusPan({ x: 0, y: 120 });
            } else {
              resetFocusView();
            }
          }}
        >
          <div
            className={`flex items-center justify-center ${
              isDraggingImage ? '' : 'transition-transform duration-100 ease-out'
            }`}
            style={{
              transform: `translate(${focusPan.x}px, ${focusPan.y}px) scale(${focusZoom}) rotate(${focusRotation}deg)`,
            }}
          >
            <img
              src={receipt.image_url}
              alt={`Receipt #${receipt.id}`}
              draggable={false}
              className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-2xl pointer-events-none select-none"
            />
          </div>

          {/* ヒント案内 */}
          <div className="absolute bottom-3 left-4 text-[11px] text-slate-300 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-md backdrop-blur shadow-lg pointer-events-none flex items-center gap-2.5">
            <span>
              🖱️ <b>ホイール</b>: 拡大・縮小
            </span>
            <span className="text-slate-600">|</span>
            <span>
              ✋ <b>ドラッグ</b>: 掴んで移動
            </span>
            <span className="text-slate-600">|</span>
            <span>
              ⚡ <b>ダブルクリック</b>: 拡大 / リセット
            </span>
          </div>
        </div>

        {/* 右半分 (42%): 明細グリッド編集テーブル */}
        <div className="w-[42%] h-full bg-slate-900 flex flex-col overflow-hidden text-slate-100">
          {/* ヘッダ編集部 */}
          <div className="p-4 bg-slate-800 border-b border-slate-700 space-y-3 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">日付:</span>
                <input
                  type="date"
                  value={receipt.receipt_date}
                  onChange={(e) =>
                    onReceiptFieldChange(receipt.id, 'receipt_date', e.target.value)
                  }
                  className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-indigo-400"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">領収書合計:</span>
                <span className="text-xs text-slate-400">¥</span>
                <input
                  type="number"
                  value={receipt.amount}
                  onChange={(e) =>
                    onReceiptFieldChange(receipt.id, 'amount', e.target.value)
                  }
                  className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 text-xs w-28 font-mono text-right font-bold focus:outline-none focus:border-indigo-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-slate-400 shrink-0">支払先:</span>
                <input
                  type="text"
                  value={receipt.payee}
                  onChange={(e) =>
                    onReceiptFieldChange(receipt.id, 'payee', e.target.value)
                  }
                  placeholder="店舗・企業名"
                  className="w-full bg-slate-700 text-white border border-slate-600 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-400"
                />
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] text-slate-300 font-mono">
                  (明細計: ¥{itemsTotal.toLocaleString()})
                </span>
                {isDiff && (
                  <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-xs font-bold border border-red-500/40">
                    差額あり
                  </span>
                )}
              </div>
            </div>

            {/* メモ入力 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 shrink-0">📝 メモ:</span>
              <input
                type="text"
                value={receipt.memo}
                onChange={(e) =>
                  onReceiptFieldChange(receipt.id, 'memo', e.target.value)
                }
                placeholder="例: 会食相手、2行目のみ経費など特記事項"
                className="w-full bg-slate-700/80 text-white border border-slate-600 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          {/* 明細テーブル */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 text-[11px] font-bold text-slate-400 uppercase">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">行</th>
                  <th className="py-2.5 px-3">品名（内容）</th>
                  <th className="py-2.5 px-3 w-28 text-right">金額 (税込)</th>
                  <th className="py-2.5 px-3 w-40">税率区分</th>
                  <th className="py-2.5 px-2 w-8 text-center">削</th>
                  <th className="py-2.5 px-3 w-20 text-center bg-slate-800/90 text-amber-300 border-l border-slate-700">
                    修正済
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
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
                      className="hover:bg-slate-800/60 transition-colors"
                    >
                      <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={item.item_name}
                          onChange={(e) =>
                            onItemChange(receipt.id, item.key, 'item_name', e.target.value)
                          }
                          className="w-full bg-slate-800 text-white border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-400 focus:bg-slate-700"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          value={item.amount}
                          onChange={(e) =>
                            onItemChange(receipt.id, item.key, 'amount', e.target.value)
                          }
                          className="w-full bg-slate-800 text-white border border-slate-700 rounded px-2 py-1 text-xs text-right font-mono font-bold focus:outline-none focus:border-indigo-400 focus:bg-slate-700"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={isPresetMatched ? currentPresetKey : 'custom'}
                            onChange={(e) =>
                              onTaxPresetChange(receipt.id, item.key, e.target.value)
                            }
                            className="bg-slate-800 text-white border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-400"
                          >
                            {taxRateOptions.map((opt) => (
                              <option
                                key={opt.id}
                                value={`${opt.rate}:${opt.is_reduced}`}
                              >
                                {opt.name}
                              </option>
                            ))}
                            {!isPresetMatched && (
                              <option value="custom">直接入力(任意%)</option>
                            )}
                          </select>
                          {item.is_reduced_tax && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold shrink-0">
                              軽減
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center">
                        {receipt.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onRemoveItem(receipt.id, item.key)}
                            className="text-slate-500 hover:text-red-400 text-xs p-1"
                            title="行を削除"
                          >
                            ✕
                          </button>
                        )}
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
                        className="py-2 px-3 text-center border-l border-slate-800 cursor-pointer select-none"
                      >
                        <button
                          type="button"
                          className={`inline-flex items-center justify-center w-16 h-6 rounded font-bold text-[11px] transition-all cursor-pointer ${
                            item.is_modified
                              ? 'bg-amber-500 text-white shadow-xs'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-700'
                          }`}
                        >
                          {item.is_modified ? '✎ 修正済' : '未修正'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* フッター: 行追加ボタン */}
          <div className="p-3 bg-slate-800/80 border-t border-slate-700 flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={() => onAddItem(receipt.id)}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
            >
              ＋ 明細行を追加
            </button>

            <span className="text-xs text-slate-400">
              全 {receipt.items.length} 行 / 手修正済:{' '}
              {receipt.items.filter((i) => i.is_modified).length} 行
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

