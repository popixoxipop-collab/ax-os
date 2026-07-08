#!/usr/bin/env python3
"""
Track G: 2x2 factorial ablation crossing {frequency-domain vs channel-domain}
x {complex weights vs real weights} to narrow down why Track F's F2 (plain
real dense rank-8 bottleneck, channel-domain) beat F1 (dense complex rank-8
bottleneck, frequency-domain via rfft/irfft) at matched param budget on
Qwen2.5-1.5B FFN replacement at L14. See ../SPECTRAL_LLM_SURGERY_FINDINGS.md
("F1>F2 이유에 대한 수학 검증", Codex job task-mrarfesy-mpw9th) for why the
original "F1's rank is wasted by DFT rotation constraints" explanation was
found to be overreaching -- this track tests the untested alternative
candidates empirically instead of arguing about them further.

F1 = (frequency, complex), F2 = (channel, real) already exist in
bottleneck_filter.py. This file adds the other two cells:
  G1 = (frequency, real)   -- keeps rfft/irfft, swaps in real/unconstrained weights
  G2 = (channel, complex)  -- keeps channel domain, swaps in complex weights via
                              a fixed arbitrary local pairing (no FFT, no global mixing)

D5: G1 = real-valued bottleneck kept in frequency-domain coordinates (rfft/irfft preserved)
  WHY: isolates whether frequency-domain global mixing itself (independent of complex-valued
       weights) explains F1's disadvantage vs F2, by keeping F1's domain but swapping in F2's
       real/unconstrained weight type.
  COST: doesn't test a "real AND non-Fourier-but-still-global-mixing" cell -- G1 alone can't
       distinguish "Fourier-specific structure" from "any global mixing" as the culprit.
  EXIT: if G1~=F2, global mixing isn't the issue (weight type is); if G1~=F1, something about
       going through frequency-domain (mixing, or DC/Nyquist, or the domain itself) is implicated.

D6: G1's gate uses joint per-frequency-bin magnitude (matching F1's complex-magnitude gate)
    rather than an independent per-real-scalar gate
  WHY: keeps the gate's mathematical meaning identical to F1 so ONLY the weight type (real vs
       complex) differs between F1 and G1, not also the gate semantics.
  COST: implementation must track which real indices are paired frequency bins vs the two
       singleton DC/Nyquist reals, more involved than a naive elementwise gate.
  EXIT: an independent-per-scalar gate variant could be tried later if this choice turns out to
       matter more than expected.

D7: G2 = complex-valued bottleneck via arbitrary adjacent-channel pairing, no FFT, no global mixing
  WHY: isolates whether complex-valued weights per se (independent of Fourier structure) explain
       F1's disadvantage, by keeping F2's channel-domain/local setup but swapping in F1's complex
       weight type.
  COST: G2's "complex" structure only mixes LOCALLY-adjacent channel pairs, not globally like
       rfft -- not a clean "complex + global mixing, non-Fourier" cell; can't fully separate
       "complex weights are bad" from "complex weights are fine, F1 needed global mixing
       specifically." Report this limitation plainly, don't overclaim past it.
  EXIT: a future cell using a fixed random unitary (complex, global, non-Fourier) mixing could
       close this gap if G2's result is ambiguous.

D8: Both G1 and G2 budget-matched to F2's 24,576 params (not F1's 24,608)
  WHY: F2 is the cleaner reference (no DC/Nyquist asymmetry); consistent ~24.6K budget across
       all four cells (F1/F2/G1/G2, within the already-established negligible +/-32-param
       tolerance) keeps the 2x2 comparison as apples-to-apples as practically achievable.
  COST: none significant.
  EXIT: n/a.

Shape contract: (..., dim) -> (..., dim), same as SpectralFilter/F1/F2, drop-in
replacement for model.model.layers[14].mlp.
"""
import mlx.core as mx
import mlx.nn as nn

from spectral_filter import output_rms  # noqa: E402  (reused unmodified)


