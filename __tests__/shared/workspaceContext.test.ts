import { WorkspaceContextSchema, SelectedFileSchema } from '@robocode-packages/shared';

describe('WorkspaceContext and SelectedFile schemas', () => {
  describe('SelectedFileSchema', () => {
    it('parses valid object', () => {
      const result = SelectedFileSchema.safeParse({
        path: 'src/foo.ts',
        content: 'export const x = 1;',
        score: 0.85,
        truncated: false,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing path', () => {
      const result = SelectedFileSchema.safeParse({
        content: 'export const x = 1;',
        score: 0.85,
        truncated: false,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing content', () => {
      const result = SelectedFileSchema.safeParse({
        path: 'src/foo.ts',
        score: 0.85,
        truncated: false,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-number score', () => {
      const result = SelectedFileSchema.safeParse({
        path: 'src/foo.ts',
        content: 'export const x = 1;',
        score: 'high',
        truncated: false,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean truncated', () => {
      const result = SelectedFileSchema.safeParse({
        path: 'src/foo.ts',
        content: 'export const x = 1;',
        score: 0.85,
        truncated: 'yes',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('WorkspaceContextSchema', () => {
    it('parses valid object', () => {
      const result = WorkspaceContextSchema.safeParse({
        cwd: '/home/user/project',
        gitStatus: 'M src/foo.ts',
        gitLog: 'abc123 feat: add feature',
        gitDiff: '',
        tsconfig: '{"compilerOptions":{}}',
        packageJson: '{"name":"app"}',
        eslintConfig: null,
        envExample: null,
        roboMd: null,
      });
      expect(result.success).toBe(true);
    });

    it('allows nullable string fields to be null', () => {
      const result = WorkspaceContextSchema.safeParse({
        cwd: '/home/user/project',
        gitStatus: 'M src/foo.ts',
        gitLog: 'abc123 feat: add feature',
        gitDiff: '',
        tsconfig: null,
        packageJson: null,
        eslintConfig: null,
        envExample: null,
        roboMd: null,
      });
      expect(result.success).toBe(true);
    });

    it('allows nullable string fields to have content', () => {
      const result = WorkspaceContextSchema.safeParse({
        cwd: '/home/user/project',
        gitStatus: 'M src/foo.ts',
        gitLog: 'abc123 feat: add feature',
        gitDiff: '',
        tsconfig: '{"compilerOptions":{}}',
        packageJson: '{"name":"app"}',
        eslintConfig: 'rules: {}',
        envExample: 'DATABASE_URL=',
        roboMd: '# Project',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing cwd', () => {
      const result = WorkspaceContextSchema.safeParse({
        gitStatus: '',
        gitLog: '',
        gitDiff: '',
        tsconfig: null,
        packageJson: null,
        eslintConfig: null,
        envExample: null,
        roboMd: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing gitStatus', () => {
      const result = WorkspaceContextSchema.safeParse({
        cwd: '/home/user/project',
        gitLog: '',
        gitDiff: '',
        tsconfig: null,
        packageJson: null,
        eslintConfig: null,
        envExample: null,
        roboMd: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing gitLog', () => {
      const result = WorkspaceContextSchema.safeParse({
        cwd: '/home/user/project',
        gitStatus: '',
        gitDiff: '',
        tsconfig: null,
        packageJson: null,
        eslintConfig: null,
        envExample: null,
        roboMd: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing gitDiff', () => {
      const result = WorkspaceContextSchema.safeParse({
        cwd: '/home/user/project',
        gitStatus: '',
        gitLog: '',
        tsconfig: null,
        packageJson: null,
        eslintConfig: null,
        envExample: null,
        roboMd: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string cwd', () => {
      const result = WorkspaceContextSchema.safeParse({
        cwd: 123,
        gitStatus: '',
        gitLog: '',
        gitDiff: '',
        tsconfig: null,
        packageJson: null,
        eslintConfig: null,
        envExample: null,
        roboMd: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-nullable tsconfig being non-string', () => {
      const result = WorkspaceContextSchema.safeParse({
        cwd: '/home/user/project',
        gitStatus: '',
        gitLog: '',
        gitDiff: '',
        tsconfig: 123,
        packageJson: null,
        eslintConfig: null,
        envExample: null,
        roboMd: null,
      });
      expect(result.success).toBe(false);
    });
  });
});
