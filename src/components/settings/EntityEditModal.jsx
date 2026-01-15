import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Trash2, Archive, Save, Plus, AlertTriangle, Link2, ChevronDown,
  User, PawPrint, MapPin, Package, Activity
} from 'lucide-react';
import {
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  ENTITY_LINK_TYPES,
  getValidLinkTypesForEntity
} from '../../services/memory/memoryGraph';

/**
 * EntityEditModal - Edit or create an entity
 *
 * Fields:
 * - Name
 * - Aliases (multiple)
 * - Entity type (person/pet/place/thing/activity)
 * - Relationship to user
 * - Notes (optional)
 */
const EntityEditModal = ({
  entity,
  allEntities = [],
  onSave,
  onDelete,
  onArchive,
  onAddRelationship,
  onRemoveRelationship,
  onClose,
  isCreating = false
}) => {
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState([]);
  const [newAlias, setNewAlias] = useState('');
  const [entityType, setEntityType] = useState('person');
  const [relationship, setRelationship] = useState('unknown');
  const [notes, setNotes] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Relationship linking state
  const [showRelationshipPicker, setShowRelationshipPicker] = useState(false);
  const [selectedTargetEntity, setSelectedTargetEntity] = useState('');
  const [selectedLinkType, setSelectedLinkType] = useState('');
  const [addingRelationship, setAddingRelationship] = useState(false);

  // Entity type icons
  const typeIcons = {
    person: User,
    pet: PawPrint,
    place: MapPin,
    thing: Package,
    activity: Activity
  };

  // Initialize form with entity data
  useEffect(() => {
    if (entity) {
      setName(entity.name || '');
      setAliases(entity.aliases || []);
      setEntityType(entity.entityType || 'person');
      setRelationship(entity.relationship || 'unknown');
      setNotes(entity.notes || '');
    } else {
      // Reset for create mode
      setName('');
      setAliases([]);
      setEntityType('person');
      setRelationship('unknown');
      setNotes('');
    }
  }, [entity]);

  // Get available relationships for selected type
  const availableRelationships = RELATIONSHIP_TYPES[entityType] || ['unknown'];

  // When entity type changes, reset relationship if invalid
  useEffect(() => {
    if (!availableRelationships.includes(relationship)) {
      setRelationship(availableRelationships[0] || 'unknown');
    }
  }, [entityType, availableRelationships, relationship]);

  // Get current entity relationships
  const currentRelationships = entity?.relationships || [];

  // Get valid link types for the current entity type
  const validLinkTypes = useMemo(() => {
    return getValidLinkTypesForEntity(entityType);
  }, [entityType]);

  // Get available target entities (exclude self and already-linked entities for this relationship type)
  const availableTargetEntities = useMemo(() => {
    if (!entity?.id) return [];

    // Flatten all entities
    const flatEntities = Object.values(allEntities).flat();

    // Exclude self
    return flatEntities.filter(e => {
      if (e.id === entity.id) return false;
      // Could also filter out already-linked for this specific type if desired
      return true;
    });
  }, [allEntities, entity?.id]);

  // Reset picker when hidden
  useEffect(() => {
    if (!showRelationshipPicker) {
      setSelectedTargetEntity('');
      setSelectedLinkType('');
    }
  }, [showRelationshipPicker]);

  // Handle adding a relationship
  const handleAddRelationship = async () => {
    if (!selectedTargetEntity || !selectedLinkType || !onAddRelationship) return;

    setAddingRelationship(true);
    try {
      await onAddRelationship(entity.id, selectedTargetEntity, selectedLinkType);
      setShowRelationshipPicker(false);
    } catch (error) {
      console.error('[EntityEditModal] Failed to add relationship:', error);
    } finally {
      setAddingRelationship(false);
    }
  };

  // Handle removing a relationship
  const handleRemoveRelationship = async (targetEntityId, relationshipType) => {
    if (!onRemoveRelationship) return;

    try {
      await onRemoveRelationship(entity.id, targetEntityId, relationshipType);
    } catch (error) {
      console.error('[EntityEditModal] Failed to remove relationship:', error);
    }
  };

  // Add alias
  const handleAddAlias = () => {
    const trimmed = newAlias.trim();
    if (trimmed && !aliases.includes(trimmed) && trimmed !== name) {
      setAliases([...aliases, trimmed]);
      setNewAlias('');
    }
  };

  // Remove alias
  const handleRemoveAlias = (alias) => {
    setAliases(aliases.filter(a => a !== alias));
  };

  // Save changes
  const handleSave = async () => {
    if (!name.trim()) {
      alert('Name is required');
      return;
    }

    setSaving(true);
    try {
      const updates = {
        name: name.trim(),
        aliases,
        entityType,
        relationship,
        notes: notes.trim() || null
      };

      await onSave(entity?.id, updates);
    } catch (error) {
      console.error('[EntityEditModal] Save failed:', error);
    } finally {
      setSaving(false);
    }
  };

  // Format label for display
  const formatLabel = (str) => {
    if (!str) return '';
    return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const TypeIcon = typeIcons[entityType] || User;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      {/* Modal */}
      <motion.div
        className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-hidden"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-warm-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
            <TypeIcon size={20} className="text-primary-600" />
          </div>
          <div className="flex-1">
            <h2 className="font-display font-bold text-lg text-warm-800">
              {isCreating ? 'Add New' : 'Edit'} {formatLabel(entityType)}
            </h2>
            {entity?.mentionCount > 0 && (
              <p className="text-xs text-warm-500">
                Mentioned {entity.mentionCount} time{entity.mentionCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-xl hover:bg-warm-100 transition-colors"
          >
            <X size={20} className="text-warm-500" />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-5 overflow-y-auto max-h-[60vh]">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name..."
              className="w-full px-4 py-2.5 bg-warm-50 border border-warm-200 rounded-xl
                text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>

          {/* Aliases */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1.5">
              Also known as
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {aliases.map((alias) => (
                <span
                  key={alias}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-warm-100 text-warm-700 rounded-lg text-sm"
                >
                  {alias}
                  <button
                    onClick={() => handleRemoveAlias(alias)}
                    className="p-0.5 hover:bg-warm-200 rounded"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                placeholder="Add alias..."
                className="flex-1 px-4 py-2 bg-warm-50 border border-warm-200 rounded-xl
                  text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
              <button
                onClick={handleAddAlias}
                disabled={!newAlias.trim()}
                className="px-3 py-2 bg-primary-100 text-primary-600 rounded-xl hover:bg-primary-200
                  disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          {/* Entity Type */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1.5">
              Type
            </label>
            <div className="grid grid-cols-5 gap-2">
              {ENTITY_TYPES.map((type) => {
                const Icon = typeIcons[type];
                const isSelected = entityType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setEntityType(type)}
                    className={`
                      flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all
                      ${isSelected
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-warm-200 bg-warm-50 hover:border-warm-300'
                      }
                    `}
                  >
                    <Icon size={20} className={isSelected ? 'text-primary-600' : 'text-warm-500'} />
                    <span className={`text-xs ${isSelected ? 'text-primary-700 font-medium' : 'text-warm-600'}`}>
                      {formatLabel(type)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Relationship */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1.5">
              Relationship
            </label>
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              className="w-full px-4 py-2.5 bg-warm-50 border border-warm-200 rounded-xl
                text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-300"
            >
              {availableRelationships.map((rel) => (
                <option key={rel} value={rel}>
                  {formatLabel(rel)}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context..."
              rows={3}
              className="w-full px-4 py-2.5 bg-warm-50 border border-warm-200 rounded-xl
                text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none"
            />
          </div>

          {/* Entity Relationships (Links to other entities) - Edit mode only */}
          {!isCreating && onAddRelationship && (
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1.5">
                <div className="flex items-center gap-2">
                  <Link2 size={16} />
                  Connected to
                </div>
              </label>

              {/* Current relationships */}
              {currentRelationships.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {currentRelationships.map((rel, idx) => {
                    const linkConfig = ENTITY_LINK_TYPES[rel.relationshipType];
                    return (
                      <div
                        key={`${rel.targetEntityId}-${rel.relationshipType}-${idx}`}
                        className="flex items-center justify-between p-3 bg-warm-50 rounded-xl border border-warm-100"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-warm-500 uppercase tracking-wide">
                            {linkConfig?.label || formatLabel(rel.relationshipType)}
                          </span>
                          <span className="font-medium text-warm-800">
                            {rel.targetEntityName}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveRelationship(rel.targetEntityId, rel.relationshipType)}
                          className="p-1.5 text-warm-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove relationship"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-warm-500 mb-3">
                  No connections yet
                </p>
              )}

              {/* Add relationship button/picker */}
              {!showRelationshipPicker ? (
                <button
                  onClick={() => setShowRelationshipPicker(true)}
                  className="w-full py-2.5 px-4 border-2 border-dashed border-warm-200 text-warm-500
                    rounded-xl hover:border-primary-300 hover:text-primary-600 transition-colors
                    flex items-center justify-center gap-2"
                >
                  <Plus size={18} />
                  Add connection
                </button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="p-4 bg-primary-50 rounded-xl border border-primary-200 space-y-3"
                >
                  {/* Target entity picker */}
                  <div>
                    <label className="block text-xs text-primary-700 mb-1">
                      Connect to
                    </label>
                    <select
                      value={selectedTargetEntity}
                      onChange={(e) => setSelectedTargetEntity(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-primary-200 rounded-lg
                        text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm"
                    >
                      <option value="">Select an entity...</option>
                      {availableTargetEntities.map((e) => {
                        const Icon = typeIcons[e.entityType || 'person'];
                        return (
                          <option key={e.id} value={e.id}>
                            {e.name} ({formatLabel(e.entityType || 'person')})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Relationship type picker */}
                  <div>
                    <label className="block text-xs text-primary-700 mb-1">
                      Relationship type
                    </label>
                    <select
                      value={selectedLinkType}
                      onChange={(e) => setSelectedLinkType(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-primary-200 rounded-lg
                        text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm"
                    >
                      <option value="">Select relationship...</option>
                      {validLinkTypes.map((lt) => (
                        <option key={lt.type} value={lt.type}>
                          {lt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Add/Cancel buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowRelationshipPicker(false)}
                      className="flex-1 py-2 px-3 text-warm-600 hover:bg-white rounded-lg
                        transition-colors text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddRelationship}
                      disabled={!selectedTargetEntity || !selectedLinkType || addingRelationship}
                      className="flex-1 py-2 px-3 bg-primary-600 text-white rounded-lg
                        hover:bg-primary-700 transition-colors text-sm disabled:opacity-50
                        flex items-center justify-center gap-1"
                    >
                      {addingRelationship ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <Link2 size={14} />
                          Connect
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-warm-100 space-y-3">
          {/* Primary actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 px-4 border border-warm-200 text-warm-600 rounded-xl
                hover:bg-warm-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="flex-1 py-2.5 px-4 bg-primary-600 text-white rounded-xl
                hover:bg-primary-700 transition-colors font-medium disabled:opacity-50
                flex items-center justify-center gap-2"
            >
              {saving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Save size={18} />
                  Save
                </>
              )}
            </button>
          </div>

          {/* Destructive actions (edit mode only) */}
          {!isCreating && (
            <div className="flex gap-3">
              {onArchive && entity?.status !== 'archived' && (
                <button
                  onClick={() => onArchive(entity.id)}
                  className="flex-1 py-2 px-4 text-amber-600 hover:bg-amber-50 rounded-xl
                    transition-colors text-sm flex items-center justify-center gap-2"
                >
                  <Archive size={16} />
                  Archive
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex-1 py-2 px-4 text-red-600 hover:bg-red-50 rounded-xl
                    transition-colors text-sm flex items-center justify-center gap-2"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              )}
            </div>
          )}
        </div>

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <motion.div
            className="absolute inset-0 bg-white flex flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle size={32} className="text-red-500" />
              </div>
              <h3 className="font-display font-bold text-xl text-warm-800 mb-2">
                Delete "{name}"?
              </h3>
              <p className="text-warm-600 mb-6">
                This will permanently remove this {formatLabel(entityType).toLowerCase()} and cannot be undone.
              </p>
              <div className="flex gap-3 w-full max-w-xs">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 px-4 border border-warm-200 text-warm-600 rounded-xl
                    hover:bg-warm-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onDelete(entity.id)}
                  className="flex-1 py-2.5 px-4 bg-red-600 text-white rounded-xl
                    hover:bg-red-700 transition-colors font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default EntityEditModal;
