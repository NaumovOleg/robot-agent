export interface DirEntry {
  name: string;
  type: 'file' | 'dir' | 'symlink';
  size: number;
  modified: string;
  children?: DirEntry[];
}
