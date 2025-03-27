import os
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from mqtt_client import start_mqtt_client, connected_websockets, get_historical_data

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(title="Lidar Data Visualizer")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Set up Jinja2 templates
templates = Jinja2Templates(directory="templates")

# Start MQTT client
mqtt_client = start_mqtt_client()
if not mqtt_client:
    logger.warning("MQTT client failed to start. Some features may not work.")

@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    """Serve the index.html template."""
    return templates.TemplateResponse(
        "index.html", 
        {"request": request, "title": "Lidar Data Visualizer"}
    )

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "mqtt_connected": mqtt_client is not None}

@app.get("/api/data/current")
async def get_current_data():
    """Get the most recent data point."""
    history = get_historical_data()
    if not history:
        return {"message": "No data available yet"}
    return history[-1]

@app.get("/api/data/history")
async def get_history():
    """Get historical data points."""
    return get_historical_data()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time data streaming."""
    await websocket.accept()
    connected_websockets.add(websocket)
    
    try:
        # Send historical data when client connects
        history = get_historical_data()
        if history:
            await websocket.send_text(json.dumps({"type": "history", "data": history}))
        
        # Keep connection alive and handle client messages if needed
        while True:
            data = await websocket.receive_text()
            # Process client messages if needed
            
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if websocket in connected_websockets:
            connected_websockets.remove(websocket)

# Start server with environment variables
if __name__ == "__main__":
    import uvicorn
    host = "0.0.0.0"
    port = int(os.getenv("APP_PORT", 8000))
    uvicorn.run("main:app", host=host, port=port, reload=True)