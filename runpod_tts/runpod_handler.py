# RunPod Handler - Test with Real Audio File
#forcing push to runpod
import runpod
import json
import time
import wave
import io
import base64
import requests
from pathlib import Path

def chunked_audio_generator(text, voice="aryan_default"):
    """
    Test generator that loads a real WAV file and chunks it
    """
    print(f"🎯 Starting real audio test for: '{text}' (voice: {voice})")
    
    # Download a sample WAV file for testing
    try:
        # Use a public sample WAV file
        sample_url = "https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav"
        response = requests.get(sample_url, timeout=10)
        
        if response.status_code == 200:
            audio_data = response.content
            print(f"✅ Downloaded sample audio: {len(audio_data)} bytes")
        else:
            raise Exception(f"Failed to download: {response.status_code}")
            
    except Exception as e:
        print(f"⚠️ Could not download sample, using fallback: {e}")
        # Fallback: Create a very short WAV with actual audio structure
        audio_data = create_minimal_wav()
    
    # Parse WAV to get proper format info
    try:
        with io.BytesIO(audio_data) as audio_io:
            with wave.open(audio_io, 'rb') as wav_file:
                sample_rate = wav_file.getframerate()
                channels = wav_file.getnchannels()
                total_frames = wav_file.getnframes()
                duration = total_frames / sample_rate
                
                print(f"🎵 WAV Info: {sample_rate}Hz, {channels}ch, {duration:.2f}s")
    except Exception as e:
        print(f"⚠️ Could not parse WAV: {e}")
        sample_rate = 22050
        channels = 1
        duration = 1.0
    
    # Send start message
    yield {
        "type": "stream_start",
        "request_id": f"test_{int(time.time())}",
        "text": text,
        "voice": voice,
        "sampling_rate": sample_rate,
        "total_estimated_chunks": 6
    }
    
    # Split audio into chunks (simulate streaming)
    chunk_size = len(audio_data) // 6  # 6 chunks like before
    
    for i in range(6):
        start_idx = i * chunk_size
        end_idx = start_idx + chunk_size if i < 5 else len(audio_data)
        
        chunk_data = audio_data[start_idx:end_idx]
        
        print(f"🔊 Chunk {i+1}/6: {len(chunk_data)} bytes")
        
        yield {
            "type": "audio_chunk",
            "chunk_id": i + 1,
            "audio_data": chunk_data.hex(),
            "timestamp": time.time()
        }
        
        # Small delay between chunks
        time.sleep(0.1)
    
    # Send completion
    yield {
        "type": "stream_complete",
        "total_chunks": 6,
        "request_id": f"test_{int(time.time())}",
        "final_duration": duration
    }

def create_minimal_wav():
    """
    Create a minimal valid WAV file with actual audio content
    """
    import struct
    
    # WAV parameters
    sample_rate = 22050
    duration = 2.0  # 2 seconds
    num_samples = int(sample_rate * duration)
    
    # Generate a simple melody instead of sine wave
    audio_samples = []
    for i in range(num_samples):
        # Create a simple melody with varying frequency
        t = i / sample_rate
        freq = 440 + 110 * (t % 1.0)  # Frequency varies from 440-550 Hz
        sample = int(16384 * (t % 0.5) * 2)  # Sawtooth-like wave
        audio_samples.append(sample)
    
    # Create WAV file in memory
    wav_buffer = io.BytesIO()
    
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(1)      # Mono
        wav_file.setsampwidth(2)      # 16-bit
        wav_file.setframerate(sample_rate)
        
        # Convert to bytes
        audio_bytes = b''.join(struct.pack('<h', sample) for sample in audio_samples)
        wav_file.writeframes(audio_bytes)
    
    wav_buffer.seek(0)
    return wav_buffer.read()

def handler(event):
    """
    Main RunPod handler - Test with real audio
    """
    try:
        input_data = event.get("input", {})
        text = input_data.get("text", "Hello, this is a test message")
        voice = input_data.get("voice", "aryan_default")
        
        print(f"🚀 Handler called with text: '{text}', voice: {voice}")
        
        # Return generator for streaming
        return chunked_audio_generator(text, voice)
        
    except Exception as e:
        print(f"❌ Handler error: {e}")
        return {
            "error": f"Handler failed: {str(e)}",
            "type": "error"
        }

# RunPod serverless setup
runpod.serverless.start({"handler": handler})

print("🎵 RunPod Real Audio Test Handler Ready!")
print("📝 This handler will:")
print("   1. Download a real WAV file")
print("   2. Split it into 6 chunks")
print("   3. Stream as hex-encoded audio")
print("   4. Test the full audio pipeline")
