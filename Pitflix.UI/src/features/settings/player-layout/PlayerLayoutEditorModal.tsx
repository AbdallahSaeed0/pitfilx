import { AnimatePresence, motion } from "framer-motion";
import { PlayerLayoutEditor } from "./PlayerLayoutEditor";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function PlayerLayoutEditorModal({ open, onClose }: Props) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[220] flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Player layout editor"
            className="relative z-10 mx-auto flex h-full w-full max-w-[min(1440px,98vw)] flex-col overflow-hidden p-3 sm:p-4 md:p-5"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
              <PlayerLayoutEditor onClose={onClose} />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
