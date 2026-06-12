#!/usr/bin/env python3
"""
Thread 3: Tokenizer mechanism analysis.
Hypothesis: 1.9× cross-arch gap caused by tokenizer difference
  - Qwen2.5: tiktoken, vocab=131072
  - Mistral-7B: SentencePiece, vocab=32768

Measures:
  1. Token counts on WikiText-2 test (compression ratio)
  2. Token frequency distribution (rare token %)
  3. Token length distribution (short vs long tokens)
  4. Estimated "high-entropy token" ratio (tokens that appear <N times in training)
"""
import json
import collections
import math
from datasets import load_dataset
from transformers import AutoTokenizer

MODELS = {
    "Qwen2.5-7B":  "Qwen/Qwen2.5-7B-Instruct",
    "Mistral-7B":  "mistralai/Mistral-7B-Instruct-v0.3",
}

RARE_THRESHOLD = 100  # tokens appearing fewer than this rank are "rare" (by freq rank)

def analyze_tokenizer(name, model_id, text):
    print(f"\n{'='*50}")
    print(f"Tokenizer: {name} ({model_id})")
    tok = AutoTokenizer.from_pretrained(model_id)
    print(f"  Vocab size: {tok.vocab_size:,}")

    ids = tok.encode(text)
    n_tokens = len(ids)
    n_chars = len(text)
    print(f"  Tokens: {n_tokens:,} | Chars: {n_chars:,} | Compression: {n_chars/n_tokens:.2f} chars/token")

    # Token frequency distribution
    freq = collections.Counter(ids)
    total = len(ids)

    # Top-K coverage
    top100 = sum(v for _, v in freq.most_common(100))
    top1000 = sum(v for _, v in freq.most_common(1000))
    top10k = sum(v for _, v in freq.most_common(10000))
    print(f"  Top-100  token coverage: {top100/total*100:.1f}%")
    print(f"  Top-1000 token coverage: {top1000/total*100:.1f}%")
    print(f"  Top-10K  token coverage: {top10k/total*100:.1f}%")

    # Unique token count
    n_unique = len(freq)
    print(f"  Unique tokens used: {n_unique:,} / {tok.vocab_size:,} ({n_unique/tok.vocab_size*100:.1f}%)")

    # Token length distribution (proxy for "specificity")
    lengths = []
    for token_id in freq:
        try:
            decoded = tok.decode([token_id], skip_special_tokens=True)
            lengths.append(len(decoded))
        except:
            pass
    if lengths:
        avg_len = sum(lengths) / len(lengths)
        single_char = sum(1 for l in lengths if l == 1) / len(lengths)
        print(f"  Avg token length: {avg_len:.2f} chars")
        print(f"  Single-char tokens: {single_char*100:.1f}%")

    # Entropy of token distribution (higher = more uniform = harder to predict)
    probs = [v/total for v in freq.values()]
    entropy = -sum(p * math.log2(p) for p in probs if p > 0)
    max_entropy = math.log2(total)
    print(f"  Token entropy: {entropy:.2f} bits (max {max_entropy:.2f})")

    # Hapax legomena (tokens appearing exactly once)
    hapax = sum(1 for v in freq.values() if v == 1)
    print(f"  Hapax legomena: {hapax:,} ({hapax/n_unique*100:.1f}% of unique tokens)")

    return {
        "name": name,
        "vocab_size": tok.vocab_size,
        "n_tokens": n_tokens,
        "chars_per_token": n_chars / n_tokens,
        "n_unique": n_unique,
        "top100_coverage": top100 / total,
        "top1000_coverage": top1000 / total,
        "top10k_coverage": top10k / total,
        "avg_token_length": sum(lengths) / len(lengths) if lengths else 0,
        "single_char_ratio": sum(1 for l in lengths if l == 1) / len(lengths) if lengths else 0,
        "entropy": entropy,
        "hapax_count": hapax,
        "hapax_ratio": hapax / n_unique,
    }


def main():
    print("Loading WikiText-2 test split...")
    ds = load_dataset("wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n\n".join(ds["text"])
    print(f"Total chars: {len(text):,}")

    results = {}
    for name, model_id in MODELS.items():
        try:
            results[name] = analyze_tokenizer(name, model_id, text)
        except Exception as e:
            print(f"ERROR for {name}: {e}")

    # Cross-comparison
    print(f"\n{'='*50}")
    print("CROSS-ARCH COMPARISON")
    if "Qwen2.5-7B" in results and "Mistral-7B" in results:
        q = results["Qwen2.5-7B"]
        m = results["Mistral-7B"]
        print(f"  Token count ratio (Qwen/Mistral): {q['n_tokens']/m['n_tokens']:.3f}")
        print(f"  Chars/token ratio (Qwen/Mistral): {q['chars_per_token']/m['chars_per_token']:.3f}")
        print(f"  Vocab utilization ratio: {(q['n_unique']/q['vocab_size']) / (m['n_unique']/m['vocab_size']):.3f}")
        print(f"  Hapax ratio (Qwen/Mistral): {q['hapax_ratio']/m['hapax_ratio']:.3f}")
        print(f"  Entropy ratio (Qwen/Mistral): {q['entropy']/m['entropy']:.3f}")
        print()
        print("INTERPRETATION:")
        if q['n_unique']/q['vocab_size'] < m['n_unique']/m['vocab_size']:
            print("  Qwen uses SMALLER fraction of its vocab on WikiText-2")
            print("  → More tokens are 'rare' relative to vocab size")
            print("  → q4 has less training signal for embedding quantization")
        if q['hapax_ratio'] > m['hapax_ratio']:
            print("  Qwen has HIGHER hapax ratio → more tokens appear exactly once")
            print("  → These single-occurrence tokens have highest quantization error")

    # Save results
    with open("tokenizer_analysis_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to tokenizer_analysis_results.json")


if __name__ == "__main__":
    main()
