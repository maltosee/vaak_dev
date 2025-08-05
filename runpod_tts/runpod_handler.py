import runpod
import json
import uuid
import logging
from app import StreamingTTSService, VOICE_CONFIGS

# Initialize TTS service globally 
tts_service = StreamingTTSService()
tts_service.load_model()

def handler(job):
    """RunPod serverless handler with generator for streaming"""
    try:
        job_input = job['input']
        text = job_input.get('text', '').strip()
        voice = job_input.get('voice', 'aryan_default')
        play_steps_in_s = job_input.get('play_steps_in_s', 0.5)
        
        if not text:
            return {"error": "Text required"}
        
        request_id = str(uuid.uuid4())[:8]
        logging.info(f"🎵 RunPod request [{request_id}]: '{text[:50]}...'")
        
        # Generator for streaming chunks
        def stream_generator():
            yield {
                "type": "stream_start",
                "request_id": request_id,
                "text": text,
                "voice": voice,
                "sampling_rate": 44100
            }
            
            chunk_count = 0
            for wav_chunk in tts_service.stream_synthesis(text, voice, play_steps_in_s, request_id):
                chunk_count += 1
                yield {
                    "type": "audio_chunk",
                    "chunk_id": chunk_count,
                    "audio_data": wav_chunk.hex(),  # Convert bytes to hex
                    "request_id": request_id
                }
            
            yield {
                "type": "stream_complete", 
                "request_id": request_id,
                "total_chunks": chunk_count
            }
        
        return stream_generator()
        
    except Exception as e:
        logging.error(f"Handler error: {e}")
        return {"error": str(e)}

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})