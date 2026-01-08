const logEl = document.getElementById("log");
function log(msg) {
  logEl.textContent += msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function refreshList() {
  const data = await api("/api/videos");
  const sel = document.getElementById("videoList");
  sel.innerHTML = "";
  for (const id of data.videos) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    sel.appendChild(opt);
  }
  log(`Loaded ${data.videos.length} videos.`);
}

document.getElementById("btnRefresh").onclick = refreshList;

document.getElementById("btnUpload").onclick = async () => {
  const f = document.getElementById("file").files[0];
  if (!f) return alert("Select a file first.");
  const fd = new FormData();
  fd.append("file", f);
  log("Uploading...");
  const res = await api("/api/upload", { method: "POST", body: fd });
  log(`Uploaded. video_id=${res.video_id}`);
  await refreshList();
};

function pickResolution(manifest, throughputKbps) {
  const budget = throughputKbps * 0.85;
  const entries = Object.entries(manifest.resolutions)
    .map(([label, obj]) => ({ label, bitrate: obj.bitrate_kbps }))
    .sort((a, b) => a.bitrate - b.bitrate);

  let chosen = entries[0].label;
  for (const e of entries) if (e.bitrate <= budget) chosen = e.label;
  return chosen;
}

async function fetchWithTiming(url) {
  const t0 = performance.now();
  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  const t1 = performance.now();
  const ms = t1 - t0;
  const bytes = buf.byteLength;
  const kbps = (bytes * 8) / (ms / 1000) / 1000;
  return { ok: r.ok, buf, ms, bytes, kbps, status: r.status, url };
}

function chooseVideoMime(manifest) {
  const candidates = [
    manifest.video_mime,
    manifest.mime, // backward compat
    'video/mp4; codecs="avc1.42E01E"',
    'video/mp4; codecs="avc1.42C01E"',
    'video/mp4; codecs="avc1.4D401F"',
  ].filter(Boolean);

  for (const m of candidates) {
    if (MediaSource.isTypeSupported(m)) return m;
  }
  return null;
}

function chooseAudioMime(manifest) {
  const candidates = [
    manifest.audio_mime,
    'audio/mp4; codecs="mp4a.40.2"',
  ].filter(Boolean);

  for (const m of candidates) {
    if (MediaSource.isTypeSupported(m)) return m;
  }
  return null;
}

function appendBuf(sb, buf) {
  return new Promise((resolve, reject) => {
    sb.addEventListener("updateend", resolve, { once: true });
    sb.addEventListener("error", () => reject(new Error("SourceBuffer error (appendBuffer failed)")), { once: true });
    sb.appendBuffer(buf);
  });
}

