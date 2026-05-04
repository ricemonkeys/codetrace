import * as path from 'path';
import * as vscode from 'vscode';
import {
  type ChangedLineRangeMap,
  parseUnifiedDiffChangedRanges,
} from './changedRanges';

export interface GitChangeScanResult {
  ranges: ChangedLineRangeMap;
  baseRef: string;
  unavailableReason?: string;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

interface GitApi {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  diffWith?(ref: string, path?: string): Promise<string>;
}

export const DEFAULT_GIT_BASE_BRANCH = 'main';

export function getConfiguredGitBaseBranch(): string {
  const configured = vscode.workspace
    .getConfiguration('codetrace.git')
    .get<string>('baseBranch', DEFAULT_GIT_BASE_BRANCH)
    .trim();
  return configured || DEFAULT_GIT_BASE_BRANCH;
}

export async function collectChangedLineRanges(
  workspaceRoot: string,
  baseRef: string = DEFAULT_GIT_BASE_BRANCH,
): Promise<GitChangeScanResult> {
  const empty: ChangedLineRangeMap = new Map();

  try {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
      return { ranges: empty, baseRef, unavailableReason: 'VS Code Git extension is unavailable.' };
    }

    const gitApiProvider = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    const git = gitApiProvider.getAPI(1);
    const repository = findRepository(git.repositories, workspaceRoot);
    if (!repository) {
      return { ranges: empty, baseRef, unavailableReason: 'No Git repository found for the workspace.' };
    }

    if (typeof repository.diffWith !== 'function') {
      return { ranges: empty, baseRef, unavailableReason: 'VS Code Git API does not expose diffWith().' };
    }

    const diff = await diffWithBase(repository, baseRef);
    return {
      ranges: parseUnifiedDiffChangedRanges(diff, repository.rootUri.fsPath),
      baseRef,
    };
  } catch (error) {
    return {
      ranges: empty,
      baseRef,
      unavailableReason: `Git diff unavailable: ${error}`,
    };
  }
}

function findRepository(
  repositories: readonly GitRepository[],
  workspaceRoot: string,
): GitRepository | undefined {
  const normalizedWorkspaceRoot = normalizePath(workspaceRoot);
  return repositories.find((repository) => {
    const repositoryRoot = normalizePath(repository.rootUri.fsPath);
    return (
      normalizedWorkspaceRoot === repositoryRoot ||
      normalizedWorkspaceRoot.startsWith(`${repositoryRoot}${path.sep}`) ||
      repositoryRoot.startsWith(`${normalizedWorkspaceRoot}${path.sep}`)
    );
  });
}

async function diffWithBase(repository: GitRepository, baseRef: string): Promise<string> {
  try {
    return await repository.diffWith!(baseRef);
  } catch (error) {
    if (baseRef.startsWith('origin/')) throw error;
    return repository.diffWith!(`origin/${baseRef}`);
  }
}

function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}
