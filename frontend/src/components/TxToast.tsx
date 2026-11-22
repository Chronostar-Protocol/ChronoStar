"use client";

import React, { useState, useEffect } from "react";
import { getTransactionExplorerUrl } from "@/lib/config";
import { downloadReceiptAsJson } from "@/lib/contracts";
import type { TransactionReceipt } from "@/types";

interface TxToastProps {
  hash?: string | null;
  status?: "pending" | "success" | "error" | null;
  message?: string;
  receipt?: TransactionReceipt | null;
  onClose?: () => void;
}

export function TxToast({ hash, status, message, receipt, onClose }: TxToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status) {
      setVisible(true);
      if (status === "pending") return;
      const timer = setTimeout(() => {
        setVisible(false);
        onClose?.();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

  if (!visible || !status) return null;

  const colors = {
    pending: "border-accent-orange text-accent-orange",
    success: "border-accent-green text-accent-green",
    error: "border-accent-red text-accent-red",
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border bg-bg-card ${colors[status]}`}
    >
      <div className="flex items-center gap-2">
        {status === "pending" && (
          <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
        )}
        <span className="text-sm">{message || status}</span>
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs">
        {hash && (
          <a
            href={getTransactionExplorerUrl(hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue underline hover:opacity-80"
          >
            View on explorer
          </a>
        )}
        {status === "success" && receipt && (
          <button
            type="button"
            onClick={() => downloadReceiptAsJson(receipt)}
            className="text-accent-green underline hover:opacity-80 flex items-center gap-1 font-medium"
            data-testid="download-receipt-btn"
          >
            Download receipt
          </button>
        )}
      </div>
    </div>
  );
}
