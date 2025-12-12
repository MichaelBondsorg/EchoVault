import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, AlertTriangle, Wind, Heart, Phone, Plus } from 'lucide-react';
import { DEFAULT_SAFETY_PLAN } from '../../config/constants';

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
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl p-4 border border-warm-100 shadow-soft"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-primary-600" />
          <h3 className="font-display font-semibold text-warm-800">{title}</h3>
        </div>
        <motion.button
          onClick={() => setEditingSection(editingSection === section ? null : section)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="text-primary-600 hover:text-primary-700"
        >
          <Plus size={18} />
        </motion.button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-warm-400 italic font-body">No items yet - tap + to add</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-between bg-warm-50 rounded-xl p-2"
            >
              <span className="text-sm text-warm-700 font-body">{renderItem(item)}</span>
              <button onClick={() => removeItem(section, i)} className="text-warm-400 hover:text-red-500">
                <X size={14} />
              </button>
            </motion.div>
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
              className="flex-1 px-3 py-2 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 font-body"
              autoFocus
            />
            <motion.button
              onClick={() => addItem(section)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-3 py-2 bg-primary-600 text-white rounded-xl text-sm font-display font-medium"
            >
              Add
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-warm-50 z-50 overflow-y-auto"
    >
      <div className="sticky top-0 bg-white border-b border-warm-100 p-4 flex items-center justify-between z-10 shadow-soft">
        <div className="flex items-center gap-3">
          <Shield className="text-primary-600" size={24} />
          <h1 className="text-lg font-display font-bold text-warm-900">My Safety Plan</h1>
        </div>
        <motion.button
          onClick={onClose}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="p-2 hover:bg-warm-100 rounded-full"
        >
          <X size={20} />
        </motion.button>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-primary-50 rounded-2xl p-4 border border-primary-100"
        >
          <p className="text-sm text-primary-800 font-body">
            Your safety plan is here for difficult moments. Customize it during calm times so it's ready when you need it.
          </p>
        </motion.div>

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

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-4 border border-warm-100 shadow-soft"
        >
          <div className="flex items-center gap-2 mb-3">
            <Phone size={18} className="text-red-600" />
            <h3 className="font-display font-semibold text-warm-800">Crisis Lines (Always Available)</h3>
          </div>
          <div className="space-y-2">
            {(plan.professionalContacts || DEFAULT_SAFETY_PLAN.professionalContacts).map((contact, i) => (
              <a
                key={i}
                href={contact.phone.length <= 3 ? `tel:${contact.phone}` : `sms:${contact.phone}`}
                className="flex items-center justify-between bg-red-50 rounded-xl p-3 hover:bg-red-100 transition-colors"
              >
                <span className="text-sm font-medium text-red-800 font-body">{contact.name}</span>
                <span className="text-sm text-red-600">{contact.phone}</span>
              </a>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default SafetyPlanScreen;
