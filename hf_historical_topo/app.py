from fastapi.responses import HTMLResponse
from server import app

@app.get("/", response_class=HTMLResponse)
def home():
    return "<h1>Historical USGS Topo Tiles</h1><p>Use /tiles/{era}/{z}/{x}/{y}.png</p>"
