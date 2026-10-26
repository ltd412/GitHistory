#!/bin/bash
# WHY: electron-builder's default postinst picks mode 0755 when `unshare --user` works for root, but Ubuntu 23.10+
# (AppArmor apparmor_restrict_unprivileged_userns) blocks user namespaces for normal users, so Chromium aborts
# at launch unless chrome-sandbox is SUID root. The SUID sandbox is valid on every system, so always set it.
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
