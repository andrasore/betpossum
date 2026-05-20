import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '..');
export const PROJECT = 'betting-e2e';

export const COMPOSE_FILES = [
  '-f', 'docker-compose.yml',
  '-f', 'docker-compose.e2e.yml',
  ...(process.env.CI ? ['-f', 'docker-compose.ci.yml'] : []),
];

export const LOGS_DIR = path.join(__dirname, 'test-results', 'docker-logs');

export function compose(args: string[]): void {
  const result = spawnSync(
    'docker',
    ['compose', '-p', PROJECT, ...COMPOSE_FILES, ...args],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} exited with ${result.status}`);
  }
}

export function captureLogs(outDir: string = LOGS_DIR): void {
  const ps = spawnSync(
    'docker',
    ['compose', '-p', PROJECT, ...COMPOSE_FILES, 'ps', '--all', '--services'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (ps.status !== 0) {
    console.warn(`  could not list services (exit ${ps.status}): ${ps.stderr}`);
    return;
  }
  const services = ps.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (services.length === 0) {
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const svc of services) {
    const logs = spawnSync(
      'docker',
      ['compose', '-p', PROJECT, ...COMPOSE_FILES, 'logs', '--no-color', '--timestamps', svc],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    fs.writeFileSync(path.join(outDir, `${svc}.log`), (logs.stdout ?? '') + (logs.stderr ?? ''));
  }
  console.log(`  wrote logs for ${services.length} service(s) to ${outDir}`);
}
