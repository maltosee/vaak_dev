import runpod
import json
import uuid
import logging
import numpy as np
import soundfile as sf
import io
import time

print("🚨 STATIC AUDIO HANDLER LOADED - NO TTS MODELS 🚨")
print("🚨 THIS IS THE NEW VERSION 🚨")

import runpod
# ... rest of static audio code

# NO TTS IMPORTS - NO MODEL LOADING

def create_test_audio_chunks(duration_seconds=2, sample_rate=22050, chunk_size_seconds=0.5):
    """Generate simple sine wave audio chunks for testing"""
    
    total_samples = int(duration_seconds * sample_rate)
    chunk_samples = int(chunk_size_seconds * sample_rate)
    
    # Generate a simple sine wave (440 Hz tone)
    t = np.linspace(0, duration_seconds, total_samples)
    audio_data = 0.3 * np.sin(2 * np.pi * 440 * t).astype(np.float32)
    
    # Split into chunks
    chunks = []
    for i in range(0, len(audio_data), chunk_samples):
        chunk = audio_data[i:i + chunk_samples]
        
        # Convert to WAV bytes
        buffer = io.BytesIO()
        sf.write(buffer, chunk, sample_rate, format='WAV')
        buffer.seek(0)
        wav_bytes = buffer.read()
        chunks.append(wav_bytes)
    
    return chunks

def handler(job):
    """Static audio streaming - NO TTS models involved"""
    try:
        job_input = job['input']
        text = job_input.get('text', '').strip()
        
        logging.info(f"🔍 Handler received job: text='{text[:50]}...'")
        
        if not text:
            yield {"error": "Text required"}
            return

        request_id = str(uuid.uuid4())[:8]
        logging.info(f"🎵 Static audio request [{request_id}]: '{text[:50]}...'")
        
        # Generate static test audio chunks (NO TTS)
        audio_chunks = create_test_audio_chunks(duration_seconds=3, chunk_size_seconds=0.5)
        
        # Send stream start
        yield {
            "type": "stream_start",
            "request_id": request_id,
            "text": text,
            "voice": "test_static",
            "sampling_rate": 22050
        }
        
        # Stream static audio chunks
        for chunk_id, wav_chunk in enumerate(audio_chunks, 1):
            time.sleep(0.1)  # Simulate processing delay
            
            logging.info(f"📤 [{request_id}] Static chunk {chunk_id}: {len(wav_chunk)} bytes")
            
            yield {
                "type": "audio_chunk",
                "chunk_id": chunk_id,
                "audio_data": wav_chunk.hex(),  # Convert bytes to hex
                "request_id": request_id
            }
        
        yield {
            "type": "stream_complete", 
            "request_id": request_id,
            "total_chunks": len(audio_chunks)
        }
        
    except Exception as e:
        logging.error(f"Handler error: {e}")
        yield {"error": str(e)}   
        
if __name__ == "__main__":
    runpod.serverless.start({
        "handler": handler,
        "return_aggregate_stream": True
    })