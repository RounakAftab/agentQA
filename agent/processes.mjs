// Child-process helpers for the worker: git, npm and Playwright.
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';

// Hides tokens embedded in clone URLs before anything is logged or stored.
export const redact = (text) => String(text).replace(/\/\/[^/@\s]+@/g, '//***@');

// Runs a command and resolves { code, stdout, stderr }. Never rejects on a non-zero exit;
// callers decide what a failure means. npm/npx are .cmd files on Windows and need a shell.
export function run(command, args, { cwd, env, timeoutMs = 10 * 60_000, signal } = {}) {
  return new Promise((resolve) => {
    const useShell = isWindows && ['npm', 'npx'].includes(command);
    const child = spawn(command, args, { cwd, env: env ?? process.env, shell: useShell, windowsHide: true, signal });
    let stdout = '';
    let stderr = '';
    const cap = (s, chunk) => (s.length > 2_000_000 ? s : s + chunk);
    child.stdout.on('data', (d) => (stdout = cap(stdout, d.toString())));
    child.stderr.on('data', (d) => (stderr = cap(stderr, d.toString())));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

// Ends a child process and everything it started (on Windows a plain kill leaves browsers open).
export async function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWindows) await run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeoutMs: 15_000 });
  else child.kill('SIGTERM');
}

export async function runOrThrow(command, args, opts) {
  const result = await run(command, args, opts);
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout).trim().split('\n').slice(-15).join('\n');
    throw new Error(redact(`${command} ${args[0]} failed (exit ${result.code}): ${output}`));
  }
  return result;
}
