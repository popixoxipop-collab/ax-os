#!/bin/bash
# Self-healing guard, invoked by Windows Task Scheduler every 5 min.
# Runs the queue as a FOREGROUND child so the scheduler-owned wsl.exe stays
# alive as a WSL client for the queue's entire lifetime. Scheduler's
# IgnoreNew policy prevents overlapping instances.
pgrep -f d4_parity_all.sh > /dev/null && exit 0
grep -q "PARITY-ALL DONE" /home/alienware-r13/ax-os/ax-os-paper/scripts/d4_parity_all.log 2>/dev/null && exit 0
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
echo "[guard relaunch $(date -u +%H:%M:%S)]" >> scripts/d4_parity_all.log
exec bash scripts/d4_parity_all.sh
