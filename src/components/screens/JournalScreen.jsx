import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Search, Calendar, ChevronLeft, ChevronRight,
  Filter, SlidersHorizontal
} from 'lucide-react';
import EntryCard from '../entries/EntryCard';

/**
 * JournalScreen - Full timeline view with date navigation and search
 */
const JournalScreen = ({
  entries,
  category,
  onClose,
  onDelete,
  onUpdate
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Filter entries by category and search
  const filteredEntries = useMemo(() => {
    let filtered = entries.filter(e => e.category === category);

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.text?.toLowerCase().includes(query) ||
        e.title?.toLowerCase().includes(query) ||
        e.tags?.some(t => {
          // Handle both string tags and object tags (legacy data)
          const tagStr = typeof t === 'string' ? t : (t?.text || '');
          return tagStr.toLowerCase().includes(query);
        })
      );
    }

    // Apply date filter - use effectiveDate if available (Phase 2 backdating)
    if (selectedDate) {
      const dateStart = new Date(selectedDate);
      dateStart.setHours(0, 0, 0, 0);
      const dateEnd = new Date(selectedDate);
      dateEnd.setHours(23, 59, 59, 999);

      filtered = filtered.filter(e => {
        // Use effectiveDate if available, otherwise createdAt
        const dateField = e.effectiveDate || e.createdAt;
        const entryDate = dateField instanceof Date
          ? dateField
          : dateField?.toDate?.() || new Date();
        return entryDate >= dateStart && entryDate <= dateEnd;
      });
    }

    return filtered;
  }, [entries, category, searchQuery, selectedDate]);

  // Group entries by date - use effectiveDate if available (Phase 2 backdating)
  const groupedEntries = useMemo(() => {
    const groups = new Map();

    filteredEntries.forEach(entry => {
      // Use effectiveDate if available, otherwise createdAt
      const dateField = entry.effectiveDate || entry.createdAt;
      const entryDate = dateField instanceof Date
        ? dateField
        : dateField?.toDate?.() || new Date();
      const dateKey = entryDate.toDateString();

      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          date: entryDate,
          entries: []
        });
      }
      groups.get(dateKey).entries.push(entry);
    });

    return Array.from(groups.values()).sort((a, b) => b.date - a.date);
  }, [filteredEntries]);

  // Navigate dates
  const navigateDate = (direction) => {
    const current = selectedDate ? new Date(selectedDate) : new Date();
    current.setDate(current.getDate() + direction);
    setSelectedDate(current);
  };

  const formatDateHeader = (date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <motion.div
      className="fixed inset-0 bg-warm-50 z-50 overflow-hidden flex flex-col"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
    >
      {/* Header */}
      <div className="bg-white border-b border-warm-200 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between mb-4">
          <motion.button
            onClick={onClose}
            className="p-2 -ml-2 text-warm-500 hover:text-warm-700 hover:bg-warm-100 rounded-full"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <X size={24} />
          </motion.button>
          <h1 className="text-lg font-display font-bold text-warm-800">Journal</h1>
          <div className="w-10" /> {/* Spacer for alignment */}
        </div>

        {/* Search Bar */}
        <div className="relative mb-3">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entries..."
            className="w-full pl-10 pr-4 py-2.5 bg-warm-100 rounded-xl text-sm font-body text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-honey-500"
          />
        </div>

        {/* Date Navigation */}
        <div className="flex items-center justify-between">
          <motion.button
            onClick={() => navigateDate(-1)}
            className="p-2 text-warm-500 hover:text-warm-700 hover:bg-warm-100 rounded-full"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ChevronLeft size={20} />
          </motion.button>

          <motion.button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-warm-700 hover:bg-warm-100 rounded-lg"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Calendar size={16} />
            {selectedDate
              ? selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'All Dates'
            }
          </motion.button>

          <motion.button
            onClick={() => navigateDate(1)}
            className="p-2 text-warm-500 hover:text-warm-700 hover:bg-warm-100 rounded-full"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ChevronRight size={20} />
          </motion.button>
        </div>

        {/* Date Picker (Simple) */}
        <AnimatePresence>
          {showDatePicker && (
            <motion.div
              className="mt-3 flex gap-2 flex-wrap"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <button
                onClick={() => { setSelectedDate(null); setShowDatePicker(false); }}
                className={`px-3 py-1 text-xs rounded-full ${!selectedDate ? 'bg-honey-600 text-white' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'}`}
              >
                All
              </button>
              <button
                onClick={() => { setSelectedDate(new Date()); setShowDatePicker(false); }}
                className="px-3 py-1 text-xs rounded-full bg-warm-100 text-warm-600 hover:bg-warm-200"
              >
                Today
              </button>
              <button
                onClick={() => {
                  const yesterday = new Date();
                  yesterday.setDate(yesterday.getDate() - 1);
                  setSelectedDate(yesterday);
                  setShowDatePicker(false);
                }}
                className="px-3 py-1 text-xs rounded-full bg-warm-100 text-warm-600 hover:bg-warm-200"
              >
                Yesterday
              </button>
              <button
                onClick={() => {
                  const weekAgo = new Date();
                  weekAgo.setDate(weekAgo.getDate() - 7);
                  setSelectedDate(weekAgo);
                  setShowDatePicker(false);
                }}
                className="px-3 py-1 text-xs rounded-full bg-warm-100 text-warm-600 hover:bg-warm-200"
              >
                Last Week
              </button>
              <input
                type="date"
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedDate(new Date(e.target.value + 'T00:00:00'));
                    setShowDatePicker(false);
                  }
                }}
                className="px-3 py-1 text-xs rounded-full bg-warm-100 text-warm-600 border-none"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active Filters */}
        {(searchQuery || selectedDate) && (
          <div className="mt-3 flex gap-2 flex-wrap">
            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-honey-100 text-honey-700 rounded-full text-xs">
                Search: "{searchQuery}"
                <button onClick={() => setSearchQuery('')} className="hover:text-honey-900">
                  <X size={12} />
                </button>
              </span>
            )}
            {selectedDate && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-honey-100 text-honey-700 rounded-full text-xs">
                {selectedDate.toLocaleDateString()}
                <button onClick={() => setSelectedDate(null)} className="hover:text-honey-900">
                  <X size={12} />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Entry List */}
      <div className="flex-1 overflow-y-auto p-4 pb-8">
        <AnimatePresence mode="popLayout">
          {groupedEntries.length === 0 ? (
            <motion.div
              className="text-center py-12"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="text-warm-500 font-body">
                {searchQuery || selectedDate
                  ? 'No entries match your filters'
                  : 'No entries yet'}
              </p>
            </motion.div>
          ) : (
            <div className="space-y-6">
              {groupedEntries.map(group => (
                <div key={group.date.toDateString()}>
                  <h3 className="text-sm font-display font-semibold text-warm-500 mb-3 sticky top-0 bg-warm-50 py-1">
                    {formatDateHeader(group.date)}
                  </h3>
                  <div className="space-y-4">
                    {group.entries.map(entry => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        onDelete={onDelete}
                        onUpdate={onUpdate}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default JournalScreen;
