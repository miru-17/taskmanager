interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
}: ConfirmModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">

      <div className="w-[420px] rounded-3xl bg-slate-900 border border-cyan-500/30 p-8 shadow-[0_0_60px_rgba(6,182,212,.25)]">

        <h2 className="text-3xl font-bold text-white">
          {title}
        </h2>

        <p className="mt-4 text-slate-300">
          {message}
        </p>

        <div className="flex justify-end gap-4 mt-8">

          <button
            onClick={onCancel}
            className="px-6 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white transition"
          >
            Cancel
          </button>

          <button
            onClick={onConfirm}
            className="px-6 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white transition"
          >
            Delete
          </button>

        </div>

      </div>

    </div>
  );
};

export default ConfirmModal;