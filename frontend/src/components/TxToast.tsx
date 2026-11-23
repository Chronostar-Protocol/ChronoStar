"use client";

import React, { useState, useEffect, useCallback } from "react";
import { getTransactionExplorerUrl } from "@/lib/config";

interface TxToastProps {
  hash?: string | null;
  status?: "pending" | "success" | "error" | null;
  message?: string;
  onClose?: () => void;
}

export function TxToast({ hash, status, message, onClose }: TxToastProps) {
  const [visible, setVisible] = useState(false);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (status) {
      setVisible(true);
      if (status === "pending") return;
      const timer = setTimeout(() => {
        handleDismiss();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [status, handleDismiss]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, handleDismiss]);

  if (!visible || !status) return null;

  const colors = {
    pending: "border-accent-orange text-accent-orange",
    success: "border-accent-green text-accent-green",
    error: "border-accent-red text-accent-red",
  };

  const role = status === "error" ? "alert" : "status";
  const ariaLive = status === "error" ? "assertive" : "polite";

  return (
    <div
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border bg-bg-card shadow-lg ${colors[status]}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {status === "pending" && (
            <>
              <span
                aria-hidden="true"
                className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"
              />
              <span className="sr-only">Transaction pending: </span>
            </>
          )}
          <span className="text-sm">{message || status}</span>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss notification"
          className="text-xs opacity-70 hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-current rounded p-0.5 ml-2"
        >
          ✕
        </button>
      </div>
      {hash && (
        <a
          href={getTransactionExplorerUrl(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-1 text-xs text-accent-blue underline"
        >
          View on explorer
        </a>
      )}
    </div>
  );
}
