let ready = true;
export function markProcessReady(): void { ready = true; }
export function markProcessDraining(): void { ready = false; }
export function isProcessReady(): boolean { return ready; }
