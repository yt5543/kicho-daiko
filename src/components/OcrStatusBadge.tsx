import React from 'react';
import type { OcrStatus } from '../types';

interface OcrStatusBadgeProps {
  ocrStatus: OcrStatus;
  retryCount: number;
  ocrError?: string;
  hasModified?: boolean;
  showCompletedBadge?: boolean;
}

export const OcrStatusBadge: React.FC<OcrStatusBadgeProps> = ({
  ocrStatus,
  retryCount,
  ocrError,
  hasModified = false,
  showCompletedBadge = true,
}) => {
  if (ocrStatus === 'pending') {
    return (
      <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-900 text-[11px] font-bold">
        {retryCount > 0 ? `⏳ 再試行待ち (${retryCount}/3)` : '⏳ OCR待ち'}
      </span>
    );
  }

  if (ocrStatus === 'processing') {
    return (
      <span className="px-2 py-0.5 rounded bg-indigo-500 text-white text-[11px] font-bold animate-pulse">
        🔄 解析中
      </span>
    );
  }

  if (ocrStatus === 'failed') {
    return (
      <span
        className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px] font-bold cursor-help"
        title={ocrError}
      >
        ⚠️ 解析失敗({retryCount}回)
      </span>
    );
  }

  if (!showCompletedBadge) {
    return null;
  }

  if (hasModified) {
    return (
      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[11px] font-semibold">
        ✎ 修正あり
      </span>
    );
  }

  return (
    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[11px] font-medium">
      ✓ OCR済
    </span>
  );
};

