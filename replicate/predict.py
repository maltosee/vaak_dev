Great. Let's start with Replicate.

The first step is to create a Python file named `predict.py`. This file will contain all the logic for your model, including how to load it and how to run inference. Replicate uses a `Predictor` class within this file to handle everything.

Here is a template for the `predict.py` file. We will adapt your existing `StreamingTTSService` and `VOICE_CONFIGS` into this structure.

```python
import os
import torch
import numpy as np
import soundfile as sf
import io
import time
from typing import Iterator

from parler_tts import ParlerTTSForConditionalGeneration, ParlerTTSStreamer
from transformers import AutoTokenizer

# These are the voice configs from your original app.py
VOICE_CONFIGS = {
    "aryan_default": "Aryan speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters",
    "aryan_scholarly": "Aryan recites Sanskrit with scholarly precision and poetic sensibility while ensuring proper halant pronunciations and clear consonant clusters.",
    "aryan_meditative": "Aryan speaks in a serene, meditative tone with slow, deliberate pacing while ensuring proper halant pronunciations and clear consonant clusters.",
    "priya_default": "Priya speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters, with a feminine voice quality."
}

class Predictor:
    def setup(self):
        """Load the model into memory. This runs once when the model starts."""
        print("🤖 Loading TTS model...")

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.torch_dtype = torch.float16 if self.device == "cuda" else torch.float32

        if self.device == "cuda":
            torch.backends.cudnn.benchmark = True

        self.model = ParlerTTSForConditionalGeneration.from_pretrained(
            "ai4bharat/indic-parler-tts",
            torch_dtype=self.torch_dtype
        ).to(self.device)

        self.tokenizer = AutoTokenizer.from_pretrained("ai4bharat/indic-parler-tts")
        self.desc_tokenizer = AutoTokenizer.from_pretrained(self.model.config.text_encoder._name_or_path)
        self.sampling_rate = self.model.config.sampling_rate

        self.model.eval()
        torch.set_grad_enabled(False)
        self.tokenizer.padding_side = "left"
        self.desc_tokenizer.padding_side = "left"

        print(f"✅ TTS model loaded and initialized on {self.device}")

    def predict(
        self,
        text: str,
        voice: str = "aryan_default",
        play_steps_in_s: float = 0.5,
    ) -> Iterator[str]:
        """Run a single prediction on the model."""
        print(f"🎵 Starting synthesis: '{text[:50]}...' with voice '{voice}'")

        voice_description = VOICE_CONFIGS.get(voice, VOICE_CONFIGS["aryan_default"])

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

            for audio_chunk in streamer:
                if audio_chunk.shape[0] == 0:
                    break
                audio_float32 = audio_chunk.astype(np.float32)
                buffer = io.BytesIO()
                sf.write(buffer, audio_float32, self.sampling_rate, format='WAV')
                buffer.seek(0)
                wav_bytes = buffer.read()
                # Yield the base64 encoded string of the WAV bytes
                yield wav_bytes.hex()
            
            thread.join()

```