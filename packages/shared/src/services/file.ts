import {
  saveJsonFile,
  deleteDir,
  renameFile,
  renameDir,
  loadJsonFile,
  deleteFile,
} from '../utils/fs';

export class FileSystem {
  static loadJson<T>(pathname: string) {
    return loadJsonFile<T>(pathname);
  }

  static readonly writeJson = <T>(content: T, pathname: string): void => {
    return saveJsonFile(content, pathname);
  };

  static readonly deleteFile = (name: string) => {
    return deleteFile(name);
  };

  static deleteDir(name: string) {
    return deleteDir(name);
  }
  static readonly renameFile = (
    oldPath: string,

    newPath: string
  ) => {
    return renameFile(oldPath, newPath);
  };

  static readonly renameDir = (
    oldPath: string,

    newPath: string
  ) => {
    return renameDir(oldPath, newPath);
  };
}
