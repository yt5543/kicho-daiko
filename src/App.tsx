import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Client,
  Receipt,
  ReceiptItem,
  TaxRateOption,
} from './types';

export type { Client, Receipt, ReceiptItem, TaxRateOption };

interface EditableItem {
  key: string;
  item_name: string;
  amount: string;
  tax_rate: string;
  is_reduced_tax: boolean;
  is_modified: boolean; // 手で修正したかどうかのフラグ
}

interface EditableReceipt {
  id: number;
  client_id: number;
  image_url: string;
  receipt_date: string;
  amount: string;
  payee: string;
  memo: string;
  items: EditableItem[];
}

const DEFAULT_TAX_RATES: TaxRateOption[] = [
  { id: 1, rate: 10, name: '10% (標準)', is_reduced: 0, is_active: 1, sort_order: 10 },
  { id: 2, rate: 8, name: '8% (軽減※)', is_reduced: 1, is_active: 1, sort_order: 20 },
  { id: 3, rate: 1, name: '1% (軽減※)', is_reduced: 1, is_active: 1, sort_order: 30 },
  { id: 4, rate: 0, name: '0% (非課税)', is_reduced: 0, is_active: 1, sort_order: 40 },
];

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? '';

function createRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapReceiptToEditable(r: Receipt): EditableReceipt {
  return {
    id: r.id,
    client_id: r.client_id,
    image_url: r.image_url,
    receipt_date: r.receipt_date ?? '',
    amount: String(r.amount ?? 0),
    payee: r.payee ?? '',
    memo: r.memo ?? '',
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

export default function App() {
  const [clients, setClients] = useState<Client[]>([]);
  const [taxRateOptions, setTaxRateOptions] = useState<TaxRateOption[]>(DEFAULT_TAX_RATES);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [receipts, setReceipts] = useState<EditableReceipt[]>([]);
  const [activeReceiptId, setActiveReceiptId] = useState<number | null>(null);

  // Google Drive フォルダ設定＆同期用
  const [driveFolderInput, setDriveFolderInput] = useState<string>('');
  const [savingFolder, setSavingFolder] = useState<boolean>(false);
  const [syncingDrive, setSyncingDrive] = useState<boolean>(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // 月指定CSVエクスポート用（初期値: 2026-10）
  const [exportMonth, setExportMonth] = useState<string>('2026-10');
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  // ローカル画像アップロード用
  const [uploadingFiles, setUploadingFiles] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loadingClients, setLoadingClients] = useState<boolean>(true);
  const [loadingReceipts, setLoadingReceipts] = useState<boolean>(false);
  const [submittingIds, setSubmittingIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // スクロール連動用のRef
  const imageCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const gridSectionRefs = useRef<Map<number, HTMLTableSectionElement>>(new Map());

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  // 1. 初回マウント時に顧客一覧と税率マスタを取得
  useEffect(() => {
    const fetchInitialData = async () => {
      setLoadingClients(true);
      setError(null);
      try {
        const [clientsRes, taxRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/clients`),
          fetch(`${API_BASE_URL}/api/tax-rates`).catch(() => null),
        ]);

        if (!clientsRes.ok) {
          throw new Error('顧客一覧の取得に失敗しました');
        }
        const clientsData: { clients: Client[] } = await clientsRes.json();
        setClients(clientsData.clients ?? []);
        if (clientsData.clients?.length > 0) {
          setSelectedClientId(clientsData.clients[0].id);
          setDriveFolderInput(clientsData.clients[0].drive_folder_id ?? '');
        }

        if (taxRes && taxRes.ok) {
          const taxData: { tax_rates: TaxRateOption[] } = await taxRes.json();
          if (taxData.tax_rates?.length > 0) {
            setTaxRateOptions(taxData.tax_rates);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '予期せぬエラーが発生しました');
      } finally {
        setLoadingClients(false);
      }
    };

    fetchInitialData();
  }, []);

  // 2. 選択された顧客が変更されたら未レビューレシート一覧を取得
  useEffect(() => {
    if (selectedClientId === null) {
      setReceipts([]);
      return;
    }

    const client = clients.find((c) => c.id === selectedClientId);
    if (client) {
      setDriveFolderInput(client.drive_folder_id ?? '');
    }

    const fetchReceipts = async () => {
      setLoadingReceipts(true);
      setError(null);
      setInfoMessage(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/clients/${selectedClientId}/receipts?status=unreviewed`
        );
        if (!res.ok) {
          throw new Error('未レビューレシートの取得に失敗しました');
        }
        const data: { receipts: Receipt[] } = await res.json();
        const mapped = (data.receipts ?? []).map(mapReceiptToEditable);

        setReceipts(mapped);
        setActiveReceiptId(mapped[0]?.id ?? null);

        if (mapped[0]?.receipt_date && /^\d{4}-\d{2}/.test(mapped[0].receipt_date)) {
          setExportMonth(mapped[0].receipt_date.slice(0, 7));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '予期せぬエラーが発生しました');
      } finally {
        setLoadingReceipts(false);
      }
    };

    fetchReceipts();
  }, [selectedClientId]);

  // グリッド側でレシートを選択した際、左カラムのレシート画像をスクロール表示
  const focusReceiptImage = (receiptId: number) => {
    setActiveReceiptId(receiptId);
    const el = imageCardRefs.current.get(receiptId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // 左カラムの画像をクリックした際、右カラムのグリッド該当箇所へスクロール
  const focusGridSection = (receiptId: number) => {
    setActiveReceiptId(receiptId);
    const el = gridSectionRefs.current.get(receiptId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // 顧客のGoogle DriveフォルダID（またはURL）を保存
  const handleSaveDriveFolder = async () => {
    if (!selectedClientId) return;
    setSavingFolder(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/clients/${selectedClientId}/drive-folder`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ drive_folder_id: driveFolderInput }),
        }
      );
      const data = (await res.json()) as { error?: string; drive_folder_id: string };
      if (!res.ok) {
        throw new Error(data.error || 'DriveフォルダIDの保存に失敗しました');
      }

      setDriveFolderInput(data.drive_folder_id);
      setClients((prev) =>
        prev.map((c) =>
          c.id === selectedClientId
            ? { ...c, drive_folder_id: data.drive_folder_id }
            : c
        )
      );
      setInfoMessage('Google DriveフォルダIDを保存しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存中にエラーが発生しました');
    } finally {
      setSavingFolder(false);
    }
  };

  // Google Driveから新規レシートを今すぐ取り込むボタン処理
  const handleSyncDriveNow = async () => {
    if (!selectedClientId || syncingDrive) return;
    setSyncingDrive(true);
    setError(null);
    setInfoMessage(null);

    try {
      // フォルダIDが入力変更されていれば先に保存
      if (selectedClient && driveFolderInput !== selectedClient.drive_folder_id) {
        await fetch(`${API_BASE_URL}/api/clients/${selectedClientId}/drive-folder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ drive_folder_id: driveFolderInput }),
        });
      }

      const res = await fetch(
        `${API_BASE_URL}/api/clients/${selectedClientId}/sync-drive`,
        { method: 'POST' }
      );
      const data = (await res.json()) as {
        error?: string;
        message: string;
        receipts?: Receipt[];
      };
      if (!res.ok) {
        throw new Error(data.error || 'Google Driveからの取り込みに失敗しました');
      }

      const newlyIngested: EditableReceipt[] = (data.receipts ?? []).map(
        mapReceiptToEditable
      );

      if (newlyIngested.length > 0) {
        setReceipts((prev) => [...prev, ...newlyIngested]);
        const lastId = newlyIngested[newlyIngested.length - 1].id;
        setTimeout(() => {
          focusReceiptImage(lastId);
          focusGridSection(lastId);
        }, 100);
      }

      setInfoMessage(data.message);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Google Drive同期中にエラーが発生しました'
      );
    } finally {
      setSyncingDrive(false);
    }
  };

  // ローカル画像ファイルの取り込み（R2保存 → Gemini OCR → D1保存）
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedClientId) return;

    setUploadingFiles(true);
    setError(null);
    setInfoMessage(null);

    try {
      const newlyIngested: EditableReceipt[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(
          `${API_BASE_URL}/api/clients/${selectedClientId}/receipts/ingest`,
          {
            method: 'POST',
            body: formData,
          }
        );

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `${file.name} の取り込みに失敗しました`);
        }

        const data: { receipt: Receipt } = await res.json();
        newlyIngested.push(mapReceiptToEditable(data.receipt));
      }

      if (newlyIngested.length > 0) {
        setReceipts((prev) => [...prev, ...newlyIngested]);
        const lastId = newlyIngested[newlyIngested.length - 1].id;
        setTimeout(() => {
          focusReceiptImage(lastId);
          focusGridSection(lastId);
        }, 100);
        setInfoMessage(`${newlyIngested.length} 枚のレシート画像を取り込みました`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像取り込み中にエラーが発生しました');
    } finally {
      setUploadingFiles(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // レシートヘッダ＆メモ編集
  const handleReceiptFieldChange = (
    receiptId: number,
    field: 'receipt_date' | 'payee' | 'amount' | 'memo',
    value: string
  ) => {
    setReceipts((prev) =>
      prev.map((r) => (r.id === receiptId ? { ...r, [field]: value } : r))
    );
  };

  // 明細セルの編集
  const handleItemChange = (
    receiptId: number,
    itemKey: string,
    field: keyof EditableItem,
    value: string | boolean
  ) => {
    setReceipts((prev) =>
      prev.map((r) => {
        if (r.id !== receiptId) return r;
        return {
          ...r,
          items: r.items.map((item) => {
            if (item.key !== itemKey) return item;
            if (field === 'is_modified') {
              return { ...item, is_modified: Boolean(value) };
            }
            return {
              ...item,
              [field]: value,
              is_modified: true,
            };
          }),
        };
      })
    );
  };

  // 税率プルダウン変更
  const handleTaxPresetChange = (
    receiptId: number,
    itemKey: string,
    presetValue: string
  ) => {
    const [rateStr, reducedStr] = presetValue.split(':');
    setReceipts((prev) =>
      prev.map((r) => {
        if (r.id !== receiptId) return r;
        return {
          ...r,
          items: r.items.map((item) =>
            item.key === itemKey
              ? {
                  ...item,
                  tax_rate: rateStr,
                  is_reduced_tax: reducedStr === '1',
                  is_modified: true,
                }
              : item
          ),
        };
      })
    );
  };

  // 明細行の追加
  const handleAddItem = (receiptId: number) => {
    setReceipts((prev) =>
      prev.map((r) => {
        if (r.id !== receiptId) return r;
        return {
          ...r,
          items: [
            ...r.items,
            {
              key: createRowKey(),
              item_name: '',
              amount: '0',
              tax_rate: '10',
              is_reduced_tax: false,
              is_modified: true,
            },
          ],
        };
      })
    );
  };

  // 明細行の削除
  const handleRemoveItem = (receiptId: number, itemKey: string) => {
    setReceipts((prev) =>
      prev.map((r) => {
        if (r.id !== receiptId || r.items.length <= 1) return r;
        return {
          ...r,
          items: r.items.filter((item) => item.key !== itemKey),
        };
      })
    );
  };

  // レシート保存処理
  const saveReceiptToApi = async (
    receipt: EditableReceipt,
    status: 'approved' | 'unreviewed' = 'approved'
  ) => {
    const itemsTotal = receipt.items.reduce(
      (sum, i) => sum + (Number(i.amount) || 0),
      0
    );
    const headerAmount = Number(receipt.amount) || itemsTotal;

    const res = await fetch(`${API_BASE_URL}/api/receipts/${receipt.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipt_date: receipt.receipt_date,
        amount: Math.trunc(headerAmount),
        payee: receipt.payee,
        memo: receipt.memo,
        status,
        items: receipt.items.map((item) => ({
          item_name: item.item_name || '（品名なし）',
          amount: Math.trunc(Number(item.amount) || 0),
          tax_rate: Number(item.tax_rate) || 0,
          is_reduced_tax: item.is_reduced_tax ? 1 : 0,
          is_modified: item.is_modified ? 1 : 0,
        })),
      }),
    });

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `レシート #${receipt.id} の保存に失敗しました`);
    }
  };

  // 単一レシートの承認保存処理
  const approveReceipt = async (receipt: EditableReceipt) => {
    setSubmittingIds((prev) => new Set(prev).add(receipt.id));
    setError(null);
    try {
      await saveReceiptToApi(receipt, 'approved');
      setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新中にエラーが発生しました');
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(receipt.id);
        return next;
      });
    }
  };

  // 表示中の全レシートを一括承認
  const handleBatchApproveAllReceipts = async () => {
    for (const r of receipts) {
      await approveReceipt(r);
    }
  };

  // 月指定CSVダウンロード処理
  const handleDownloadCsv = async () => {
    if (!selectedClientId || !exportMonth) return;
    setExportingCsv(true);
    setError(null);

    try {
      for (const r of receipts) {
        await saveReceiptToApi(r, 'unreviewed');
      }

      const res = await fetch(
        `${API_BASE_URL}/api/clients/${selectedClientId}/receipts/csv?month=${encodeURIComponent(
          exportMonth
        )}`
      );
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || 'CSVのダウンロードに失敗しました');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipts_${selectedClient?.name ?? selectedClientId}_${exportMonth}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV出力中にエラーが発生しました');
    } finally {
      setExportingCsv(false);
    }
  };

  // 集計ステータス
  const stats = useMemo(() => {
    let totalItems = 0;
    let modifiedItems = 0;

    for (const r of receipts) {
      totalItems += r.items.length;
      const modCount = r.items.filter((i) => i.is_modified).length;
      modifiedItems += modCount;
    }

    return { totalItems, modifiedItems };
  }, [receipts]);

  return (
    <div className="flex h-screen bg-slate-100 text-slate-800">
      {/* 左サイドバー: 顧客リスト */}
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col border-r border-slate-800 shrink-0">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-base font-bold tracking-tight">レシートOCR レビュー</h1>
          <p className="text-[11px] text-slate-400 mt-0.5">Drive自動取込＆グリッド確認</p>
        </div>

        <div className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          顧客一覧 ({clients.length})
        </div>

        <nav className="flex-1 overflow-y-auto px-2 space-y-1">
          {loadingClients ? (
            <div className="px-3 py-4 text-xs text-slate-400">読み込み中...</div>
          ) : (
            clients.map((client) => {
              const isSelected = client.id === selectedClientId;
              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelectedClientId(client.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span className="truncate">{client.name}</span>
                  <span className="text-[10px] opacity-70">#{client.id}</span>
                </button>
              );
            })
          )}
        </nav>
      </aside>

      {/* メインエリア */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 上部バー（1段目: 顧客ステータス・CSV出力・一括承認） */}
        <header className="bg-white border-b border-slate-200 px-5 py-2.5 space-y-2 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-base font-bold text-slate-900 truncate">
                {selectedClient ? selectedClient.name : '顧客を選択してください'}
              </h2>
              {selectedClient && (
                <div className="flex items-center gap-2 text-xs shrink-0">
                  <span className="px-2.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                    未レビュー: <strong>{receipts.length}</strong> 枚 ({stats.totalItems} 行)
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full font-medium bg-amber-50 text-amber-800 border border-amber-200">
                    手修正済: <strong>{stats.modifiedItems}</strong> 行
                  </span>
                </div>
              )}
            </div>

            {selectedClient && (
              <div className="flex items-center gap-2.5 shrink-0">
                {/* 月指定CSVエクスポート */}
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
                    onChange={(e) => setExportMonth(e.target.value)}
                    className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    disabled={exportingCsv || !exportMonth}
                    onClick={handleDownloadCsv}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 shadow-2xs disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <span>{exportingCsv ? '出力中...' : '⬇ CSV出力'}</span>
                  </button>
                </div>

                {receipts.length > 0 && (
                  <button
                    type="button"
                    onClick={handleBatchApproveAllReceipts}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-colors cursor-pointer"
                  >
                    <span>全レシートを一括承認 ({receipts.length}枚)</span>
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
                  onChange={(e) => setDriveFolderInput(e.target.value)}
                  placeholder="Google DriveのフォルダURLまたはIDを入力（毎日Cronで自動巡回）"
                  className="max-w-md w-full rounded border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  disabled={savingFolder}
                  onClick={handleSaveDriveFolder}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium cursor-pointer shrink-0"
                >
                  {savingFolder ? '保存中...' : 'フォルダ保存'}
                </button>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Google Driveから今すぐ取り込むボタン */}
                <button
                  type="button"
                  disabled={syncingDrive}
                  onClick={handleSyncDriveNow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <span>
                    {syncingDrive ? 'Drive同期・OCR解析中...' : '🔄 Driveからレシート取込'}
                  </span>
                </button>

                {/* ローカルPC/スマホから直接画像をアップロードするボタン */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileUpload}
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

        {/* 完了メッセージ通知 */}
        {infoMessage && (
          <div className="mx-5 mt-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
            <span>{infoMessage}</span>
            <button
              type="button"
              onClick={() => setInfoMessage(null)}
              className="font-medium underline hover:text-emerald-950"
            >
              閉じる
            </button>
          </div>
        )}

        {/* エラー通知 */}
        {error && (
          <div className="mx-5 mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-medium underline hover:text-red-900"
            >
              閉じる
            </button>
          </div>
        )}

        {/* メイン2カラム（左: レシート画像連続スクロール / 右: 明細グリッド一覧） */}
        <div className="flex-1 overflow-hidden p-4">
          {!selectedClientId ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              左のサイドバーから顧客を選択してください。
            </div>
          ) : loadingReceipts ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">
              レシートと文字起こし明細を読み込み中...
            </div>
          ) : receipts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-xl border border-slate-200 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xl font-bold mb-3">
                ✓
              </div>
              <h3 className="text-base font-semibold text-slate-800">
                未レビューのレシートはありません
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                上部の「🔄 Driveからレシート取込」や「＋ ローカル画像取込」から取り込むか、「⬇ CSV出力」から月別データを出力できます。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
              {/* 左カラム (5/12): レシート画像の縦スクロール一覧 */}
              <div className="lg:col-span-5 bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between text-xs text-slate-300 shrink-0">
                  <span className="font-semibold">
                    レシート画像一覧（縦スクロールで連続確認）
                  </span>
                  <span className="text-[11px] text-slate-400">
                    全 {receipts.length} 枚
                  </span>
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
                        onClick={() => focusGridSection(receipt.id)}
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
                            {hasModified && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[11px] font-semibold">
                                ✎ 修正あり
                              </span>
                            )}
                            <a
                              href={receipt.image_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] text-indigo-400 hover:underline"
                            >
                              拡大
                            </a>
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

              {/* 右カラム (7/12): 品名・金額・税率・修正済ボタンのグリッド */}
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
                      const modifiedCount = receipt.items.filter(
                        (item) => item.is_modified
                      ).length;
                      const isSubmitting = submittingIds.has(receipt.id);
                      const isActive = activeReceiptId === receipt.id;

                      return (
                        <tbody
                          key={receipt.id}
                          ref={(el) => {
                            if (el) gridSectionRefs.current.set(receipt.id, el);
                            else gridSectionRefs.current.delete(receipt.id);
                          }}
                          onClick={() => focusReceiptImage(receipt.id)}
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
                                      handleReceiptFieldChange(
                                        receipt.id,
                                        'receipt_date',
                                        e.target.value
                                      )
                                    }
                                    className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-indigo-400"
                                  />

                                  <input
                                    type="text"
                                    value={receipt.payee}
                                    onChange={(e) =>
                                      handleReceiptFieldChange(
                                        receipt.id,
                                        'payee',
                                        e.target.value
                                      )
                                    }
                                    placeholder="支払先"
                                    className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-0.5 text-xs w-44 focus:outline-none focus:border-indigo-400"
                                  />

                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-slate-400">
                                      領収書計:¥
                                    </span>
                                    <input
                                      type="number"
                                      step="1"
                                      value={receipt.amount}
                                      onChange={(e) =>
                                        handleReceiptFieldChange(
                                          receipt.id,
                                          'amount',
                                          e.target.value
                                        )
                                      }
                                      className="bg-slate-700 text-white border border-slate-600 rounded px-1.5 py-0.5 text-xs w-20 font-mono text-right focus:outline-none focus:border-indigo-400"
                                    />
                                  </div>

                                  <span className="text-[11px] text-slate-300 font-mono">
                                    (明細計: ¥{itemsTotal.toLocaleString()})
                                  </span>
                                  {isDiff && (
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
                                      handleAddItem(receipt.id);
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
                                      approveReceipt(receipt);
                                    }}
                                    className="px-2.5 py-1 rounded text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
                                  >
                                    {isSubmitting ? '保存中...' : '承認完了'}
                                  </button>
                                </div>
                              </div>

                              {/* 2段目: レシートごとのメモ欄 */}
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-300 shrink-0">
                                  📝 メモ:
                                </span>
                                <input
                                  type="text"
                                  value={receipt.memo}
                                  onChange={(e) =>
                                    handleReceiptFieldChange(
                                      receipt.id,
                                      'memo',
                                      e.target.value
                                    )
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
                                      handleItemChange(
                                        receipt.id,
                                        item.key,
                                        'item_name',
                                        e.target.value
                                      )
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
                                        handleItemChange(
                                          receipt.id,
                                          item.key,
                                          'amount',
                                          e.target.value
                                        )
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
                                          handleTaxPresetChange(
                                            receipt.id,
                                            item.key,
                                            e.target.value
                                          );
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
                                      {!isPresetMatched && (
                                        <option value="custom">カスタム</option>
                                      )}
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
                                          handleItemChange(
                                            receipt.id,
                                            item.key,
                                            'tax_rate',
                                            e.target.value
                                          )
                                        }
                                        className="w-11 rounded border border-slate-200 bg-white px-1 py-1 text-right font-mono text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                                      />
                                      <span className="text-[11px] text-slate-400 ml-0.5">
                                        %
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                <td className="py-1.5 px-1 text-center">
                                  <button
                                    type="button"
                                    disabled={receipt.items.length <= 1}
                                    onClick={() => handleRemoveItem(receipt.id, item.key)}
                                    title="行を削除"
                                    className="text-slate-300 hover:text-red-500 disabled:opacity-20 text-xs px-1 cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </td>

                                <td
                                  onClick={() =>
                                    handleItemChange(
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
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
