#!/usr/bin/env python3
"""
RunPod WebSocket TTS Service for Sanskrit Vaak
Handles TTS requests from Fly.io and streams audio to clients
"""

import asyncio
import json
import logging
import uuid
import time
from typing import Dict, Optional
import weakref

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Import your existing TTS components
import torch
import numpy as np
import soundfile as sf
import io
from parler_tts import ParlerTTSForConditionalGeneration, ParlerTTSStreamer
from transformers import AutoTokenizer
from threading import Thread

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Voice configs from your existing app.py
VOICE_CONFIGS = {
    "aryan_default": "Aryan speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters",
    "aryan_scholarly": "Aryan recites Sanskrit with scholarly precision and poetic sensibility while ensuring proper halant pronunciations and clear consonant clusters.",
    "aryan_meditative": "Aryan speaks in a serene, meditative tone with slow, deliberate pacing while ensuring proper halant pronunciations and clear consonant clusters.",
    "priya_default": "Priya speaks in a warm, respectful tone suitable for Sanskrit conversation while ensuring proper halant pronunciations and clear consonant clusters, with a feminine voice quality."
}

def estimate_audio_duration(text: str, words_per_minute: int = 150) -> float:
    """Estimate audio duration based on text length and normal speaking rate"""
    word_count = len(text.split())
    duration_seconds = (word_count / words_per_minute) * 60
    return max(1.0, duration_seconds)

class StreamingTTSService:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.desc_tokenizer = None
        self.device = None
        self.sampling_rate = None
        self.torch_dtype = None

    def load_model(self):
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
        logger.info(f"🎵 [{request_id}] Starting synthesis: '{text[:50]}...'")

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
                chunk_send_times = []
                for audio_chunk in streamer:
                    if audio_chunk.shape[0] == 0:
                        break
                    chunk_count += 1
                    audio_float32 = audio_chunk.astype(np.float32)
                    buffer = io.BytesIO()
                    sf.write(buffer, audio_float32, self.sampling_rate, format='WAV')
                    buffer.seek(0)
                    wav_bytes = buffer.read()
                    
                    send_time = time.time()
                    chunk_send_times.append(send_time)
                    
                    logger.info(f"📤 [{request_id}] Chunk {chunk_count}: {len(wav_bytes)} bytes at {send_time:.3f}")
                    
                    if len(chunk_send_times) > 1:
                        gap = send_time - chunk_send_times[-2]
                        logger.info(f"⏱️ [{request_id}] Gap since last chunk: {gap:.3f}s")
                    
                    yield wav_bytes
            finally:
                thread.join()
                logger.info(f"✅ [{request_id}] Complete: {chunk_count} chunks")

class ClientConnectionManager:
    """Manages WebSocket connections for clients"""
    
    def __init__(self):
        self.client_connections: Dict[str, WebSocket] = {}
        self.connection_times: Dict[str, float] = {}
        
    async def connect_client(self, client_id: str, websocket: WebSocket):
        """Register new client connection"""
        await websocket.accept()
        self.client_connections[client_id] = websocket
        self.connection_times[client_id] = time.time()
        logger.info(f"✅ Client {client_id} connected. Total clients: {len(self.client_connections)}")
        
    def disconnect_client(self, client_id: str):
        """Remove client connection"""
        if client_id in self.client_connections:
            del self.client_connections[client_id]
        if client_id in self.connection_times:
            del self.connection_times[client_id]
        logger.info(f"👋 Client {client_id} disconnected. Total clients: {len(self.client_connections)}")
        
    async def send_to_client(self, client_id: str, message_type: str, data: dict = None):
        """Send JSON message to specific client"""
        if client_id not in self.client_connections:
            logger.warning(f"⚠️ Client {client_id} not connected")
            return False
            
        try:
            message = {"type": message_type, "timestamp": time.time()}
            if data:
                message.update(data)
                
            await self.client_connections[client_id].send_text(json.dumps(message))
            return True
        except Exception as e:
            logger.error(f"❌ Failed to send to client {client_id}: {e}")
            self.disconnect_client(client_id)
            return False
            
    async def send_audio_to_client(self, client_id: str, audio_chunk: bytes):
        """Send audio chunk to specific client"""
        if client_id not in self.client_connections:
            logger.warning(f"⚠️ Client {client_id} not connected for audio")
            return False
            
        try:
            await self.client_connections[client_id].send_bytes(audio_chunk)
            return True
        except Exception as e:
            logger.error(f"❌ Failed to send audio to client {client_id}: {e}")
            self.disconnect_client(client_id)
            return False
            
    def get_connected_clients(self):
        """Get list of connected client IDs"""
        return list(self.client_connections.keys())
        
    async def cleanup_idle_connections(self, timeout_seconds: int = 10):
        """Remove connections idle longer than timeout"""
        current_time = time.time()
        idle_clients = []
        
        for client_id, connect_time in self.connection_times.items():
            if (current_time - connect_time) > timeout_seconds:
                idle_clients.append(client_id)
                
        for client_id in idle_clients:
            if client_id in self.client_connections:
                try:
                    await self.client_connections[client_id].close()
                except:
                    pass
                self.disconnect_client(client_id)
                logger.info(f"🧹 Cleaned up idle client {client_id}")

