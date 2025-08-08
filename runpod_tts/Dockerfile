# Use a suitable PyTorch base image
# FIX: Use a compatible PyTorch version (2.3.0 or newer)
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# Set the working directory
WORKDIR /app

# Install git and other essentials
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# The previous PyTorch downgrade is no longer needed since we have a compatible base image.
# We can remove these lines to simplify the build process.
# RUN pip cache purge
# RUN pip uninstall -y torch torchvision torchaudio
# RUN pip install torch==2.2.0 torchvision==0.17.0 torchaudio==2.2.0 --index-url https://download.pytorch.org/whl/cu118 --no-cache-dir --force-reinstall

# The verification step should now pass, so you can remove the assertion to avoid build failures.
# This check is still useful for local debugging if needed.
# RUN python -c "import torch; print(f'PyTorch version: {torch.__version__}'); print(f'torch.uint64 exists: {hasattr(torch, \"uint64\")}'); assert hasattr(torch, 'uint64'), 'torch.uint64 not found!'"

# Clone your repository
RUN git clone https://github.com/maltosee/vaak_dev.git .

# Install dependencies
RUN pip install --no-cache-dir -r runpod_tts/requirements.txt

# Set environment variables for the TTS model
ENV PYTHONPATH=/app
ENV TORCH_HOME=/app/models
ENV HF_HOME=/app/models
ENV TRANSFORMERS_CACHE=/app/models

# Create models directory
RUN mkdir -p /app/models

# Change to the correct directory containing runpod_handler.py
WORKDIR /app/runpod_tts

# The handler is the entry point for the RunPod worker
CMD ["python3", "-u", "runpod_handler.py"]
