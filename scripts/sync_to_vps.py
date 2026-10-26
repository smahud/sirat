#!/usr/bin/env python3
"""SIRAT — sync source code lokal ke VPS via SFTP (paramiko).

Exclude: node_modules, .next, db/, data/, skills/, .git, dev.log,
server.log, .env, tsconfig.tsbuildinfo, bun.lock, download/, .zscripts/,
mini-services/, examples/, upload/, skills/, tests/*.sh (build scripts).

Include: src/, prisma/, scripts/, docs/, public/, package.json,
package-lock.json, next.config.ts, tsconfig.json, tailwind.config.*,
postcss.config.mjs, components.json, eslint.config.mjs, vitest.config.ts,
.env.example, Dockerfile, docker-compose.yml, .gitignore, Caddyfile,
tests/numbering.test.ts, next-env.d.ts.
"""
import os, sys, stat
import paramiko

HOST = 'host.zerotier.my.id'
PORT = 2226
USER = 'root'
KEY = os.path.expanduser('~/.ssh/id_ed25519_sirat')
LOCAL_ROOT = '/home/z/my-project'
REMOTE_ROOT = '/var/www/sirat'

# Directories to skip entirely (relative to LOCAL_ROOT)
SKIP_DIRS = {
    'node_modules', '.next', '.git', 'db', 'data', 'skills', 'download',
    '.zscripts', 'mini-services', 'examples', 'upload', '.cursor',
    'agent-ctx', 'agent-bin',
}
# Files to skip
SKIP_FILES = {
    '.env', 'tsconfig.tsbuildinfo', 'bun.lock', 'dev.log', 'server.log',
    'dev.out.log', '.z-ai-config', 'next-env.d.ts.bak',
}
# Skip tests build scripts (kept database-runtime-build.sh etc — not used in deploy)
SKIP_TESTS_SH = True

def should_skip(rel_path: str, is_dir: bool) -> bool:
    parts = rel_path.split(os.sep)
    for p in parts:
        if p in SKIP_DIRS:
            return True
    if not is_dir:
        name = parts[-1]
        if name in SKIP_FILES:
            return True
        if name.startswith('local-') or name.endswith('.log'):
            return True
        if name == '.DS_Store':
            return True
        if parts[0] == 'tests' and SKIP_TESTS_SH and name.endswith('.sh') and name != 'smoke-local.sh':
            return True
        if parts[0] == 'download':
            return True
    return False

def ensure_remote_dir(sftp, remote_path: str):
    """mkdir -p on remote."""
    parts = remote_path.strip('/').split('/')
    cur = ''
    for p in parts:
        cur = cur + '/' + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur, mode=0o755)

def upload_file(sftp, local: str, remote: str):
    sftp.put(local, remote)
    # Preserve executable bit for scripts
    st = os.stat(local)
    if st.st_mode & 0o111:
        try:
            sftp.chmod(remote, 0o755)
        except Exception:
            pass

def walk_and_upload(sftp):
    uploaded = 0
    skipped = 0
    errors = []
    for root, dirs, files in os.walk(LOCAL_ROOT):
        rel_root = os.path.relpath(root, LOCAL_ROOT)
        if rel_root == '.':
            rel_root = ''
        # Filter dirs in-place
        dirs[:] = [d for d in dirs if not should_skip(
            os.path.join(rel_root, d) if rel_root else d, True)]
        # Create remote dir
        if rel_root:
            remote_dir = REMOTE_ROOT + '/' + rel_root.replace(os.sep, '/')
        else:
            remote_dir = REMOTE_ROOT
        try:
            ensure_remote_dir(sftp, remote_dir)
        except Exception as e:
            errors.append(f'mkdir {remote_dir}: {e}')
            continue
        for f in files:
            local_file = os.path.join(root, f)
            rel_file = os.path.join(rel_root, f) if rel_root else f
            if should_skip(rel_file, False):
                skipped += 1
                continue
            remote_file = remote_dir + '/' + f
            try:
                upload_file(sftp, local_file, remote_file)
                uploaded += 1
                # Print every 50 files to keep visible progress
                if uploaded % 50 == 0:
                    print(f'  uploaded {uploaded} files... ({rel_file})')
            except Exception as e:
                errors.append(f'put {rel_file}: {e}')
                print(f'  [skip] {rel_file}: {e}', file=sys.stderr)
    return uploaded, skipped, errors

def main():
    print(f'Connecting to {USER}@{HOST}:{PORT} ...')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=HOST, port=PORT, username=USER,
                   key_filename=KEY, look_for_keys=False, allow_agent=False,
                   timeout=15, auth_timeout=15)
    sftp = client.open_sftp()
    try:
        print(f'Remote root: {REMOTE_ROOT}')
        ensure_remote_dir(sftp, REMOTE_ROOT)
        # Pre-clean remote: remove old src/ docs/ scripts/ prisma/ public/ to avoid stale files
        for stale_dir in ['src', 'docs', 'public', 'tests']:
            try:
                # Walk-and-delete recursively
                def _rm(path):
                    try:
                        st = sftp.stat(path)
                        if stat.S_ISDIR(st.st_mode):
                            for entry in sftp.listdir(path):
                                _rm(path + '/' + entry)
                            sftp.rmdir(path)
                        else:
                            sftp.remove(path)
                    except FileNotFoundError:
                        pass
                _rm(REMOTE_ROOT + '/' + stale_dir)
                print(f'  cleaned {stale_dir}/')
            except Exception as e:
                print(f'  [warn] clean {stale_dir}: {e}')
        print('Uploading...')
        uploaded, skipped, errors = walk_and_upload(sftp)
        print(f'\n✅ uploaded {uploaded} files, skipped {skipped}')
        if errors:
            print(f'⚠️  {len(errors)} errors:')
            for e in errors[:20]:
                print(f'  - {e}')
        # Set ownership to sirat:sirat (if user exists) via SSH
        print('\nSetting ownership sirat:sirat ...')
        chown_cmd = (
            'id sirat >/dev/null 2>&1 && '
            f'chown -R sirat:sirat {REMOTE_ROOT}/src {REMOTE_ROOT}/docs '
            f'{REMOTE_ROOT}/public {REMOTE_ROOT}/scripts {REMOTE_ROOT}/prisma 2>&1 '
            '|| echo sirat_not_yet_created'
        )
        stdin, stdout, stderr = client.exec_command(chown_cmd)
        out = stdout.read().decode()
        err = stderr.read().decode()
        print(f'  chown: {out}{err}' if (out or err) else '  chown OK')
    finally:
        sftp.close()
        client.close()

if __name__ == '__main__':
    main()