def freq_to_real(x_re: mx.array, x_im: mx.array) -> mx.array:
    """Pack rfft output (re/im of a length dim//2+1 complex array, DC=index 0
    and Nyquist=index dim//2 real-only per Codex's verified derivation) into
    a real vector of length dim. x_re/x_im shape (..., dim//2+1)."""
    z0 = x_re[..., 0:1]                       # DC, real-only
    mid_re = x_re[..., 1:-1]                  # (..., dim//2 - 1) genuine complex bins
    mid_im = x_im[..., 1:-1]
    mid = mx.stack([mid_re, mid_im], axis=-1)  # (..., dim//2 - 1, 2)
    mid_flat = mid.reshape(*mid.shape[:-2], -1)  # (..., dim - 2) interleaved [re,im,re,im,...]
    z_last = x_re[..., -1:]                   # Nyquist, real-only
    return mx.concatenate([z0, mid_flat, z_last], axis=-1)  # (..., dim)


def real_to_freq(z: mx.array):
    """Inverse of freq_to_real. Returns (x_re, x_im), each (..., dim//2+1)."""
    z0 = z[..., 0:1]
    mid_flat = z[..., 1:-1]                   # (..., dim - 2)
    mid = mid_flat.reshape(*mid_flat.shape[:-1], -1, 2)  # (..., dim//2 - 1, 2)
    mid_re, mid_im = mid[..., 0], mid[..., 1]
    z_last = z[..., -1:]
    x_re = mx.concatenate([z0, mid_re, z_last], axis=-1)
    zeros_edge = mx.zeros_like(z0)
    x_im = mx.concatenate([zeros_edge, mid_im, zeros_edge], axis=-1)
    return x_re, x_im


def gate_paired_real(z: mx.array, eps: float) -> mx.array:
    """Apply magnitude-sigmoid gate to a freq_to_real-packed real vector,
    using JOINT magnitude for each (re,im) pair (D6) and independent
    magnitude for the two DC/Nyquist singleton reals."""
    z0 = z[..., 0:1]
    mid_flat = z[..., 1:-1]
    mid = mid_flat.reshape(*mid_flat.shape[:-1], -1, 2)  # (..., n_pairs, 2)
    mid_re, mid_im = mid[..., 0], mid[..., 1]
    mag_mid = mx.sqrt(mid_re ** 2 + mid_im ** 2 + eps)
    gate_mid = mx.sigmoid(mag_mid)
    gated_mid = mx.stack([mid_re * gate_mid, mid_im * gate_mid], axis=-1)
    gated_mid_flat = gated_mid.reshape(*gated_mid.shape[:-2], -1)
    z_last = z[..., -1:]
    gate0 = mx.sigmoid(mx.sqrt(z0 ** 2 + eps))
    gate_last = mx.sigmoid(mx.sqrt(z_last ** 2 + eps))
    return mx.concatenate([z0 * gate0, gated_mid_flat, z_last * gate_last], axis=-1)


class RealFreqDomainBottleneck(nn.Module):
    """G1: rfft(hidden) -> pack to real(dim) -> dense REAL rank-r bottleneck
    (down: r x dim, up: dim x r) -> joint-magnitude-sigmoid gate -> unpack -> irfft.
    Same domain as F1 (frequency), same weight type as F2 (real)."""
    def __init__(self, dim: int, rank: int = 8, eps: float = 1e-6, init_std: float = 0.02):
        super().__init__()
        self.dim, self.rank, self.eps = dim, rank, eps
        self.down_w = mx.random.normal((rank, dim)) * init_std
        self.up_w = mx.random.normal((dim, rank)) * init_std

    def __call__(self, x: mx.array) -> mx.array:
        orig_dtype = x.dtype
        X = mx.fft.rfft(x.astype(mx.float32), axis=-1)  # (..., dim//2+1) complex64
        z = freq_to_real(mx.real(X), mx.imag(X))         # (..., dim) real

        zd = z @ self.down_w.T   # (..., dim) @ (dim, rank) -> (..., rank)
        zu = zd @ self.up_w.T    # (..., rank) @ (rank, dim) -> (..., dim)

        gated = gate_paired_real(zu, self.eps)
        x_re, x_im = real_to_freq(gated)
        out_c = x_re.astype(mx.complex64) + 1j * x_im.astype(mx.complex64)
        out = mx.fft.irfft(out_c, n=self.dim, axis=-1)
        return out.astype(orig_dtype)

    def num_params(self) -> int:
        return self.down_w.size + self.up_w.size


