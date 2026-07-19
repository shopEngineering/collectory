/// <reference types="vite/client" />

// Electron preload bridge (present only in the Electron shell).
interface CollectoryBridge {
  onNavigate?: (cb: (path: string) => void) => void;
}
interface Window {
  collectory?: CollectoryBridge;
}
