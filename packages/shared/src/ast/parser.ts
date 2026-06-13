import { Parser, Language } from 'web-tree-sitter';
import { detectLanguage } from '../utils';
import path from 'node:path';
import fs from 'node:fs';
import { debug } from '../utils';
import * as awsm from './wasm/c.wasm';

debug(awsm);

const resolveAstDir = (): string => {
  const candidates: string[] = [];
  if (typeof __dirname === 'string' && __dirname.length > 0) {
    candidates.push(__dirname);
  }
  candidates.push(path.resolve(process.cwd(), './'), path.resolve(process.cwd(), './dist'));

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'wasm'))) {
      return dir;
    }
  }

  return candidates[0] ?? process.cwd();
};

const AST_DIR = resolveAstDir();
const parserCache = new Map<string, Promise<Language>>();
let parserInitPromise: Promise<void> | null = null;

const ensureParserInit = async (): Promise<void> => {
  if (!parserInitPromise) {
    parserInitPromise = Parser.init();
  }
  return parserInitPromise;
};

const loadLanguage = async (language: string): Promise<Language> => {
  debug('AST_DIR', AST_DIR);
  const cached = parserCache.get(language);
  if (cached) return cached;
  const wasmPath = path.join(AST_DIR, 'wasm', `${language}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`No AST wasm grammar for language: ${language}`);
  }
  const loader = Language.load(wasmPath);
  parserCache.set(language, loader);
  return loader;
};

export const createAstParser = async (pathname: string) => {
  await ensureParserInit();
  const parser = new Parser();
  const ext = path.extname(pathname).toLowerCase();
  let language = detectLanguage(pathname);

  if (ext === '.tsx') {
    language = 'tsx';
  }

  const Lang = await loadLanguage(language);
  parser.setLanguage(Lang);
  return { parser, language };
};
