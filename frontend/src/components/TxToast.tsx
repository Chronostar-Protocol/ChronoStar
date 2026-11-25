"use client";

import React, { useState, useEffect } from "react";
import { getTransactionExplorerUrl } from "@/lib/config";
import { useI18n } from "@/lib/i18n";

interface TxToastProps {
  hash?: string | null;
  status?: "pending" | "success" | "error" | null;
  message?: string;
  onClose?: () => void;
}

export function TxToast({ hash, status, message, onClose }: TxToastProps) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (status) {
      setVisible(true);
      if (status === "pending") return;
      const timer = setTimeout(() => {
        setVisible(false);
        onClose?.();
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

  if (!visible || !status) return null;

  const colors = {
    pending: "border-accent-orange text-accent-orange",
    success: "border-accent-green text-accent-green",
    error: "border-accent-red text-accent-red",
  };

  const handleDownloadReceipt = () => {
    if (!hash) return;
    const receiptData = {
      hash,
      status,
      message: message || status,
      timestamp: new Date().toISOString(),
      explorer: getTransactionExplorerUrl(hash),
    };
    const blob = new Blob([JSON.stringify(receiptData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${hash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border bg-bg-card shadow-lg ${colors[status]}`}
    >
      <div className="flex items-center gap-2">
        {status === "pending" && (
          <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
        )}
        <span className="text-sm font-medium">{message || t.toast[status]}</span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        {hash && (
          <a
            href={getTransactionExplorerUrl(hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-blue underline hover:opacity-80"
          >
            {t.toast.viewExplorer}
          </a>
        )}
        {status === "success" && hash && (
          <button
            onClick={handleDownloadReceipt}
            className="text-xs text-text-muted hover:text-text-primary underline cursor-pointer"
          >
            {t.toast.downloadReceipt}
          </button>
        )}
      </div>
    </div>
  );
}
