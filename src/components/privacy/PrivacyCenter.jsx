import { Brain, Cloud, Database, Download, HardDrive, ShieldCheck, UserRoundCog, X } from 'lucide-react';

const PrivacyCenter = ({ entries = [], aiProcessingEnabled, onClose, onManageMemory, onExport, onToggleAi }) => {
  const analyzed = entries.filter((entry) => entry.analysisStatus === 'complete' || entry.analysis).length;
  const health = entries.filter((entry) => entry.healthContext).length;

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-start justify-between">
          <div>
            <p className="cloud-kicker">AI & PRIVACY</p>
            <h2 id="privacy-title" className="cloud-title text-3xl">Your data, in plain language</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">See what is stored, why it is used, and what you can control.</p>
          </div>
          <button type="button" className="cloud-icon-button" aria-label="Close privacy center" onClick={onClose}><X size={21} /></button>
        </header>

        <section>
          <h3 className="cloud-kicker mb-2">DATA INVENTORY</h3>
          <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
            {[
              { icon: HardDrive, title: 'On this device', detail: 'Unsent entries and recoverable audio are owner-scoped and protected inside the app’s iOS data container.' },
              { icon: Cloud, title: 'In your private cloud account', detail: `${entries.length} journal entries. ${health} include health context you enabled.` },
              { icon: Brain, title: 'Processed for reflection', detail: `${analyzed} entries have AI-assisted organization. Failed analysis is shown as unavailable, never invented.` },
            ].map(({ icon: Icon, title, detail }) => (
              <div key={title} className="flex gap-3 px-4 py-4">
                <Icon className="mt-0.5 shrink-0 text-[var(--accent)]" size={20} />
                <div><p className="font-semibold">{title}</p><p className="mt-0.5 text-sm leading-relaxed text-[var(--muted-foreground)]">{detail}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="cloud-kicker mb-2">CONTROLS</h3>
          <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
            <button type="button" onClick={onManageMemory} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left"><UserRoundCog className="text-[var(--accent)]" size={20} /><span className="flex-1"><strong className="block">People, places & memory</strong><small className="text-[var(--muted-foreground)]">Review and correct what Engram remembers</small></span></button>
            <button type="button" onClick={onExport} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left"><Download className="text-[var(--accent)]" size={20} /><span className="flex-1"><strong className="block">Preview an export</strong><small className="text-[var(--muted-foreground)]">Choose what to share before creating a file</small></span></button>
            <button type="button" onClick={onToggleAi} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left"><Database className="text-[var(--accent)]" size={20} /><span className="flex-1"><strong className="block">{aiProcessingEnabled ? 'Pause AI processing' : 'Enable AI processing'}</strong><small className="text-[var(--muted-foreground)]">{aiProcessingEnabled ? 'Typed entries remain available without analysis' : 'Review the disclosure before AI resumes'}</small></span></button>
          </div>
        </section>

        <div className="flex gap-3 rounded-2xl bg-[var(--accent-wash)] p-4 text-sm text-[var(--secondary-foreground)]">
          <ShieldCheck className="shrink-0 text-[var(--accent-deep)]" size={21} />
          <p>Engram is a private reflection tool—not therapy, a medical device, or a crisis service. Insights describe associations in your data, not causes or diagnoses.</p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyCenter;
