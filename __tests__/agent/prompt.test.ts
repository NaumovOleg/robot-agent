import { buildSystemPrompt } from '../../packages/agent/src/main/prompt';
import type { WorkspaceContext, SelectedFile } from '@robocode-packages/shared';

const ctx: WorkspaceContext = {
  cwd: '/project',
  gitStatus: 'M src/foo.ts',
  gitLog: 'abc feat: add thing',
  gitDiff: '',
  tsconfig: null,
  packageJson: '{"name":"app","scripts":{"test":"jest"}}',
  eslintConfig: null,
  envExample: null,
  roboMd: '# Project rules\nUse TypeScript.',
};

const files: SelectedFile[] = [
  { path: 'src/foo.ts', content: 'export const x = 1;', score: 1.0, truncated: false },
];

test('includes cwd in prompt', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('/project');
});

test('includes git status', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('M src/foo.ts');
});

test('includes .ROBO.md content', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('Use TypeScript.');
});

test('includes file content', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('export const x = 1;');
});

test('includes file path', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('src/foo.ts');
});
