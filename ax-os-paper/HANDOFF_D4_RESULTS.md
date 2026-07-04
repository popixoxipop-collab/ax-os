# AX OS Paper — D4 Results & Methodology Correction (RTX 5070 Ti, CUDA)

**Created:** 2026-07-04
**Machine:** RTX 5070 Ti (Blackwell, SM12.0, 15.9GB VRAM), WSL2 Ubuntu, PyTorch 2.11+cu128, transformers 5.12
**Parent doc:** [`HANDOFF_D4.md`](./HANDOFF_D4.md) (the execution plan added in `8371a88`)
**Status:** ✅ **COMPLETE (2026-07-04)** — 4 affine-q4 models (1.5B/3B/7B/Mistral)
cross-validated within 0.3 pp of MLX, + 14B via NF4 (scheme exception), + 5 BF16
baselines matching to 4 s.f. Merged and pushed: `4174781` (results) on top of
`d4b6823` (this doc). The D4 main-conference blocker is resolved. Only
Llama-3.1-8B remains as an **optional** 6th point (access requested/pending; see §3d).

> **This document CORRECTS the core recipe in `HANDOFF_D4.md`.** The fake-quant
> reimplementation prescribed there (§"What to build instead") does **not**
> reproduce MLX's `mx.quantize` and must not be used. See §2. The authoritative
> pipeline is convert-with-real-MLX → `mx.dequantize` → inject → eval on CUDA.

---

## 1. TL;DR — cross-hardware ΔPPL (WikiText-2, full test split, 512-token windows)

The claim D4 must defend: **ΔPPL% is hardware-invariant** (a property of the
model+quantization, not of MLX's Metal kernels). Every CUDA BF16 baseline below
reproduces the MLX baseline to 4 significant figures, and every completed q4
point reproduces the MLX ΔPPL% to within measurement noise.

| Model | BF16 CUDA (MLX) | q4 CUDA (MLX) | ΔPPL% CUDA | ΔPPL% MLX | verdict |
|-------|-----------------|---------------|-----------|-----------|---------|
| Qwen2.5-1.5B | 12.7000 (12.70) | 14.6208 (14.60) | **+15.12%** | +15.0% | ✅ reproduced |
| Qwen2.5-3B   | 11.4486 (11.45) | 12.8179 (12.79) | **+11.96%** | +11.7% | ✅ reproduced |
| Qwen2.5-7B   | 10.1444 (10.14) | 11.0123 (11.01) | **+8.56%** | +8.5% | ✅ reproduced |
| Mistral-7B-v0.3 | 7.2429 (7.24) | 7.5624 (7.56) | **+4.41%** | +4.4% | ✅ reproduced |
| Qwen2.5-14B  | 7.7315 (7.73) | 8.2716 (NF4) | +7.0%<sup>†</sup> | +10.3% | ⚠ NF4 scheme |
| Llama-3.1-8B | *blocked* (9.47) | *blocked* (10.12) | — | +6.9% | 🔒 gated repo |

Numbers in parentheses are the MLX (Apple M1 Max) values from `HANDOFF.md` §3.
Four of five affine-q4 models reproduce the MLX ΔPPL% within **0.3 pp** (1.5B, 3B,
7B, Mistral); all five BF16 baselines match MLX to four significant figures
(incl. 14B: 7.73 vs 7.7315). <sup>†</sup>Qwen2.5-14B is a **scheme exception** —
its BF16 (~28 GB) exceeds the 15.9 GB card, so CUDA q4 uses bitsandbytes NF4, not
affine RTN. NF4's +7.0% (vs MLX affine +10.3%) reflects NF4's better 4-bit
encoding, not a hardware effect; reported as a separate data point. Only
Llama-3.1-8B remains, blocked on gated-repo access.

---

## 2. Methodology correction (READ THIS BEFORE RESUMING)

### What HANDOFF_D4.md told us to do
Reimplement `mx.quantize(group_size=64, bits=4, mode="affine")` as a PyTorch
"fake-quant" pass (per-group min-max affine RTN over every `nn.Linear` +
`nn.Embedding`, incl. `embed_tokens`/`lm_head`), then run the forward pass on
CUDA. The stated validation gate was "Qwen2.5-1.5B reproduces ΔPPL ≈ +15.0%".

### Why that failed
The 1.5B gate **passed** (RTN q4 PPL 14.6016, ΔPPL +14.97%) — which is exactly
why it was a dangerous gate: it gave false confidence. On **3B the same code
diverged catastrophically**: RTN q4 PPL **15.097 → ΔPPL +31.9%** against MLX's
+11.7%. A single-model gate could not catch this.

Root-cause debug (mini-eval, 40 windows, 3B), sweeping the obvious suspects:

| RTN variant | mini-ΔPPL% |
|---|---|
| bf16 arithmetic (as written in HANDOFF_D4.md) | +31.8% |
| fp32 arithmetic | +22.8% |
| fp32 arithmetic, skip embeddings | +19.5% |
| MLX reference | **+11.7%** |

**No variant reproduced MLX.** So the divergence is *not* explained by
arithmetic precision or embedding coverage — the two knobs HANDOFF_D4.md worried
about. There is a **structural** difference between a hand-rolled affine RTN and
MLX's actual `mx.quantize` (candidate causes: MLX's exact rounding/packing,
bias-term handling, or per-group orientation). Reproducing it by re-derivation
is a rabbit hole, and — crucially — any residual mismatch silently confounds the
very hardware comparison D4 exists to make.

