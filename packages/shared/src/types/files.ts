export interface Match {
  file: string;
  line: number;
  column: number;
  content: string;
  context_before: string[];
  context_after: string[];
  kind?: string;
  context: string[];
}
