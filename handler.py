"""RunPod Serverless handler for NVIDIA PiD image upscaling."""
from __future__ import annotations

import base64
import io
import os
import sys
import tempfile
import traceback
from types import SimpleNamespace
from typing import Any

import runpod
import torch
from PIL import Image

PID_REPO = os.environ.get("PID_REPO", "/workspace/PiD")
if PID_REPO not in sys.path:
    sys.path.insert(0, PID_REPO)

_PID_MODEL = None
_PID_META: dict[str, Any] | None = None
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def _tensor_to_pil(tensor: torch.Tensor) -> Image.Image:
    if tensor.dim() == 4:
        tensor = tensor.squeeze(1)
    arr = ((tensor.float().clamp(-1, 1) + 1) * 127.5).permute(1, 2, 0).cpu().numpy().astype("uint8")
    return Image.fromarray(arr)


def _load_pid():
    """Load the official PiD decoder once per worker process."""
    global _PID_MODEL, _PID_META
    if _PID_MODEL is not None:
        return _PID_MODEL, _PID_META
    if _DEVICE != "cuda":
        raise RuntimeError("PiD requires a CUDA GPU worker")

    os.chdir(PID_REPO)
    from pid._src.inference.checkpoint_registry import get_pid_checkpoint
    from pid._src.inference.decoder import load_our_decoder

    backbone = os.environ.get("PID_BACKBONE", "flux")
    ckpt_type = os.environ.get("PID_CKPT_TYPE", "2k")
    ckpt = get_pid_checkpoint(backbone, ckpt_type)
    args = SimpleNamespace(
        backbone=backbone,
        experiment=ckpt.experiment,
        checkpoint_path=ckpt.checkpoint_path,
        config_file="pid/_src/configs/pid/config.py",
        load_ema_to_reg=False,
        compile=False,
    )
    _PID_MODEL = load_our_decoder(args, [], True)
    _PID_META = {"backbone": backbone, "ckpt_type": ckpt_type, "pid_scale": ckpt.pid_scale}
    return _PID_MODEL, _PID_META


def _decode_b64_png(b64: str) -> Image.Image:
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    min_side = 16
    if img.width < min_side or img.height < min_side:
        scale = max(min_side / img.width, min_side / img.height)
        img = img.resize((max(min_side, round(img.width * scale)), max(min_side, round(img.height * scale))), Image.LANCZOS)
    return img


def _encode_png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _run_pid(img: Image.Image, requested_scale: int, prompt: str) -> Image.Image:
    model, meta = _load_pid()
    from pid._src.inference.decoder import add_noise
    from pid._src.inference.inference_utils import load_input_image

    pid_scale = int(meta["pid_scale"])
    with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as tmp:
        img.save(tmp.name)
        input_tensor = load_input_image(tmp.name).to(dtype=torch.bfloat16, device="cuda")

    with torch.inference_mode():
        clean_latent = model.encode_lq_latent(input_tensor)
        vae_compression = int(model.vae_encoder.spatial_compression_factor)
        vae_h = int(clean_latent.shape[-2]) * vae_compression
        vae_w = int(clean_latent.shape[-1]) * vae_compression
        latent = add_noise(clean_latent.float(), 0.0, torch.Generator(device="cuda"), meta["backbone"]).to(dtype=torch.bfloat16)
        data_batch = {
            model.config.input_caption_key: [prompt],
            "LQ_latent": latent.to(dtype=torch.bfloat16, device="cuda"),
            "degrade_sigma": torch.tensor([0.0], device="cuda", dtype=torch.float32),
        }
        samples = model.generate_samples_from_batch(
            data_batch,
            cfg_scale=1.0,
            num_steps=4,
            seed=0,
            shift=None,
            image_size=(vae_h * pid_scale, vae_w * pid_scale),
        )
    out = _tensor_to_pil(samples[0].float().cpu().clamp(-1, 1))
    if requested_scale != pid_scale:
        out = out.resize((img.width * requested_scale, img.height * requested_scale), Image.LANCZOS)
    return out


def handler(event: dict[str, Any]) -> dict[str, Any]:
    try:
        inp = (event or {}).get("input") or {}

        # Health ping (used by deployment check).
        if inp.get("ping"):
            return {
                "ok": True,
                "model": "PiD-v1",
                "device": _DEVICE,
                "cuda_available": torch.cuda.is_available(),
            }

        b64 = inp.get("image_b64")
        if not b64:
            return {"error": "image_b64 required"}

        scale_raw = inp.get("scale", 2)
        try:
            scale = int(scale_raw)
        except (TypeError, ValueError):
            scale = 2
        if scale not in (2, 4):
            scale = 2

        prompt = inp.get("prompt") or "high quality product image, clean edges, sharp detail"
        src = _decode_b64_png(b64)
        out = _run_pid(src, scale, prompt)
        return {
            "image_b64": _encode_png_b64(out),
            "width": out.width,
            "height": out.height,
            "model": "PiD-v1",
            "scale": scale,
        }
    except Exception as e:
        traceback.print_exc()
        return {"error": f"{type(e).__name__}: {e}"}


if __name__ == "__main__":
    print(f"[handler] starting on device={_DEVICE}", flush=True)
    runpod.serverless.start({"handler": handler})
