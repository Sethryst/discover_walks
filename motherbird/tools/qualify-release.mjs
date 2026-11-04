import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.QUALIFICATION_OUTPUT || path.join(root, 'test-results', 'qualification');
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['playwright', 'test', '-c', 'playwright.qualify.config.mjs'], { cwd: root, env: { ...process.env, QUALIFICATION_OUTPUT: output }, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
