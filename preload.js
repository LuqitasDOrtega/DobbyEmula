const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getEmujsPort:    ()   => ipcRenderer.invoke('get-emujs-port'),
  openRom:         ()   => ipcRenderer.invoke('open-rom'),
  scanRoms:        ()   => ipcRenderer.invoke('scan-roms'),
  openRomByPath:   (p)  => ipcRenderer.invoke('open-rom-by-path', p),
  saveState:       (o)  => ipcRenderer.invoke('save-state', o),
  loadState:       (o)  => ipcRenderer.invoke('load-state', o),
  listSaveSlots:   (o)  => ipcRenderer.invoke('list-save-slots', o),
  windowMinimize:  ()   => ipcRenderer.send('window-minimize'),
  windowMaximize:  ()   => ipcRenderer.send('window-maximize'),
  windowClose:     ()   => ipcRenderer.send('window-close'),
  toggleFullscreen:()   => ipcRenderer.send('toggle-fullscreen'),
  openExternal:    (url)=> ipcRenderer.send('open-external', url),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, data) => cb(data)),
});
