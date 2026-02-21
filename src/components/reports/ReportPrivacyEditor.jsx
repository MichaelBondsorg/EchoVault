import React, { useState, useMemo } from 'react';
import { ArrowLeft, Shield } from 'lucide-react';

export default function ReportPrivacyEditor({ report, privacy, onSave, onClose }) {
  const [hiddenSections, setHiddenSections] = useState(
    () => new Set(privacy?.hiddenSections || [])
  );
  const [anonymizedEntities, setAnonymizedEntities] = useState(
    () => new Set(privacy?.anonymizedEntities || [])
  );

  const allEntities = useMemo(() => {
    const entities = new Set();
    (report?.sections || []).forEach(s => {
      (s.entities || []).forEach(e => entities.add(e));
    });
    return [...entities];
  }, [report]);

  const toggleSection = (sectionId) => {
    setHiddenSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const toggleEntity = (entity) => {
    setAnonymizedEntities(prev => {
      const next = new Set(prev);
      if (next.has(entity)) next.delete(entity);
      else next.add(entity);
      return next;
    });
  };

  const handleSave = () => {
    onSave({
      hiddenSections: [...hiddenSections],
      anonymizedEntities: [...anonymizedEntities],
    });
  };

  return (
    <div className="fixed inset-0 z-[70] bg-white dark:bg-warm-900 overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onClose} className="p-2 rounded-full hover:bg-warm-100 transition-colors">
            <ArrowLeft size={20} className="text-warm-600" />
          </button>
          <Shield size={20} className="text-lavender-500 dark:text-lavender-400" />
          <h2 className="text-lg font-display font-semibold text-warm-900 dark:text-warm-50">
            Privacy Settings
          </h2>
        </div>

        {/* Section toggles */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-warm-700 dark:text-warm-200 mb-3">
            Include Sections
          </h3>
          <div className="space-y-2">
            {(report?.sections || []).map(section => {
              const isCrisis = section.id?.includes('crisis') || section.title?.toLowerCase().includes('crisis');
              const isHidden = hiddenSections.has(section.id) || isCrisis;

              return (
                <label
                  key={section.id}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                    isCrisis ? 'bg-warm-50 border-warm-200 opacity-60' : 'border-warm-100 dark:border-warm-700'
                  }`}
                >
                  <span className="text-sm text-warm-700 dark:text-warm-200">{section.title}</span>
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    disabled={isCrisis}
                    onChange={() => !isCrisis && toggleSection(section.id)}
                    className="rounded text-honey-600 focus:ring-honey-500"
                  />
                </label>
              );
            })}
          </div>
          <p className="text-xs text-warm-400 mt-2">
            Crisis-related content is always excluded from exports for your safety.
          </p>
        </div>

        {/* Entity anonymization */}
        {allEntities.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-warm-700 dark:text-warm-200 mb-3">
              Anonymize People & Places
            </h3>
            <div className="space-y-2">
              {allEntities.map(entity => (
                <label
                  key={entity}
                  className="flex items-center justify-between p-3 rounded-xl border border-warm-100 dark:border-warm-700"
                >
                  <span className="text-sm text-warm-700 dark:text-warm-200">{entity}</span>
                  <input
                    type="checkbox"
                    checked={anonymizedEntities.has(entity)}
                    onChange={() => toggleEntity(entity)}
                    className="rounded text-lavender-600 focus:ring-lavender-500 dark:text-lavender-400"
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-warm-400 mt-2">
              Checked names will be replaced with "Person A", "Person B", etc. in exports.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-warm-200 dark:border-warm-700 text-warm-600 dark:text-warm-400 text-sm font-medium hover:bg-warm-50 dark:hover:bg-warm-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-3 rounded-xl bg-honey-600 dark:bg-honey-500 text-white text-sm font-medium hover:bg-honey-700 dark:hover:bg-honey-400 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
