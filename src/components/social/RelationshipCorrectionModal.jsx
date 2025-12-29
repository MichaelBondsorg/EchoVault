/**
 * Relationship Correction Modal
 *
 * Allows users to manually correct relationship categorization
 * when the heuristics get it wrong (e.g., a "boss" who is also a friend).
 *
 * This is the "Manual Override" safety valve that ensures user preferences
 * always take precedence over algorithmic guesses.
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, Briefcase, Heart, Check, AlertCircle } from 'lucide-react';
import { saveRelationshipCategory } from '../../services/social/relationshipCategorizer';

const CATEGORY_OPTIONS = [
  {
    id: 'personal',
    label: 'Personal',
    description: 'Friend, family, or personal connection',
    icon: Heart,
    color: 'rose'
  },
  {
    id: 'work',
    label: 'Work',
    description: 'Colleague, manager, or professional contact',
    icon: Briefcase,
    color: 'blue'
  },
  {
    id: 'ambiguous',
    label: 'Both / Other',
    description: 'Mixed relationship or doesn\'t fit either category',
    icon: Users,
    color: 'purple'
  }
];

const RelationshipCorrectionModal = ({
  isOpen,
  onClose,
  person,
  currentCategory,
  userId,
  onCategorySaved
}) => {
  const [selectedCategory, setSelectedCategory] = useState(currentCategory || 'ambiguous');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSave = useCallback(async () => {
    if (!person?.name || !userId) return;

    setSaving(true);
    setError(null);

    try {
      const result = await saveRelationshipCategory(userId, person.name, selectedCategory);

      if (result) {
        setSuccess(true);
        onCategorySaved?.(person.name, selectedCategory);

        // Auto-close after success
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setError('Failed to save preference. Please try again.');
      }
    } catch (err) {
      console.error('Failed to save relationship category:', err);
      setError('Something went wrong. Please try again.');
    }

    setSaving(false);
  }, [person, userId, selectedCategory, onCategorySaved, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b border-warm-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-warm-800">
                Correct Categorization
              </h2>
              <p className="text-sm text-warm-500 mt-0.5">
                How should <span className="font-medium capitalize">{person?.name}</span> be categorized?
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-warm-100 rounded-full transition-colors"
            >
              <X size={20} className="text-warm-500" />
            </button>
          </div>

          {/* Current Detection */}
          {currentCategory && currentCategory !== 'ambiguous' && (
            <div className="px-4 py-3 bg-warm-50 border-b border-warm-100">
              <div className="flex items-center gap-2 text-sm text-warm-600">
                <AlertCircle size={16} />
                <span>
                  Currently detected as <span className="font-medium">{currentCategory}</span>
                </span>
              </div>
            </div>
          )}

          {/* Category Options */}
          <div className="p-4 space-y-2">
            {CATEGORY_OPTIONS.map(option => {
              const IconComponent = option.icon;
              const isSelected = selectedCategory === option.id;

              return (
                <button
                  key={option.id}
                  onClick={() => setSelectedCategory(option.id)}
                  className={`w-full p-4 rounded-xl border-2 transition-all flex items-start gap-3 text-left ${
                    isSelected
                      ? option.color === 'rose'
                        ? 'border-rose-300 bg-rose-50'
                        : option.color === 'blue'
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-purple-300 bg-purple-50'
                      : 'border-warm-200 hover:border-warm-300 bg-white'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isSelected
                      ? option.color === 'rose'
                        ? 'bg-rose-200 text-rose-600'
                        : option.color === 'blue'
                          ? 'bg-blue-200 text-blue-600'
                          : 'bg-purple-200 text-purple-600'
                      : 'bg-warm-100 text-warm-500'
                  }`}>
                    <IconComponent size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-warm-800 flex items-center gap-2">
                      {option.label}
                      {isSelected && (
                        <Check size={16} className={
                          option.color === 'rose'
                            ? 'text-rose-500'
                            : option.color === 'blue'
                              ? 'text-blue-500'
                              : 'text-purple-500'
                        } />
                      )}
                    </div>
                    <p className="text-sm text-warm-500 mt-0.5">
                      {option.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Error State */}
          {error && (
            <div className="px-4 pb-2">
              <div className="p-3 bg-red-50 rounded-lg text-sm text-red-600 flex items-center gap-2">
                <AlertCircle size={16} />
                {error}
              </div>
            </div>
          )}

          {/* Success State */}
          {success && (
            <div className="px-4 pb-2">
              <div className="p-3 bg-green-50 rounded-lg text-sm text-green-600 flex items-center gap-2">
                <Check size={16} />
                Preference saved! This will apply to future analyses.
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="p-4 border-t border-warm-100 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-warm-100 hover:bg-warm-200 text-warm-700 rounded-xl font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || success}
              className={`flex-1 py-3 px-4 rounded-xl font-medium transition-colors ${
                saving || success
                  ? 'bg-warm-200 text-warm-400 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {saving ? 'Saving...' : success ? 'Saved!' : 'Save Preference'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/**
 * Inline Correction Button
 *
 * Small button that appears next to person names to allow quick correction
 */
export const RelationshipCorrectionButton = ({
  person,
  currentCategory,
  onCorrectionClick
}) => {
  return (
    <button
      onClick={() => onCorrectionClick?.(person)}
      className="text-xs text-warm-400 hover:text-warm-600 underline"
      title="Correct categorization"
    >
      Not right?
    </button>
  );
};

export default RelationshipCorrectionModal;
