export interface FileSelectorStateT {
  goal: string;
  keywords: string[];
  cwd: string;
  grepResults: {
    file: string;
    matches: string[];
  }[];
  scoredFiles: {
    file: string;
    score: number;
  }[];
  selectedFiles: string[];
}