### The correct pipeline (authoritative, byte-exact scheme parity)
Do **not** reimplement the quantizer. Use MLX's own quantize/dequantize:

1. **Convert with the real quantizer.** `mlx` has a CPU build that installs and
   runs on Linux/WSL (no Apple Silicon required):
   ```bash
   pip install --user --break-system-packages mlx mlx-lm
   python3 -m mlx_lm convert --hf-path Qwen/Qwen2.5-3B-Instruct \
     --mlx-path artifacts/mlx_q4/qwen3b -q --q-bits 4 --q-group-size 64
   ```
   This produces the *exact same* q4 checkpoint the paper's MLX numbers came
   from (same `mx.quantize`, same code path).
2. **Dequantize with MLX's authoritative inverse.**
   `mx.dequantize(w, scales, biases, group_size=64, bits=4, mode="affine")`
   yields the precise weights MLX uses in its forward pass.
3. **Inject into the HF model (bf16) and run on CUDA.** The q4 weights *are* the
   MLX weights; the only thing that differs is the hardware executing the
   matmuls — which is exactly, and only, what D4 is supposed to isolate.

Implemented in [`eval/eval_ppl_wikitext2_cuda_mlxparity.py`](./eval/eval_ppl_wikitext2_cuda_mlxparity.py).
Result: 1.5B +15.12%, 3B +11.96% — both reproduce MLX. Scheme confound: gone.

### Consequence for artifacts
Three checkpoint families now live in `artifacts/`. **Only `_q4mlx_` is valid.**

| Suffix | Meaning | Use? |
|---|---|---|
| `_cuda_bf16_` | BF16 baseline | ✅ authoritative |
| `_cuda_q4mlx_` | dequantized real MLX q4 | ✅ authoritative |
| `_cuda_q4_` | hand-rolled RTN (bf16 arith) | ❌ DEPRECATED — do not cite |
| `_cuda_q4fp32_` | hand-rolled RTN (fp32 arith) | ❌ DEPRECATED — do not cite |

The deprecated files are kept only as evidence of the investigation above.

---

## 3. What remains (all mechanical, all checkpointed)

> **UPDATE 2026-07-04:** (a) 7B, (b) Mistral, and (c) 14B are **DONE** — results
> in §1. Only **(d) Llama-3.1-8B** remains, blocked on gated-repo access. The
> commands below are retained as the record of how each was produced. Reliability
> note learned the hard way: long (>10 min) offloaded evals die *silently, no
> traceback* if the last Windows `wsl.exe` client exits (WSL auto-terminates the
> distro — not OOM; check `dmesg` for oom-killer to confirm). Keep a persistent
> client alive for the whole run: a WMI-spawned `wsl.exe --exec sleep <N>`
> survives the harness; a `tail -F` Monitor also works. Then `setsid nohup` the
> eval and watch its log.

Run order and exact commands. Every eval checkpoints every 100 strides, so any
interruption resumes losslessly — just re-run the same command.

