import { useEffect, useRef } from "react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal = ({ isOpen, title, message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmModalProps) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-[420px] rounded-3xl bg-slate-900 border border-cyan-500/30 p-8 shadow-[0_0_60px_rgba(6,182,212,.25)]"
      >
        <h2 id="confirm-title" className="text-3xl font-bold text-white">
          {title}
        </h2>

        <p className="mt-4 text-slate-300">{message}</p>

        <div className="flex justify-end gap-4 mt-8">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-6 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white transition"
          >
            Cancel
          </button>

          <button onClick={onConfirm} className="px-6 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white transition">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
