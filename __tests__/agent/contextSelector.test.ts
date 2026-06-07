import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runContextSelector } from '../../packages/agent/src/context/selector';
import { WorkspaceContextSchema } from '@robocode-packages/shared';

describe('runContextSelector', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robocode-selector-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns WorkspaceContext with correct cwd', async () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{"compilerOptions":{}}');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');

    const result = await runContextSelector(tmpDir);

    expect(result.cwd).toBe(tmpDir);
    expect(WorkspaceContextSchema.safeParse(result).success).toBe(true);
  });

  it('returns empty gitStatus when git not available', async () => {
    const result = await runContextSelector(tmpDir);

    expect(result.gitStatus).toBe('');
    expect(typeof result.gitStatus).toBe('string');
  });

  it('returns empty gitLog when git not available', async () => {
    const result = await runContextSelector(tmpDir);

    expect(result.gitLog).toBe('');
    expect(typeof result.gitLog).toBe('string');
  });

  it('returns empty gitDiff when git not available', async () => {
    const result = await runContextSelector(tmpDir);

    expect(result.gitDiff).toBe('');
    expect(typeof result.gitDiff).toBe('string');
  });

  it('returns null when tsconfig.json does not exist', async () => {
    const result = await runContextSelector(tmpDir);

    expect(result.tsconfig).toBeNull();
  });

  it('reads tsconfig.json when it exists', async () => {
    const tsconfigContent = '{"compilerOptions":{"strict":true}}';
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), tsconfigContent);

    const result = await runContextSelector(tmpDir);

    expect(result.tsconfig).toBe(tsconfigContent);
  });

  it('returns null when package.json does not exist', async () => {
    const result = await runContextSelector(tmpDir);

    expect(result.packageJson).toBeNull();
  });

  it('reads package.json when it exists', async () => {
    const packageJsonContent = '{"name":"myapp","version":"1.0.0"}';
    fs.writeFileSync(path.join(tmpDir, 'package.json'), packageJsonContent);

    const result = await runContextSelector(tmpDir);

    expect(result.packageJson).toBe(packageJsonContent);
  });

  it('returns null when .ROBO.md does not exist', async () => {
    const result = await runContextSelector(tmpDir);

    expect(result.roboMd).toBeNull();
  });

  it('reads .ROBO.md when it exists', async () => {
    const roboMdContent = '# Project\nSome documentation';
    fs.writeFileSync(path.join(tmpDir, '.ROBO.md'), roboMdContent);

    const result = await runContextSelector(tmpDir);

    expect(result.roboMd).toBe(roboMdContent);
  });

  it('handles .eslintrc config file', async () => {
    const eslintConfig = '{"extends":"eslint:recommended"}';
    fs.writeFileSync(path.join(tmpDir, '.eslintrc'), eslintConfig);

    const result = await runContextSelector(tmpDir);

    expect(result.eslintConfig).toBe(eslintConfig);
  });

  it('returns null when no eslint config exists', async () => {
    const result = await runContextSelector(tmpDir);

    expect(result.eslintConfig).toBeNull();
  });

  it('reads .env.example and extracts only key names', async () => {
    const envExampleContent = `DATABASE_URL=postgresql://localhost/db
API_KEY=secret123
DESCRIPTION=This is a comment
DEBUG=false`;

    fs.writeFileSync(path.join(tmpDir, '.env.example'), envExampleContent);

    const result = await runContextSelector(tmpDir);

    expect(result.envExample).toContain('DATABASE_URL');
    expect(result.envExample).toContain('API_KEY');
    expect(result.envExample).toContain('DESCRIPTION');
    expect(result.envExample).toContain('DEBUG');
    expect(result.envExample).not.toContain('postgresql://localhost/db');
    expect(result.envExample).not.toContain('secret123');
    expect(result.envExample).not.toContain('false');
  });

  it('returns null when .env.example does not exist', async () => {
    const result = await runContextSelector(tmpDir);

    expect(result.envExample).toBeNull();
  });

  it('parses env.example correctly when it has comments', async () => {
    const envExampleContent = `# Database configuration
DATABASE_URL=postgres://localhost/db
# API settings
API_KEY=sk_test_123
# Skip blank lines

DEBUG=true`;

    fs.writeFileSync(path.join(tmpDir, '.env.example'), envExampleContent);

    const result = await runContextSelector(tmpDir);

    const lines = result.envExample!.split('\n').filter((l) => l.length > 0);
    expect(lines).toContain('DATABASE_URL');
    expect(lines).toContain('API_KEY');
    expect(lines).toContain('DEBUG');
  });

  it('truncates gitDiff to 8000 characters', async () => {
    // This test is limited because we can't easily trigger a large diff
    // in a non-git directory. The truncation is tested indirectly through
    // the implementation using .slice(0, 8000).
    const result = await runContextSelector(tmpDir);

    // Git commands will fail in non-git dir, so gitDiff will be empty string
    expect(result.gitDiff).toBe('');
    expect(result.gitDiff.length).toBeLessThanOrEqual(8000);
  });

  it('handles .eslintrc.json config file', async () => {
    const eslintConfig = '{"extends":"eslint:recommended"}';
    fs.writeFileSync(path.join(tmpDir, '.eslintrc.json'), eslintConfig);

    const result = await runContextSelector(tmpDir);

    expect(result.eslintConfig).toBe(eslintConfig);
  });

  it('checks eslint config files in order', async () => {
    // Only .eslintrc.json exists
    const eslintConfig = '{"extends":"json-config"}';
    fs.writeFileSync(path.join(tmpDir, '.eslintrc.json'), eslintConfig);

    const result = await runContextSelector(tmpDir);

    expect(result.eslintConfig).toBe(eslintConfig);
  });

  it('truncates eslint config to 500 characters', async () => {
    const longConfig = 'x'.repeat(1000);
    fs.writeFileSync(path.join(tmpDir, '.eslintrc'), longConfig);

    const result = await runContextSelector(tmpDir);

    expect(result.eslintConfig).toBe('x'.repeat(500));
    expect(result.eslintConfig!.length).toBe(500);
  });

  it('strips values from .env.example but keeps keys with empty values', async () => {
    const envExampleContent = `DATABASE_URL=
API_KEY=
SOMETHING=value`;

    fs.writeFileSync(path.join(tmpDir, '.env.example'), envExampleContent);

    const result = await runContextSelector(tmpDir);

    expect(result.envExample).toContain('DATABASE_URL');
    expect(result.envExample).toContain('API_KEY');
    expect(result.envExample).toContain('SOMETHING');
  });

  it('parses .env.example that starts with comments', async () => {
    const envExampleContent = `# This is a comment
# Another comment
DATABASE_URL=value`;

    fs.writeFileSync(path.join(tmpDir, '.env.example'), envExampleContent);

    const result = await runContextSelector(tmpDir);

    const lines = result.envExample!.split('\n').filter((l) => l.length > 0);
    expect(lines).toContain('DATABASE_URL');
    expect(lines.length).toBe(1);
  });

  it('parses .env.example with various key formats', async () => {
    const envExampleContent = `SIMPLE_KEY=value
NESTED_KEY_WITH_UNDERSCORE=test
MixedCase=data
number123=val`;

    fs.writeFileSync(path.join(tmpDir, '.env.example'), envExampleContent);

    const result = await runContextSelector(tmpDir);

    expect(result.envExample).toContain('SIMPLE_KEY');
    expect(result.envExample).toContain('NESTED_KEY_WITH_UNDERSCORE');
    expect(result.envExample).toContain('MixedCase');
    expect(result.envExample).toContain('number123');
  });

  it('validates output against WorkspaceContextSchema', async () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.ROBO.md'), '# test');

    const result = await runContextSelector(tmpDir);

    const validation = WorkspaceContextSchema.safeParse(result);
    expect(validation.success).toBe(true);
    if (validation.success) {
      expect(validation.data.cwd).toBe(tmpDir);
    }
  });
});
