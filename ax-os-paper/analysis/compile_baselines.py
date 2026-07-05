#!/usr/bin/env python3
"""Compile our uniform-q4 vs real AWQ/GPTQ baselines from checkpoint JSONs."""
import json
import os

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "artifacts")

BF16 = {
    "Qwen2.5-1.5B": 12.7000, "Qwen2.5-3B": 11.4486, "Qwen2.5-7B": 10.1444,
    "Qwen2.5-14B": 7.7315, "Mistral-7B": 7.2429, "Llama-3.1-8B": 9.4668,
}
OUR_Q4 = {
    "Qwen2.5-1.5B": 15.12, "Qwen2.5-3B": 11.96, "Qwen2.5-7B": 8.56,
    "Qwen2.5-14B": None,  # NF4 scheme exception, not directly comparable
    "Mistral-7B": 4.41, "Llama-3.1-8B": 7.11,
}
AWQ_FILES = {
    "Qwen2.5-1.5B": "qwen25_15b_instruct_awq_cuda_awq_ppl_checkpoint.json",
    "Qwen2.5-3B": "qwen25_3b_instruct_awq_cuda_awq_ppl_checkpoint.json",
    "Qwen2.5-7B": "qwen25_7b_instruct_awq_cuda_awq_ppl_checkpoint.json",
    "Qwen2.5-14B": "qwen25_14b_instruct_awq_cuda_awq_ppl_checkpoint.json",
    "Mistral-7B": "mistral_7b_instruct_v03_awq_cuda_awq_ppl_checkpoint.json",
    "Llama-3.1-8B": "meta_llama_31_8b_instruct_awq_int4_cuda_awq_ppl_checkpoint.json",
}
GPTQ_FILES = {
    "Qwen2.5-1.5B": "qwen25_15b_instruct_gptq_int4_cuda_gptq_ppl_checkpoint.json",
    "Qwen2.5-3B": "qwen25_3b_instruct_gptq_int4_cuda_gptq_ppl_checkpoint.json",
    "Qwen2.5-7B": "qwen25_7b_instruct_gptq_int4_cuda_gptq_ppl_checkpoint.json",
    "Qwen2.5-14B": None,  # EXCLUDED: confirmed broken (incoherent generation, PPL=72.9)
    "Mistral-7B": "mistral_7b_instruct_v03_gptq_cuda_gptq_ppl_checkpoint.json",
    "Llama-3.1-8B": "meta_llama_31_8b_instruct_gptq_int4_cuda_gptq_ppl_checkpoint.json",
}


def load_ppl(fname):
    if fname is None:
        return None
    with open(os.path.join(ART, fname)) as f:
        d = json.load(f)
    assert d.get("done")
    return d["ppl"]


def dpct(ppl_q, ppl_bf16):
    if ppl_q is None:
        return None
    return (ppl_q - ppl_bf16) / ppl_bf16 * 100


def main():
    print(f"{'Model':<14} {'BF16':>8} {'ours(q4)':>9} {'AWQ_ppl':>9} {'AWQ_d%':>8} "
          f"{'GPTQ_ppl':>9} {'GPTQ_d%':>8}")
    rows = {}
    for m, bf16 in BF16.items():
        awq_ppl = load_ppl(AWQ_FILES[m])
        gptq_ppl = load_ppl(GPTQ_FILES[m])
        awq_d = dpct(awq_ppl, bf16)
        gptq_d = dpct(gptq_ppl, bf16)
        rows[m] = dict(bf16=bf16, ours=OUR_Q4[m], awq_ppl=awq_ppl, awq_d=awq_d,
                        gptq_ppl=gptq_ppl, gptq_d=gptq_d)
        ours_s = f"{OUR_Q4[m]:+.2f}" if OUR_Q4[m] is not None else "n/a(NF4)"
        gptq_s = f"{gptq_ppl:.4f}" if gptq_ppl is not None else "EXCLUDED"
        gptq_d_s = f"{gptq_d:+.2f}" if gptq_d is not None else "---"
        print(f"{m:<14} {bf16:>8.4f} {ours_s:>9} {awq_ppl:>9.4f} {awq_d:>+7.2f}% "
              f"{gptq_s:>9} {gptq_d_s:>8}")

    out_path = os.path.join(ART, "baselines_compiled.json")
    with open(out_path, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
