import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import type { RiskLevel } from '../types';

/**
 * Per-row block/unblock button. Ad, tracking and dangerous rows block on
 * the first click; infrastructure and unclassified rows ("service"/"safe")
 * can be part of what makes the current page work, so those ask for a
 * confirming second click before the rule is written.
 */
export const BlockButton: React.FC<{
  blocked: boolean;
  riskLevel: RiskLevel;
  onBlock: () => void;
  onUnblock: () => void;
}> = ({ blocked, riskLevel, onBlock, onUnblock }) => {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const needsConfirm = riskLevel === 'tracker' || riskLevel === 'safe';

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (blocked) {
      onUnblock();
      return;
    }
    if (needsConfirm && !confirming) {
      setConfirming(true);
      timer.current = window.setTimeout(() => setConfirming(false), 2500);
      return;
    }
    window.clearTimeout(timer.current);
    setConfirming(false);
    onBlock();
  }

  return (
    <button
      className={`flex-shrink-0 px-1.5 h-5 rounded text-[9px] font-bold uppercase tracking-wider transition ${
        blocked
          ? 'bg-gray-700/60 text-gray-300 hover:bg-gray-600'
          : confirming
            ? 'bg-red-600 text-white border border-red-400'
            : 'bg-red-900/30 text-red-300 border border-red-800/50 hover:bg-red-900/60 hover:border-red-500'
      }`}
      title={
        !blocked && needsConfirm
          ? t('blockBreakRisk', 'May be needed by this site — click twice to block.')
          : undefined
      }
      onClick={handleClick}
    >
      {blocked
        ? t('unblock', 'unblock')
        : confirming
          ? t('blockConfirmShort', 'sure?')
          : t('block', 'block')}
    </button>
  );
};

/** Bottom toast confirming a block, with a one-tap undo. */
export const UndoToast: React.FC<{
  domain: string;
  onUndo: () => void;
  onClose: () => void;
}> = ({ domain, onUndo, onClose }) => (
  <div className="fixed bottom-10 inset-x-2 z-50 flex items-center gap-2 rounded-lg border border-cyan-800/60 bg-gray-900/95 px-3 py-2 text-[11px] shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
    <span className="flex-1 min-w-0 truncate text-gray-200">
      {t('blockToastMsg', `Blocked ${domain}`, domain)}
    </span>
    <button
      className="flex-none px-2.5 py-1 rounded-full bg-cyan-500/90 hover:bg-cyan-400 text-black font-bold"
      onClick={onUndo}
    >
      {t('blockToastUndo', 'Undo')}
    </button>
    <button
      className="flex-none text-gray-500 hover:text-gray-300 px-1"
      aria-label={t('pwWarnDismiss', 'Dismiss')}
      onClick={onClose}
    >
      ✕
    </button>
  </div>
);
