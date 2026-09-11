/**
 * Preload bridge.
 *
 * The only surface the renderer gets. Three functions, string in / string out,
 * no filesystem paths and no Node objects cross this line.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mfmBridge', {
  readSave: (key) => ipcRenderer.invoke('save:read', String(key)),
  writeSave: (key, value) => ipcRenderer.invoke('save:write', String(key), String(value)),
  removeSave: (key) => ipcRenderer.invoke('save:remove', String(key)),
});
