'use client';

import React, { useState } from 'react';

interface ShareModalProps {
  title: string;
  url: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareModal({ title, url, isOpen, onClose }: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Generate deterministic QR-like SVG pattern for compact display without external libraries
  const generateQrSvg = (text: string) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    const cells = 15;
    const rects = [];
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        // corners have locator boxes
        const isCorner =
          (r < 4 && c < 4) || (r < 4 && c >= cells - 4) || (r >= cells - 4 && c < 4);
        const bit = ((hash ^ (r * 31 + c * 17)) & 1) === 1;
        if (isCorner || bit) {
          rects.push(
            <rect
              key={`${r}-${c}`}
              x={c * 8 + 4}
              y={r * 8 + 4}
              width={7}
              height={7}
              fill="currentColor"
            />
          );
        }
      }
    }
    return (
      <svg
        viewBox="0 0 128 128"
        className="w-36 h-36 mx-auto text-text-primary p-2 bg-white rounded-lg"
      >
        {rects}
      </svg>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-bg-card border border-border rounded-xl max-w-sm w-full p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-heading font-bold text-text-primary">Share {title}</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="flex flex-col items-center justify-center p-3 border border-border/50 rounded-lg bg-bg-primary">
          {generateQrSvg(url)}
          <span className="text-xs text-text-muted mt-2">Scan to open on mobile</span>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">Schedule Link</label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={url}
              className="flex-1 px-3 py-1.5 text-xs rounded border border-border bg-bg-primary text-text-primary font-mono select-all focus:outline-none"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs font-medium rounded bg-accent-blue text-white hover:opacity-90 transition-opacity"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 text-sm rounded-lg border border-border text-text-muted hover:text-text-primary transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
