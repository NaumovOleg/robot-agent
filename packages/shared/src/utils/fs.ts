import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@robocode-packages/config';

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

export const loadJsonFile = <T>(path: string): T | null => {
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
