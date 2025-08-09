import runpod
import json
import uuid
import logging
import torch
import numpy as np
import soundfile as sf
import io
import base64
from threading import Thread
from parler_tts import ParlerTTSForConditionalGeneration, ParlerTTSStreamer
from transformers import AutoTokenizer

# Voice configs
VOICE_CONFIGS = {
    "aryan_default": "Aryan speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters",
    "aryan_scholarly": "Aryan recites Sanskrit with scholarly precision and poetic sensibility while ensuring proper halant pronunciations and clear consonant clusters.",
    "aryan_meditative": "Aryan speaks in a serene, meditative tone with slow, deliberate pacing while ensuring proper halant pronunciations and clear consonant clusters.",
    "priya_default": "Priya speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters, with a feminine voice quality."
}

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

    def audio_chunks_generator(self, text: str, voice_key: str, play_steps_in_s: float, request_id: str):
        """Generator that yields audio chunks - EXACTLY like text_to_speech_simulator"""
        logger = logging.getLogger(__name__)
        logger.info(f"🎵 [{request_id}] Starting synthesis: '{text[:50]}...'")

        voice_description = VOICE_CONFIGS.get(voice_key, VOICE_CONFIGS["aryan_default"])

        text_tokens = self.tokenizer(text, return_tensors="pt").to(self.device)
        desc_tokens = self.desc_tokenizer(voice_description, return_tensors="pt").to(self.device)

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

            try:
                logger.info(f"🔍 [{request_id}] Entering streamer loop...")
                for audio_chunk in streamer:
                    if audio_chunk.shape[0] == 0:
                        break
                    
                    # Convert to base64 string (like text chunks)
                    audio_float32 = audio_chunk.astype(np.float32)
                    buffer = io.BytesIO()
                    sf.write(buffer, audio_float32, self.sampling_rate, format='WAV')
                    buffer.seek(0)
                    wav_bytes = buffer.read()
                    
                    # Yield base64 encoded audio as string (like text)
                    audio_chunk_str = base64.b64encode(wav_bytes).decode('utf-8')
                    yield audio_chunk_str
                    
            finally:
                thread.join()
                logger.info(f"✅ [{request_id}] Complete")

# Initialize TTS service globally 
tts_service = StreamingTTSService()
tts_service.load_model()

def handler(job):
    """FAITHFUL REPLICATION of canonical text streaming pattern"""
    try:
        job_input = job['input']
        text = job_input.get('text', '').strip()
        voice = job_input.get('voice', 'aryan_default')
        play_steps_in_s = job_input.get('play_steps_in_s', 0.5)
        
        logging.info(f"🔍 Handler received job: text='{text[:50]}...', voice='{voice}'")
        
        if not text:
            yield {"error": "Text required"}
            return

        request_id = str(uuid.uuid4())[:8]
        logging.info(f"🎵 RunPod request [{request_id}]: '{text[:50]}...'")
        
        # FAITHFUL REPLICATION: Replace text_to_speech_simulator with audio_chunks_generator
        for audio_chunk in tts_service.audio_chunks_generator(text, voice, play_steps_in_s, request_id):
            yield {"status": "processing", "chunk": audio_chunk}  # SAME STRUCTURE AS TEXT
        
        yield {"status": "completed", "message": "Audio synthesis completed"}  # SAME AS TEXT
        
    except Exception as e:
        logging.error(f"Handler error: {e}")
        yield {"error": str(e)}   
        
if __name__ == "__main__":
    runpod.serverless.start({
        "handler": handler,
        "return_aggregate_stream": True
    })