"""
MLX port of the Surgical MoE Chimera Bridge (hidden-state residual bridge).

Track C of /Users/xox/.claude/plans/reactive-noodling-toucan.md. Ports the
original PyTorch BridgeModule (P_up -> frozen donor MLP stack -> P_down ->
learned-alpha residual) to MLX, and provides BridgedBlock, which substitutes
in place of a recipient TransformerBlock via plain list-index assignment
(model.model.layers[i] = BridgedBlock(original_block, bridge)).

Donor MLP/norm layers are held as zero-copy references into an already-loaded
donor `Model` object (never reconstructed or weight-copied), so this works
identically regardless of which mlx_lm module actually backs the donor
(e.g. Mistral routes through mlx_lm.models.llama via MODEL_REMAPPING, not a
mistral.py -- callers never need to know or care).
"""

# D1: donor MLP/norm held as zero-copy references into the already-loaded
#     donor Model, never reconstructed or weight-copied into fresh modules.
#   WHY: works identically regardless of which mlx_lm module backs the donor
#        (Qwen2.5-7B -> qwen2.py, Mistral-7B-v0.3 -> llama.py via
#        MODEL_REMAPPING) with zero adapter code; also sidesteps the eps
#        mismatch (Qwen rms_norm_eps=1e-6 vs Mistral/Llama=1e-5) that would
#        have been a real risk under a reconstruct-and-copy-weights approach
#        (the failure mode the original PyTorch GemmaMLP.from_hf_layer had).
#   COST: the donor Model object must stay loaded/alive for the bridge's
#        lifetime (can't discard it after extracting one layer); freezing
#        must be coordinated explicitly on both models (see run_bridge_
#        experiment.py's recipient.freeze() + donor.freeze()).
#   EXIT: switch to explicit weight-copying into freshly-constructed
#        norm/MLP modules (matching the donor's exact dims/eps) if a bridge
#        checkpoint that doesn't require the full donor model to reload is
#        ever needed.
#
# D2: BridgedBlock composes as bridge(original_block(x)) -- after the
#     wrapped block's fully-computed output, not at some interior point.
#   WHY: the only externally-observable point without reaching inside
#        TransformerBlock.__call__ (which would mean subclassing/duplicating
#        it); semantically identical to what a PyTorch forward_hook on the
#        original block would see. Not an arbitrary tie-break.
#   COST: can't inject a correction based on an interior (post-attn,
#        pre-MLP) representation -- if that granularity ever matters, this
#        wrapper design can't express it.
#   EXIT: would require a hand-written subclass duplicating
#        TransformerBlock.__call__'s internals instead of wrapping opaquely.
import mlx.core as mx
import mlx.nn as nn


class BridgeModule(nn.Module):
    def __init__(self, recipient_dim: int, donor_dim: int, alpha_init: float = 0.1):
        super().__init__()
        self.P_up = nn.Sequential(
            nn.Linear(recipient_dim, donor_dim, bias=False),
            nn.LayerNorm(donor_dim),
        )
        self.P_down = nn.Sequential(
            nn.Linear(donor_dim, recipient_dim, bias=False),
            nn.LayerNorm(recipient_dim),
        )
        self.alpha = mx.array(alpha_init, dtype=mx.float32)
        self.donor_mlps = []
        self.donor_norms = []

    def attach_donor_layers(self, donor_model, layer_indices):
        """Zero-copy: hold references into an already-loaded donor Model's
        layers. Single-shot list assignment (not incremental append) --
        matches the proven mlx_lm idiom (Qwen2Model.layers = [...]) and is
        empirically confirmed to be correctly discovered by MLX's parameter
        tree walker (tree_flatten(module.parameters()) sees donor_mlps.N.*)."""
        self.donor_mlps = [donor_model.model.layers[idx].mlp for idx in layer_indices]
        self.donor_norms = [donor_model.model.layers[idx].post_attention_layernorm for idx in layer_indices]

    def __call__(self, h: mx.array) -> mx.array:
        h_src = self.P_up(h)
        for mlp, norm in zip(self.donor_mlps, self.donor_norms):
            h_src = h_src + mlp(norm(h_src))
        correction = self.P_down(h_src)
        return h + self.alpha * correction


class BridgedBlock(nn.Module):
    """Wraps a recipient TransformerBlock; __call__ = bridge(original_block(x)).
    This is the only externally-observable composition point available without
    reaching inside TransformerBlock.__call__ -- semantically identical to what
    a PyTorch forward-hook on the original block would see (a module's already-
    fully-computed output), so it faithfully mirrors the original Chimera
    insertion mechanism despite MLX having no direct hook API."""

    def __init__(self, original_block: nn.Module, bridge_module: BridgeModule):
        super().__init__()
        self.original_block = original_block
        self.bridge_module = bridge_module

    def __call__(self, x, mask=None, cache=None):
        h_out = self.original_block(x, mask, cache)
        return self.bridge_module(h_out)
