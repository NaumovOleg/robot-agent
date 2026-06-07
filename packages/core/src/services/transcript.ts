import { type BaseMessage, ToolMessage } from '@langchain/core/messages';
import { FileSystem, messageType, sessionMdPath } from '@robocode-packages/shared';
import { SessionService } from './session';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const formatContent = (msg: BaseMessage): string => {
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
  return `<pre>\n${escapeHtml(content)}\n</pre>`;
};

export class TranscriptService {
  static path(sessionId: string): string {
    return sessionMdPath(sessionId);
  }

  static read(sessionId: string): string {
    try {
      return FileSystem.readFile(this.path(sessionId));
    } catch {
      return '';
    }
  }

  static write(sessionId: string, messages: BaseMessage[]): void {
    const session = SessionService.get(sessionId);
    const lines: string[] = [
      '# Session Transcript',
      '',
      `- Session: ${session?.name ?? sessionId}`,
      `- Session ID: ${sessionId}`,
      `- Workspace: ${session?.cwd ?? process.cwd()}`,
      `- Updated: ${session?.updatedAt ?? new Date().toISOString()}`,
      `- Messages: ${messages.length}`,
    ];

    if (session?.summary) {
      lines.push(`- Summary: ${session.summary}`);
    }
    if (session?.forkedFromName) {
      lines.push(`- Forked from: ${session.forkedFromName}${session.forkedFromId ? ` (${session.forkedFromId})` : ''}`);
    }

    lines.push('');

    messages.forEach((msg, index) => {
      const role = messageType(msg).toUpperCase();
      lines.push(`## ${index + 1}. ${role}`);

      if (msg instanceof ToolMessage) {
        lines.push(`- Tool call: ${msg.tool_call_id}`);
        if (msg.name) {
          lines.push(`- Tool name: ${msg.name}`);
        }
        lines.push('');
      }

      lines.push(formatContent(msg));
      lines.push('');
    });

    FileSystem.writeFile(this.path(sessionId), lines.join('\n'));
  }
}
