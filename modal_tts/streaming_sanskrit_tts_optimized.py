"""
Two Container Streaming Sanskrit TTS - WebSocket + TTS Service
Fast implementation for production streaming
"""

import modal
import json
import logging
import uuid
from threading import Thread

# Create app
app = modal.App("two-container-sanskrit-tts")

# TTS image
tts_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(["git", "ffmpeg", "libsndfile1"])
    .pip_install([
        "torch>=2.0.0", # Ensure PyTorch 2.0+ for torch.compile
        "transformers>=4.40.0", 
        "soundfile>=0.12.1",
        "accelerate>=0.21.0",
        "numpy>=1.24.0"
    ])
    .pip_install("git+https://github.com/huggingface/parler-tts.git")
)

# WebSocket image
websocket_image = modal.Image.debian_slim().pip_install("fastapi[standard]", "websockets")

# Voice configs
VOICE_CONFIGS = {
    "aryan_default": "Aryan speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters",
    "aryan_scholarly": "Aryan recites Sanskrit with scholarly precision and poetic sensibility while ensuring proper halant pronunciations and clear consonant clusters.",
    "aryan_meditative": "Aryan speaks in a serene, meditative tone with slow, deliberate pacing while ensuring proper halant pronunciations and clear consonant clusters.",
    "priya_default": "Priya speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters, with a feminine voice quality."
}

# ADD THIS FUNCTION HERE (before the class)
def estimate_audio_duration(text: str, sampling_rate: int = 44100) -> float:
    """Estimate audio duration based on text length"""
    char_count = len(text)
    estimated_seconds = char_count / 2.5
    return max(1.0, estimated_seconds)

