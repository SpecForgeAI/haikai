/**
 * DiagramCanvas — wraps ReactFlow with dark IDE theme
 * Design: dot-grid canvas, animated edges, fit-on-load
 */
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect } from "react";
import { DiagramNode, GroupLabelNode, type DiagramNodeData } from "./DiagramNode";

const nodeTypes: NodeTypes = {
  diagramNode: DiagramNode as unknown as NodeTypes[string],
  groupLabel: GroupLabelNode as unknown as NodeTypes[string],
};

interface DiagramCanvasProps {
  nodes: Node<DiagramNodeData>[];
  edges: Edge[];
}

export function DiagramCanvas({ nodes: initialNodes, edges: initialEdges }: DiagramCanvasProps) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // Re-initialise when diagram changes
  useEffect(() => {
    // Nodes/edges are re-initialised via key prop on parent
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
      minZoom={0.2}
      maxZoom={2.5}
      defaultEdgeOptions={{
        type: "smoothstep",
        style: { stroke: "#334155", strokeWidth: 1.5 },
        labelStyle: {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          fill: "#64748b",
        },
        labelBgStyle: { fill: "#0f1117", fillOpacity: 0.85 },
        labelBgPadding: [4, 6],
        labelBgBorderRadius: 4,
        animated: false,
      }}
      proOptions={{ hideAttribution: true }}
      style={{ background: "#0f1117" }}
      deleteKeyCode={null}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="#1e2433"
      />
      <Controls
        style={{ bottom: 24, left: 24 }}
        showInteractive={false}
      />
      <MiniMap
        style={{ bottom: 24, right: 24, width: 160, height: 100 }}
        nodeColor={(n) => {
          const d = n.data as DiagramNodeData;
          const map: Record<string, string> = {
            frontend: "#3b82f6", gateway: "#10b981", core: "#8b5cf6",
            db: "#f59e0b", external: "#64748b", extapi: "#ef4444",
            agent: "#38bdf8", artifact: "#f59e0b", standards: "#22c55e",
            user: "#a78bfa", cicd: "#fb923c", volume: "#facc15",
          };
          return map[d?.category as string] ?? "#334155";
        }}
        maskColor="rgba(15,17,23,0.7)"
      />
    </ReactFlow>
  );
}