class ComplexChannelPairBottleneck(nn.Module):
    """G2: pair adjacent raw channels (x[2k], x[2k+1]) into dim/2 complex
    numbers via a FIXED arbitrary convention (no FFT, no learned/global
    mixing) -> dense COMPLEX rank-r bottleneck -> magnitude-sigmoid gate
    (identical formula to F1) -> unpair. Same domain as F2 (channel), same
    weight type as F1 (complex).

    Complex down/up projections use real re/im matmul decomposition, same
    pattern as DenseFFTBottleneck (F1) in bottleneck_filter.py -- only
    elementwise complex ops and mx.fft are validated in this repo, complex
    matmul autodiff is not, so this carries no unvalidated risk."""
    def __init__(self, dim: int, rank: int = 8, eps: float = 1e-6, init_std: float = 0.02):
        super().__init__()
        assert dim % 2 == 0
        self.dim, self.rank, self.eps = dim, rank, eps
        n_pairs = dim // 2
        self.n_pairs = n_pairs
        self.down_re = mx.random.normal((rank, n_pairs)) * init_std
        self.down_im = mx.random.normal((rank, n_pairs)) * init_std
        self.up_re = mx.random.normal((n_pairs, rank)) * init_std
        self.up_im = mx.random.normal((n_pairs, rank)) * init_std

    def __call__(self, x: mx.array) -> mx.array:
        orig_dtype = x.dtype
        x32 = x.astype(mx.float32)
        pairs = x32.reshape(*x32.shape[:-1], self.n_pairs, 2)
        c_re, c_im = pairs[..., 0], pairs[..., 1]   # (..., n_pairs) each

        dre_t, dim_t = self.down_re.T, self.down_im.T  # (n_pairs, rank) each
        d_re = c_re @ dre_t - c_im @ dim_t
        d_im = c_re @ dim_t + c_im @ dre_t

        ure_t, uim_t = self.up_re.T, self.up_im.T      # (rank, n_pairs) each
        u_re = d_re @ ure_t - d_im @ uim_t
        u_im = d_re @ uim_t + d_im @ ure_t

        mag = mx.sqrt(u_re ** 2 + u_im ** 2 + self.eps)
        gate = mx.sigmoid(mag)
        u_re, u_im = u_re * gate, u_im * gate

        out = mx.stack([u_re, u_im], axis=-1).reshape(*u_re.shape[:-1], self.dim)
        return out.astype(orig_dtype)

    def num_params(self) -> int:
        return (self.down_re.size + self.down_im.size
                + self.up_re.size + self.up_im.size)


def _verify_pack_unpack_roundtrip(dim: int = 1536, seed: int = 0) -> None:
    """unpack(pack(rfft(x))) == rfft(x) sanity check (run once at import/dry-run
    time, not on the hot path) -- an index-off-by-one here would silently
    corrupt every G1 number."""
    mx.random.seed(seed)
    x = mx.random.normal((3, dim))
    X = mx.fft.rfft(x, axis=-1)
    z = freq_to_real(mx.real(X), mx.imag(X))
    assert z.shape[-1] == dim, f"packed shape {z.shape} != dim {dim}"
    x_re2, x_im2 = real_to_freq(z)
    max_re_err = float(mx.max(mx.abs(x_re2 - mx.real(X))).item())
    max_im_err = float(mx.max(mx.abs(x_im2 - mx.imag(X))).item())
    assert max_re_err < 1e-4, f"real part roundtrip error {max_re_err}"
    assert max_im_err < 1e-4, f"imag part roundtrip error {max_im_err}"
    # also confirm DC/Nyquist truly carry ~zero imaginary part pre-pack
    dc_im = float(mx.max(mx.abs(mx.imag(X)[..., 0])).item())
    nyq_im = float(mx.max(mx.abs(mx.imag(X)[..., -1])).item())
    assert dc_im < 1e-3, f"DC bin imag part not ~0: {dc_im}"
    assert nyq_im < 1e-3, f"Nyquist bin imag part not ~0: {nyq_im}"
    print(f"  pack/unpack roundtrip OK: max_re_err={max_re_err:.2e} "
          f"max_im_err={max_im_err:.2e} dc_im={dc_im:.2e} nyq_im={nyq_im:.2e}")


if __name__ == "__main__":
    _verify_pack_unpack_roundtrip()
