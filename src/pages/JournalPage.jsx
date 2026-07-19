import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Card, Chip, SectionLabel } from '../components/cloud';
import EntryCard from '../components/entries/EntryCard';

/**
 * JournalPage - Full journal with entry feed and search
 * (CLOUD-DESIGN-SPEC.md §7 Journal: "search icon, filter chips, day-grouped
 * Card lists, mood dot per row, meta line").
 *
 * Contains:
 * - Search functionality
 * - Date navigation
 * - Grouped entry feed
 *
 * Restyle only: entry loading, day-grouping, search/date filter semantics,
 * and the onDelete/onUpdate store callbacks are unchanged. The date
 * quick-select (All/Today/Yesterday) and the active-filter pills are the
 * page's existing interactive filters, reskinned onto the cloud `Chip`
 * primitive per spec — no new filter dimensions were introduced.
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
        <h2 className="font-display font-medium text-[27px] leading-[1.2] tracking-[-0.01em] text-foreground">
          Journal
        </h2>
      </div>

      {/* Search Bar */}
      <div className="relative mb-3">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search entries..."
          className="min-h-11 w-full rounded-full border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Date Navigation */}
      <div className="mb-3 flex items-center justify-between rounded-full border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => navigateDate(-1)}
          aria-label="Previous day"
          className="cloud-icon-button text-secondary-foreground hover:text-foreground"
        >
          <ChevronLeft size={20} />
        </button>

        <button
          type="button"
          onClick={() => setShowDatePicker(!showDatePicker)}
          className="flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-secondary-foreground hover:bg-divider"
        >
          <Calendar size={15} aria-hidden="true" />
          {selectedDate
            ? selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'All dates'
          }
        </button>

        <button
          type="button"
          onClick={() => navigateDate(1)}
          aria-label="Next day"
          className="cloud-icon-button text-secondary-foreground hover:text-foreground"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Date quick-select filter chips */}
      <AnimatePresence>
        {showDatePicker && (
          <motion.div
            className="mb-3 flex flex-wrap gap-2"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <Chip
              as="button"
              type="button"
              selected={!selectedDate}
              onClick={() => { setSelectedDate(null); setShowDatePicker(false); }}
            >
              All
            </Chip>
            <Chip
              as="button"
              type="button"
              onClick={() => { setSelectedDate(new Date()); setShowDatePicker(false); }}
            >
              Today
            </Chip>
            <Chip
              as="button"
              type="button"
              onClick={() => {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                setSelectedDate(yesterday);
                setShowDatePicker(false);
              }}
            >
              Yesterday
            </Chip>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Filters */}
      {(searchQuery || selectedDate) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {searchQuery && (
            <Chip>
              Search: "{searchQuery}"
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search filter"
                className="relative -mr-1 inline-flex h-4 w-4 items-center justify-center text-accent-deep hover:opacity-70 before:absolute before:-inset-3.5 before:content-['']"
              >
                <X size={11} />
              </button>
            </Chip>
          )}
          {selectedDate && (
            <Chip>
              {selectedDate.toLocaleDateString()}
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                aria-label="Clear date filter"
                className="relative -mr-1 inline-flex h-4 w-4 items-center justify-center text-accent-deep hover:opacity-70 before:absolute before:-inset-3.5 before:content-['']"
              >
                <X size={11} />
              </button>
            </Chip>
          )}
        </div>
      )}

      {/* Entry Feed */}
      {groupedEntries.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="p-8 text-center">
            <p className="text-foreground font-medium">
              {searchQuery || selectedDate ? 'No entries match your filters' : 'No entries yet'}
            </p>
            <p className="text-muted-foreground text-sm mt-2">
              {searchQuery || selectedDate
                ? 'Try adjusting your search or date filter'
                : 'Start journaling to see your entries here'
              }
            </p>
          </Card>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {groupedEntries.map(group => (
            <div key={group.date.toDateString()}>
              <SectionLabel className="mb-3 sticky top-0 bg-transparent py-1">
                {formatDateHeader(group.date)}
              </SectionLabel>
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
