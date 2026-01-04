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

/*/ Register Service Worker (optional cache)
(async () => {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
      log("Service Worker registered (client cache enabled).");
    } catch (e) {
      log("Service Worker failed: " + e.message);
    }
  } else {
    log("Service Worker not supported.");
  }
})();*/

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

function chooseMime(manifest) {
  // VIDEO ONLY
  const candidates = [
    manifest.mime,
    'video/mp4; codecs="avc1.42E01E"',
    'video/mp4; codecs="avc1.42C01E"',
    'video/mp4; codecs="avc1.4D401F"',
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

  const video = document.getElementById("v");
  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);

  video.addEventListener("error", () => {
    const err = video.error;
    log("VIDEO ERROR: " + (err ? `code=${err.code}` : "unknown"));
  });

  let sourceBuffer;
  let currentRes = "360p";
  let chunkIndex = 1;
  let estThroughput = 1500;

  ms.addEventListener("sourceopen", async () => {
    try {
      const chosenMime = chooseMime(manifest);
      if (!chosenMime) throw new Error("No supported MIME codec found for MediaSource.");
      log("Using MIME: " + chosenMime);

      sourceBuffer = ms.addSourceBuffer(chosenMime);

      const initUrl = `${manifest.resolutions[currentRes].path}/${manifest.init_name}`;
      log(`Init: ${initUrl}`);
      const init = await fetchWithTiming(initUrl);
      if (!init.ok) throw new Error(`Init fetch failed (${init.status}): ${init.url}`);
      await appendBuf(sourceBuffer, init.buf);

      const maxChunks = manifest.resolutions[currentRes].chunk_count;
      log(`maxChunks @${currentRes}: ${maxChunks}`);
      if (!maxChunks || maxChunks < 1) throw new Error(`No chunks found for ${currentRes}.`);

      while (chunkIndex <= maxChunks) {
        const chosen = pickResolution(manifest, estThroughput);
        if (chosen !== currentRes) {
          currentRes = chosen;
          log(`Switch -> ${currentRes} (est ${estThroughput.toFixed(0)} kbps)`);

          // new init for new representation (simple approach)
          const init2Url = `${manifest.resolutions[currentRes].path}/${manifest.init_name}`;
          const init2 = await fetchWithTiming(init2Url);
          if (!init2.ok) throw new Error(`Init fetch failed after switch (${init2.status}): ${init2.url}`);
          await appendBuf(sourceBuffer, init2.buf);
        }

        const iStr = String(chunkIndex).padStart(5, "0");
        const chunkUrl = `${manifest.resolutions[currentRes].path}/chunk_${iStr}.m4s`;
        const seg = await fetchWithTiming(chunkUrl);
        if (!seg.ok) throw new Error(`Chunk fetch failed (${seg.status}): ${seg.url}`);

        estThroughput = seg.kbps;
        log(`chunk ${chunkIndex} @${currentRes}  ${seg.bytes} bytes  ${seg.ms.toFixed(0)} ms  ~${seg.kbps.toFixed(0)} kbps`);

        await appendBuf(sourceBuffer, seg.buf);
        chunkIndex += 1;
        await new Promise((r) => setTimeout(r, 0));
      }

      ms.endOfStream();
      log("Done.");
    } catch (e) {
      log("ERROR (sourceopen): " + e.message);
      try { ms.endOfStream(); } catch {}
    }
  });
}

document.getElementById("btnPlay").onclick = async () => {
  const id = document.getElementById("videoList").value;
  if (!id) return alert("No video selected.");
  try { await playVideo(id); } catch (e) { log("ERROR: " + e.message); }
};

refreshList();
