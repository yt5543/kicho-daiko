import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClientSidebar } from './components/ClientSidebar';
import { FocusReviewModal } from './components/FocusReviewModal';
import { ReceiptGridSection } from './components/ReceiptGridSection';
import { ReceiptImageList } from './components/ReceiptImageList';
import { TopHeaderBar } from './components/TopHeaderBar';
import {
  DEFAULT_TAX_RATES,
  createRowKey,
  mapReceiptToEditable,
  type Client,
  type EditableItem,
  type EditableReceipt,
  type OcrStatus,
  type Receipt,
  type ReceiptItem,
  type ReceiptStats,
  type TaxRateOption,
} from './types';

export type { Client, OcrStatus, Receipt, ReceiptItem, TaxRateOption };

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? '';

export default function App() {
  const [clients, setClients] = useState<Client[]>([]);
  const [taxRateOptions, setTaxRateOptions] = useState<TaxRateOption[]>(DEFAULT_TAX_RATES);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [receipts, setReceipts] = useState<EditableReceipt[]>([]);
  const [activeReceiptId, setActiveReceiptId] = useState<number | null>(null);

  // 顧客の新規作成・編集モーダル用
  const [showClientModal, setShowClientModal] = useState<boolean>(false);
  const [clientModalMode, setClientModalMode] = useState<'create' | 'edit'>('create');
  const [clientNameInput, setClientNameInput] = useState<string>('');
  const [clientFolderInput, setClientFolderInput] = useState<string>('');
  const [submittingClient, setSubmittingClient] = useState<boolean>(false);

  // Google Drive フォルダ設定＆同期用
  const [driveFolderInput, setDriveFolderInput] = useState<string>('');
  const [savingFolder, setSavingFolder] = useState<boolean>(false);
  const [syncingDrive, setSyncingDrive] = useState<boolean>(false);
  const [runningOcr, setRunningOcr] = useState<boolean>(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // 月指定エクスポート用
  const [exportMonth, setExportMonth] = useState<string>('2026-10');
  const [exportingJson, setExportingJson] = useState<boolean>(false);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  // ローカル画像アップロード用
  const [uploadingFiles, setUploadingFiles] = useState<boolean>(false);

  const [loadingClients, setLoadingClients] = useState<boolean>(true);
  const [loadingReceipts, setLoadingReceipts] = useState<boolean>(false);
  const [submittingIds, setSubmittingIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // 🔍 集中拡大レビューモード用 対象レシートID
  const [focusReceiptId, setFocusReceiptId] = useState<number | null>(null);

  // スクロール連動用のRef
  const imageCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const gridSectionRefs = useRef<Map<number, HTMLTableSectionElement>>(new Map());

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const focusReceipt = receipts.find((r) => r.id === focusReceiptId);

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

  // 顧客の新規作成モーダルを開く
  const handleOpenCreateClientModal = () => {
    setClientModalMode('create');
    setClientNameInput('');
    setClientFolderInput('');
    setShowClientModal(true);
  };

  // 顧客の編集モーダルを開く
  const handleOpenEditClientModal = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    setClientModalMode('edit');
    setClientNameInput(client.name);
    setClientFolderInput(client.drive_folder_id ?? '');
    setShowClientModal(true);
  };

  // 顧客の保存（新規登録または編集）
  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientNameInput.trim() || submittingClient) return;

    setSubmittingClient(true);
    setError(null);

    try {
      if (clientModalMode === 'create') {
        const res = await fetch(`${API_BASE_URL}/api/clients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: clientNameInput.trim(),
            drive_folder_id: clientFolderInput.trim(),
          }),
        });
        const data = (await res.json()) as { error?: string; client: Client };
        if (!res.ok) throw new Error(data.error || '顧客の登録に失敗しました');

        setClients((prev) => [...prev, data.client]);
        setSelectedClientId(data.client.id);
        setDriveFolderInput(data.client.drive_folder_id ?? '');
        setInfoMessage(`顧客「${data.client.name}」を登録しました`);
      } else {
        if (!selectedClientId) return;
        const res = await fetch(`${API_BASE_URL}/api/clients/${selectedClientId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: clientNameInput.trim(),
            drive_folder_id: clientFolderInput.trim(),
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || '顧客情報の更新に失敗しました');

        setClients((prev) =>
          prev.map((c) =>
            c.id === selectedClientId
              ? {
                  ...c,
                  name: clientNameInput.trim(),
                  drive_folder_id: clientFolderInput.trim(),
                }
              : c
          )
        );
        setDriveFolderInput(clientFolderInput.trim());
        setInfoMessage(`顧客情報を更新しました`);
      }

      setShowClientModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '処理中にエラーが発生しました');
    } finally {
      setSubmittingClient(false);
    }
  };

  // 顧客の削除
  const handleDeleteClient = async (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `顧客「${client.name}」を削除してもよろしいですか？\n※紐づくレシートと明細データもすべて削除されます。`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
        method: 'DELETE',
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || '顧客の削除に失敗しました');

      const nextClients = clients.filter((c) => c.id !== client.id);
      setClients(nextClients);
      if (selectedClientId === client.id) {
        setSelectedClientId(nextClients[0]?.id ?? null);
      }
      setInfoMessage(`顧客「${client.name}」を削除しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除中にエラーが発生しました');
    }
  };

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

  // Google Driveから新規レシート画像を今すぐ取り込むボタン処理
  const handleSyncDriveNow = async () => {
    if (!selectedClientId || syncingDrive) return;
    setSyncingDrive(true);
    setError(null);
    setInfoMessage(null);

    try {
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
        ingested_count?: number;
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
        setInfoMessage(
          `${data.message}。「⚡ OCR解析を実行」を押すと明細を自動抽出できます。`
        );
      } else {
        setInfoMessage(data.message);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Google Drive同期中にエラーが発生しました'
      );
    } finally {
      setSyncingDrive(false);
    }
  };

  // 選択中顧客の OCR 未実行レシートを一括解析
  const handleRunOcrBatch = async () => {
    if (!selectedClientId || runningOcr) return;
    setRunningOcr(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/clients/${selectedClientId}/run-ocr`,
        { method: 'POST' }
      );
      const data = (await res.json()) as {
        error?: string;
        message: string;
        processed_count?: number;
      };

      if (!res.ok) {
        throw new Error(data.error || 'OCR解析に失敗しました');
      }

      const refreshedRes = await fetch(
        `${API_BASE_URL}/api/clients/${selectedClientId}/receipts?status=unreviewed`
      );
      if (refreshedRes.ok) {
        const refreshedData = (await refreshedRes.json()) as { receipts: Receipt[] };
        const mapped = (refreshedData.receipts ?? []).map(mapReceiptToEditable);
        setReceipts(mapped);
        const firstWithDate = mapped.find((r) => /^\d{4}-\d{2}/.test(r.receipt_date));
        if (firstWithDate) {
          setExportMonth(firstWithDate.receipt_date.slice(0, 7));
        }
      }

      setInfoMessage(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OCR解析中にエラーが発生しました');
    } finally {
      setRunningOcr(false);
    }
  };

  // ローカル画像ファイルの取り込み
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
        receipt_date: receipt.receipt_date ?? '',
        amount: Math.trunc(headerAmount),
        payee: receipt.payee ?? '',
        memo: receipt.memo ?? '',
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

  // 月指定エクスポート共通処理（JSON / CSV 統合）
  const handleDownloadExport = async (format: 'json' | 'csv') => {
    if (!selectedClientId || !exportMonth) return;
    const isJson = format === 'json';
    const setExporting = isJson ? setExportingJson : setExportingCsv;
    const label = isJson ? 'JSON' : 'CSV';

    setExporting(true);
    setError(null);

    try {
      for (const r of receipts) {
        await saveReceiptToApi(r, 'unreviewed');
      }

      const res = await fetch(
        `${API_BASE_URL}/api/clients/${selectedClientId}/receipts/${format}?month=${encodeURIComponent(
          exportMonth
        )}`
      );
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `${label}のダウンロードに失敗しました`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipts_${selectedClient?.name ?? selectedClientId}_${exportMonth}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label}出力中にエラーが発生しました`);
    } finally {
      setExporting(false);
    }
  };

  // 集計ステータス
  const stats = useMemo<ReceiptStats>(() => {
    let totalItems = 0;
    let modifiedItems = 0;
    let pendingOcrCount = 0;
    let failedOcrCount = 0;

    for (const r of receipts) {
      if (r.ocr_status === 'pending') {
        pendingOcrCount++;
      } else if (r.ocr_status === 'failed') {
        failedOcrCount++;
      }
      totalItems += r.items.length;
      const modCount = r.items.filter((i) => i.is_modified).length;
      modifiedItems += modCount;
    }

    return { totalItems, modifiedItems, pendingOcrCount, failedOcrCount };
  }, [receipts]);

  return (
    <div className="flex h-screen bg-slate-100 text-slate-800">
      {/* 左サイドバー ＆ 顧客登録モーダル */}
      <ClientSidebar
        clients={clients}
        selectedClientId={selectedClientId}
        loadingClients={loadingClients}
        onSelectClient={setSelectedClientId}
        onOpenCreateModal={handleOpenCreateClientModal}
        onOpenEditModal={handleOpenEditClientModal}
        onDeleteClient={handleDeleteClient}
        showClientModal={showClientModal}
        clientModalMode={clientModalMode}
        clientNameInput={clientNameInput}
        clientFolderInput={clientFolderInput}
        submittingClient={submittingClient}
        onChangeNameInput={setClientNameInput}
        onChangeFolderInput={setClientFolderInput}
        onCloseModal={() => setShowClientModal(false)}
        onSubmitModal={handleSaveClient}
      />

      {/* メインエリア */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 上部バー */}
        <TopHeaderBar
          selectedClient={selectedClient}
          clientsCount={clients.length}
          receiptsCount={receipts.length}
          stats={stats}
          exportMonth={exportMonth}
          exportingJson={exportingJson}
          exportingCsv={exportingCsv}
          driveFolderInput={driveFolderInput}
          savingFolder={savingFolder}
          syncingDrive={syncingDrive}
          runningOcr={runningOcr}
          uploadingFiles={uploadingFiles}
          onChangeExportMonth={setExportMonth}
          onDownloadExport={handleDownloadExport}
          onBatchApproveAll={handleBatchApproveAllReceipts}
          onChangeDriveFolderInput={setDriveFolderInput}
          onSaveDriveFolder={handleSaveDriveFolder}
          onSyncDriveNow={handleSyncDriveNow}
          onRunOcrBatch={handleRunOcrBatch}
          onFileUpload={handleFileUpload}
        />

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
          {clients.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-xl border border-slate-200 p-8 text-center max-w-lg mx-auto my-auto shadow-xs">
              <div className="w-14 h-14 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-2xl font-bold mb-4">
                🏢
              </div>
              <h3 className="text-base font-bold text-slate-800">
                顧客がまだ登録されていません
              </h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                記帳代行・レシート確認を始めるには、まず顧客（企業名など）を登録してください。
              </p>
              <button
                type="button"
                onClick={handleOpenCreateClientModal}
                className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-colors cursor-pointer"
              >
                ＋ 最初の顧客を登録する
              </button>
            </div>
          ) : !selectedClientId ? (
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
                上部の「🔄 Driveから画像取込」や「＋ ローカル画像取込」から取り込むか、「⬇ JSON出力」「CSV」から月別データを出力できます。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
              {/* 左カラム (5/12): レシート画像の縦スクロール一覧 */}
              <ReceiptImageList
                receipts={receipts}
                activeReceiptId={activeReceiptId}
                imageCardRefs={imageCardRefs}
                onFocusGridSection={focusGridSection}
                onOpenFocusReview={setFocusReceiptId}
              />

              {/* 右カラム (7/12): 明細グリッド一覧 */}
              <ReceiptGridSection
                receipts={receipts}
                activeReceiptId={activeReceiptId}
                submittingIds={submittingIds}
                taxRateOptions={taxRateOptions}
                gridSectionRefs={gridSectionRefs}
                onFocusReceiptImage={focusReceiptImage}
                onOpenFocusReview={setFocusReceiptId}
                onReceiptFieldChange={handleReceiptFieldChange}
                onItemChange={handleItemChange}
                onTaxPresetChange={handleTaxPresetChange}
                onAddItem={handleAddItem}
                onRemoveItem={handleRemoveItem}
                onApproveReceipt={approveReceipt}
              />
            </div>
          )}
        </div>
      </main>

      {/* 🔍 集中拡大レビューモード */}
      {focusReceipt && (
        <FocusReviewModal
          receipt={focusReceipt}
          receipts={receipts}
          taxRateOptions={taxRateOptions}
          onSelectReceiptId={setFocusReceiptId}
          onApproveReceipt={approveReceipt}
          onReceiptFieldChange={handleReceiptFieldChange}
          onItemChange={handleItemChange}
          onTaxPresetChange={handleTaxPresetChange}
          onAddItem={handleAddItem}
          onRemoveItem={handleRemoveItem}
        />
      )}
    </div>
  );
}
