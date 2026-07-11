import { t } from './i18n';

/**
 * Preview + save/post dialog for a rendered share-card image. Used by the
 * popup (per-page scan card) and the report page (weekly recap card).
 */
export const ShareModal: React.FC<{
  title: string;
  url: string;
  blob: Blob;
  fileName: string;
  tweet: string;
  onClose: () => void;
}> = ({ title, url, blob, fileName, tweet, onClose }) => {
  async function postOnX() {
    // The tweet intent URL cannot carry media, so put the image on the
    // clipboard first — one Ctrl+V in the composer attaches it.
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    } catch {
      // clipboard is best-effort; the user can still attach the saved file
    }
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      `${tweet}\nhttps://zevrhq.com`,
    )}`;
    void chrome.tabs.create({ url: intent });
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0a1420] border border-cyan-800/50 rounded-lg overflow-hidden shadow-[0_0_30px_rgba(56,189,248,0.15)]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-cyan-900/40">
          <div className="text-[10px] uppercase tracking-[0.25em] text-cyan-400">
            {title}
          </div>
          <button
            className="text-gray-500 hover:text-gray-200 text-sm"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <img src={url} alt="" className="w-full block" />
        <div className="flex gap-2 p-3">
          <a
            href={url}
            download={fileName}
            className="flex-1 text-center py-2 rounded text-[11px] font-bold uppercase tracking-wider bg-gray-700/70 text-gray-100 hover:bg-gray-600 transition"
          >
            ⬇ {t('shareDownload', 'Save image')}
          </a>
          <button
            className="flex-1 py-2 rounded text-[11px] font-bold uppercase tracking-wider bg-cyan-500/90 text-black hover:bg-cyan-400 transition"
            onClick={() => void postOnX()}
          >
            𝕏 {t('sharePost', 'Post')}
          </button>
        </div>
        <div className="px-3 pb-3 text-[9px] text-gray-500">
          {t('shareHint', 'The image is copied when you post — press Ctrl+V in the composer to attach it.')}
        </div>
      </div>
    </div>
  );
};
