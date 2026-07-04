#!/bin/bash
python3 - <<'EOF'
from huggingface_hub import whoami, snapshot_download
print("token user:", whoami()["name"], flush=True)
snapshot_download("meta-llama/Llama-3.1-8B-Instruct",
                  ignore_patterns=["*.pth", "original*", "consolidated*"])
print("OK llama", flush=True)
EOF