# TTS Service Container
@app.cls(
    gpu="L4",
    image=tts_image,
    concurrency_limit=2,
    keep_warm=0,
    timeout=1800,
    container_idle_timeout=600
)
class StreamingTTSService:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.desc_tokenizer = None
        self.device = None
        self.sampling_rate = None
        self.torch_dtype = None # Added to store dtype for autocast
        
    @modal.enter()
    def load_model(self):
        import torch
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer
        
        logging.basicConfig(level=logging.INFO)
        logger = logging.getLogger(__name__)
        logger.info("🤖 Loading TTS model...")
        
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        # --- OPTIMIZATION 1: Mixed Precision (FP16/BF16) Setup ---
        # Using torch.float16 for L4 GPU. If L4 supports bfloat16 and you prefer it, use torch.bfloat16.
        self.torch_dtype = torch.float16 if self.device == "cuda" else torch.float32
        
        # ✅ ADD THIS LINE HERE (after device setup, before model loading):
        if self.device == "cuda":
            torch.backends.cudnn.benchmark = True
        
        logger.info(f"Using torch_dtype: {self.torch_dtype}")

        self.model = ParlerTTSForConditionalGeneration.from_pretrained(
            "ai4bharat/indic-parler-tts",
            torch_dtype=self.torch_dtype # Pass the dtype to from_pretrained
        ).to(self.device)
        
        self.tokenizer = AutoTokenizer.from_pretrained("ai4bharat/indic-parler-tts")
        self.desc_tokenizer = AutoTokenizer.from_pretrained(self.model.config.text_encoder._name_or_path)
        self.sampling_rate = self.model.config.sampling_rate
        
        # --- OPTIMIZATION 2: torch.compile ---
        # This compiles the model for faster execution.
        # It's a powerful optimization for PyTorch 2.0+ models.
        try:
            # You can experiment with different modes: "default", "reduce-overhead", "max-autotune"
            # "max-autotune" can be slower for first run but best for long-running services.
            # "reduce-overhead" is a good balance.
            self.model = torch.compile(self.model, mode="reduce-overhead")
            logger.info("✅ Model compiled with torch.compile!")
        except Exception as e:
            logger.warning(f"⚠️ torch.compile failed: {e}. Proceeding without compilation.")
            # If compilation fails, the original model is used, so it's safe.
        
        # ✅ ADD MODEL CACHING OPTIMIZATIONS HERE (after compilation):
        self.model.eval()                           # Set to evaluation mode
        torch.set_grad_enabled(False)               # Disable gradients globally
    
        # ✅ ADD TOKENIZER OPTIMIZATIONS HERE:
        self.tokenizer.padding_side = "left"        # Optimize padding  
        self.desc_tokenizer.padding_side = "left"   # Optimize padding
        

        logger.info(f"✅ TTS model loaded and initialized on {self.device}")
        
    def chunk_text(self, text: str, max_words: int = 20) -> list:
        """Adaptive chunking based on word count - Indic Parler TTS recommendation"""
        import re
        
        words = text.split()
        if len(words) <= max_words:
            return [text]  # No chunking needed
        
        # Split by sentences first, using both markers
        sentences = re.split(r'[।|\.]+', text)
        chunks = []
        current_chunk = ""
        current_word_count = 0
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
                
            sentence_words = len(sentence.split())
            
            # If adding this sentence exceeds word limit, save current chunk
            if current_word_count + sentence_words > max_words and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = sentence
                current_word_count = sentence_words
            else:
                current_chunk += (" " + sentence if current_chunk else sentence)
                current_word_count += sentence_words
        
        # Add final chunk
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        return chunks
    
    @modal.method()
    def batch_synthesis(self, text: str, voice_key: str, request_id: str):
        import torch
        import numpy as np
        import soundfile as sf
        import io
        import time

        logger = logging.getLogger(__name__)
        logger.info(f"🎵 [{request_id}] BATCH synthesis: '{text[:50]}...'")
        
        # Chunk the text
        text_chunks = self.chunk_text(text, max_words=20)  # ✅ Explicit parameter
        logger.info(f"📝 [{request_id}] Split into {len(text_chunks)} chunks")
        
        voice_description = VOICE_CONFIGS.get(voice_key, VOICE_CONFIGS["aryan_default"])
        all_audio_chunks = []
        
        # Process each chunk
        for i, chunk in enumerate(text_chunks):
            logger.info(f"🔄 [{request_id}] Processing chunk {i+1}/{len(text_chunks)}: '{chunk[:30]}...'")
            
            # Tokenization for this chunk
            text_tokens = self.tokenizer(chunk, return_tensors="pt").to(self.device)
            desc_tokens = self.desc_tokenizer(voice_description, return_tensors="pt").to(self.device)
            
            # HF-style generation parameters
            generation_kwargs = {
                "input_ids": desc_tokens.input_ids,
                "attention_mask": desc_tokens.attention_mask,
                "prompt_input_ids": text_tokens.input_ids,
                "prompt_attention_mask": text_tokens.attention_mask,
                "do_sample": True,
                "temperature": 1.0,                   # ✅ HF uses temperature
                "return_dict_in_generate": True
            }
            
            with torch.autocast(device_type=self.device, dtype=self.torch_dtype):
                generation = self.model.generate(**generation_kwargs)
            
            # Extract audio using HF method
            if hasattr(generation, 'sequences') and hasattr(generation, 'audios_length'):
                audio = generation.sequences[0, :generation.audios_length[0]]
                audio_numpy = audio.to(torch.float32).cpu().numpy().squeeze()
            else:
                logger.error(f"❌ [{request_id}] Generation missing sequences for chunk {i+1}")
                continue
                
            all_audio_chunks.append(audio_numpy)
            logger.info(f"✅ [{request_id}] Chunk {i+1} audio: {audio_numpy.shape}, Duration: {len(audio_numpy)/self.sampling_rate:.3f}s")
        
        # Concatenate all chunks with silence padding
        if not all_audio_chunks:
            logger.error(f"❌ [{request_id}] No audio chunks generated")
            return None
        
        # Add silence between chunks (0.1 second)
        silence_samples = int(0.1 * self.sampling_rate)
        silence = np.zeros(silence_samples, dtype=np.float32)
        
        final_audio = all_audio_chunks[0]
        for chunk in all_audio_chunks[1:]:
            final_audio = np.concatenate([final_audio, silence, chunk])
        
        logger.info(f"🔗 [{request_id}] Final concatenated audio: {final_audio.shape}, Duration: {len(final_audio)/self.sampling_rate:.3f}s")
        
        # Convert to WAV
        buffer = io.BytesIO()
        sf.write(buffer, final_audio.astype(np.float32), self.sampling_rate, format='WAV')
        buffer.seek(0)
        return buffer.read()

    
    
    
    
    @modal.method()
    def stream_synthesis(self, text: str, voice_key: str, play_steps_in_s: float, request_id: str):
        import torch
        import numpy as np
        import soundfile as sf
        import io
        import time  # ← ADD THIS LINE
        from parler_tts import ParlerTTSStreamer
        
        logger = logging.getLogger(__name__)
        logger.info(f"🎵 [{request_id}] Starting synthesis: '{text[:50]}...'")
        
        logger.info(f"🔍 [{request_id}] Audio config - Rate: {self.sampling_rate}Hz, Channels: 1")
        
        voice_description = VOICE_CONFIGS.get(voice_key, VOICE_CONFIGS["aryan_default"])
        
        # Tokenization
        text_tokens = self.tokenizer(text, return_tensors="pt").to(self.device)
        desc_tokens = self.desc_tokenizer(voice_description, return_tensors="pt").to(self.device)
        
        logger.info(f"🔍 [{request_id}] Text tokens: {text_tokens.input_ids.shape}")
        
        # Setup streaming
        frame_rate = self.model.audio_encoder.config.frame_rate
        play_steps = int(frame_rate * play_steps_in_s)
        streamer = ParlerTTSStreamer(self.model, device=self.device, play_steps=play_steps)
        
       # REPLACE in stream_synthesis():
        generation_kwargs = {
            "input_ids": desc_tokens.input_ids,
            "attention_mask": desc_tokens.attention_mask,
            "prompt_input_ids": text_tokens.input_ids,
            "prompt_attention_mask": text_tokens.attention_mask,
            "streamer": streamer,
            "do_sample": False,        
            "min_new_tokens": 5,       
            "max_new_tokens": 1000,    
            # ❌ REMOVE: "early_stopping": True,  # Causes conflict with num_beams=1
        }
        
        # ADD in stream_synthesis() before generation:
        torch.cuda.empty_cache()  # Clear GPU memory cache
        
        # --- OPTIMIZATION 1: Mixed Precision (FP16) Inference Context ---
        # This context manager ensures operations within it use the specified dtype (e.g., float16)
        # It's safe because if self.device is "cpu", it will default to float32.
        with torch.autocast(device_type=self.device, dtype=self.torch_dtype):
            # Start generation thread
            thread = Thread(target=self.model.generate, kwargs=generation_kwargs)
            thread.start()
            
            # Stream chunks
            chunk_count = 0
            
            try:
                chunk_send_times = []  # Track exact send times
                for audio_chunk in streamer:
                    if audio_chunk.shape[0] == 0:
                        break
                        
                    chunk_count += 1
                    
                    # Convert to WAV
                    audio_float32 = audio_chunk.astype(np.float32)
                    buffer = io.BytesIO()
                    sf.write(buffer, audio_float32, self.sampling_rate, format='WAV')
                    buffer.seek(0)
                    wav_bytes = buffer.read()
                    
                    logger.info(f"🔍 [{request_id}] Chunk audio shape: {audio_chunk.shape}, Duration: {len(audio_chunk)/self.sampling_rate:.3f}s")
                    
                    # DIAGNOSTIC: Record exact send time
                    send_time = time.time()
                    chunk_send_times.append(send_time)
                    
                    logger.info(f"📤 [{request_id}] Chunk {chunk_count}: {len(wav_bytes)} bytes at {send_time:.3f}")
                    
                    # DIAGNOSTIC: Calculate gap from previous chunk
                    if len(chunk_send_times) > 1:
                        gap = send_time - chunk_send_times[-2]
                        logger.info(f"⏱️ [{request_id}] Gap since last chunk: {gap:.3f}s")
                    
                    
                    yield wav_bytes
                    
            finally:
                thread.join()
                logger.info(f"✅ [{request_id}] Complete: {chunk_count} chunks")


