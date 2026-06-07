export interface Session {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
  cwd: string;
  transcriptPath?: string;
  auditPath?: string;
  summary?: string;
  forkedFromId?: string;
  forkedFromName?: string;
}
