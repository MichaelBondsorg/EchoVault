// src/test/mocks/filesystem.js — in-memory Filesystem for vitest
const store = new Map();

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
    const files = [...store.keys()]
      .filter(p => p.startsWith(path + '/'))
      .map(p => ({ name: p.slice(path.length + 1), type: 'file' }));
    return { files };
  },
  async mkdir() { /* no-op */ },
  __reset() { store.clear(); }
};
