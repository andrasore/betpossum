import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const TB_VERSION = '0.17.3';

const ARCH_MAP: Record<string, string> = {
  x64: 'x86_64',
  arm64: 'aarch64',
};

const ARCH = ARCH_MAP[process.arch] ?? 'x86_64';
const TB_DOWNLOAD_URL = `https://github.com/tigerbeetle/tigerbeetle/releases/download/${TB_VERSION}/tigerbeetle-${ARCH}-linux.zip`;

const TB_BIN_DIR = path.join(__dirname, '.tb_bin');
const TB_BIN = path.join(TB_BIN_DIR, 'tigerbeetle');

async function ensureBinary(): Promise<void> {
  if (fs.existsSync(TB_BIN)) return;
  await fsp.mkdir(TB_BIN_DIR, { recursive: true });
  const zipPath = path.join(TB_BIN_DIR, 'tb.zip');
  console.log(`\nDownloading TigerBeetle ${TB_VERSION} …`);
  const res = await fetch(TB_DOWNLOAD_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(zipPath));
  execFileSync('unzip', ['-o', zipPath, 'tigerbeetle', '-d', TB_BIN_DIR], { stdio: 'inherit' });
  await fsp.chmod(TB_BIN, 0o755);
  await fsp.rm(zipPath);
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not get free port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const sock = net.createConnection({ host: '127.0.0.1', port });
      sock.once('connect', () => {
        sock.end();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`TigerBeetle did not open port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 100);
        }
      });
    };
    tryConnect();
  });
}

export type TbInstance = {
  address: string;
  shutdown: () => Promise<void>;
};

export async function startTigerBeetle(): Promise<TbInstance> {
  await ensureBinary();
  const port = await pickFreePort();
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tb_test_'));
  const dataFile = path.join(dataDir, '0_0.tigerbeetle');

  execFileSync(
    TB_BIN,
    ['format', '--cluster=0', '--replica=0', '--replica-count=1', dataFile],
    { stdio: 'pipe' },
  );

  const proc: ChildProcess = spawn(
    TB_BIN,
    ['start', `--addresses=127.0.0.1:${port}`, dataFile],
    { stdio: 'ignore' },
  );

  await waitForPort(port, 15_000);

  return {
    address: `127.0.0.1:${port}`,
    async shutdown() {
      if (proc.pid && !proc.killed) {
        proc.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            proc.kill('SIGKILL');
            resolve();
          }, 5_000);
          proc.once('exit', () => {
            clearTimeout(t);
            resolve();
          });
        });
      }
      await fsp.rm(dataDir, { recursive: true, force: true });
    },
  };
}
