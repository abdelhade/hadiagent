'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Invoke an IPC channel and return the result.
     * @param {string} channel
     * @param {*} data
     * @returns {Promise<*>}
     */
    invoke(channel, data) {
        return ipcRenderer.invoke(channel, data);
    },

    /**
     * Listen for messages on an IPC channel.
     * @param {string} channel
     * @param {Function} callback
     */
    on(channel, callback) {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
    },

    /**
     * Remove all listeners for an IPC channel.
     * @param {string} channel
     */
    removeAllListeners(channel) {
        ipcRenderer.removeAllListeners(channel);
    },
});
