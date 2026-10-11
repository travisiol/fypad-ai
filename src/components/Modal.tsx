"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./Icons";

/** Instagram-style centred modal: dimmed backdrop, rounded sheet, Escape / backdrop click closes. */
export function Modal({ open, onClose, title, children, width = 400, closeOutside = true, testId }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; width?: number; closeOutside?: boolean; testId?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop fade-in" onMouseDown={(e) => closeOutside && e.target === e.currentTarget && onClose()} data-testid={testId}>
      <button type="button" className="icon-btn fixed right-3 top-3 hidden text-white md:inline-flex" onClick={onClose} aria-label="Close">
        <CloseIcon />
      </button>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="modal-head">
            <span>{title}</span>
            <button type="button" className="icon-btn absolute right-2 md:hidden" onClick={onClose} aria-label="Close">
              <CloseIcon size={20} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
