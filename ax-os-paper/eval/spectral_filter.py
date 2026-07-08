#!/usr/bin/env python3
"""
SpectralFilter: drop-in replacement for a dense sublayer operating on the
model's hidden dimension. FFT over the feature axis, K sequential learned
complex per-frequency filters (multiply-then-magnitude-gate), inverse FFT.

Shape contract: (..., dim) -> (..., dim) -- identical to nn.Linear(dim, dim)
or Qwen2's MLP.__call__(x), so this module is reusable unmodified for:
  Track A: model.model.layers[i].mlp                  (dim=1536)
  Track B: model.model.layers[i].self_attn.o_proj      (dim=1536)

Params stored as real filt_re/filt_im (not complex64) to keep the module
compatible with standard RTN affine group-quantization tooling.

D1: init_std is NOT a fixed constant -- see calibrate_init_std() below.
    WHY: K sequential multiplicative gate stages shrink output geometrically
         at small init_std (near-total no-op through the residual), and blow
         up loss catastrophically at large init_std -- measured directly on
         this model (see plan reactive-noodling-toucan.md Track A section).
    COST: requires one extra forward pass per (track, layer) to calibrate.
    EXIT: if a fixed init_std is ever wanted again, no-op-control=0.02 is the
          validated "near-zero-effect" reference point; do not use it as "the"
          zero-shot condition without also reporting a calibrated condition.
"""
import mlx.core as mx
import mlx.nn as nn


class SpectralFilter(nn.Module):
    def __init__(self, dim: int, K: int = 4, eps: float = 1e-6, init_std: float = 0.02):
        super().__init__()
        self.dim, self.K, self.eps = dim, K, eps
        freq_dim = dim // 2 + 1  # rfft output size for even dim (1536 -> 769)
        self.filt_re = mx.random.normal((K, freq_dim)) * init_std
        self.filt_im = mx.random.normal((K, freq_dim)) * init_std

    def __call__(self, x: mx.array) -> mx.array:
        orig_dtype = x.dtype
        z = mx.fft.rfft(x.astype(mx.float32), axis=-1)
        for k in range(self.K):
            w = self.filt_re[k].astype(mx.complex64) + 1j * self.filt_im[k].astype(mx.complex64)
            z = z * w
            mag = mx.sqrt(mx.abs(z) ** 2 + self.eps)
            gate = mx.sigmoid(mag)
            z = z * gate.astype(mx.complex64)
        out = mx.fft.irfft(z, n=self.dim, axis=-1)
        return out.astype(orig_dtype)

    def num_params(self) -> int:
        return self.filt_re.size + self.filt_im.size


def output_rms(x: mx.array) -> float:
    return float(mx.sqrt(mx.mean(x.astype(mx.float32) ** 2)).item())


class ClusteredSpectralFilter(nn.Module):
    """G independent SpectralFilter instances, each applied to its own
    contiguous 1/G-sized chunk of the hidden dimension, concatenated back.
    G=1 is mathematically identical to a plain SpectralFilter(dim, K).

    D2: chunk the hidden dim into G independent groups instead of one global
        FFT over the whole dim.
      WHY: Track A's results showed one global spectral filter can't
           approximate the FFN's behavior well (+3.8% to +29.2% PPL even
           after fine-tuning) -- letting each chunk have its own independent
           frequency-domain structure gives more local flexibility, echoing
           the group_size lesson from the RTN-quantization work earlier
           this session (smaller groups = more flexibility = less error).
      COST: loses the ability to model frequency correlations spanning
           across chunk boundaries (one global FFT sees the whole 1536-dim
           vector; G independent chunk-FFTs cannot). Total param count grows
           only slightly with G (~K*dim + 2*K*G, not a G-multiple, since the
           summed frequency-bin budget across chunks is roughly conserved),
           so this is a near-free parameter cost -- but the *representational*
           cost of losing cross-chunk structure is real and untested until
           measured here.
      EXIT: G=1 recovers the original SpectralFilter exactly.
    """
    def __init__(self, dim: int, num_clusters: int, K: int = 4, eps: float = 1e-6, init_std: float = 0.02):
        super().__init__()
        if dim % num_clusters != 0:
            raise ValueError(f"dim={dim} must be divisible by num_clusters={num_clusters}")
        self.dim = dim
        self.num_clusters = num_clusters
        self.chunk_dim = dim // num_clusters
        self.filters = [SpectralFilter(self.chunk_dim, K=K, eps=eps, init_std=init_std)
                        for _ in range(num_clusters)]

    def __call__(self, x: mx.array) -> mx.array:
        chunks = mx.split(x, self.num_clusters, axis=-1)
        outs = [f(c) for f, c in zip(self.filters, chunks)]
        return mx.concatenate(outs, axis=-1)

    def num_params(self) -> int:
        return sum(f.num_params() for f in self.filters)


def calibrate_init_std(target_rms: float, dim: int, K: int, seed: int,
                        candidates=(0.02, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0)) -> float:
    """Pick the init_std whose SpectralFilter output RMS (on standard-normal
    input, a scale-agnostic probe) is closest in log-space to target_rms."""
    mx.random.seed(seed)
    probe = mx.random.normal((1, 8, dim))  # small batch/seq, just for RMS matching
    best_std, best_diff = candidates[0], float("inf")
    for std in candidates:
        mx.random.seed(seed)
        f = SpectralFilter(dim, K=K, init_std=std)
        rms = output_rms(f(probe))
        if rms <= 0:
            continue
        diff = abs(mx.log(mx.array(rms)).item() - mx.log(mx.array(target_rms)).item())
        if diff < best_diff:
            best_diff, best_std = diff, std
    return best_std
