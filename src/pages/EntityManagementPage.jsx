import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Search, Plus, User, PawPrint, MapPin, Package, Activity,
  ChevronDown, ChevronRight, Pencil, MoreVertical, Trash2, Archive, Merge,
  RefreshCw, CheckCircle, AlertCircle, List, GitBranch, HelpCircle, X,
  Sparkles, Link2, Edit3
} from 'lucide-react';
import {
  getAllEntities,
  updateEntity,
  deleteEntity,
  archivePerson,
  createEntity,
  mergeEntities,
  addEntityRelationship,
  removeEntityRelationship,
  ENTITY_TYPES,
  RELATIONSHIP_TYPES
} from '../services/memory/memoryGraph';
import { migrateEntitiesFromEntriesFn } from '../config/firebase';
import EntityEditModal from '../components/settings/EntityEditModal';
import RelationshipGraph from '../components/settings/RelationshipGraph';

/**
 * EntityManagementPage - Manage people, pets, places, and things
 *
 * Features:
 * - View all entities grouped by type
 * - Search/filter entities
 * - Edit entity details (name, type, relationship)
 * - Archive or delete entities
 * - Create new entities manually
 */
const EntityManagementPage = ({ userId, onBack }) => {
  const [entities, setEntities] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState({
    person: true,
    pet: true,
    place: true,
    thing: false,
    activity: false
  });
  const [editingEntity, setEditingEntity] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'graph'
  const [migrationStatus, setMigrationStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [migrationResult, setMigrationResult] = useState(null);
  const [showTips, setShowTips] = useState(() => {
    // Show tips by default unless user has dismissed them
    return localStorage.getItem('entityManagement.tipsDismissed') !== 'true';
  });

  // Dismiss tips and persist
  const dismissTips = () => {
    setShowTips(false);
    localStorage.setItem('entityManagement.tipsDismissed', 'true');
  };

  // Entity type configuration
  const entityConfig = {
    person: { icon: User, label: 'People', color: 'bg-blue-100 text-blue-600' },
    pet: { icon: PawPrint, label: 'Pets', color: 'bg-amber-100 text-amber-600' },
    place: { icon: MapPin, label: 'Places', color: 'bg-green-100 text-green-600' },
    thing: { icon: Package, label: 'Things', color: 'bg-purple-100 text-purple-600' },
    activity: { icon: Activity, label: 'Activities', color: 'bg-pink-100 text-pink-600' }
  };

  // Load entities
  useEffect(() => {
    const loadEntities = async () => {
      try {
        setLoading(true);
        const grouped = await getAllEntities(userId, { excludeArchived: !showArchived });
        setEntities(grouped);
      } catch (error) {
        console.error('[EntityManagement] Failed to load entities:', error);
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      loadEntities();
    }
  }, [userId, showArchived]);

  // Filter entities by search query
  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;

    const query = searchQuery.toLowerCase();
    const filtered = {};

    Object.keys(entities).forEach(type => {
      filtered[type] = entities[type].filter(entity =>
        entity.name?.toLowerCase().includes(query) ||
        entity.aliases?.some(a => a.toLowerCase().includes(query)) ||
        entity.relationship?.toLowerCase().includes(query)
      );
    });

    return filtered;
  }, [entities, searchQuery]);

  // Count total entities
  const totalCount = useMemo(() => {
    return Object.values(entities).reduce((sum, list) => sum + list.length, 0);
  }, [entities]);

  // Toggle section expansion
  const toggleSection = (type) => {
    setExpandedSections(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  // Handle entity update
  const handleUpdateEntity = async (entityId, updates) => {
    try {
      await updateEntity(userId, entityId, updates);
      // Refresh list
      const grouped = await getAllEntities(userId, { excludeArchived: !showArchived });
      setEntities(grouped);
      setEditingEntity(null);
    } catch (error) {
      console.error('[EntityManagement] Failed to update entity:', error);
      alert('Failed to save changes. Please try again.');
    }
  };

  // Handle entity delete
  const handleDeleteEntity = async (entityId) => {
    if (!confirm('Are you sure you want to permanently delete this? This cannot be undone.')) {
      return;
    }

    try {
      await deleteEntity(userId, entityId);
      const grouped = await getAllEntities(userId, { excludeArchived: !showArchived });
      setEntities(grouped);
      setEditingEntity(null);
    } catch (error) {
      console.error('[EntityManagement] Failed to delete entity:', error);
      alert('Failed to delete. Please try again.');
    }
  };

  // Handle entity archive
  const handleArchiveEntity = async (entityId) => {
    try {
      await archivePerson(userId, entityId);
      const grouped = await getAllEntities(userId, { excludeArchived: !showArchived });
      setEntities(grouped);
      setEditingEntity(null);
    } catch (error) {
      console.error('[EntityManagement] Failed to archive entity:', error);
      alert('Failed to archive. Please try again.');
    }
  };

  // Handle create entity
  const handleCreateEntity = async (entityData) => {
    try {
      await createEntity(userId, entityData);
      const grouped = await getAllEntities(userId, { excludeArchived: !showArchived });
      setEntities(grouped);
      setShowCreateModal(false);
    } catch (error) {
      console.error('[EntityManagement] Failed to create entity:', error);
      alert('Failed to create. Please try again.');
    }
  };

  // Handle adding entity relationship
  const handleAddRelationship = async (sourceEntityId, targetEntityId, relationshipType) => {
    try {
      await addEntityRelationship(userId, sourceEntityId, targetEntityId, relationshipType);
      // Refresh entities and update editingEntity
      const grouped = await getAllEntities(userId, { excludeArchived: !showArchived });
      setEntities(grouped);

      // Update the editing entity with fresh data
      const flatEntities = Object.values(grouped).flat();
      const updatedEntity = flatEntities.find(e => e.id === sourceEntityId);
      if (updatedEntity) {
        setEditingEntity(updatedEntity);
      }
    } catch (error) {
      console.error('[EntityManagement] Failed to add relationship:', error);
      alert('Failed to add connection. Please try again.');
    }
  };

  // Handle removing entity relationship
  const handleRemoveRelationship = async (sourceEntityId, targetEntityId, relationshipType) => {
    try {
      await removeEntityRelationship(userId, sourceEntityId, targetEntityId, relationshipType);
      // Refresh entities and update editingEntity
      const grouped = await getAllEntities(userId, { excludeArchived: !showArchived });
      setEntities(grouped);

      // Update the editing entity with fresh data
      const flatEntities = Object.values(grouped).flat();
      const updatedEntity = flatEntities.find(e => e.id === sourceEntityId);
      if (updatedEntity) {
        setEditingEntity(updatedEntity);
      }
    } catch (error) {
      console.error('[EntityManagement] Failed to remove relationship:', error);
      alert('Failed to remove connection. Please try again.');
    }
  };

  // Handle migration from existing entries
  const handleMigrateEntities = async () => {
    setMigrationStatus('loading');
    setMigrationResult(null);

    try {
      const result = await migrateEntitiesFromEntriesFn({ dryRun: false, limit: 300 });
      setMigrationResult(result.data);
      setMigrationStatus('success');

      // Refresh entity list
      const grouped = await getAllEntities(userId, { excludeArchived: !showArchived });
      setEntities(grouped);
    } catch (error) {
      console.error('[EntityManagement] Migration failed:', error);
      setMigrationStatus('error');
      setMigrationResult({ error: error.message });
    }
  };

  // Format relationship for display
  const formatRelationship = (relationship) => {
    if (!relationship) return 'Unknown';
    return relationship.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <motion.div
      className="min-h-screen bg-gradient-to-b from-primary-50 to-accent-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-white/20">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-xl hover:bg-white/50 transition-colors"
          >
            <ArrowLeft size={24} className="text-warm-600" />
          </button>
          <div className="flex-1">
            <h1 className="font-display font-bold text-lg text-warm-800">
              People & Things
            </h1>
            <p className="text-xs text-warm-500">
              {totalCount} {totalCount === 1 ? 'entity' : 'entities'}
            </p>
          </div>
          {/* View mode toggle */}
          <div className="flex rounded-xl bg-warm-100 p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'list'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-warm-500 hover:text-warm-700'
              }`}
              title="List view"
            >
              <List size={18} />
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'graph'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-warm-500 hover:text-warm-700'
              }`}
              title="Graph view"
            >
              <GitBranch size={18} />
            </button>
          </div>
          {!showTips && (
            <button
              onClick={() => setShowTips(true)}
              className="p-2 rounded-xl hover:bg-warm-100 transition-colors"
              title="Show tips"
            >
              <HelpCircle size={20} className="text-warm-400" />
            </button>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-2 rounded-xl bg-primary-100 hover:bg-primary-200 transition-colors"
          >
            <Plus size={20} className="text-primary-600" />
          </button>
        </div>

        {/* Search bar - only show in list view */}
        {viewMode === 'list' && (
          <div className="px-4 pb-3">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
              <input
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/50 border border-white/30 rounded-xl
                  text-warm-700 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
            </div>
          </div>
        )}

        {/* Show archived toggle - only in list view */}
        {viewMode === 'list' && (
          <div className="px-4 pb-3">
            <label className="flex items-center gap-2 text-sm text-warm-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-warm-300 text-primary-600 focus:ring-primary-500"
              />
              Show archived
            </label>
          </div>
        )}
      </div>

      {/* Tips Banner */}
      <AnimatePresence>
        {showTips && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-4 mb-4"
          >
            <div className="bg-gradient-to-r from-primary-50 to-accent-50 rounded-2xl border border-primary-200 p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={16} className="text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="font-medium text-warm-800">Welcome to People & Things</h3>
                    <button
                      onClick={dismissTips}
                      className="p-1 rounded-lg hover:bg-white/50 text-warm-400 hover:text-warm-600"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="space-y-2 text-sm text-warm-600">
                    <div className="flex items-start gap-2">
                      <Edit3 size={14} className="text-primary-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Edit entities</strong> to fix names, change types (person/pet/place), and add notes</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Link2 size={14} className="text-primary-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Connect entities</strong> to show relationships (e.g., Luna is Spencer's pet)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <GitBranch size={14} className="text-primary-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Graph view</strong> visualizes how your people, pets, and places are connected</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : viewMode === 'graph' ? (
          /* Graph View */
          <RelationshipGraph
            entities={entities}
            onEditEntity={setEditingEntity}
          />
        ) : (
          /* List View */
          <>
          {ENTITY_TYPES.map(type => {
            const config = entityConfig[type];
            const typeEntities = filteredEntities[type] || [];
            const isExpanded = expandedSections[type];
            const Icon = config.icon;

            if (typeEntities.length === 0 && !searchQuery) return null;

            return (
              <div key={type} className="bg-white/40 backdrop-blur-sm rounded-2xl overflow-hidden border border-white/30">
                {/* Section header */}
                <button
                  onClick={() => toggleSection(type)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/30 transition-colors"
                >
                  <div className={`w-8 h-8 rounded-lg ${config.color} flex items-center justify-center`}>
                    <Icon size={16} />
                  </div>
                  <span className="font-medium text-warm-700 flex-1 text-left">
                    {config.label}
                  </span>
                  <span className="text-sm text-warm-500 mr-2">
                    {typeEntities.length}
                  </span>
                  {isExpanded ? (
                    <ChevronDown size={20} className="text-warm-400" />
                  ) : (
                    <ChevronRight size={20} className="text-warm-400" />
                  )}
                </button>

                {/* Entity list */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {typeEntities.length === 0 ? (
                        <div className="px-4 py-6 text-center text-warm-400 text-sm">
                          No {config.label.toLowerCase()} found
                        </div>
                      ) : (
                        <div className="border-t border-white/20">
                          {typeEntities.map((entity, index) => (
                            <motion.div
                              key={entity.id}
                              className={`
                                px-4 py-3 flex items-center gap-3
                                ${index !== typeEntities.length - 1 ? 'border-b border-white/10' : ''}
                                ${entity.status === 'archived' ? 'opacity-50' : ''}
                              `}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.03 }}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-warm-700 truncate">
                                    {entity.name}
                                  </span>
                                  {entity.userCorrected && (
                                    <span className="px-1.5 py-0.5 bg-primary-100 text-primary-600 text-[10px] font-bold rounded">
                                      Edited
                                    </span>
                                  )}
                                  {entity.status === 'archived' && (
                                    <span className="px-1.5 py-0.5 bg-warm-200 text-warm-600 text-[10px] font-bold rounded">
                                      Archived
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-warm-500 truncate">
                                  {formatRelationship(entity.relationship)}
                                  {entity.aliases?.length > 0 && (
                                    <span className="text-warm-400">
                                      {' '}(aka {entity.aliases.slice(0, 2).join(', ')})
                                    </span>
                                  )}
                                </p>
                              </div>
                              <button
                                onClick={() => setEditingEntity(entity)}
                                className="p-2 rounded-lg hover:bg-white/50 transition-colors"
                              >
                                <Pencil size={16} className="text-warm-500" />
                              </button>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* Empty state */}
          {!loading && totalCount === 0 && (
          <div className="py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-warm-100 rounded-full flex items-center justify-center">
              <User size={28} className="text-warm-400" />
            </div>
            <h3 className="font-medium text-warm-700 mb-2">No entities yet</h3>
            <p className="text-sm text-warm-500 mb-4 max-w-xs mx-auto">
              People, pets, and places from your journal entries will appear here.
              Import from existing entries or add manually.
            </p>

            {/* Migration status */}
            {migrationStatus === 'success' && migrationResult && (
              <div className="mb-4 mx-auto max-w-xs p-3 bg-green-50 border border-green-200 rounded-xl text-sm">
                <div className="flex items-center gap-2 text-green-700 mb-1">
                  <CheckCircle size={16} />
                  <span className="font-medium">Migration complete!</span>
                </div>
                <p className="text-green-600">
                  Created {migrationResult.entitiesCreated} entities from {migrationResult.entriesProcessed} entries.
                </p>
              </div>
            )}

            {migrationStatus === 'error' && (
              <div className="mb-4 mx-auto max-w-xs p-3 bg-red-50 border border-red-200 rounded-xl text-sm">
                <div className="flex items-center gap-2 text-red-700 mb-1">
                  <AlertCircle size={16} />
                  <span className="font-medium">Migration failed</span>
                </div>
                <p className="text-red-600">
                  {migrationResult?.error || 'Please try again.'}
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3 items-center">
              <button
                onClick={handleMigrateEntities}
                disabled={migrationStatus === 'loading'}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700
                  transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {migrationStatus === 'loading' ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    Scanning entries...
                  </>
                ) : (
                  <>
                    <RefreshCw size={18} />
                    Import from journal
                  </>
                )}
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 text-warm-600 hover:text-warm-800 transition-colors"
              >
                Or add manually
              </button>
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingEntity && (
          <EntityEditModal
            entity={editingEntity}
            allEntities={entities}
            onSave={handleUpdateEntity}
            onDelete={handleDeleteEntity}
            onArchive={handleArchiveEntity}
            onAddRelationship={handleAddRelationship}
            onRemoveRelationship={handleRemoveRelationship}
            onClose={() => setEditingEntity(null)}
          />
        )}
      </AnimatePresence>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <EntityEditModal
            entity={null}
            allEntities={entities}
            onSave={(_, data) => handleCreateEntity(data)}
            onClose={() => setShowCreateModal(false)}
            isCreating
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default EntityManagementPage;
