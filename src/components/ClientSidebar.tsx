import React from 'react';
import type { Client } from '../types';

interface ClientSidebarProps {
  clients: Client[];
  selectedClientId: number | null;
  loadingClients: boolean;
  onSelectClient: (clientId: number) => void;
  onOpenCreateModal: () => void;
  onOpenEditModal: (client: Client, e: React.MouseEvent) => void;
  onDeleteClient: (client: Client, e: React.MouseEvent) => void;

  // モーダル制御用
  showClientModal: boolean;
  clientModalMode: 'create' | 'edit';
  clientNameInput: string;
  clientFolderInput: string;
  submittingClient: boolean;
  onChangeNameInput: (val: string) => void;
  onChangeFolderInput: (val: string) => void;
  onCloseModal: () => void;
  onSubmitModal: (e: React.FormEvent) => void;
}

export const ClientSidebar: React.FC<ClientSidebarProps> = ({
  clients,
  selectedClientId,
  loadingClients,
  onSelectClient,
  onOpenCreateModal,
  onOpenEditModal,
  onDeleteClient,
  showClientModal,
  clientModalMode,
  clientNameInput,
  clientFolderInput,
  submittingClient,
  onChangeNameInput,
  onChangeFolderInput,
  onCloseModal,
  onSubmitModal,
}) => {
  return (
    <>
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col border-r border-slate-800 shrink-0">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-base font-bold tracking-tight">レシートOCR レビュー</h1>
          <p className="text-[11px] text-slate-400 mt-0.5">Drive自動取込＆グリッド確認</p>
        </div>

        <div className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>顧客一覧 ({clients.length})</span>
          <button
            type="button"
            onClick={onOpenCreateModal}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-0.5 cursor-pointer px-1 py-0.5 rounded hover:bg-slate-800 transition-colors"
          >
            ＋ 追加
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 space-y-1">
          {loadingClients ? (
            <div className="px-3 py-4 text-xs text-slate-400">読み込み中...</div>
          ) : clients.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              顧客が登録されていません。
              <br />
              上の「＋ 追加」から登録してください。
            </div>
          ) : (
            clients.map((client) => {
              const isSelected = client.id === selectedClientId;
              return (
                <div
                  key={client.id}
                  onClick={() => onSelectClient(client.id)}
                  className={`group w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span className="truncate flex-1 mr-1">{client.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] opacity-60">#{client.id}</span>
                    <button
                      type="button"
                      title="顧客情報を編集"
                      onClick={(e) => onOpenEditModal(client, e)}
                      className="opacity-0 group-hover:opacity-100 hover:text-amber-300 text-[10px] p-0.5 rounded transition-opacity"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      title="顧客を削除"
                      onClick={(e) => onDeleteClient(client, e)}
                      className="opacity-0 group-hover:opacity-100 hover:text-red-300 text-[10px] p-0.5 rounded transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </nav>
      </aside>

      {/* 顧客追加・編集モーダル */}
      {showClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {clientModalMode === 'create' ? '新規顧客の登録' : '顧客情報の編集'}
              </h3>
              <button
                type="button"
                onClick={onCloseModal}
                className="text-slate-400 hover:text-white text-base leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={onSubmitModal} className="p-5 space-y-4">
              <div>
                <label
                  htmlFor="modal_client_name"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  顧客名 / 企業名 <span className="text-red-500">*</span>
                </label>
                <input
                  id="modal_client_name"
                  type="text"
                  required
                  placeholder="例: 株式会社ABC商事"
                  value={clientNameInput}
                  onChange={(e) => onChangeNameInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20"
                />
              </div>

              <div>
                <label
                  htmlFor="modal_client_folder"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Google Drive フォルダURLまたはID (任意)
                </label>
                <input
                  id="modal_client_folder"
                  type="text"
                  placeholder="例: https://drive.google.com/drive/folders/xxxx"
                  value={clientFolderInput}
                  onChange={(e) => onChangeFolderInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-600"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  レシート画像を入れるGoogle DriveフォルダのURLを貼り付けます（後からでも設定可能）
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCloseModal}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={submittingClient || !clientNameInput.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-xs"
                >
                  {submittingClient ? '保存中...' : '登録する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
