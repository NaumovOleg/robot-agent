import { Parser, Language } from 'web-tree-sitter';
import { detectLanguage } from '../utils';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _currentDir = dirname(fileURLToPath(import.meta.url));

export const createAstParser = async (pathname: string) => {
  await Parser.init();
  const parser = new Parser();
  const ext = path.extname(pathname).toLowerCase();
  let language = detectLanguage(pathname);

  if (ext === '.tsx') {
    language = 'tsx';
  }

  const Lang = await Language.load(path.join(_currentDir, `./wasm/${language}.wasm`));
  parser.setLanguage(Lang);
  return { parser, language };
};
