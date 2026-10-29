import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDevelopmentEnvironment } from './dev-environment.mjs';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
let child;
let stopping = false;
let restarting = false;
let restartTimer;
let startupTimer;

function start() {
  let listening = false;
  child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/server.ts'], {
    cwd: apiRoot,
    env: { ...createDevelopmentEnvironment(process.env), OPERATOR_DEV_STARTUP_NOTIFY: '1' },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  startupTimer = setTimeout(() => {
    process.stderr.write('API has not reported that it is listening after 15 seconds. Check the startup output above.\n');
  }, 15_000);
  child.on('message', (message) => {
    if (message?.event === 'api.server.listening') {
      listening = true;
      clearTimeout(startupTimer);
    }
  });
  child.on('error', (error) => {
    process.stderr.write(`Could not start the API: ${error.message}\n`);
  });
  child.on('close', (code, signal) => {
    clearTimeout(startupTimer);
    child = undefined;
    if (stopping) return;
    if (restarting) {
      restarting = false;
      start();
      return;
    }
    process.stderr.write(`API process exited${listening ? '' : ' before listening'} (code: ${code ?? 'none'}, signal: ${signal ?? 'none'}). Waiting for a source change.\n`);
  });
}

const watcher = watch(sourceRoot, { recursive: true }, () => {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (stopping) return;
    if (!child) {
      start();
    } else if (!restarting) {
      restarting = true;
      child.kill();
    }
  }, 150);
});
watcher.on('error', (error) => {
  process.stderr.write(`API source watcher failed: ${error.message}\n`);
  stop('SIGTERM', 1);
});

function stop(signal, exitCode) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  clearTimeout(startupTimer);
  watcher.close();
  if (child) child.kill(signal);
  process.exitCode = exitCode;
}
process.once('SIGINT', () => stop('SIGINT', 130));
process.once('SIGTERM', () => stop('SIGTERM', 143));
start();
