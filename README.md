Project Setup
Folder Structure
Peanut/
  server.py
  web/
    index.html
    client.js
    sw.js
  storage/  # auto-created

Install Python Packages
pip install fastapi uvicorn python-multipart

Install FFmpeg (Windows, CMD Admin)
winget install --id Gyan.FFmpeg -e
ffmpeg -version

Run Server

From project root:

uvicorn server:app --host 0.0.0.0 --port 8000

Open Client

In browser:

http://SERVER_IP:8000/web/index.html


Use localhost if running locally.
