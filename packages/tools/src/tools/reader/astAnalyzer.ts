import type { AstAnalyzerInput } from '@robocode-packages/shared';
import { createAstParser, AnalyzeAstToolSchema, TOOL_NAMES } from '@robocode-packages/shared';
import path from 'node:path';
import fs from 'node:fs';
import { tool } from '@langchain/core/tools';
import { findFunctions, findClasses, findImports, findReferences } from '../../utils';

export const astAnalyzer = async ({
  filePath,
  queryType,
  symbolName,
  includeBody,
}: AstAnalyzerInput) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const { parser, language } = await createAstParser(filePath);
    if (!language) return `Error: No parser for ${ext}`;

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return 'Ast tree not found';
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
        result = findReferences(tree.rootNode, source, filePath, symbolName);
        break;
    }
    return JSON.stringify({ file: filePath, [queryType]: result });
  } catch (err: any) {
    console.log(err);
    return err.message;
  }
};

export const astAnalyzerTool = tool(astAnalyzer, {
  name: TOOL_NAMES.ast_analyzer,
  description:
    'Analyze code structure using tree-sitter AST. Returns functions, classes, imports, or symbol references.',
  schema: AnalyzeAstToolSchema,
});
