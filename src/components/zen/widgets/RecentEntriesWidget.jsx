import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../cloud';

/**
 * RecentEntriesWidget - "Recent list" for the Home screen
 * (CLOUD-DESIGN-SPEC.md §7 Home: "Recent list"; day rows with a mood dot
 * + meta line, per the Home mockup's "Today" list).
 *
 * Tapping a row opens the existing Day Summary modal for that entry's
 * date via the same `onDayClick` callback the mood-trend bar card already
 * uses - no new navigation plumbing.
 */
const RecentEntriesWidget = ({
  entries = [],
  category,
  onDayClick,
  isEditing = false,
  onDelete,
}) => {
  const recentEntries = useMemo(() => {
    return entries
      .filter(e => e.category === category)
      .map(entry => {
        const dateField = entry.effectiveDate || entry.createdAt;
        const date = dateField instanceof Date ? dateField : dateField?.toDate?.() || new Date(dateField);
        return { entry, date };
      })
      .sort((a, b) => b.date - a.date)
      .slice(0, 5);
  }, [entries, category]);

  const formatMeta = (date) => {
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return time;
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`;
  };

  const handleRowClick = ({ entry, date }) => {
    if (isEditing) return;
    onDayClick?.(date, {
      date,
      mood: entry.analysis?.mood_score,
      count: 1,
      entries: [entry],
    });
  };

  return (
    <div className={`w-full ${isEditing ? 'animate-shake' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-foreground">Recent</span>
        <Link to="/journal" className="text-xs text-muted-foreground">View all</Link>
      </div>

      {recentEntries.length === 0 ? (
        <Card className="p-4 text-center text-sm text-muted-foreground">
          No entries yet
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {recentEntries.map(({ entry, date }, i) => (
            <button
              key={entry.id}
              type="button"
              disabled={isEditing}
              onClick={() => handleRowClick(recentEntries[i])}
              className="flex w-full items-start gap-2.5 border-b border-divider px-3.5 py-3 text-left last:border-b-0 disabled:cursor-default"
            >
              <span
                className="mt-[5px] h-2 w-2 flex-none rounded-full"
                style={{ background: i === 0 ? 'var(--accent)' : 'var(--text-decorative)' }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {entry.text || 'Untitled entry'}
                </div>
                <div className="mt-0.5 text-[11.5px] text-faint">
                  {formatMeta(date)}
                </div>
              </div>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
};

export default RecentEntriesWidget;
