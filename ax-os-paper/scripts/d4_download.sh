#!/bin/bash
python3 - <<'EOF'
from huggingface_hub import snapshot_download
for m in ["Qwen/Qwen2.5-3B-Instruct", "Qwen/Qwen2.5-7B-Instruct",
          "mistralai/Mistral-7B-Instruct-v0.3", "Qwen/Qwen2.5-14B-Instruct"]:
    try:
        snapshot_download(m, ignore_patterns=["*.pth", "consolidated*"])
        print(f"OK {m}", flush=True)
    except Exception as e:
        print(f"FAIL {m}: {type(e).__name__}: {e}", flush=True)
EOF
