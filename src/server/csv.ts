// CSVセルのエスケープヘルパー
export function escapeCsvCell(val: string | number | null | undefined): string {
  const str = String(val ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface CsvReceiptRow {
  receipt_id: number;
  receipt_date: string;
  payee: string;
  receipt_amount: number;
  memo: string;
  status: string;
  line_number: number;
  item_name: string;
  item_amount: number;
  tax_rate: number;
  is_reduced_tax: number;
  is_modified: number;
}

// レシート＆明細リストからBOM付きUTF-8のCSV文字列を生成
export function buildReceiptsCsv(rows: CsvReceiptRow[]): string {
  const headers = [
    'レシートID',
    '日付',
    '支払先',
    'レシート合計金額',
    'メモ',
    '行番号',
    '品名',
    '明細金額(税込)',
    '税率(%)',
    '軽減税率',
    '手修正',
    'ステータス',
  ];

  const lines: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const row of rows) {
    const cols = [
      row.receipt_id,
      row.receipt_date,
      row.payee,
      row.receipt_amount,
      row.memo ?? '',
      row.line_number ?? 1,
      row.item_name ?? '',
      row.item_amount ?? row.receipt_amount,
      row.tax_rate ?? 10,
      row.is_reduced_tax ? '軽減' : '',
      row.is_modified ? '修正済' : '未修正',
      row.status === 'approved' ? '承認済' : '未レビュー',
    ];
    lines.push(cols.map(escapeCsvCell).join(','));
  }

  // Excelで文字化けしないよう先頭にUTF-8 BOM (\uFEFF) を付与
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

