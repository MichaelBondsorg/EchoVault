import { useState } from 'react';
import { Check } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../cloud';

/**
 * QuickLogModal (CLOUD-DESIGN-SPEC.md §5/§7 "Quick mood" — mockup 7l):
 * cloud `Dialog`, centered, radius 22. Simplified mood logging from the
 * top bar mood orb.
 *
 * Contains:
 * - Mood slider (0-1 range)
 * - 5 high-frequency "Current Vibe" tags
 *
 * The mockup's discrete 5-circle mood picker has no backing state in this
 * component (mood here is a continuous 0-1 score driving a gradient
 * slider, not 5 selectable buckets) — the existing slider interaction is
 * kept as-is (presentation only, per the task's behavior-parity
 * constraint) and reskinned onto Cloud tokens rather than replaced with a
 * different control.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {function} props.onClose - Callback to close modal
 * @param {function} props.onSave - Callback with { moodScore, vibeTags }
 */
const QuickLogModal = ({ isOpen, onClose, onSave }) => {
  const [moodScore, setMoodScore] = useState(0.5);
  const [selectedVibes, setSelectedVibes] = useState([]);

  const vibeTags = [
    { id: 'energized', emoji: '⚡', label: 'Energized' },
    { id: 'foggy', emoji: '☁️', label: 'Foggy' },
    { id: 'grateful', emoji: '\u{1F64F}', label: 'Grateful' },
    { id: 'anxious', emoji: '\u{1F630}', label: 'Anxious' },
    { id: 'peaceful', emoji: '\u{1F33F}', label: 'Peaceful' },
  ];

  const triggerHaptic = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch (e) {
        // Haptics not available
      }
    }
  };

  const handleVibeToggle = async (vibeId) => {
    await triggerHaptic();
    setSelectedVibes(prev =>
      prev.includes(vibeId)
        ? prev.filter(v => v !== vibeId)
        : [...prev, vibeId]
    );
  };

  const handleSave = async () => {
    await triggerHaptic();
    onSave?.({
      moodScore,
      vibeTags: selectedVibes,
      timestamp: new Date(),
    });
    // Reset state
    setMoodScore(0.5);
    setSelectedVibes([]);
    onClose();
  };

  const handleClose = () => {
    setMoodScore(0.5);
    setSelectedVibes([]);
    onClose();
  };

  // Get mood label based on score
  const getMoodLabel = (score) => {
    if (score >= 0.8) return 'Great';
    if (score >= 0.6) return 'Good';
    if (score >= 0.4) return 'Okay';
    if (score >= 0.2) return 'Low';
    return 'Struggling';
  };

  // Mood color: same 4-bucket accent scale as EntryCard's mood dot
  // (CLOUD-DESIGN-SPEC.md §7 Journal note) — accent tokens only, no legacy
  // `text-mood-*` classes.
  const getMoodColor = (score) => {
    if (score >= 0.75) return 'var(--accent-4)';
    if (score >= 0.5) return 'var(--accent-3)';
    if (score >= 0.25) return 'var(--accent-2)';
    return 'var(--accent-1)';
  };

  // Slider track gradient, walked across the same accent-1..4 scale as the
  // mood label color above (was a fixed lavender/honey/sage legacy gradient).
  const getSliderGradient = () => {
    return 'linear-gradient(to right, var(--accent-1), var(--accent-2), var(--accent-3), var(--accent-4), var(--accent-deep))';
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent aria-labelledby="quick-log-title">
        <DialogDescription className="sr-only">
          Log how you're feeling right now with a mood slider and optional vibe tags.
        </DialogDescription>
        <DialogTitle id="quick-log-title">
          Quick Check-in
        </DialogTitle>

        {/* Content */}
        <div className="mt-4 space-y-6">
          {/* Mood Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-secondary-foreground">
                How are you feeling?
              </span>
              <span
                className="text-lg font-bold"
                style={{ color: getMoodColor(moodScore) }}
              >
                {getMoodLabel(moodScore)}
              </span>
            </div>

            {/* Custom slider */}
            <div className="relative">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={moodScore}
                onChange={(e) => setMoodScore(parseFloat(e.target.value))}
                aria-label="Mood score"
                className="
                  w-full h-3 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-6
                  [&::-webkit-slider-thumb]:h-6
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-card
                  [&::-webkit-slider-thumb]:shadow-soft
                  [&::-webkit-slider-thumb]:border-2
                  [&::-webkit-slider-thumb]:border-border
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-moz-range-thumb]:w-6
                  [&::-moz-range-thumb]:h-6
                  [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-card
                  [&::-moz-range-thumb]:shadow-soft
                  [&::-moz-range-thumb]:border-2
                  [&::-moz-range-thumb]:border-border
                  [&::-moz-range-thumb]:cursor-pointer
                "
                style={{
                  background: getSliderGradient(),
                }}
              />
            </div>

            {/* Mood labels */}
            <div className="flex justify-between text-xs text-faint">
              <span>Struggling</span>
              <span>Great</span>
            </div>
          </div>

          {/* Vibe Tags */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-secondary-foreground">
              Current vibe (optional)
            </span>
            <div className="flex flex-wrap gap-2">
              {vibeTags.map((vibe) => {
                const isSelected = selectedVibes.includes(vibe.id);
                return (
                  <button
                    key={vibe.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleVibeToggle(vibe.id)}
                    className={`
                      relative min-h-[44px] px-3 py-2 rounded-full
                      text-sm font-medium
                      transition-colors border
                      ${isSelected
                        ? 'bg-accent-deep text-background border-accent-deep'
                        : 'bg-accent-wash text-accent-deep border-transparent hover:bg-divider'
                      }
                    `}
                  >
                    <span className="mr-1" aria-hidden="true">{vibe.emoji}</span>
                    {vibe.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <button
          type="button"
          onClick={handleSave}
          className="
            mt-6 w-full min-h-[52px] px-4
            bg-accent-deep
            text-background font-bold
            rounded-full
            shadow-soft
            flex items-center justify-center gap-2
            transition-opacity hover:opacity-90
          "
        >
          <Check size={20} aria-hidden="true" />
          Save Check-in
        </button>
      </DialogContent>
    </Dialog>
  );
};

export default QuickLogModal;
