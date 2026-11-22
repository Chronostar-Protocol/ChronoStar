"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getCanonicalScheduleUrl, assertNoSecretsInPayload } from "@/lib/share";
import { config } from "@/lib/config";

export interface ShareScheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  scheduleType: "vault" | "stream" | "dca";
  scheduleId: string | number;
  label?: string;
  network?: string;
  canonicalUrl?: string;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function ShareScheduleDialog({
  isOpen,
  onClose,
  scheduleType,
  scheduleId,
  label,
  network,
  canonicalUrl: customUrl,
  triggerRef,
}: ShareScheduleDialogProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const deploymentNetwork = network || config.environment || "testnet";
  const url =
    customUrl ||
    getCanonicalScheduleUrl({
      type: scheduleType,
      id: scheduleId,
      network: deploymentNetwork,
    });

  // Verify that neither the URL nor any payload includes secrets
  assertNoSecretsInPayload(url);

  const typeName =
    scheduleType === "vault" ? "Vault" : scheduleType === "stream" ? "Stream" : "DCA Policy";

  // Manage focus restoration and trapping
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedElementRef.current =
        (document.activeElement as HTMLElement) || triggerRef?.current || null;

      // Focus the close button on open
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);

      return () => clearTimeout(timer);
    } else if (previouslyFocusedElementRef.current) {
      previouslyFocusedElementRef.current.focus();
      previouslyFocusedElementRef.current = null;
    }
  }, [isOpen, triggerRef]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // Trap focus and handle Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusableElements.length) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    },
    [onClose],
  );

  const handleCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        aria-describedby="share-dialog-desc"
        onKeyDown={handleKeyDown}
        className="w-full max-w-md bg-bg-card border border-border rounded-xl p-6 shadow-2xl relative text-text-primary animate-in fade-in zoom-in-95 duration-150 focus:outline-none"
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 id="share-dialog-title" className="text-lg font-heading font-bold text-text-primary">
            Share {typeName} #{scheduleId}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Deployment Context */}
        <div
          data-testid="share-deployment-context"
          className="mb-5 p-3 rounded-lg border border-border bg-bg-elevated/60 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 truncate">
            <span className="text-text-muted font-medium">Deployment:</span>
            <span
              data-testid="share-network-badge"
              className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider bg-accent-blue/15 text-accent-blue border border-accent-blue/30"
            >
              {deploymentNetwork}
            </span>
          </div>
          {label && (
            <span className="text-text-muted truncate max-w-[150px]" title={label}>
              {label}
            </span>
          )}
        </div>

        {/* QR Code Container */}
        <div className="flex flex-col items-center justify-center my-4">
          <div
            className="bg-white p-4 rounded-xl shadow-md flex items-center justify-center"
            data-testid="share-qr-wrapper"
          >
            <QRCodeSVG
              value={url}
              size={180}
              level="M"
              role="img"
              data-testid="share-qr-code"
              data-payload={url}
              aria-label={`QR code for ${typeName} #${scheduleId}`}
            />
          </div>
          <p id="share-dialog-desc" className="text-xs text-text-muted mt-3 text-center">
            Scan with a camera or QR reader to open this schedule on a second device.
          </p>
        </div>

        {/* Fallback Link and Copy */}
        <div className="mt-5 space-y-2">
          <label
            htmlFor="share-schedule-url-input"
            className="block text-xs font-medium text-text-muted"
          >
            Canonical Link
          </label>
          <div className="flex gap-2">
            <input
              id="share-schedule-url-input"
              data-testid="share-link-input"
              type="text"
              readOnly
              value={url}
              aria-label="Shareable link"
              className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-blue select-all"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              data-testid="share-copy-button"
              onClick={handleCopy}
              className="px-3 py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:opacity-90 transition-all flex items-center gap-1.5 shrink-0"
              aria-label="Copy link"
            >
              {copied ? (
                <>
                  <svg
                    className="w-3.5 h-3.5 text-accent-green"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <span className="sr-only" aria-live="polite">
            {copied ? "Link copied to clipboard" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ShareScheduleButton({
  scheduleType,
  scheduleId,
  label,
  className,
  network,
}: {
  scheduleType: "vault" | "stream" | "dca";
  scheduleId: string | number;
  label?: string;
  className?: string;
  network?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const scheduleName =
    scheduleType === "vault" ? "Vault" : scheduleType === "stream" ? "Stream" : "DCA Policy";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          className ||
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-bg-card hover:bg-bg-elevated text-text-primary text-sm font-medium transition-colors"
        }
        aria-label={`Share ${scheduleName} #${scheduleId}`}
        data-testid={`share-${scheduleType}-button`}
      >
        <svg
          className="w-4 h-4 text-text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
        <span>Share</span>
      </button>
      <ShareScheduleDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        scheduleType={scheduleType}
        scheduleId={scheduleId}
        label={label}
        network={network}
        triggerRef={triggerRef}
      />
    </>
  );
}
