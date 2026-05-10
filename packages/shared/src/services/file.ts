import {
  saveJsonFile,
  deleteDir,
  renameFile,
  renameDir,
  loadJsonFile,
  deleteFile,
  readFile,
  writeFile,
} from '../utils/fs';

export class FileSystem {
  static loadJson<T>(pathname: string) {
    return loadJsonFile<T>(pathname);
  }

  static readonly writeJson = <T>(pathname: string, content: T): void => {
    return saveJsonFile(pathname, content);
  };

  static readonly deleteFile = (name: string) => {
    return deleteFile(name);
  };

  static deleteDir(name: string) {
    return deleteDir(name);
  }
  static readonly renameFile = (oldPath: string, newPath: string) => {
    return renameFile(oldPath, newPath);
  };

  static readonly renameDir = (oldPath: string, newPath: string) => {
    return renameDir(oldPath, newPath);
  };

  static readonly readFile = (pathname: string) => {
    return readFile(pathname);
  };
  static readonly writeFile = (pathname: string, content: string) => {
    return writeFile(pathname, content);
  };
}
