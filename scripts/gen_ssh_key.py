#!/usr/bin/env python3
"""
Generate an OpenSSH-compatible Ed25519 keypair without ssh-keygen.
Writes:
  - private key  -> ~/.ssh/id_ed25519_sirat   (OpenSSH format, unencrypted)
  - public  key  -> ~/.ssh/id_ed25519_sirat.pub
"""
import os
import base64
import struct
import secrets
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

OUT_DIR = Path.home() / ".ssh"
OUT_DIR.mkdir(mode=0o700, exist_ok=True)

PRIV_PATH = OUT_DIR / "id_ed25519_sirat"
PUB_PATH  = OUT_DIR / "id_ed25519_sirat.pub"

COMMENT = "z-assistant@sirat"

# --- Generate Ed25519 key ---
priv = Ed25519PrivateKey.generate()
pub  = priv.public_key()

raw_pub_bytes = pub.public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw,
)

# --- Build OpenSSH public key string ---
# Format: base64( string("ssh-ed25519") || string(pubkey) )
def ssh_string(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b

blob = ssh_string(b"ssh-ed25519") + ssh_string(raw_pub_bytes)
b64 = base64.b64encode(blob).decode("ascii")
pub_line = f"ssh-ed25519 {b64} {COMMENT}\n"

PUB_PATH.write_text(pub_line)
PUB_PATH.chmod(0o644)

# --- Build OpenSSH private key (unencrypted) ---
def ssh_string_v(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b

priv_raw = priv.private_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PrivateFormat.Raw,
    encryption_algorithm=serialization.NoEncryption(),
)
# cryptography returns 32-byte seed for Ed25519 raw private; OpenSSH wants 64 bytes: priv_seed || pub
priv_full = priv_raw + raw_pub_bytes

public_blob  = ssh_string_v(b"ssh-ed25519") + ssh_string_v(raw_pub_bytes)

# OpenSSH private key section starts with two identical uint32 checkints
# (used to detect successful decryption)
checkint = secrets.randbelow(2**32)
private_inner = struct.pack(">II", checkint, checkint)
private_inner += ssh_string_v(b"ssh-ed25519") + ssh_string_v(raw_pub_bytes) + ssh_string_v(priv_full)
private_inner += ssh_string_v(COMMENT.encode("utf-8"))

# Cipher "none" uses block size 8 -> pad to multiple of 8 with 1,2,3,...
pad_len = (8 - (len(private_inner) % 8)) % 8
padding = bytes((i + 1) for i in range(pad_len))
private_blob_padded = private_inner + padding

unencrypted = b"openssh-key-v1\x00"
unencrypted += ssh_string_v(b"none")            # ciphername
unencrypted += ssh_string_v(b"none")            # kdfname
unencrypted += ssh_string_v(b"")                # kdf
unencrypted += struct.pack(">I", 1)             # number of keys
unencrypted += ssh_string_v(public_blob)
unencrypted += ssh_string_v(private_blob_padded)

b64_priv = base64.b64encode(unencrypted).decode("ascii")
wrapped = "\n".join(b64_priv[i:i+70] for i in range(0, len(b64_priv), 70))

priv_text = (
    "-----BEGIN OPENSSH PRIVATE KEY-----\n"
    + wrapped
    + "\n-----END OPENSSH PRIVATE KEY-----\n"
)
PRIV_PATH.write_text(priv_text)
PRIV_PATH.chmod(0o600)

print("=== PUBLIC KEY (send this to VPS) ===")
print(pub_line)
print(f"=== Files ===")
print(f"Private key : {PRIV_PATH}  (chmod 600)")
print(f"Public  key : {PUB_PATH}  (chmod 644)")
print(f"Fingerprint: ", end="")
import hashlib
fp = hashlib.sha256(blob).digest()
print("SHA256:" + base64.b64encode(fp).decode("ascii").rstrip("="))
