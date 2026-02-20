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
          className="bg-white dark:bg-hearth-900 rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b border-warm-100 dark:border-warm-800 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-warm-800 dark:text-warm-200">
                Correct Categorization
              </h2>
              <p className="text-sm text-warm-500 dark:text-warm-400 mt-0.5">
                How should <span className="font-medium capitalize">{person?.name}</span> be categorized?
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full transition-colors"
            >
              <X size={20} className="text-warm-500 dark:text-warm-400" />
            </button>
          </div>

          {/* Current Detection */}
          {currentCategory && currentCategory !== 'ambiguous' && (
            <div className="px-4 py-3 bg-warm-50 dark:bg-warm-900/30 border-b border-warm-100 dark:border-warm-800">
              <div className="flex items-center gap-2 text-sm text-warm-600 dark:text-warm-400">
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
                        ? 'border-terra-300 bg-terra-50 dark:border-terra-700 dark:bg-terra-900/30'
                        : option.color === 'blue'
                          ? 'border-lavender-300 bg-lavender-50 dark:border-lavender-700 dark:bg-lavender-900/30'
                          : 'border-honey-300 bg-honey-50 dark:border-honey-700 dark:bg-honey-900/30'
                      : 'border-warm-200 hover:border-warm-300 bg-white dark:border-warm-700 dark:hover:border-warm-600 dark:bg-hearth-850'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isSelected
                      ? option.color === 'rose'
                        ? 'bg-terra-200 text-terra-600 dark:bg-terra-800/50 dark:text-terra-400'
                        : option.color === 'blue'
                          ? 'bg-lavender-200 text-lavender-600 dark:bg-lavender-800/50 dark:text-lavender-400'
                          : 'bg-honey-200 text-honey-600 dark:bg-honey-800/50 dark:text-honey-400'
                      : 'bg-warm-100 text-warm-500 dark:bg-warm-800 dark:text-warm-400'
                  }`}>
                    <IconComponent size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-warm-800 dark:text-warm-200 flex items-center gap-2">
                      {option.label}
                      {isSelected && (
                        <Check size={16} className={
                          option.color === 'rose'
                            ? 'text-terra-500 dark:text-terra-400'
                            : option.color === 'blue'
                              ? 'text-lavender-500 dark:text-lavender-400'
                              : 'text-honey-500 dark:text-honey-400'
                        } />
                      )}
                    </div>
                    <p className="text-sm text-warm-500 dark:text-warm-400 mt-0.5">
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
              <div className="p-3 bg-red-50 dark:bg-red-900/30 rounded-lg text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle size={16} />
                {error}
              </div>
            </div>
          )}

          {/* Success State */}
          {success && (
            <div className="px-4 pb-2">
              <div className="p-3 bg-sage-50 dark:bg-sage-900/30 rounded-lg text-sm text-sage-600 dark:text-sage-400 flex items-center gap-2">
                <Check size={16} />
                Preference saved! This will apply to future analyses.
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="p-4 border-t border-warm-100 dark:border-warm-800 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-warm-100 hover:bg-warm-200 text-warm-700 dark:bg-warm-800 dark:hover:bg-warm-700 dark:text-warm-300 rounded-xl font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || success}
              className={`flex-1 py-3 px-4 rounded-xl font-medium transition-colors ${
                saving || success
                  ? 'bg-warm-200 text-warm-400 dark:bg-warm-800 dark:text-warm-500 cursor-not-allowed'
                  : 'bg-lavender-500 hover:bg-lavender-600 text-white dark:bg-lavender-600 dark:hover:bg-lavender-500'
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
      className="text-xs text-warm-400 hover:text-warm-600 dark:text-warm-500 dark:hover:text-warm-300 underline"
      title="Correct categorization"
    >
      Not right?
    </button>
  );
};

export default RelationshipCorrectionModal;
