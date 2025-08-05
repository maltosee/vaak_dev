# Use a suitable PyTorch base image
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

# Set the working directory
WORKDIR /app

# Install git so we can clone the repo
RUN apt-get update && apt-get install -y git

# Clone your repository and install dependencies
RUN git clone https://github.com/maltosee/vaak_dev.git . && \
    pip install --no-cache-dir -r runpod_tts/requirements.txt

# Set environment variables for the TTS model
ENV PYTHONPATH=/app
ENV TORCH_HOME=/app/models
ENV HF_HOME=/app/models
ENV TRANSFORMERS_CACHE=/app/models

# The handler is the entry point for the RunPod worker
CMD ["python", "runpod_handler.py"]