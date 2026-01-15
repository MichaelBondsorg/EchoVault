import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { User, PawPrint, MapPin, Package, Activity, Filter } from 'lucide-react';
import GraphNode from './GraphNode';
import { ENTITY_LINK_TYPES } from '../../services/memory/memoryGraph';

/**
 * RelationshipGraph - Interactive visualization of entity relationships
 *
 * Features:
 * - Force-directed layout with draggable nodes
 * - Color coding by entity type
 * - Edge labels showing relationship type
 * - Click to edit entities
 * - Filter by entity type
 * - Zoom/pan controls
 */

// Entity type colors matching the list view
const entityColors = {
  person: { bg: '#DBEAFE', border: '#3B82F6', text: '#1D4ED8' },
  pet: { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309' },
  place: { bg: '#D1FAE5', border: '#10B981', text: '#047857' },
  thing: { bg: '#EDE9FE', border: '#8B5CF6', text: '#6D28D9' },
  activity: { bg: '#FCE7F3', border: '#EC4899', text: '#BE185D' }
};

// Custom node types
const nodeTypes = {
  entity: GraphNode
};

/**
 * Calculate initial node positions in a circle layout
 */
const calculateCircleLayout = (nodes, centerX = 400, centerY = 300, radius = 250) => {
  const angleStep = (2 * Math.PI) / Math.max(nodes.length, 1);

  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: centerX + radius * Math.cos(angleStep * index - Math.PI / 2),
      y: centerY + radius * Math.sin(angleStep * index - Math.PI / 2)
    }
  }));
};

/**
 * Convert entities to React Flow nodes and edges
 */
const entitiesToFlowData = (entities, typeFilter = null) => {
  const nodes = [];
  const edges = [];
  const processedEdges = new Set(); // Avoid duplicate edges

  // Flatten and filter entities
  const allEntities = Object.entries(entities).flatMap(([type, list]) => {
    if (typeFilter && typeFilter !== type) return [];
    return list.map(e => ({ ...e, entityType: e.entityType || type }));
  });

  // Create nodes
  allEntities.forEach(entity => {
    const colors = entityColors[entity.entityType] || entityColors.person;

    nodes.push({
      id: entity.id,
      type: 'entity',
      data: {
        entity,
        colors,
        label: entity.name
      },
      position: { x: 0, y: 0 } // Will be set by layout
    });
  });

  // Create edges from relationships
  allEntities.forEach(entity => {
    if (!entity.relationships?.length) return;

    entity.relationships
      .filter(rel => rel.direction === 'outgoing')
      .forEach(rel => {
        // Check if target exists in our filtered set
        const targetExists = allEntities.some(e => e.id === rel.targetEntityId);
        if (!targetExists) return;

        // Create unique edge key to avoid duplicates
        const edgeKey = [entity.id, rel.targetEntityId].sort().join('-');
        if (processedEdges.has(edgeKey)) return;
        processedEdges.add(edgeKey);

        const linkConfig = ENTITY_LINK_TYPES[rel.relationshipType];

        edges.push({
          id: `${entity.id}-${rel.targetEntityId}`,
          source: entity.id,
          target: rel.targetEntityId,
          label: linkConfig?.label || rel.relationshipType,
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#94A3B8', strokeWidth: 2 },
          labelStyle: {
            fontSize: 11,
            fontWeight: 500,
            fill: '#64748B'
          },
          labelBgStyle: {
            fill: 'white',
            fillOpacity: 0.9
          },
          labelBgPadding: [4, 8],
          labelBgBorderRadius: 4,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#94A3B8',
            width: 15,
            height: 15
          }
        });
      });
  });

  // Apply circle layout to nodes
  const positionedNodes = calculateCircleLayout(nodes);

  return { nodes: positionedNodes, edges };
};

const RelationshipGraph = ({
  entities,
  onEditEntity,
  onAddRelationship
}) => {
  const [typeFilter, setTypeFilter] = useState(null);

  // Convert entities to flow data
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => entitiesToFlowData(entities, typeFilter),
    [entities, typeFilter]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes/edges when entities or filter changes
  useMemo(() => {
    const { nodes: newNodes, edges: newEdges } = entitiesToFlowData(entities, typeFilter);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [entities, typeFilter, setNodes, setEdges]);

  // Handle node click
  const onNodeClick = useCallback((event, node) => {
    if (onEditEntity) {
      onEditEntity(node.data.entity);
    }
  }, [onEditEntity]);

  // Filter buttons
  const filterTypes = [
    { type: null, label: 'All', icon: null },
    { type: 'person', label: 'People', icon: User },
    { type: 'pet', label: 'Pets', icon: PawPrint },
    { type: 'place', label: 'Places', icon: MapPin },
    { type: 'thing', label: 'Things', icon: Package },
    { type: 'activity', label: 'Activities', icon: Activity }
  ];

  // Count entities by type
  const counts = useMemo(() => {
    const c = { total: 0 };
    Object.entries(entities).forEach(([type, list]) => {
      c[type] = list.length;
      c.total += list.length;
    });
    return c;
  }, [entities]);

  if (counts.total === 0) {
    return (
      <div className="h-[500px] flex items-center justify-center bg-warm-50 rounded-2xl border border-warm-200">
        <div className="text-center text-warm-500">
          <p className="mb-2">No entities to display</p>
          <p className="text-sm">Add people, pets, or places to see them here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[500px] bg-white rounded-2xl border border-warm-200 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep'
        }}
      >
        <Background color="#E2E8F0" gap={20} />
        <Controls
          showInteractive={false}
          className="bg-white rounded-lg shadow-md border border-warm-200"
        />
        <MiniMap
          nodeColor={(node) => node.data?.colors?.border || '#94A3B8'}
          maskColor="rgba(255, 255, 255, 0.8)"
          className="bg-white rounded-lg shadow-md border border-warm-200"
        />

        {/* Filter Panel */}
        <Panel position="top-left" className="bg-white/90 backdrop-blur-sm rounded-xl shadow-md border border-warm-200 p-2">
          <div className="flex items-center gap-1">
            <Filter size={14} className="text-warm-400 mr-1" />
            {filterTypes.map(({ type, label, icon: Icon }) => {
              const isActive = typeFilter === type;
              const count = type ? counts[type] || 0 : counts.total;

              return (
                <button
                  key={type || 'all'}
                  onClick={() => setTypeFilter(type)}
                  className={`
                    px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
                    flex items-center gap-1
                    ${isActive
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-warm-600 hover:bg-warm-100'
                    }
                  `}
                >
                  {Icon && <Icon size={12} />}
                  {label}
                  <span className={`ml-0.5 ${isActive ? 'text-primary-500' : 'text-warm-400'}`}>
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Instructions Panel */}
        <Panel position="bottom-center" className="bg-white/80 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs text-warm-500">
          Click a node to edit  &middot;  Drag to reposition  &middot;  Scroll to zoom
        </Panel>
      </ReactFlow>
    </div>
  );
};

export default RelationshipGraph;
