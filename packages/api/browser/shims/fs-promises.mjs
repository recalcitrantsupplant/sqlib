import fs from './fs.mjs';
export const { readFile, writeFile, appendFile, mkdir, readdir, stat, lstat, access, unlink, rm, rmdir, rename, copyFile, realpath, mkdtemp, readlink, chmod, utimes, open } = fs.promises;
export const constants = fs.constants;
export default fs.promises;