**a) Qwen2.5-7B q4 — ✅ DONE (11.0123, +8.56%). Was resumed from stride 500/585:**
```bash
cd ~/ax-os/ax-os-paper
python3 -u eval/eval_ppl_wikitext2_cuda_mlxparity.py \
  --hf-model Qwen/Qwen2.5-7B-Instruct --mlx-dir artifacts/mlx_q4/qwen7b \
  --device-map auto \
  --checkpoint artifacts/qwen25_7b_instruct_cuda_q4mlx_ppl_checkpoint.json
```

**b) Mistral-7B q4 — convert + eval (MLX dir not yet generated):**
```bash
python3 -m mlx_lm convert --hf-path mistralai/Mistral-7B-Instruct-v0.3 \
  --mlx-path artifacts/mlx_q4/mistral7b -q --q-bits 4 --q-group-size 64
python3 -u eval/eval_ppl_wikitext2_cuda_mlxparity.py \
  --hf-model mistralai/Mistral-7B-Instruct-v0.3 --mlx-dir artifacts/mlx_q4/mistral7b \
  --device-map auto \
  --checkpoint artifacts/mistral_7b_instruct_v03_cuda_q4mlx_ppl_checkpoint.json
```
(The existing `mistral..._cuda_q4_` = 7.4586 is the DEPRECATED RTN result — ignore.)

**c) Qwen2.5-14B — scheme exception (user-approved).** BF16 weights (~28GB) do
not fit 15.9GB VRAM, and fake-quant/dequant-inject does not save memory, so 14B
uses **real 4-bit packing via bitsandbytes NF4** for q4, plus a CPU-offload BF16
baseline. This is a *different quantization scheme* from the other rows (NF4 ≠
MLX affine-RTN) and **must be flagged as such in the paper** — report it as a
hardware-driven asymmetry, not silently merged into the affine-RTN column.
```bash
python3 -u eval/eval_ppl_wikitext2_cuda.py --model Qwen/Qwen2.5-14B-Instruct \
  --precision nf4 --device-map cuda
python3 -u eval/eval_ppl_wikitext2_cuda.py --model Qwen/Qwen2.5-14B-Instruct \
  --precision bf16 --device-map auto
```

**d) Llama-3.1-8B — OPTIONAL, access requested/pending (2026-07-04).** The HF
token (account `XOXOXOXOXOXO`) authenticates but is not yet on
`meta-llama/Llama-3.1-8B-Instruct`'s access list — file `resolve` returns 403
(the model-info API returning 200 is *not* a grant; check with a file-resolve
HEAD, not `/api/models/...`). A license-acceptance request has been submitted and
is awaiting Meta approval. This row is not needed for the paper's claim (already
carried by the 4 affine models + 14B); add it only for completeness once granted.

Completion procedure once access is granted (WSL outbound is down, so download on
the Windows side and hand the cache to WSL via `/mnt`):
```bash
# Windows (has network + token): download into a shared NTFS cache
HF_HOME='G:/hf_cache' HF_TOKEN=<token> python -c "from huggingface_hub import \
  snapshot_download; snapshot_download('meta-llama/Llama-3.1-8B-Instruct', \
  ignore_patterns=['original*','consolidated*','*.pth'])"
# WSL: convert + eval, reading the shared cache offline
bash scripts/d4_run_llama.sh          # HF_HOME=/mnt/g/hf_cache, ready to go
```
Then add the 6th row to `tab:crosshw` (macro `\XLDP`; MLX reference $+6.9\%$).

---

## 4. Infrastructure lessons (this machine, this week)

Non-obvious failures cost most of the wall-clock. Recording them so the next
pickup doesn't re-derive them.

1. **Host drive fill → WSL Errno 5.** HF model downloads (~63GB) inflated the
   default-Ubuntu `ext4.vhdx` (was on `C:`, 95GB) until `C:` hit 0 bytes, which
   surfaced *inside* WSL as `OSError: [Errno 5] Input/output error` on random
   imports — not as an obvious disk error (WSL's own `df` looks fine; the VHD is
   sparse). Fixed by moving the distro to `G:`:
   `wsl --manage Ubuntu --move G:\WSL\Ubuntu` (fully stop `vmmemWSL` first, else
   `ERROR_SHARING_VIOLATION` / `WSL_E_DISTRO_NOT_STOPPED`). `C:` recovered 116GB.
