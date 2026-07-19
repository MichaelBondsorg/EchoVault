import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, AlertTriangle, Wind, Heart, Phone, Plus } from 'lucide-react';
import { DEFAULT_SAFETY_PLAN } from '../../config/constants';
import { Card, Button, LinenWaveBackground } from '../cloud';

/**
 * SafetyPlanScreen — restyle only (Task D3). CLOUD-DESIGN-SPEC.md §7 does
 * not carry an explicit prose bullet for this screen (only "Crisis
 * resources" is quoted); the mockup (7f) is a simplified illustration
 * (3 groups, no add/remove chrome) of the same underlying screen this
 * component already implements. Per "spec-silent copy stays as-is," no
 * copy in this file was changed from the original — only tokens/layout.
 *
 * Behavior is unchanged: props (plan, onUpdate, onClose); `addItem`/
 * `removeItem` logic is byte-identical; every onClick handler
 * (edit-section toggle, add, remove, close) is unchanged; the
 * `professionalContacts` fallback and the `contact.phone.length <= 3 ?
 * tel: : sms:` link-target logic are unchanged.
 *
 * The "Crisis Lines (Always Available)" card previously used red styling
 * (bg-red-50, text-red-600/800) for the same 988/Crisis-Text-Line numbers
 * shown calmly on CrisisResourcesScreen. Per the safety-critical "never
 * red/alarming" rule, it's now the same accent-deep filled treatment as
 * that screen's 988 card (flip-polarity `text-background`), not red.
 */
const SafetyPlanScreen = ({ plan, onUpdate, onClose }) => {
  const [editingSection, setEditingSection] = useState(null);
  const [newItem, setNewItem] = useState('');

  const addItem = (section) => {
    if (!newItem.trim()) return;
    const updated = { ...plan };
    if (section === 'copingStrategies') {
      updated[section] = [...(updated[section] || []), { activity: newItem, notes: '' }];
    } else if (section === 'supportContacts') {
      updated[section] = [...(updated[section] || []), { name: newItem, phone: '', relationship: '' }];
    } else {
      updated[section] = [...(updated[section] || []), newItem];
    }
    onUpdate(updated);
    setNewItem('');
    setEditingSection(null);
  };

  const removeItem = (section, index) => {
    const updated = { ...plan };
    updated[section] = updated[section].filter((_, i) => i !== index);
    onUpdate(updated);
  };

  const SectionCard = ({ title, icon: Icon, section, items, renderItem }) => (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-accent-deep" aria-hidden="true" />
          <h3 className="font-display font-semibold text-foreground">{title}</h3>
        </div>
        <button
          type="button"
          onClick={() => setEditingSection(editingSection === section ? null : section)}
          aria-label={`Add to ${title}`}
          className="cloud-icon-button text-accent-deep"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">No items yet - tap + to add</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded-xl bg-divider py-1 pl-3 pr-1"
            >
              <span className="text-sm text-secondary-foreground">{renderItem(item)}</span>
              <button
                type="button"
                onClick={() => removeItem(section, i)}
                aria-label="Remove item"
                className="cloud-icon-button text-faint hover:text-foreground"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {editingSection === section && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 flex gap-2"
          >
            <input
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add new item..."
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
              autoFocus
            />
            <Button onClick={() => addItem(section)} className="px-4">
              Add
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
    >
      <LinenWaveBackground />

      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Shield className="text-accent-deep" size={24} aria-hidden="true" />
          <h1 className="font-display text-lg font-bold text-foreground">My Safety Plan</h1>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close safety plan"
          className="cloud-icon-button"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="relative z-10 mx-auto max-w-md space-y-4 p-4 pb-20">
        <Card className="border-accent-wash bg-accent-wash p-4">
          <p className="text-sm text-accent-deep">
            Your safety plan is here for difficult moments. Customize it during calm times so it's ready when you need it.
          </p>
        </Card>

        <SectionCard
          title="Warning Signs"
          icon={AlertTriangle}
          section="warningSignsPersonal"
          items={plan.warningSignsPersonal || []}
          renderItem={(item) => item}
        />

        <SectionCard
          title="Coping Strategies"
          icon={Wind}
          section="copingStrategies"
          items={plan.copingStrategies || []}
          renderItem={(item) => item.activity}
        />

        <SectionCard
          title="Reasons for Living"
          icon={Heart}
          section="reasonsForLiving"
          items={plan.reasonsForLiving || []}
          renderItem={(item) => item}
        />

        <SectionCard
          title="Support Contacts"
          icon={Phone}
          section="supportContacts"
          items={plan.supportContacts || []}
          renderItem={(item) => item.name}
        />

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Phone size={18} className="text-accent-deep" aria-hidden="true" />
            <h3 className="font-display font-semibold text-foreground">Crisis Lines (Always Available)</h3>
          </div>
          <div className="space-y-2">
            {(plan.professionalContacts || DEFAULT_SAFETY_PLAN.professionalContacts).map((contact, i) => (
              <a
                key={i}
                href={contact.phone.length <= 3 ? `tel:${contact.phone}` : `sms:${contact.phone}`}
                className="flex min-h-[44px] items-center justify-between rounded-xl bg-accent-deep p-3 transition-opacity hover:opacity-90"
              >
                <span className="text-sm font-medium text-background">{contact.name}</span>
                <span className="text-sm text-background">{contact.phone}</span>
              </a>
            ))}
          </div>
        </Card>
      </div>
    </motion.div>
  );
};

export default SafetyPlanScreen;
