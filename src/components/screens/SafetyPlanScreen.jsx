import React, { useState } from 'react';
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
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-indigo-600" />
          <h3 className="font-semibold text-gray-800">{title}</h3>
        </div>
        <button
          onClick={() => setEditingSection(editingSection === section ? null : section)}
          className="text-indigo-600 hover:text-indigo-800"
        >
          <Plus size={18} />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No items yet - tap + to add</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg p-2">
              <span className="text-sm text-gray-700">{renderItem(item)}</span>
              <button onClick={() => removeItem(section, i)} className="text-gray-400 hover:text-red-500">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {editingSection === section && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Add new item..."
            className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          <button
            onClick={() => addItem(section)}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 overflow-y-auto">
      <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <Shield className="text-indigo-600" size={24} />
          <h1 className="text-lg font-bold text-gray-900">My Safety Plan</h1>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
          <X size={20} />
        </button>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4 pb-20">
        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
          <p className="text-sm text-indigo-800">
            Your safety plan is here for difficult moments. Customize it during calm times so it's ready when you need it.
          </p>
        </div>

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

        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Phone size={18} className="text-red-600" />
            <h3 className="font-semibold text-gray-800">Crisis Lines (Always Available)</h3>
          </div>
          <div className="space-y-2">
            {(plan.professionalContacts || DEFAULT_SAFETY_PLAN.professionalContacts).map((contact, i) => (
              <a
                key={i}
                href={contact.phone.length <= 3 ? `tel:${contact.phone}` : `sms:${contact.phone}`}
                className="flex items-center justify-between bg-red-50 rounded-lg p-3 hover:bg-red-100 transition-colors"
              >
                <span className="text-sm font-medium text-red-800">{contact.name}</span>
                <span className="text-sm text-red-600">{contact.phone}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SafetyPlanScreen;
