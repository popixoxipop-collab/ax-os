#!/bin/bash
cd /home/alienware-r13/ax-os/ax-os-paper
python3 - <<'EOF'
import json, glob, os
for f in sorted(glob.glob("artifacts/*cuda*_ppl_checkpoint.json")):
    d = json.load(open(f))
    print(os.path.basename(f), "strides:", len(d["nlls"]), f"next:{d['next_begin']}/{d['n']}",
          "done:", d.get("done"), "ppl:", round(d["ppl"], 4) if "ppl" in d else None)
EOF
echo "--- log section 7B q4 -> Mistral ---"
sed -n '/Qwen2.5-7B-Instruct \[q4\]/,/Mistral/p' scripts/d4_sweep.log | tr '\r' '\n' | tail -6
