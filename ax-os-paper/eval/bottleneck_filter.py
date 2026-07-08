#!/usr/bin/env python3
"""
Track F: dense low-rank bottleneck replacements for model.model.layers[14].mlp,
follow-up to Track A-E (see ../SPECTRAL_LLM_SURGERY_FINDINGS.md). Codex's
independent math review of Track A-E found the FFN sublayer is a dense
quadratic form in input coordinates that no per-bin-independent/shift-
equivariant family (what every Track A-E variant was) can represent. Track F
tests that finding directly by deliberately adding cross-bin/cross-channel
mixing at the same param budget as Track E's K=16 config (24,608).

Shape contract: (..., dim) -> (..., dim), same as SpectralFilter, so both
classes below are drop-in replacements for model.model.layers[14].mlp.

D1: FFT-domain dense rank-8 complex bottleneck (DenseFFTBottleneck / "F1"),
    replacing Track A-E's per-bin-diagonal filter
  WHY: Codex's independent math review of Track A-E found the FFN sublayer is
       a dense quadratic form in input coordinates that no per-bin-independent/
       shift-equivariant family can represent. F1 directly breaks shift-
       equivariance (dense complex map across ALL 769 rfft bins, not diagonal)
       at the same param budget as Track E's K=16 config (24,608), to test
       that finding directly.
  COST: no longer a "spectral filter" in the per-bin sense Track A-E used; a
       dense low-rank complex map costs 2x params per unit of "mixing
       capacity" vs a same-shape real map (see F2).
  EXIT: shrink rank r toward 0 to fall back to the old per-bin family; grow r
       toward 769 to recover a fully dense complex linear map in frequency
       domain.

D2: Plain real-valued dense rank-8 bottleneck (DenseBottleneck / "F2"), no FFT
    at all -- control arm for D1
  WHY: isolates whether cross-channel MIXING itself is what matters (any
       bottleneck would do) vs whether the FFT basis specifically matters.
       Also directly tests Codex's side observation that exact cyclic-shift
       equivariance is an unnatural property for a hidden-channel axis that
       has no inherent translation-invariant meaning.
  COST: if F2 wins outright, it undercuts the entire spectral/FFT framing for
       this substitution site -- this is a real possible outcome we're
       deliberately testing for, not one we're hoping to avoid.
  EXIT: if F2 underperforms F1 clearly, drop the control arm in future tracks
       and stay in FFT space.

D3: rank r=8 chosen to match Track E's K=16 budget (24,608 params) exactly
  WHY: budget-matched comparison isolates topology (mixing vs no-mixing) from
       raw parameter count, avoiding a "trained more params, of course it's
       better" confound.
  COST: r=8 might simply be too small in absolute terms for either topology to
       show an effect -- a null result at r=8 can't cleanly distinguish
       "topology doesn't matter" from "budget too small".
  EXIT: if null, sweep r upward (e.g. r=16, ~2x budget) before concluding
       mixing itself doesn't help.

D4: insertion layer fixed at L14, not re-sweeping 4/14/24
  WHY: L14 was already established as the most tolerant insertion point
       across Tracks A/B/C/D; fixing it keeps this a single-variable
       (topology) test instead of reopening the layer-depth axis.
  COST: doesn't tell us whether mixing would also help at L24, where Track
       A's trained variant was previously indistinguishable from its own
       no-op control (trained gave zero benefit there).
  EXIT: if F1/F2 show a real effect at L14, rerun at L24 to see if mixing
       rescues that L24 null result.
"""
import mlx.core as mx
import mlx.nn as nn

from spectral_filter import output_rms  # noqa: E402  (reused unmodified)


