#!/usr/bin/env python3
"""SSH helper for SIRAT VPS - reusable command runner."""
import sys
import os
import paramiko

HOST = 'host.zerotier.my.id'
PORT = 2226
USER = 'root'
KEY = os.path.expanduser('~/.ssh/id_ed25519_sirat')

def get_client():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=HOST, port=PORT, username=USER,
        key_filename=KEY, look_for_keys=False, allow_agent=False,
        timeout=15, auth_timeout=15,
    )
    return client

def run(client, cmd, timeout=30):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    return code, out, err

if __name__ == '__main__':
    cmds = sys.argv[1:] if len(sys.argv) > 1 else ['hostname; whoami; uptime']
    c = get_client()
    try:
        for cmd in cmds:
            code, out, err = run(c, cmd)
            print(f'$ {cmd}')
            if out.strip():
                print(out.rstrip())
            if err.strip():
                print('[stderr]', err.rstrip())
            print(f'[exit={code}]')
            print('-' * 60)
    finally:
        c.close()
