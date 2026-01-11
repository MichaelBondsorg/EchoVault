import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import EntryCard from '../components/entries/EntryCard';

/**
 * JournalPage - Full journal with entry feed and search
 *
 * Contains:
 * - Search functionality
 * - Date navigation
 * - Grouped entry feed
 */
const JournalPage = ({
  entries,
  category,
  onDayClick,
  onEntryClick,
  onDelete,
  onUpdate,
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
          const tagStr = typeof t === 'string' ? t : (t?.text || '');
          return tagStr.toLowerCase().includes(query);
        })
      );
    }

    // Apply date filter
    if (selectedDate) {
      const dateStart = new Date(selectedDate);
      dateStart.setHours(0, 0, 0, 0);
      const dateEnd = new Date(selectedDate);
      dateEnd.setHours(23, 59, 59, 999);

      filtered = filtered.filter(e => {
        const dateField = e.effectiveDate || e.createdAt;
        const entryDate = dateField instanceof Date
          ? dateField
          : dateField?.toDate?.() || new Date();
        return entryDate >= dateStart && entryDate <= dateEnd;
      });
    }

    return filtered;
  }, [entries, category, searchQuery, selectedDate]);

  // Group entries by date
  const groupedEntries = useMemo(() => {
    const groups = new Map();

    filteredEntries.forEach(entry => {
      const dateField = entry.effectiveDate || entry.createdAt;
      const entryDate = dateField instanceof Date
        ? dateField
        : dateField?.toDate?.() || new Date();
      const dateKey = entryDate.toDateString();

      if (!groups.has(dateKey)) {
        groups.set(dateKey, { date: entryDate, entries: [] });
      }
      groups.get(dateKey).entries.push(entry);
    });

    return Array.from(groups.values()).sort((a, b) => b.date - a.date);
  }, [filteredEntries]);

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

  const navigateDate = (direction) => {
    const current = selectedDate ? new Date(selectedDate) : new Date();
    current.setDate(current.getDate() + direction);
    setSelectedDate(current);
  };

  return (
    <motion.div
      className="px-4 pb-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Page Title */}
      <div className="pt-2 mb-4">
        <h2 className="font-display font-bold text-xl text-warm-800">
          Your Journal
        </h2>
      </div>

      {/* Search Bar */}
      <div className="relative mb-3">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search entries..."
          className="w-full pl-10 pr-4 py-2.5 bg-white/50 backdrop-blur-sm border border-white/30 rounded-xl text-sm text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between mb-4 bg-white/30 backdrop-blur-sm rounded-xl p-2">
        <motion.button
          onClick={() => navigateDate(-1)}
          className="p-2 text-warm-500 hover:text-warm-700 hover:bg-white/50 rounded-full"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <ChevronLeft size={20} />
        </motion.button>

        <motion.button
          onClick={() => setShowDatePicker(!showDatePicker)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-warm-700 hover:bg-white/50 rounded-lg"
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
          className="p-2 text-warm-500 hover:text-warm-700 hover:bg-white/50 rounded-full"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <ChevronRight size={20} />
        </motion.button>
      </div>

      {/* Date Picker */}
      <AnimatePresence>
        {showDatePicker && (
          <motion.div
            className="mb-4 flex gap-2 flex-wrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <button
              onClick={() => { setSelectedDate(null); setShowDatePicker(false); }}
              className={`px-3 py-1 text-xs rounded-full ${!selectedDate ? 'bg-primary-600 text-white' : 'bg-white/50 text-warm-600 hover:bg-white/70'}`}
            >
              All
            </button>
            <button
              onClick={() => { setSelectedDate(new Date()); setShowDatePicker(false); }}
              className="px-3 py-1 text-xs rounded-full bg-white/50 text-warm-600 hover:bg-white/70"
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
              className="px-3 py-1 text-xs rounded-full bg-white/50 text-warm-600 hover:bg-white/70"
            >
              Yesterday
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Filters */}
      {(searchQuery || selectedDate) && (
        <div className="mb-4 flex gap-2 flex-wrap">
          {searchQuery && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 text-primary-700 rounded-full text-xs">
              Search: "{searchQuery}"
              <button onClick={() => setSearchQuery('')} className="hover:text-primary-900">
                <X size={12} />
              </button>
            </span>
          )}
          {selectedDate && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 text-primary-700 rounded-full text-xs">
              {selectedDate.toLocaleDateString()}
              <button onClick={() => setSelectedDate(null)} className="hover:text-primary-900">
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Entry Feed */}
      {groupedEntries.length === 0 ? (
        <motion.div
          className="p-8 text-center bg-white/30 backdrop-blur-sm border border-white/20 rounded-3xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-warm-600 font-medium">
            {searchQuery || selectedDate ? 'No entries match your filters' : 'No entries yet'}
          </p>
          <p className="text-warm-400 text-sm mt-2">
            {searchQuery || selectedDate
              ? 'Try adjusting your search or date filter'
              : 'Start journaling to see your entries here'
            }
          </p>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {groupedEntries.map(group => (
            <div key={group.date.toDateString()}>
              <h3 className="text-sm font-display font-semibold text-warm-500 mb-3 sticky top-0 bg-transparent py-1 backdrop-blur-sm">
                {formatDateHeader(group.date)}
              </h3>
              <div className="space-y-3">
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
    </motion.div>
  );
};

export default JournalPage;
