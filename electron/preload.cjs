'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('bridge', {
  platform: process.platform,
  git: (method, ...args) => ipcRenderer.invoke('git', method, args),
  app: (method, ...args) => ipcRenderer.invoke('app', method, args),
  onRepoChanged: on('repo:changed'),
  onProgress: on('git:progress'),
  onMenu: on('menu'),
});
