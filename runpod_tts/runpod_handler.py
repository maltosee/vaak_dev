import runpod
import json
import uuid
import logging
import numpy as np
import soundfile as sf
import io
import time

# NO TTS IMPORTS - Simple text streaming following canonical pattern

def handler(job):
    """Simple text streaming - following canonical RunPod pattern"""
    try:
        job_input = job['input']
        text = job_input.get('text', '').strip()
        
        logging.info(f"🔍 Handler received job: text='{text[:50]}...'")
        
        if not text:
            yield "ERROR: Text required"
            return

        request_id = str(uuid.uuid4())[:8]
        logging.info(f"🎵 Simple text streaming [{request_id}]: '{text[:50]}...'")
        
        # CANONICAL PATTERN: Yield simple strings
        yield f"START:{request_id}"
        
        # Simulate processing each word with delay (like canonical character example)
        words = text.split()
        for i, word in enumerate(words):
            time.sleep(0.2)  # Simulate processing delay
            logging.info(f"📤 [{request_id}] Word {i+1}: {word}")
            yield f"WORD:{i+1}:{word}"
        
        yield f"COMPLETE:{len(words)}"
        
    except Exception as e:
        logging.error(f"Handler error: {e}")
        yield f"ERROR:{str(e)}"   
        
if __name__ == "__main__":
    # NO return_aggregate_stream - test default behavior
    runpod.serverless.start({
        "handler": handler
    })