class FlyConnectionManager:
    """Manages permanent connection with Fly.io"""
    
    def __init__(self):
        self.fly_connection: Optional[WebSocket] = None
        self.connection_time: Optional[float] = None
        
    async def connect_fly(self, websocket: WebSocket):
        """Register Fly.io connection"""
        await websocket.accept()
        self.fly_connection = websocket
        self.connection_time = time.time()
        logger.info("✅ Fly.io connected to RunPod TTS service")
        
    def disconnect_fly(self):
        """Remove Fly.io connection"""
        self.fly_connection = None
        self.connection_time = None
        logger.info("👋 Fly.io disconnected from RunPod TTS service")
        
    async def send_to_fly(self, message_type: str, data: dict = None):
        """Send message back to Fly.io if needed"""
        if not self.fly_connection:
            logger.warning("⚠️ Fly.io not connected")
            return False
            
        try:
            message = {"type": message_type, "timestamp": time.time()}
            if data:
                message.update(data)
                
            await self.fly_connection.send_text(json.dumps(message))
            return True
        except Exception as e:
            logger.error(f"❌ Failed to send to Fly.io: {e}")
            self.disconnect_fly()
            return False

# Initialize managers and TTS service
client_manager = ClientConnectionManager()
fly_manager = FlyConnectionManager()
tts_service = StreamingTTSService()

# FastAPI app
app = FastAPI(title="RunPod TTS WebSocket Service")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    """Initialize TTS service on startup"""
    logger.info("🚀 Starting RunPod TTS WebSocket Service...")
    tts_service.load_model()
    logger.info("✅ TTS Service ready")

@app.websocket("/fly")
async def fly_websocket_endpoint(websocket: WebSocket):
    """Permanent WebSocket endpoint for Fly.io"""
    await fly_manager.connect_fly(websocket)
    
    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            
            message_type = data.get("type")
            logger.info(f"📥 Received from Fly.io: {message_type}")
            
            if message_type == "tts_request":
                await handle_tts_request(data)
            elif message_type == "health_check":
                await fly_manager.send_to_fly("health_response", {
                    "status": "healthy",
                    "connected_clients": len(client_manager.get_connected_clients()),
                    "available_voices": list(VOICE_CONFIGS.keys())
                })
            elif message_type == "get_connected_clients":
                await fly_manager.send_to_fly("connected_clients", {
                    "clients": client_manager.get_connected_clients()
                })
                
    except WebSocketDisconnect:
        fly_manager.disconnect_fly()
    except Exception as e:
        logger.error(f"❌ Fly.io WebSocket error: {e}")
        fly_manager.disconnect_fly()

