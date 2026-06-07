import fs from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from '@robocode-packages/config';

export const fileExists = async (filePath: string): Promise<boolean> => {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
};

export const firstExisting = async (cwd: string, candidates: string[]): Promise<string | null> => {
  for (const c of candidates) {
    if (await fileExists(path.join(cwd, c))) return c;
  }
  return null;
};

export const ensureFile = (pathname: string, defaultContent = '') => {
  ensureDir(pathname);
  if (!fs.existsSync(pathname)) {
    fs.writeFileSync(pathname, defaultContent);
  }
};

export const readFile = (pathname: string, defaultContent = '') => {
  ensureDir(pathname);
  if (!fs.existsSync(pathname)) {
    fs.writeFileSync(pathname, defaultContent);
  }
  return fs.readFileSync(pathname, 'utf-8');
};

const ensureDir = (pathname: string) => {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

export const ensureRootDir = () => ensureDir(ROOT_DIR);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadJsonFile = <T = any>(path: string): T | null => {
  try {
    const raw = fs.readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveJsonFile = <T>(pathname: string, content: T): void => {
  ensureFile(pathname);
  return fs.writeFileSync(pathname, JSON.stringify(content));
};

export const deleteFile = (pathname: string) => {
  if (fs.existsSync(pathname)) {
    fs.unlinkSync(pathname);
  }
};
export const deleteDir = (pathname: string) =>
  fs.rmSync(pathname, { recursive: true, force: true });

export const renameFile = (oldPath: string, newPath: string) => fs.renameSync(oldPath, newPath);

export const renameDir = (oldPath: string, newPath: string) => fs.renameSync(oldPath, newPath);

export const writeFile = (pathname: string, content: string): void => {
  ensureFile(pathname);
  return fs.writeFileSync(pathname, content);
};

export const appendFile = (pathname: string, content: string): void => {
  ensureFile(pathname);
  return fs.appendFileSync(pathname, content);
};

export const copyFile = (from: string, to: string): void => {
  ensureDir(to);
  if (!fs.existsSync(from)) return;
  return fs.copyFileSync(from, to);
};

export const readFileSafe = async (filePath: string): Promise<string | null> => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
};
