import { Mic } from 'lucide-react';
import { useUiStore } from '../../../stores/uiStore';

/**
 * QuickCaptureWidget - Bento widget: the front door for brainstorm dumping.
 * One tap requests voice capture; AppLayout reacts to `captureRequest` and
 * opens the entry modal with voice auto-start.
 */
const QuickCaptureWidget = () => {
  const requestCapture = useUiStore((s) => s.requestCapture);

  return (
    <button
      onClick={() => requestCapture('voice')}
      aria-label="Brain dump"
      className="w-full h-full min-h-[120px] rounded-2xl bg-gradient-to-br from-honey-500 to-terra-500
                 dark:from-honey-600 dark:to-terra-600 text-white shadow-soft-md
                 flex flex-col items-center justify-center gap-2 active:scale-[0.98] transition-transform"
    >
      <Mic size={32} />
      <span className="font-medium">Brain dump</span>
      <span className="text-xs opacity-80">Tap and just talk</span>
    </button>
  );
};

export default QuickCaptureWidget;
