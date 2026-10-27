#!/usr/bin/env python3
"""Generate ed25519 SSH keypair for VPS access, saved to BOTH:
  - ~/.ssh/id_ed25519_sirat            (standard location, wiped on sandbox reset)
  - /home/z/my-project/sirat/keys/     (PERSISTENT across sandbox resets)
Also prints the public key for VPS authorization.
"""
import os
import shutil
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

SSH_DIR = os.path.expanduser("~/.ssh")
KEY_NAME = "id_ed25519_sirat"
PERSIST_DIR = "/home/z/my-project/sirat/keys"
COMMENT = "zai-sirat-vps"

os.makedirs(SSH_DIR, mode=0o700, exist_ok=True)
os.makedirs(PERSIST_DIR, mode=0o700, exist_ok=True)

private_key = Ed25519PrivateKey.generate()
pem = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.OpenSSH,
    encryption_algorithm=serialization.NoEncryption(),
)
pub = private_key.public_key().public_bytes(
    encoding=serialization.Encoding.OpenSSH,
    format=serialization.PublicFormat.OpenSSH,
)
public_line = pub.decode("ascii").strip() + " " + COMMENT

for base in (SSH_DIR, PERSIST_DIR):
    kp = os.path.join(base, KEY_NAME)
    with open(kp, "wb") as f:
        f.write(pem)
    os.chmod(kp, 0o600)
    with open(kp + ".pub", "w") as f:
        f.write(public_line + "\n")
    os.chmod(kp + ".pub", 0o644)

# Copy pub key to download/ for easy user access
with open("/home/z/my-project/download/sirat_v17_public_key.pub", "w") as f:
    f.write(public_line + "\n")

print("=== PRIVATE KEY SAVED (2 locations) ===")
print(f"  {os.path.join(SSH_DIR, KEY_NAME)}")
print(f"  {os.path.join(PERSIST_DIR, KEY_NAME)}")
print()
print("=== PUBLIC KEY (copy ke VPS authorized_keys) ===")
print(public_line)