async function playVideo(videoId) {
  logEl.textContent = "";
  log(`Loading manifest for ${videoId}...`);

  const manifest = await (await fetch(`/videos/${videoId}/manifest.json`)).json();

  const titleEl = document.getElementById("videoTitle");
  if (titleEl) titleEl.textContent = `Title: ${videoId}`;

  const video = document.getElementById("v");
  const qualitySel = document.getElementById("quality");

  const BUFFER_TARGET_SECONDS = 5;
  const BUFFER_MIN_SECONDS = 1;

  function bufferedEnd(videoEl) {
    const b = videoEl.buffered;
    if (!b || b.length === 0) return 0;
    return b.end(b.length - 1);
  }

  function bufferedAheadSeconds(videoEl) {
    const end = bufferedEnd(videoEl);
    const cur = videoEl.currentTime || 0;
    return Math.max(0, end - cur);
  }

  async function waitForLowBuffer(videoEl, targetSeconds) {
    while (bufferedAheadSeconds(videoEl) > targetSeconds) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  video.pause();
  video.removeAttribute("src");
  video.load();

  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);

  video.addEventListener("error", () => {
    const err = video.error;
    log("VIDEO ERROR: " + (err ? `code=${err.code}` : "unknown"));
  });

  let videoSB;
  let audioSB;

  let userMode = (qualitySel?.value || "auto").toLowerCase();
  let userFixedRes = userMode === "auto" ? null : qualitySel.value;

  function clampToAvailable(label) {
    if (manifest.resolutions && manifest.resolutions[label]) return label;
    const labels = Object.keys(manifest.resolutions || {});
    return labels[0] || "360p";
  }

  function desiredResolution(throughputKbps) {
    if (userMode !== "auto" && userFixedRes) return clampToAvailable(userFixedRes);
    return pickResolution(manifest, throughputKbps);
  }

  if (qualitySel) {
    qualitySel.onchange = async () => {
      userMode = (qualitySel.value || "auto").toLowerCase();
      userFixedRes = userMode === "auto" ? null : qualitySel.value;
      log(`Quality -> ${userMode === "auto" ? "Auto" : userFixedRes}`);

      if (userMode !== "auto") {
        const end = bufferedEnd(video);
        if (end > 0) {
          const jumpTo = Math.max(video.currentTime, end - 0.25);
          try {
            video.currentTime = jumpTo;
          } catch {}
        }
      }
    };
  }

  let currentRes = clampToAvailable("360p");
  let chunkIndex = 1;
  let estThroughput = 1500;

  ms.addEventListener("sourceopen", async () => {
    try {
      const vMime = chooseVideoMime(manifest);
      const aMime = chooseAudioMime(manifest);
      if (!vMime) throw new Error("No supported VIDEO MIME codec found for MediaSource.");
      if (!aMime) throw new Error("No supported AUDIO MIME codec found for MediaSource.");

      log("Video MIME: " + vMime);
      log("Audio MIME: " + aMime);

      videoSB = ms.addSourceBuffer(vMime);
      audioSB = ms.addSourceBuffer(aMime);

      try {
        videoSB.mode = "segments";
      } catch {}
      try {
        audioSB.mode = "segments";
      } catch {}

      currentRes = desiredResolution(estThroughput);

      const vInitUrl = `${manifest.resolutions[currentRes].path}/${manifest.init_name}`;
      const aInitUrl = `${manifest.audio.path}/${manifest.init_name}`;

      log(`Video init: ${vInitUrl}`);
      log(`Audio init: ${aInitUrl}`);

      const [vInit, aInit] = await Promise.all([fetchWithTiming(vInitUrl), fetchWithTiming(aInitUrl)]);

      if (!vInit.ok) throw new Error(`Video init fetch failed (${vInit.status}): ${vInit.url}`);
      if (!aInit.ok) throw new Error(`Audio init fetch failed (${aInit.status}): ${aInit.url}`);

      await appendBuf(videoSB, vInit.buf);
      await appendBuf(audioSB, aInit.buf);

      const maxVideoChunks = manifest.resolutions[currentRes].chunk_count;
      const maxAudioChunks = manifest.audio.chunk_count;
      const maxChunks = Math.min(maxVideoChunks || 0, maxAudioChunks || 0);

      log(`maxChunks video@${currentRes}: ${maxVideoChunks}, audio: ${maxAudioChunks} -> using ${maxChunks}`);
      if (!maxChunks || maxChunks < 1) throw new Error("No chunks found (video/audio).");

      while (chunkIndex <= maxChunks) {
        const ahead = bufferedAheadSeconds(video);

        if (ahead > BUFFER_TARGET_SECONDS) {
          await waitForLowBuffer(video, BUFFER_TARGET_SECONDS);
        }

        if (bufferedAheadSeconds(video) < BUFFER_MIN_SECONDS) {
          // fetch immediately
        }

        const wanted = desiredResolution(estThroughput);

        if (wanted !== currentRes) {
          currentRes = wanted;
          log(
            `Switch -> ${currentRes} (${
              userMode === "auto" ? `est ${estThroughput.toFixed(0)} kbps` : "manual"
            })`
          );

          const vInit2Url = `${manifest.resolutions[currentRes].path}/${manifest.init_name}`;
          const vInit2 = await fetchWithTiming(vInit2Url);
          if (!vInit2.ok) throw new Error(`Video init fetch failed after switch (${vInit2.status}): ${vInit2.url}`);
          await appendBuf(videoSB, vInit2.buf);
        }

        const iStr = String(chunkIndex).padStart(5, "0");
        const vUrl = `${manifest.resolutions[currentRes].path}/chunk_${iStr}.m4s`;
        const aUrl = `${manifest.audio.path}/chunk_${iStr}.m4s`;

        const [vSeg, aSeg] = await Promise.all([fetchWithTiming(vUrl), fetchWithTiming(aUrl)]);

        if (!vSeg.ok) throw new Error(`Video chunk fetch failed (${vSeg.status}): ${vSeg.url}`);
        if (!aSeg.ok) throw new Error(`Audio chunk fetch failed (${aSeg.status}): ${aSeg.url}`);

        estThroughput = vSeg.kbps;

        log(
          `chunk ${chunkIndex} @${currentRes}  V:${vSeg.bytes}B ${vSeg.ms.toFixed(0)}ms ~${vSeg.kbps.toFixed(
            0
          )}kbps  A:${aSeg.bytes}B ${aSeg.ms.toFixed(0)}ms`
        );

        await appendBuf(videoSB, vSeg.buf);
        await appendBuf(audioSB, aSeg.buf);

        chunkIndex += 1;
        await new Promise((r) => setTimeout(r, 0));
      }

      ms.endOfStream();
      log("Done.");
    } catch (e) {
      log("ERROR (sourceopen): " + e.message);
      try {
        ms.endOfStream();
      } catch {}
    }
  });
}

document.getElementById("btnPlay").onclick = async () => {
  const id = document.getElementById("videoList").value;
  if (!id) return alert("No video selected.");
  try { await playVideo(id); } catch (e) { log("ERROR: " + e.message); }
};

refreshList();

document.getElementById("btnDownload").onclick = async () => {
  const id = document.getElementById("videoList").value;
  if (!id) return alert("No video selected.");
  const url = `/api/download/${encodeURIComponent(id)}`;
  log(`Starting download from ${url} ...`);
  window.location.href = url;
};
