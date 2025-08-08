# Use existing RunPod PyTorch base image  
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

# Set the working directory
WORKDIR /app

# Install git and other essentials
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# FORCE clean PyTorch upgrade - clear caches and reinstall
RUN pip cache purge
RUN pip uninstall -y torch torchvision torchaudio
RUN pip install torch==2.2.0 torchvision==0.17.0 torchaudio==2.2.0 --index-url https://download.pytorch.org/whl/cu118 --no-cache-dir --force-reinstall

# Verify PyTorch upgrade worked
RUN python -c "import torch; print(f'PyTorch version: {torch.__version__}'); print(f'torch.uint64 exists: {hasattr(torch, \"uint64\")}'); assert hasattr(torch, 'uint64'), 'torch.uint64 not found!'"

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