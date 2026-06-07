# NVIDIA PiD upscaler — RunPod Serverless container
# Base: CUDA 12.1 + cuDNN + Ubuntu 22.04 + Python 3.10
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TORCH_HOME=/workspace/.cache/torch \
    HF_HOME=/workspace/.cache/hf

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3-pip python3.10-venv git wget ca-certificates \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.10 /usr/bin/python && \
    python -m pip install --upgrade pip

WORKDIR /workspace

# --- 1) PyTorch (CUDA 12.1) ---
RUN pip install \
        torch==2.3.1+cu121 torchvision==0.18.1+cu121 \
        --index-url https://download.pytorch.org/whl/cu121

# --- 2) PiD source (NVIDIA, Apache-2.0) ---
RUN git clone --depth 1 https://github.com/nv-tlabs/PiD.git /workspace/PiD
WORKDIR /workspace/PiD
RUN pip install -r requirements.txt || true

# --- 3) Worker deps ---
RUN pip install runpod==1.7.0 pillow numpy

# --- 4) Pre-download model weights (so first request is fast) ---
RUN python -c "from huggingface_hub import snapshot_download; \
    snapshot_download(repo_id='nvidia/PiD', cache_dir='/workspace/.cache/hf') \
    " || echo "[warn] weight prefetch skipped (will download on first run)"

# --- 5) Handler ---
COPY handler.py /workspace/handler.py

CMD ["python", "-u", "/workspace/handler.py"]
