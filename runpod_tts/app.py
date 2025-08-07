import json
import logging
import uuid
from threading import Thread
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import torch
import numpy as np
import soundfile as sf
import io
import time
from parler_tts import ParlerTTSForConditionalGeneration, ParlerTTSStreamer
from transformers import AutoTokenizer

# Create app
web_app = FastAPI()

# Voice configs
VOICE_CONFIGS = {
    "aryan_default": "Aryan speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters",
    "aryan_scholarly": "Aryan recites Sanskrit with scholarly precision and poetic sensibility while ensuring proper halant pronunciations and clear consonant clusters.",
    "aryan_meditative": "Aryan speaks in a serene, meditative tone with slow, deliberate pacing while ensuring proper halant pronunciations and clear consonant clusters.",
    "priya_default": "Priya speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters, with a feminine voice quality."
}

def estimate_audio_duration(text: str, sampling_rate: int = 44100) -> float:
    """Estimate audio duration based on text length"""
    char_count = len(text)
    estimated_seconds = char_count / 2.5
    return max(1.0, estimated_seconds)

class StreamingTTSService:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.desc_tokenizer = None
        self.device = None
        self.sampling_rate = None
        self.torch_dtype = None

    def load_model(self):
        logging.basicConfig(level=logging.INFO)
        logger = logging.getLogger(__name__)
        logger.info("🤖 Loading TTS model...")

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.torch_dtype = torch.float16 if self.device == "cuda" else torch.float32

        if self.device == "cuda":
            torch.backends.cudnn.benchmark = True

        logger.info(f"Using torch_dtype: {self.torch_dtype}")

        self.model = ParlerTTSForConditionalGeneration.from_pretrained(
            "ai4bharat/indic-parler-tts",
            torch_dtype=self.torch_dtype
        ).to(self.device)

        self.tokenizer = AutoTokenizer.from_pretrained("ai4bharat/indic-parler-tts")
        self.desc_tokenizer = AutoTokenizer.from_pretrained(self.model.config.text_encoder._name_or_path)
        self.sampling_rate = self.model.config.sampling_rate

        try:
            self.model = torch.compile(self.model, mode="reduce-overhead")
            logger.info("✅ Model compiled with torch.compile!")
        except Exception as e:
            logger.warning(f"⚠️ torch.compile failed: {e}. Proceeding without compilation.")

        self.model.eval()
        torch.set_grad_enabled(False)
        self.tokenizer.padding_side = "left"
        self.desc_tokenizer.padding_side = "left"

        logger.info(f"✅ TTS model loaded and initialized on {self.device}")

    def stream_synthesis(self, text: str, voice_key: str, play_steps_in_s: float, request_id: str):
        logger = logging.getLogger(__name__)
        logger.info(f"🎵 [{request_id}] Starting synthesis: '{text[:50]}...'")
        logger.info(f"🔍 [{request_id}] stream_synthesis received: text='{text[:50]}...', voice='{voice_key}'")


        voice_description = VOICE_CONFIGS.get(voice_key, VOICE_CONFIGS["aryan_default"])

        text_tokens = self.tokenizer(text, return_tensors="pt").to(self.device)
        desc_tokens = self.desc_tokenizer(voice_description, return_tensors="pt").to(self.device)

        logger.info(f"🔍 [{request_id}] Text tokens: {text_tokens.input_ids.shape}")

        frame_rate = self.model.audio_encoder.config.frame_rate
        play_steps = int(frame_rate * play_steps_in_s)
        streamer = ParlerTTSStreamer(self.model, device=self.device, play_steps=play_steps)

        generation_kwargs = {
            "input_ids": desc_tokens.input_ids,
            "attention_mask": desc_tokens.attention_mask,
            "prompt_input_ids": text_tokens.input_ids,
            "prompt_attention_mask": text_tokens.attention_mask,
            "streamer": streamer,
            "do_sample": False,
            "min_new_tokens": 5,
            "max_new_tokens": 1000,
        }

        torch.cuda.empty_cache()

        with torch.autocast(device_type=self.device, dtype=self.torch_dtype):
            thread = Thread(target=self.model.generate, kwargs=generation_kwargs)
            thread.start()

            chunk_count = 0
            try:
                
                chunk_send_times = []  # Track exact send times
                # FIX: Add a log to confirm we are entering the stream loop
                logger.info(f"🔍 [{request_id}] Entering streamer loop...")
                for audio_chunk in streamer:
                for audio_chunk in streamer:
                    if audio_chunk.shape[0] == 0:
                        break
                    chunk_count += 1
                    audio_float32 = audio_chunk.astype(np.float32)
                    buffer = io.BytesIO()
                    sf.write(buffer, audio_float32, self.sampling_rate, format='WAV')
                    buffer.seek(0)
                    wav_bytes = buffer.read()
                    
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

tts_service = StreamingTTSService()
@web_app.on_event("startup")
async def startup_event():
    tts_service.load_model()

@web_app.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = f"client_{id(websocket)}"
    logger = logging.getLogger(__name__)
    logger.info(f"✅ WebSocket client {client_id} connected")

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

            elif message_type == "get_voices":
                await websocket.send_text(json.dumps({
                    "type": "voices_response",
                    "voices": list(VOICE_CONFIGS.keys()),
                    "descriptions": VOICE_CONFIGS
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
                logger.info(f"🎵 [{client_id}] Stream request [{request_id}]")

                estimated_duration = estimate_audio_duration(text)

                await websocket.send_text(json.dumps({
                    "type": "stream_start",
                    "request_id": request_id,
                    "text": text,
                    "voice": voice,
                    "estimated_duration": estimated_duration,
                    # ADD THIS LINE
                    "headers": {"X-Accel-Buffering": "no"}
                }))

                try:
                    chunk_count = 0
                    for wav_chunk in tts_service.stream_synthesis(
                        text, voice, play_steps_in_s, request_id
                    ):
                        chunk_count += 1
                        await websocket.send_bytes(wav_chunk)

                    await websocket.send_text(json.dumps({
                        "type": "stream_complete",
                        "request_id": request_id,
                        "total_chunks": chunk_count
                    }))

                    logger.info(f"✅ [{client_id}] Request [{request_id}] complete")
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