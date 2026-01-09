# Indroduction
Peanut is a custom client–server based adaptive video streaming platform. This project gives us the opportunity to observe the internal networking logic of
video streaming, allowing a deeper understanding of networking concepts.

# Implemented Features

- Client–server based video streaming with upload and playback support
- Server-side transcoding into multiple resolutions with chunks
- Custom manifest-based streaming without external libraries (dash.js / hls.js not used)
- Adaptive bitrate selection based on real-time client network speed
- Seamless resolution switching during playback
- Synchronized audio and video playback
- Shows client-side logs for chunk requests and adaptive bitrate decisions.
- Support for concurrent streaming by multiple clients
- Provides the option to manually select a resolution, overriding automatic bitrate adaptation.
- Download support for original uploaded videos directly from the server

# Project Setup

## Folder Structure
````text
Peanut/
├── server.py
├── web/
│   ├── client.js
│   ├── index.html
│   ├── style.css
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
## To visibly show switching
Open Google Chromes'- ````DevTools → Network → set throttling````


Use localhost if running locally.
# Documentation
[Doc](https://drive.google.com/file/d/1IpYbhQpptXV3oMpmZ-Kg0c5iWieDLL8J/view?usp=drive_link)
