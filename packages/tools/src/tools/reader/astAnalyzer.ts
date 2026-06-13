import path from 'node:path';
import fs from 'node:fs';
import { tool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { z } from 'zod';
import { createAstParser } from '../../../../shared/src/ast/parser';
import { AnalyzeAstToolSchema } from '../../../../shared/src/schemas/reader/tools/ast';
import { TOOL_NAMES } from '../../../../shared/src/types/agent';
import { findFunctions, findClasses, findImports, findReferences } from '../../utils/ast';
import { debug } from '@robocode-packages/shared';

export const astAnalyzer = async (
  { filePath, queryType, symbolName, includeBody }: z.infer<typeof AnalyzeAstToolSchema>,
  config?: RunnableConfig
) => {
  try {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    if (!fs.existsSync(targetPath)) {
      return JSON.stringify({ ok: false, file: targetPath, queryType, error: 'File not found' });
    }
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return JSON.stringify({
        ok: false,
        file: targetPath,
        queryType,
        error: 'Path is a directory',
      });
    }

    const ext = path.extname(targetPath).toLowerCase();
    debug('EXTENSION', { ext, targetPath });
    const { parser, language } = await createAstParser(targetPath);
    if (!language) {
      return JSON.stringify({
        ok: false,
        file: targetPath,
        queryType,
        error: `No parser for ${ext}`,
      });
    }

    const source = fs.readFileSync(targetPath, 'utf-8');
    const tree = parser.parse(source);
    debug('AST tree ', tree);
    if (!tree) {
      return JSON.stringify({
        ok: false,
        file: targetPath,
        queryType,
        error: 'AST tree not found',
      });
    }

    let result;
    switch (queryType) {
      case 'functions':
        result = findFunctions(tree.rootNode, source, language, includeBody);
        break;
      case 'classes':
        result = findClasses(tree.rootNode, source, language);
        break;
      case 'imports':
        result = findImports(tree.rootNode, source, language);
        break;
      case 'references':
        result = findReferences(tree.rootNode, source, targetPath, symbolName);
        break;
    }
    debug('AST RESULT ', result);
    return JSON.stringify({ ok: true, file: targetPath, queryType, [queryType]: result });
  } catch (err: any) {
    debug('AST ERROR ', err);
    return JSON.stringify({
      ok: false,
      file: filePath,
      queryType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export const astAnalyzerTool = tool(astAnalyzer, {
  name: TOOL_NAMES.ast_analyzer,
  description:
    'Analyze code structure using tree-sitter AST. Returns functions, classes, imports, or symbol references.',
  schema: AnalyzeAstToolSchema,
});
