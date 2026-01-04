# Implemented Features

- Client–server based video streaming with upload and playback support
- Server-side transcoding into multiple resolutions with chunked fMP4 output
- Custom manifest-based streaming without external libraries (dash.js / hls.js not used)
- Adaptive bitrate selection based on real-time client network speed
- Seamless resolution switching during playback using MediaSource API
- Synchronized audio and video playback using separate MediaSource buffers
- Support for concurrent streaming by multiple clients

# Project Setup

## Folder Structure
````text
Peanut/
├── server.py
├── web/
│   ├── index.html
│   ├── client.js
│   └── sw.js
└── storage/   # auto-created
````

## Install Python Packages

````pip install fastapi uvicorn python-multipart````

## Install FFmpeg (Windows, CMD Admin)
````
winget install --id Gyan.FFmpeg -e
ffmpeg -version
````

## Run Server
From project root:
````
uvicorn server:app --host 0.0.0.0 --port 8000
````
## Open Client
In browser:
````
http://SERVER_IP:8000/web/index.html
````

Use localhost if running locally.
# Documentation
[Doc](https://docs.google.com/document/d/15aIy1n87Y-ngJkCs8ET_5ZO3ME1YtqPsOBtKiPxiJKQ/edit?usp=sharing)