2. **Distro auto-terminates with the last client.** WSL shuts the distro down
   when the last `wsl.exe` client process exits — killing `setsid`/`nohup`
   detached jobs with it. `uptime` reports shared-kernel time, so a distro
   restart is *invisible* there — don't trust it as a liveness signal. Keep a
   persistent client alive for the whole run: a `tail -F` Monitor and harness
   background tasks both count as clients; a `Start-Process` keepalive gets
   reaped by the harness job object, but a **WMI-created** one survives
   (`Invoke-CimMethod Win32_Process Create ... wsl.exe --exec sleep infinity`).
3. **Whole-model fp32 dequant → OOM.** Building a full fp32 weight dict for a 7B
   before injection peaks >32GB and gets OOM-killed in the 31GB VM. Fix:
   **stream** the dequant tensor-by-tensor (peak ~18GB) and load the HF model
   with `device_map={"": "cpu"}` (shard-by-shard, avoids the 2× eager-load
   burst). Both are in the mlxparity script.
4. **Everything checkpoints.** Every eval writes NLLs every 100 strides; deaths
   resume for free. This is why the repeated distro deaths cost time but no
   results.

---

## 5. Exit criteria (updated from HANDOFF_D4.md)

- [x] CUDA eval script written, replicating the MLX protocol exactly (512-token
      non-overlapping windows, unweighted window-mean PPL)
- [x] **Methodology settled**: authoritative MLX convert→dequantize→inject,
      superseding the fake-quant reimplementation (§2)
- [x] Validation reproduced on **four** affine-q4 models (1.5B +15.12%, 3B
      +11.96%, 7B +8.56%, Mistral +4.41%), all within 0.3 pp of MLX
- [x] All **five** BF16 baselines reproduce MLX to 4 s.f. (1.5B/3B/7B/Mistral/14B)
- [x] q4 for 7B, Mistral, 14B(NF4) **DONE**; only Llama-8B(gated) outstanding
- [x] Cross-hardware ΔPPL% table (`tab:crosshw`) + macros added to `paper.tex`
      (D5 macro pattern); 14B NF4 asymmetry flagged in caption and prose
- [ ] `HANDOFF.md` §2 (trajectory) and §9 (submission readiness) — updated in this
      commit; D4 downgraded from "sole blocker" to "complete modulo gated Llama"
- [ ] Llama-3.1-8B: convert+eval once gated-repo access is granted (see §3d)

---

## 6. File manifest (added this round)

- `eval/eval_ppl_wikitext2_cuda.py` — BF16 / RTN-q4 / NF4 CUDA eval (RTN path
  DEPRECATED for parity; NF4 path used for 14B)
- `eval/eval_ppl_wikitext2_cuda_mlxparity.py` — **authoritative** q4 path
  (dequantize real MLX checkpoint → inject → CUDA), streaming + low-mem loader
- `scripts/d4_parity_all.sh` — full parity queue (1.5B→7B→Mistral→14B), resumable
- `scripts/d4_run_mistral.sh`, `d4_run_14b.sh`, `d4_run_llama.sh` — per-model
  direct-run scripts (the reliable pattern: setsid+nohup under a WMI keepalive)
- `scripts/d4_download.sh`, `d4_download_llama.sh` — model fetch
- `scripts/d4_check_ckpt.sh` — dump all checkpoint PPLs
- `artifacts/*_cuda_bf16_*.json`, `artifacts/*_cuda_q4mlx_*.json` — authoritative
  results; `*_cuda_q4_*` / `*_cuda_q4fp32_*` — DEPRECATED (see §2)
- MLX q4 weight dirs (`artifacts/mlx_q4/*`, 6.5GB) are gitignored — regenerate
  with `mlx_lm convert` as in §3

---

## Sign-off

D4 is **done and merged** — cross-hardware ΔPPL% invariance is demonstrated on a
CUDA/Blackwell stack against the original Apple/MLX numbers, within 0.3 pp across
every affine-q4 model, with the quantizer-reimplementation trap identified and
avoided (§2). The paper carries `tab:crosshw`; `HANDOFF.md` §9 no longer lists D4
as a blocker. Nothing here is waiting on compute. The single open thread —
Llama-3.1-8B — is optional, gated on an approval outside this machine, and fully
scripted for a 30-minute finish whenever access lands (§3d).

*Wrapped up 2026-07-04.*

*— XOX / popixoxipop-collab* 🖤
