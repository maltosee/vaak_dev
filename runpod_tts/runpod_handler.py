import runpod
import json
import uuid
import logging
import traceback

# Add verbose debug logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

print("🚀 HANDLER: Container started successfully")
print("🚀 HANDLER: Python import successful")

try:
    print("🚀 HANDLER: Testing basic imports...")
    import torch
    print(f"✅ HANDLER: PyTorch version: {torch.__version__}")
    print(f"✅ HANDLER: CUDA available: {torch.cuda.is_available()}")
    print(f"✅ HANDLER: torch.uint64 exists: {hasattr(torch, 'uint64')}")
except Exception as e:
    print(f"❌ HANDLER: PyTorch import failed: {e}")
    traceback.print_exc()

try:
    print("🚀 HANDLER: Testing transformers import...")
    from transformers import AutoTokenizer
    print("✅ HANDLER: Transformers import successful")
except Exception as e:
    print(f"❌ HANDLER: Transformers import failed: {e}")
    traceback.print_exc()

try:
    print("🚀 HANDLER: Testing parler_tts import...")
    from parler_tts import ParlerTTSForConditionalGeneration, ParlerTTSStreamer
    print("✅ HANDLER: Parler-TTS import successful")
except Exception as e:
    print(f"❌ HANDLER: Parler-TTS import failed: {e}")
    traceback.print_exc()

# Simple test handler
def handler(job):
    """Simple test handler to verify basic functionality"""
    try:
        print(f"🔍 HANDLER: Received job: {job}")
        job_input = job.get('input', {})
        test_text = job_input.get('text', 'test')
        
        return {
            "status": "success", 
            "message": "Handler working!",
            "text_received": test_text,
            "torch_version": torch.__version__,
            "cuda_available": torch.cuda.is_available(),
            "uint64_support": hasattr(torch, 'uint64')
        }
        
    except Exception as e:
        print(f"❌ HANDLER: Handler error: {e}")
        traceback.print_exc()
        return {"error": str(e), "traceback": traceback.format_exc()}

print("🚀 HANDLER: Starting RunPod serverless...")

if __name__ == "__main__":
    try:
        runpod.serverless.start({"handler": handler})
        print("✅ HANDLER: RunPod serverless started successfully")
    except Exception as e:
        print(f"❌ HANDLER: RunPod start failed: {e}")
        traceback.print_exc()