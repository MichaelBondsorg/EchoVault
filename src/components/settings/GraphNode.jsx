import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { User, PawPrint, MapPin, Package, Activity } from 'lucide-react';

/**
 * GraphNode - Custom node component for entity graph
 *
 * Displays entity with:
 * - Icon based on entity type
 * - Name
 * - Relationship to user
 * - Color coding by type
 */

const typeIcons = {
  person: User,
  pet: PawPrint,
  place: MapPin,
  thing: Package,
  activity: Activity
};

const GraphNode = ({ data, selected }) => {
  const { entity, colors } = data;
  const Icon = typeIcons[entity.entityType] || User;

  // Count relationships
  const relationshipCount = entity.relationships?.length || 0;

  return (
    <>
      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-warm-300 !border-warm-400 !w-2 !h-2"
      />

      <div
        className={`
          px-3 py-2 rounded-xl shadow-md cursor-pointer
          transition-all duration-200 min-w-[100px]
          ${selected ? 'ring-2 ring-honey-500 ring-offset-2' : ''}
        `}
        style={{
          backgroundColor: colors.bg,
          borderWidth: 2,
          borderStyle: 'solid',
          borderColor: colors.border
        }}
      >
        <div className="flex items-center gap-2">
          {/* Icon */}
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: colors.border + '30' }}
          >
            <Icon size={14} style={{ color: colors.text }} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div
              className="font-medium text-sm truncate"
              style={{ color: colors.text }}
            >
              {entity.name}
            </div>
            <div className="text-[10px] text-warm-500 truncate">
              {formatRelationship(entity.relationship)}
              {relationshipCount > 0 && (
                <span className="ml-1 text-warm-400">
                  ({relationshipCount} link{relationshipCount !== 1 ? 's' : ''})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Badges */}
        {entity.userCorrected && (
          <div
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
            style={{ backgroundColor: colors.border }}
            title="Edited by you"
          />
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-warm-300 !border-warm-400 !w-2 !h-2"
      />
    </>
  );
};

// Helper to format relationship
const formatRelationship = (relationship) => {
  if (!relationship) return 'Unknown';
  return relationship.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

export default memo(GraphNode);
