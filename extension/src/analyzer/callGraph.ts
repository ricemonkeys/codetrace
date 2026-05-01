import * as fs from 'fs';
import * as path from 'path';
import { GenericLspAnalyzer } from './GenericLspAnalyzer';
import { TypeScriptAnalyzer } from './TypeScriptAnalyzer';
import type { CallEdge, CallGraph, FunctionNode, Analyzer, AnalyzerOptions } from './types';

export const DEFAULT_ANALYZER_IGNORED_DIRECTORIES = [
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
] as const;

const PREMIUM_ANALYZERS: Analyzer[] = [
  new TypeScriptAnalyzer(),
];

const STANDARD_ANALYZER = new GenericLspAnalyzer();

/**
 * Extracts a typed graph for a workspace root using a multi-language hybrid strategy.
 * Files are grouped by language and dispatched to the best available analyzer.
 * If a Premium analyzer fails, it falls back to the Standard LSP analyzer.
 */
export async function extractWorkspaceCallGraph(
  workspaceRoot: string,
  options: AnalyzerOptions = {},
): Promise<CallGraph> {
  const root = path.resolve(workspaceRoot);
  if (!fs.existsSync(root)) {
    throw new Error(`Path does not exist: ${root}`);
  }
  const isDirectory = fs.statSync(root).isDirectory();
  const searchRoot = isDirectory ? root : path.dirname(root);
  
  // If limitToFiles is provided, only process those files (optimization requested in 5th review)
  const allFiles = options.limitToFiles 
    ? options.limitToFiles.map(f => path.resolve(f))
    : (isDirectory ? findAllFiles(searchRoot, options.ignoredDirectories) : [root]);

  // Group files by their best available premium analyzer
  const buckets = new Map<Analyzer | typeof STANDARD_ANALYZER, string[]>();
  
  for (const filePath of allFiles) {
    let assigned = false;
    for (const analyzer of PREMIUM_ANALYZERS) {
      if (analyzer.canAnalyze([filePath])) {
        const bucket = buckets.get(analyzer) ?? [];
        bucket.push(filePath);
        buckets.set(analyzer, bucket);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      const bucket = buckets.get(STANDARD_ANALYZER) ?? [];
      bucket.push(filePath);
      buckets.set(STANDARD_ANALYZER, bucket);
    }
  }

  const results: CallGraph[] = [];
  const warnings: string[] = [];

  for (const [analyzer, filePaths] of buckets.entries()) {
    try {
      const result = await analyzer.analyze(searchRoot, filePaths, options);
      results.push(result);
    } catch (err) {
      warnings.push(`${analyzer.getName()} failed for ${filePaths.length} files: ${err}. Falling back to LSP.`);
      // Fallback to Standard LSP for this bucket
      try {
        const fallbackResult = await STANDARD_ANALYZER.analyze(searchRoot, filePaths, options);
        results.push(fallbackResult);
      } catch (fallbackErr) {
        warnings.push(`LSP fallback also failed: ${fallbackErr}`);
      }
    }
  }

  const merged = mergeCallGraphs(results);
  if (warnings.length > 0) {
    merged.metadata = {
      ...merged.metadata!,
      warnings: [...(merged.metadata?.warnings || []), ...warnings]
    };
  }
  return merged;
}

/**
 * Extracts a typed graph from an explicit file list.
 * Uses the list as the primary node target while using the rest of the workspace for context.
 */
export async function extractCallGraphFromFiles(
  filePaths: readonly string[],
  options: AnalyzerOptions = {},
): Promise<CallGraph> {
  const paths = filePaths.map(p => path.resolve(p));
  const searchRoot = path.dirname(paths[0] || '.');
  
  return extractWorkspaceCallGraph(searchRoot, { 
    ...options, 
    limitToFiles: [...paths],
    ignoredDirectories: [] 
  });
}

function mergeCallGraphs(graphs: CallGraph[]): CallGraph {
  const nodes: FunctionNode[] = [];
  const edges: CallEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();

  for (const g of graphs) {
    for (const n of g.nodes) {
      if (!nodeIds.has(n.id)) {
        nodes.push(n);
        nodeIds.add(n.id);
      }
    }
    for (const e of g.edges) {
      const key = `${e.from}->${e.to}`;
      if (!edgeKeys.has(key)) {
        edges.push(e);
        edgeKeys.add(key);
      }
    }
  }

  return {
    nodes,
    edges,
    metadata: {
      engine: 'Hybrid Dispatcher',
      language: 'Mixed',
      precision: graphs.some(g => g.metadata?.precision === 'premium') ? 'premium' : 'standard'
    }
  };
}

function findAllFiles(
  root: string,
  ignoredDirectories: readonly string[] = DEFAULT_ANALYZER_IGNORED_DIRECTORIES,
): string[] {
  const files: string[] = [];
  const ignoredDirectoryNames = new Set(ignoredDirectories);

  const visit = (directory: string) => {
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirectoryNames.has(entry.name)) {
            visit(fullPath);
          }
          continue;
        }

        if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (err) {
      // Ignore directory read errors (permissions, etc.)
    }
  };

  visit(root);
  return files;
}
