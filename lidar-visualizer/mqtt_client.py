import os
import json
import asyncio
import logging
from datetime import datetime
from paho.mqtt import client as mqtt_client
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# MQTT Configuration
MQTT_BROKER_HOST = os.getenv("MQTT_BROKER_HOST", "localhost")
MQTT_BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", 1883))
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "/esp32/lidar/distance")

# Store for connected clients
connected_websockets = set()

# Data cache for historical values
data_history = []
MAX_HISTORY_SIZE = 100

def on_connect(client, userdata, flags, rc):
    """Callback for when the client connects to the MQTT broker."""
    if rc == 0:
        logger.info(f"Connected to MQTT Broker at {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}")
        client.subscribe(MQTT_TOPIC)
    else:
        logger.error(f"Failed to connect to MQTT Broker. Return code: {rc}")

def on_message(client, userdata, msg):
    """Callback for when a message is received from the MQTT broker."""
    try:
        payload = msg.payload.decode()
        logger.info(f"Received message on {msg.topic}: {payload}")
        
        # Create data point with timestamp
        timestamp = datetime.now().isoformat()
        data_point = {
            "timestamp": timestamp,
            "value": float(payload),
            "topic": msg.topic
        }
        
        # Add to history and maintain max size
        data_history.append(data_point)
        if len(data_history) > MAX_HISTORY_SIZE:
            data_history.pop(0)
        
        # Get the running event loop or create a new one if needed
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # If there's no running event loop, create a new one just for this task
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(broadcast_message(json.dumps(data_point)))
        else:
            # If there's a running event loop, create a task
            loop.create_task(broadcast_message(json.dumps(data_point)))
        
    except Exception as e:
        logger.error(f"Error processing message: {e}")

async def broadcast_message(message):
    """Broadcast a message to all connected WebSocket clients."""
    if connected_websockets:
        disconnected_ws = set()
        for websocket in connected_websockets:
            try:
                await websocket.send_text(message)
            except Exception as e:
                logger.error(f"Error sending to websocket: {e}")
                disconnected_ws.add(websocket)
        
        # Remove disconnected clients
        for ws in disconnected_ws:
            connected_websockets.remove(ws)

def get_mqtt_client():
    """Create and configure MQTT client."""
    client_id = f'python-mqtt-{os.getpid()}'
    client = mqtt_client.Client(client_id)
    client.on_connect = on_connect
    client.on_message = on_message
    
    return client

def start_background_loop(loop):
    """Start the asyncio event loop in a background thread."""
    asyncio.set_event_loop(loop)
    loop.run_forever()

def start_mqtt_client():
    """Start the MQTT client and connect to the broker."""
    # Create a new event loop for background tasks
    background_loop = asyncio.new_event_loop()
    
    # Start the loop in a background thread
    import threading
    background_thread = threading.Thread(target=start_background_loop, args=(background_loop,))
    background_thread.daemon = True
    background_thread.start()
    
    client = get_mqtt_client()
    try:
        client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT)
        client.loop_start()
        return client
    except Exception as e:
        logger.error(f"Failed to connect to MQTT broker: {e}")
        return None

def get_historical_data():
    """Return the cached historical data."""
    return data_history