import { contextBridge } from 'electron'

// Server port and token are exposed here once the server lifecycle exists (step 1, unit 7).
contextBridge.exposeInMainWorld('aiplot', {})
