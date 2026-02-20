import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Settings2, X } from 'lucide-react';

import { getWidgetComponent } from './widgets';

/**
 * SortableWidget - Wrapper for draggable widgets
 * Includes delete button positioned outside the card bounds
 */
const SortableWidget = ({
  widget,
  isEditing,
  onDelete,
  children,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id, disabled: !isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        relative
        ${widget.size === '1x1' ? 'col-span-1' : 'col-span-2'}
        ${widget.size === '2x2' ? 'row-span-2' : ''}
        ${isDragging ? 'cursor-grabbing' : isEditing ? 'cursor-grab' : ''}
      `}
      {...(isEditing ? { ...attributes, ...listeners } : {})}
    >
      {/* Widget content */}
      {children}

      {/* Delete button - positioned outside the card with negative margins */}
      {isEditing && onDelete && (
        <motion.button
          role="button"
          tabIndex={0}
          className="
            absolute -top-2 -right-2 z-50
            w-8 h-8
            bg-red-500 hover:bg-red-600 active:bg-red-700
            text-white
            rounded-full
            shadow-lg
            flex items-center justify-center
            transition-colors
            select-none
          "
          style={{
            WebkitTapHighlightColor: 'transparent',
            touchAction: 'manipulation',
            WebkitUserSelect: 'none',
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete();
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          whileTap={{ scale: 0.9 }}
        >
          <X size={16} />
        </motion.button>
      )}
    </div>
  );
};

/**
 * BentoGrid - Customizable widget grid with drag-and-drop
 *
 * @param {Object} props
 * @param {Array} props.layout - Array of widget configs from useDashboardLayout
 * @param {boolean} props.isEditing - Whether edit mode is active
 * @param {function} props.onReorder - Callback when widgets are reordered
 * @param {function} props.onRemove - Callback when widget is removed
 * @param {function} props.onToggleEdit - Callback to toggle edit mode
 * @param {Object} props.widgetProps - Props to pass to all widgets
 */
const BentoGrid = ({
  layout = [],
  isEditing = false,
  onReorder,
  onRemove,
  onToggleEdit,
  widgetProps = {},
}) => {
  // Haptic feedback
  const triggerHaptic = useCallback(async (style = ImpactStyle.Light) => {
    if (Capacitor.isNativePlatform()) {
      try {
        await Haptics.impact({ style });
      } catch (e) {
        // Haptics not available
      }
    }
  }, []);

  // DnD sensors with touch support
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag start
  const handleDragStart = useCallback(async () => {
    await triggerHaptic(ImpactStyle.Medium);
  }, [triggerHaptic]);

  // Handle drag end
  const handleDragEnd = useCallback(async (event) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      await triggerHaptic(ImpactStyle.Light);

      const oldIndex = layout.findIndex(w => w.id === active.id);
      const newIndex = layout.findIndex(w => w.id === over.id);

      onReorder?.(oldIndex, newIndex);
    }
  }, [layout, onReorder, triggerHaptic]);

  // Handle long press to enter edit mode
  const [longPressTimer, setLongPressTimer] = useState(null);

  const handleLongPressStart = useCallback(() => {
    if (isEditing) return;

    const timer = setTimeout(async () => {
      await triggerHaptic(ImpactStyle.Heavy);
      onToggleEdit?.();
    }, 500);

    setLongPressTimer(timer);
  }, [isEditing, onToggleEdit, triggerHaptic]);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  return (
    <div
      className="relative"
      onTouchStart={handleLongPressStart}
      onTouchEnd={handleLongPressEnd}
      onMouseDown={handleLongPressStart}
      onMouseUp={handleLongPressEnd}
      onMouseLeave={handleLongPressEnd}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={layout.map(w => w.id)}
          strategy={rectSortingStrategy}
        >
          {/* Grid container - overflow-visible to allow delete buttons to extend outside */}
          <div className="grid grid-cols-2 gap-4 overflow-visible">
            <AnimatePresence>
              {layout.map((widget) => {
                const WidgetComponent = getWidgetComponent(widget.type);

                if (!WidgetComponent) {
                  // Widget type not implemented yet
                  return null;
                }

                return (
                  <SortableWidget
                    key={widget.id}
                    widget={widget}
                    isEditing={isEditing}
                    onDelete={() => onRemove?.(widget.id)}
                  >
                    <WidgetComponent
                      size={widget.size}
                      isEditing={isEditing}
                      onDelete={() => onRemove?.(widget.id)}
                      {...widgetProps}
                    />
                  </SortableWidget>
                );
              })}
            </AnimatePresence>
          </div>
        </SortableContext>
      </DndContext>

      {/* Customize Button (visible when not in edit mode) */}
      {!isEditing && (
        <motion.button
          onClick={onToggleEdit}
          className="
            w-full mt-4 py-3 px-4
            bg-white/30 backdrop-blur-sm
            border border-white/20
            rounded-2xl
            text-warm-500 font-medium text-sm
            flex items-center justify-center gap-2
            hover:bg-white/40 transition-colors
          "
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Settings2 size={16} />
          Customize your dashboard
        </motion.button>
      )}

      {/* Edit Mode Controls */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            className="fixed bottom-28 left-4 right-4 z-40 flex justify-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <div className="
              bg-warm-800 text-white
              px-4 py-2 rounded-full
              shadow-lg
              flex items-center gap-3
            ">
              <span className="text-sm">Drag to reorder</span>
              <button
                onClick={onToggleEdit}
                className="
                  px-3 py-1
                  bg-honey-500 hover:bg-honey-600
                  rounded-full text-sm font-medium
                  transition-colors
                "
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BentoGrid;
