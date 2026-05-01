import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, useState } from 'react';
import { FunctionNodeView, type FunctionNodeData } from './FunctionNodeView';
import { layoutCallGraph } from './layout';
import type { CallGraph, LayoutDirection } from './types';
import './CallGraphCanvas.css';

const NODE_TYPES: NodeTypes = {
  function: FunctionNodeView,
};

export interface CallGraphCanvasProps {
  graph: CallGraph;
  initialDirection?: LayoutDirection;
}

export function CallGraphCanvas({ graph, initialDirection = 'TB' }: CallGraphCanvasProps) {
  const [direction, setDirection] = useState<LayoutDirection>(initialDirection);

  const { nodes, edges } = useMemo(() => {
    const baseNodes: Node<FunctionNodeData>[] = graph.nodes.map(n => ({
      id: n.id,
      type: 'function',
      position: { x: 0, y: 0 },
      data: { name: n.name, kind: n.kind, file: n.file },
    }));

    const baseEdges: Edge[] = graph.edges.map(e => ({
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
    }));

    return layoutCallGraph(baseNodes, baseEdges, { direction });
  }, [graph, direction]);

  return (
    <div className="codetrace-canvas">
      <div className="codetrace-canvas__toolbar">
        <label>
          Layout
          <select
            value={direction}
            onChange={e => setDirection(e.target.value as LayoutDirection)}
          >
            <option value="TB">Top → Bottom</option>
            <option value="LR">Left → Right</option>
          </select>
        </label>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
