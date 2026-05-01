import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FunctionKind } from './types';

export interface FunctionNodeData extends Record<string, unknown> {
  name: string;
  kind: FunctionKind;
  file: string;
}

const KIND_LABEL: Record<FunctionKind, string> = {
  function: 'fn',
  method: 'method',
  arrow: 'arrow',
};

export function FunctionNodeView({ data }: NodeProps) {
  const { name, kind, file } = data as FunctionNodeData;
  return (
    <div className="codetrace-fn-node" data-codetrace-kind={kind}>
      <Handle type="target" position={Position.Top} />
      <div className="codetrace-fn-node__header">
        <span className="codetrace-fn-node__name">{name}</span>
        <span className="codetrace-fn-node__kind">{KIND_LABEL[kind]}</span>
      </div>
      <div className="codetrace-fn-node__file" title={file}>
        {file}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
