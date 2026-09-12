import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(root, '.venv-market', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.PNL404_PYTHON || (existsSync(local) ? local : process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, [resolve(root, 'scripts/market-refresh.py'), ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', shell: false,
});
if (result.error) console.error(`Python 수집기를 시작하지 못했습니다. README의 전용 환경 설치를 확인하세요. (${result.error.code})`);
process.exitCode = result.status ?? 1;