class DenseFFTBottleneck(nn.Module):
    """F1: rfft(hidden) -> dense complex rank-r bottleneck (down: r x F,
    up: F x r) -> magnitude-sigmoid gate -> irfft.

    Complex down/up projections are applied as four real matmuls
    (re/im decomposition of complex matmul), not via mx.complex64 @.
    WHY: only elementwise complex ops (multiply) and mx.fft have been
         gradient-checked in this repo so far (see spectral_filter.py);
         complex-valued matmul autodiff has not been validated on this MLX
         version. Real-matmul decomposition needs only primitives already
         confirmed to work, so it carries no unvalidated risk.
    """
    def __init__(self, dim: int, rank: int = 8, eps: float = 1e-6, init_std: float = 0.02):
        super().__init__()
        self.dim, self.rank, self.eps = dim, rank, eps
        freq_dim = dim // 2 + 1  # rfft output size for even dim (1536 -> 769)
        self.freq_dim = freq_dim
        self.down_re = mx.random.normal((rank, freq_dim)) * init_std
        self.down_im = mx.random.normal((rank, freq_dim)) * init_std
        self.up_re = mx.random.normal((freq_dim, rank)) * init_std
        self.up_im = mx.random.normal((freq_dim, rank)) * init_std

    def __call__(self, x: mx.array) -> mx.array:
        orig_dtype = x.dtype
        z = mx.fft.rfft(x.astype(mx.float32), axis=-1)  # (..., freq_dim) complex64
        x_re, x_im = mx.real(z), mx.imag(z)

        # down: (..., freq_dim) @ (freq_dim, rank) -> (..., rank), complex re/im decomposition
        dre_t, dim_t = self.down_re.T, self.down_im.T  # (freq_dim, rank) each
        d_re = x_re @ dre_t - x_im @ dim_t
        d_im = x_re @ dim_t + x_im @ dre_t

        # up: (..., rank) @ (rank, freq_dim) -> (..., freq_dim)
        ure_t, uim_t = self.up_re.T, self.up_im.T  # (rank, freq_dim) each
        u_re = d_re @ ure_t - d_im @ uim_t
        u_im = d_re @ uim_t + d_im @ ure_t

        mag = mx.sqrt(u_re ** 2 + u_im ** 2 + self.eps)
        gate = mx.sigmoid(mag)
        u_re, u_im = u_re * gate, u_im * gate

        out_c = u_re.astype(mx.complex64) + 1j * u_im.astype(mx.complex64)
        out = mx.fft.irfft(out_c, n=self.dim, axis=-1)
        return out.astype(orig_dtype)

    def num_params(self) -> int:
        return (self.down_re.size + self.down_im.size
                + self.up_re.size + self.up_im.size)


class DenseBottleneck(nn.Module):
    """F2: plain real-valued dense rank-r bottleneck, no FFT at all.
    down: (rank, dim), up: (dim, rank), same magnitude-sigmoid gate."""
    def __init__(self, dim: int, rank: int = 8, eps: float = 1e-6, init_std: float = 0.02):
        super().__init__()
        self.dim, self.rank, self.eps = dim, rank, eps
        self.down_w = mx.random.normal((rank, dim)) * init_std
        self.up_w = mx.random.normal((dim, rank)) * init_std

    def __call__(self, x: mx.array) -> mx.array:
        orig_dtype = x.dtype
        x32 = x.astype(mx.float32)
        xd = x32 @ self.down_w.T   # (..., dim) @ (dim, rank) -> (..., rank)
        xu = xd @ self.up_w.T      # (..., rank) @ (rank, dim) -> (..., dim)
        mag = mx.sqrt(xu ** 2 + self.eps)
        gate = mx.sigmoid(mag)
        xu = xu * gate
        return xu.astype(orig_dtype)

    def num_params(self) -> int:
        return self.down_w.size + self.up_w.size


def calibrate_init_std_bottleneck(module_factory, target_rms: float, dim: int, seed: int,
                                   candidates=(0.02, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0)) -> float:
    """Same log-space RMS-matching approach as calibrate_init_std in
    spectral_filter.py, generalized via a module_factory(std) callable since
    F1/F2 aren't SpectralFilter instances and can't reuse that function directly."""
    mx.random.seed(seed)
    probe = mx.random.normal((1, 8, dim))
    best_std, best_diff = candidates[0], float("inf")
    for std in candidates:
        mx.random.seed(seed)
        mod = module_factory(std)
        rms = output_rms(mod(probe))
        if rms <= 0:
            continue
        diff = abs(mx.log(mx.array(rms)).item() - mx.log(mx.array(target_rms)).item())
        if diff < best_diff:
            best_diff, best_std = diff, std
    return best_std
