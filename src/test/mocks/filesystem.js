// src/test/mocks/filesystem.js — in-memory Filesystem for vitest
const store = new Map();
// Tracks directories created via mkdir() so readdir() can faithfully throw
// on a directory that was never created (mirrors real Filesystem plugin
// behavior — e.g. the capture inbox before anything has ever been written).
const dirs = new Set();

export const Directory = { Data: 'DATA' };
export const Encoding = { UTF8: 'utf8' };

export const Filesystem = {
  async writeFile({ path, data }) { store.set(path, data); return { uri: `mem://${path}` }; },
  async readFile({ path }) {
    if (!store.has(path)) throw new Error('File does not exist');
    return { data: store.get(path) };
  },
  async deleteFile({ path }) { store.delete(path); },
  async readdir({ path }) {
    if (!dirs.has(path)) {
      throw new Error(`${path} does not exist`);
    }
    const files = [...store.keys()]
      .filter(p => p.startsWith(path + '/'))
      .map(p => ({ name: p.slice(path.length + 1), type: 'file' }));
    return { files };
  },
  async mkdir({ path }) { dirs.add(path); },
  __reset() { store.clear(); dirs.clear(); }
};
