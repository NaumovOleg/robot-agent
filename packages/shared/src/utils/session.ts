import path from 'node:path';
import { SESSIONS_DIR_PATH } from '@robocode-packages/config';

export const sessionMdPath = (sessionId: string) =>
  path.join(SESSIONS_DIR_PATH, `./${sessionId}.md`);
export const sessionJsonPath = (sessionId: string) =>
  path.join(SESSIONS_DIR_PATH, `./${sessionId}.json`);
export const sessionAuditPath = (sessionId: string) =>
  path.join(SESSIONS_DIR_PATH, `./${sessionId}.events.ndjson`);
