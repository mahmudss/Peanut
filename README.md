# Implemented Features

- Client–server based video streaming with upload and playback support
- Server-side transcoding into multiple resolutions with chunks
- Custom manifest-based streaming without external libraries (dash.js / hls.js not used)
- Adaptive bitrate selection based on real-time client network speed
- Seamless resolution switching during playback
- Synchronized audio and video playback
- Support for concurrent streaming by multiple clients
- Download support for original uploaded videos directly from the server

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
[Doc](https://drive.google.com/file/d/1IpYbhQpptXV3oMpmZ-Kg0c5iWieDLL8J/view?usp=drive_link)
