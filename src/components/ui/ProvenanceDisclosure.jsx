import { Info } from 'lucide-react';

const ProvenanceDisclosure = ({ entry }) => {
  const analysis = entry.analysis || {};
  const health = entry.healthContext;
  const status = entry.analysisStatus || (entry.analysis ? 'complete' : 'unavailable');

  return (
    <details className="mt-4 border-t border-[var(--divider)] pt-3 text-xs text-[var(--muted-foreground)]">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-[var(--secondary-foreground)]">
        <Info size={15} aria-hidden="true" /> Why am I seeing this?
      </summary>
      <div className="space-y-2 rounded-xl bg-[var(--accent-wash)] p-3 leading-relaxed">
        <p><strong>AI organization:</strong> {status === 'disabled' ? 'Paused for this entry. Your original text is preserved without third-party analysis.' : status === 'failed' ? 'Unavailable—the entry is preserved without an invented result.' : status === 'pending' ? 'Still processing.' : status === 'complete' ? 'Generated from this entry and your enabled context.' : 'No analysis is available.'}</p>
        {(analysis.modelVersion || entry.analysisModel || analysis.promptVersion) && (
          <p><strong>Method:</strong> {[analysis.modelVersion || entry.analysisModel, analysis.promptVersion].filter(Boolean).join(' · ')}</p>
        )}
        {health && (
          <p><strong>Health context:</strong> {health.source || 'connected provider'}{health.provenance?.requestedLocalDate ? ` for ${health.provenance.requestedLocalDate}` : ''}{health.provenance?.timezone ? ` (${health.provenance.timezone})` : ''}. This is an association, not proof that health caused how you felt.</p>
        )}
        {entry.userCorrections && <p><strong>Your correction:</strong> User edits take priority in this view.</p>}
      </div>
    </details>
  );
};

export default ProvenanceDisclosure;