@app.websocket("/client/{client_id}")
async def client_websocket_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket endpoint for individual clients"""
    await client_manager.connect_client(client_id, websocket)
    
    try:
        await client_manager.send_to_client(client_id, "connected", {
            "client_id": client_id,
            "server": "runpod_tts"
        })
        
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            
            message_type = data.get("type")
            logger.info(f"📥 Client {client_id}: {message_type}")
            
            if message_type == "ping":
                await client_manager.send_to_client(client_id, "pong")
            elif message_type == "status":
                await client_manager.send_to_client(client_id, "status_response", {
                    "connected": True,
                    "server_time": time.time()
                })
                
    except WebSocketDisconnect:
        client_manager.disconnect_client(client_id)
    except Exception as e:
        logger.error(f"❌ Client {client_id} WebSocket error: {e}")
        client_manager.disconnect_client(client_id)

async def handle_tts_request(request_data: dict):
    """Process TTS request from Fly.io and stream to client"""
    try:
        client_id = request_data.get("client_id")
        text = request_data.get("text", "").strip()
        voice = request_data.get("voice", "aryan_default")
        play_steps_in_s = request_data.get("play_steps_in_s", 0.5)
        request_id = request_data.get("request_id", str(uuid.uuid4())[:8])
        
        if not client_id:
            logger.error("❌ Missing client_id in TTS request")
            return
            
        if not text:
            logger.error(f"❌ Missing text in TTS request for client {client_id}")
            return
            
        logger.info(f"🎵 Processing TTS for client {client_id}: '{text[:50]}...'")
        
        estimated_duration = estimate_audio_duration(text)
        
        start_success = await client_manager.send_to_client(client_id, "tts_stream_start", {
            "request_id": request_id,
            "text": text,
            "voice": voice,
            "estimated_duration": estimated_duration,
            "estimated_chunks": max(1, int(estimated_duration / play_steps_in_s)),
            "sample_rate": 44100
        })
        
        if not start_success:
            logger.warning(f"⚠️ Could not send stream start to client {client_id}")
            return
            
        chunk_count = 0
        try:
            for wav_chunk in tts_service.stream_synthesis(text, voice, play_steps_in_s, request_id):
                chunk_count += 1
                
                success = await client_manager.send_audio_to_client(client_id, wav_chunk)
                if not success:
                    logger.warning(f"⚠️ Failed to send chunk {chunk_count} to client {client_id}")
                    break
                    
                logger.debug(f"📤 Sent chunk {chunk_count} to client {client_id}")
                
        except Exception as e:
            logger.error(f"❌ TTS streaming error for client {client_id}: {e}")
            await client_manager.send_to_client(client_id, "tts_error", {
                "request_id": request_id,
                "error": str(e)
            })
            return
            
        await client_manager.send_to_client(client_id, "tts_stream_complete", {
            "request_id": request_id,
            "total_chunks": chunk_count,
            "actual_duration": chunk_count * play_steps_in_s
        })
        
        logger.info(f"✅ TTS streaming complete for client {client_id}: {chunk_count} chunks")
        
    except Exception as e:
        logger.error(f"❌ TTS request handling error: {e}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "runpod_tts_websocket",
        "connected_clients": len(client_manager.get_connected_clients()),
        "fly_connected": fly_manager.fly_connection is not None,
        "timestamp": time.time()
    }

@app.get("/stats")
async def get_stats():
    """Get service statistics"""
    return {
        "connected_clients": len(client_manager.get_connected_clients()),
        "client_list": client_manager.get_connected_clients(),
        "fly_connected": fly_manager.fly_connection is not None,
        "fly_connection_time": fly_manager.connection_time,
        "available_voices": list(VOICE_CONFIGS.keys()),
        "timestamp": time.time()
    }

async def cleanup_task():
    """Background task to cleanup idle client connections"""
    while True:
        try:
            await asyncio.sleep(30)
            await client_manager.cleanup_idle_connections(timeout_seconds=10)
        except Exception as e:
            logger.error(f"❌ Cleanup task error: {e}")

@app.on_event("startup")
async def start_cleanup_task():
    """Start background cleanup task"""
    asyncio.create_task(cleanup_task())

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
