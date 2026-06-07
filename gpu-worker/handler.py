"""RunPod Serverless handler for NVIDIA PiD upscaler.

Receives a base64 PNG, runs PiD super-resolution on the GPU,
and returns the upscaled PNG as base64.

Request schema:
    { "input": { "image_b64": str, "scale": 2|4, "kind": "auto"|"photo"|"illustration"|... } }

Response schema:
    { "output": { "image_b64": str, "width": int, "height": int, "model": "PiD-v1" } }

This file is a thin glue layer; replace `_run_pid` with the real PiD inference
call once you wire the cloned repo's pipeline. The structure is correct for
RunPod Serverless and matches what photoroom-upscale Edge Function expects.
"""
from __future__ import annotations

import base64
import io
import os
import sys
import traceback
from typing import Any

import runpod
import torch
from PIL import Image

# --- PiD pipeline import (lazy, so cold start can still respond to ping) ---
_PID_PIPE = None
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def _load_pid():
    """Load the PiD model once per worker process."""
    global _PID_PIPE
    if _PID_PIPE is not None:
        return _PID_PIPE
    sys.path.insert(0, "/workspace/PiD")
    # NOTE: adjust this import to match the actual PiD API.
    # See https://github.com/nv-tlabs/PiD for the public entrypoint.
    from pid.inference import PiDPipeline  # type: ignore
    _PID_PIPE = PiDPipeline.from_pretrained(
        "nvidia/PiD",
        cache_dir="/workspace/.cache/hf",
        torch_dtype=torch.float16 if _DEVICE == "cuda" else torch.float32,
    ).to(_DEVICE)
    return _PID_PIPE


def _decode_b64_png(b64: str) -> Image.Image:
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    raw = base64.b64decode(b64)
    return Image.open(io.BytesIO(raw)).convert("RGBA")


def _encode_png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _run_pid(img: Image.Image, scale: int) -> Image.Image:
    pipe = _load_pid()
    with torch.inference_mode():
        out = pipe(img, scale=scale)  # type: ignore[operator]
    # PiDPipeline returns a PIL Image in the reference repo.
    return out if isinstance(out, Image.Image) else out["image"]


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

        src = _decode_b64_png(b64)
        out = _run_pid(src, scale)
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
