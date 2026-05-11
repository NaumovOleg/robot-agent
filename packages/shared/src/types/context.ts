export interface ProjectContext {
  cwd: string;
  projectName: string;
  packageJson: Record<string, unknown> | null;
  gitBranch: string | null;
  techStack: string[];
  structure: string;
}

export interface CacheEntry {
  context: ProjectContext;
  timestamp: number;
  watchedFiles: Map<string, number>;
}