# In streaming_sanskrit_tts_optimized.py
@app.function(image=tts_image)
def get_tts_stream(text: str, voice: str, play_steps_in_s: float, request_id: str):
    tts_service = StreamingTTSService()
    # Use the asynchronous generator call here
    yield from tts_service.stream_synthesis.remote_gen(
        text, voice, play_steps_in_s, request_id
    )


output_vol = modal.Volume.from_name("tts-files", create_if_missing=True)

@app.function(image=tts_image, volumes={"/output": output_vol})
def test_batch(text: str):  # Remove default value
    import time
    tts = StreamingTTSService()
    wav_bytes = tts.batch_synthesis.remote(text, "aryan_default", "test")
    filename = f"/output/batch_output_{int(time.time())}.wav"
    
    with open(filename, "wb") as f:
        f.write(wav_bytes)
    output_vol.commit()
    
    return f"File saved! Download with: modal volume get tts-files batch_output.wav"

# WebSocket Server Container
@app.function(
    image=websocket_image,
    concurrency_limit=100,
    keep_warm=0,
    timeout=1800
)
@modal.asgi_app()
def websocket_server():
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    
    web_app = FastAPI()
    
    @web_app.websocket("/")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        client_id = f"client_{id(websocket)}"
        logger.info(f"✅ WebSocket client {client_id} connected")
        
        # ✅ CREATE SINGLE REUSABLE INSTANCE
        tts_service = StreamingTTSService()
        
        try:
            while True:
                message_text = await websocket.receive_text()
                data = json.loads(message_text)
                message_type = data.get("type")
                
                logger.info(f"📥 [{client_id}] {message_type}")
                
                if message_type == "health_check":
                    await websocket.send_text(json.dumps({
                        "type": "health_response", 
                        "status": "healthy",
                        "available_voices": list(VOICE_CONFIGS.keys())
                    }))
                    
                elif message_type == "stream_tts":
                    text = data.get("text", "").strip()
                    voice = data.get("voice", "aryan_default")
                    play_steps_in_s = data.get("play_steps_in_s", 0.5)
                    
                    if not text:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Text required"
                        }))
                        continue
                    
                    request_id = str(uuid.uuid4())[:8]
                    estimated_duration = estimate_audio_duration(text)
                    
                    await websocket.send_text(json.dumps({
                        "type": "stream_start",
                        "request_id": request_id,
                        "text": text,
                        "voice": voice,
                        "estimated_duration": estimated_duration
                    }))
                    
                    try:
                        chunk_count = 0
                        
                        # ADD THIS DEBUG STATEMENT
                        logger.info(f"🔍 [{client_id}] Attempting to get stream from TTS service...")
                        
                        # ✅ REUSE EXISTING INSTANCE
                        async for wav_chunk in get_tts_stream.remote_gen.aio(
                            text, voice, play_steps_in_s, request_id
                        ):
                            
                            # ADD THIS DEBUG STATEMENT
                            logger.info(f"🔊 [{client_id}] Received chunk {chunk_count+1} from TTS service. Size: {len(wav_chunk)} bytes")
                            chunk_count += 1
                            await websocket.send_bytes(wav_chunk)
                        
                        logger.info(f"✅ [{client_id}] Streaming complete. Sent {chunk_count} chunks.")

                        
                        await websocket.send_text(json.dumps({
                            "type": "stream_complete",
                            "request_id": request_id,
                            "total_chunks": chunk_count
                        }))
                        
                    except Exception as e:
                        logger.error(f"❌ [{client_id}] Error [{request_id}]: {str(e)}")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "request_id": request_id,
                            "message": str(e)
                        }))
                    
        except WebSocketDisconnect:
            logger.info(f"👋 Client {client_id} disconnected")
        except Exception as e:
            logger.error(f"💥 WebSocket error [{client_id}]: {str(e)}")
            
    return web_app
    
# Deploy test
@app.local_entrypoint()
def deploy():
    print("🚀 Two-container streaming TTS ready!")
    print("WebSocket URL: Use the websocket_server endpoint")
    print("Protocol: {'type': 'stream_tts', 'text': 'ॐ गम् गणपतये नमः', 'voice': 'aryan_default'}")
