(() => {
  const $ = (selector) => document.querySelector(selector);
  const video = $("#sourceVideo");
  const fileInput = $("#fileInput");
  const dropZone = $("#dropZone");
  const previewFrame = $("#previewFrame");
  const segments = [];
  let file = null;
  let objectUrl = null;
  let duration = 0;
  let audioContext = null;
  let mediaSource = null;
  let analyser = null;
  let gainNode = null;
  let audioDestination = null;
  let audioMuted = false;
  let scanFrames = 0;
  let scanCancel = false;
  let previewToken = 0;
  let previewActive = false;
  let currentRatio = "9:16";
  let renderCancel = false;
  let toastTimer = null;

  const ui = {
    loadedFile: $("#loadedFile"), fileName: $("#fileName"), fileMeta: $("#fileMeta"),
    emptyPreview: $("#emptyPreview"), stageNote: $("#stageNote"), ratioChip: $("#ratioChip"),
    playBtn: $("#playBtn"), previewClock: $("#previewClock"), previewProgress: $("#previewProgress"),
    timelineTrack: $("#timelineTrack"), timelineEmpty: $("#timelineEmpty"), totalTime: $("#totalTime"),
    scanBtn: $("#scanBtn"), scanLabel: $("#scanLabel"), scanProgress: $("#scanProgress"),
    scanStatus: $("#scanStatus"), scanPercent: $("#scanPercent"), scanBar: $("#scanBar"),
    exportBtn: $("#exportBtn"), exportWideBtn: $("#exportWideBtn"), addCutBtn: $("#addCutBtn"),
    titleInput: $("#titleInput"), titleCount: $("#titleCount"), styleSelect: $("#styleSelect"),
    audioLevel: $("#audioLevel"), audioValue: $("#audioValue"), muteBtn: $("#muteBtn"),
    toast: $("#toast"), modal: $("#modalBackdrop"), renderModal: $("#renderBackdrop"),
    renderBar: $("#renderBar"), renderPercent: $("#renderPercent"), renderTitle: $("#renderTitle"),
    renderMessage: $("#renderMessage"),
  };

  function formatTime(value) {
    if (!Number.isFinite(value)) return "0:00";
    const seconds = Math.max(0, Math.floor(value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function newId() {
    return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  function showToast(message, durationMs = 2700) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), durationMs);
  }

  function setBusyScanning(busy) {
    ui.scanProgress.hidden = !busy;
    ui.scanBtn.disabled = busy || !file;
    ui.scanLabel.textContent = busy ? "Scanning your clip…" : segments.length ? "Scan again" : "Find my best moments";
    if (busy) {
      ui.scanStatus.textContent = "Scanning motion + sound…";
      ui.scanPercent.textContent = "0%";
      ui.scanBar.style.width = "0%";
    }
  }

  function updateActionState() {
    const hasVideo = Boolean(file);
    const hasCuts = segments.some((segment) => segment.enabled && segment.end - segment.start >= 0.35);
    ui.scanBtn.disabled = !hasVideo || !duration || scanFrames > 0;
    ui.addCutBtn.disabled = !hasVideo || !duration || scanFrames > 0;
    const recorderOk = typeof MediaRecorder !== "undefined" && HTMLCanvasElement.prototype.captureStream;
    const canExport = hasVideo && hasCuts && recorderOk && scanFrames === 0;
    ui.exportBtn.disabled = !canExport;
    ui.exportWideBtn.disabled = !canExport;
  }

  function setPreviewTime() {
    if (!duration) return;
    const ratio = Math.min(1, Math.max(0, video.currentTime / duration));
    ui.previewClock.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
    ui.previewProgress.style.width = `${ratio * 100}%`;
  }

  function syncOverlay() {
    const title = ui.titleInput.value.trim() || "Make it count.";
    const parts = title.split(/\s+/);
    const first = parts.slice(0, Math.max(1, Math.ceil(parts.length / 2))).join(" ");
    const second = parts.slice(Math.max(1, Math.ceil(parts.length / 2))).join(" ");
    $("#overlayCaption").innerHTML = `${escapeHtml(first)}${second ? `<br><i>${escapeHtml(second)}</i>` : ""}`;
    $("#overlayTag").textContent = title.length > 22 ? "A MOMENT WORTH KEEPING" : "A MOMENT WORTH KEEPING";
    const style = ui.styleSelect.value;
    previewFrame.classList.remove("style-clean", "style-cinema");
    if (style === "clean") previewFrame.classList.add("style-clean");
    if (style === "cinema") previewFrame.classList.add("style-cinema");
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function resetProject() {
    scanCancel = true;
    previewToken++;
    previewActive = false;
    video.pause();
    video.playbackRate = 1;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    file = null;
    duration = 0;
    segments.splice(0, segments.length);
    scanFrames = 0;
    video.removeAttribute("src");
    video.load();
    previewFrame.classList.remove("has-video");
    ui.loadedFile.hidden = true;
    dropZone.hidden = false;
    ui.timelineTrack.innerHTML = "";
    ui.timelineTrack.append(ui.timelineEmpty);
    ui.timelineEmpty.hidden = false;
    ui.totalTime.textContent = "0:00 total";
    ui.stageNote.textContent = "Your original clip stays on this device";
    ui.previewClock.textContent = "0:00";
    ui.previewProgress.style.width = "0%";
    setBusyScanning(false);
    renderTimeline();
    updateActionState();
  }

  function loadFile(nextFile) {
    if (!nextFile || !nextFile.type.startsWith("video/")) {
      showToast("Choose a video file to start your edit.");
      return;
    }
    if (nextFile.size > 2 * 1024 * 1024 * 1024) {
      showToast("This browser editor works best with videos under 2 GB.");
      return;
    }
    resetProject();
    file = nextFile;
    objectUrl = URL.createObjectURL(nextFile);
    video.src = objectUrl;
    video.load();
    ui.fileName.textContent = nextFile.name;
    ui.fileMeta.textContent = "Loading video…";
    ui.loadedFile.hidden = false;
    dropZone.hidden = true;
    ui.stageNote.textContent = "Local video · not uploaded";
    previewFrame.classList.add("has-video");
    video.addEventListener("loadedmetadata", onMetadata, { once: true });
    video.addEventListener("error", () => {
      showToast("This video format could not be opened in your browser.");
      resetProject();
    }, { once: true });
    syncOverlay();
    updateActionState();
  }

  function onMetadata() {
    if (!file) return;
    duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration) {
      showToast("Could not read the clip duration. Try another file.");
      resetProject();
      return;
    }
    ui.fileMeta.textContent = `${formatTime(duration)} · ${formatSize(file.size)}`;
    ui.totalTime.textContent = `${formatTime(duration)} source`;
    ui.scanBtn.disabled = false;
    ui.addCutBtn.disabled = false;
    setPreviewTime();
    updateActionState();
  }

  async function ensureAudioGraph() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioContext = new AudioContextClass();
      try {
        mediaSource = audioContext.createMediaElementSource(video);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.15;
        gainNode = audioContext.createGain();
        audioDestination = audioContext.createMediaStreamDestination();
        mediaSource.connect(analyser);
        mediaSource.connect(gainNode);
        gainNode.connect(audioContext.destination);
        gainNode.connect(audioDestination);
      } catch (error) {
        console.warn("Audio analysis is unavailable in this browser session.", error);
        audioContext = null;
        return null;
      }
    }
    if (audioContext.state === "suspended") await audioContext.resume();
    applyAudioLevel();
    return audioContext;
  }

  function applyAudioLevel() {
    const value = Number(ui.audioLevel.value) / 100;
    ui.audioValue.textContent = `${ui.audioLevel.value}%`;
    if (gainNode && audioContext) gainNode.gain.setTargetAtTime(audioMuted ? 0 : value, audioContext.currentTime, 0.03);
  }

  function getAudioRms() {
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / data.length);
  }

  function getMotion(previousFrame, canvas, context) {
    if (video.readyState < 2 || !video.videoWidth) return { pixels: previousFrame, motion: 0 };
    const width = 32;
    const height = 32;
    canvas.width = width;
    canvas.height = height;
    try {
      context.drawImage(video, 0, 0, width, height);
    } catch {
      return { pixels: previousFrame, motion: 0 };
    }
    const data = context.getImageData(0, 0, width, height).data;
    const pixels = new Uint8Array(width * height);
    let change = 0;
    if (previousFrame) {
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const luminance = Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);
        pixels[p] = luminance;
        change += Math.abs(luminance - previousFrame[p]);
      }
    } else {
      for (let i = 0, p = 0; i < data.length; i += 4, p++) pixels[p] = Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);
    }
    return { pixels, motion: previousFrame ? change / (pixels.length * 255) : 0 };
  }

  function updateScanProgress() {
    if (!duration) return;
    const value = Math.min(99, Math.round(video.currentTime / duration * 100));
    ui.scanPercent.textContent = `${value}%`;
    ui.scanBar.style.width = `${value}%`;
    ui.scanStatus.textContent = `Reading ${formatTime(video.currentTime)} of ${formatTime(duration)}…`;
  }

  async function scanClip() {
    if (!file || !duration || scanFrames > 0) return;
    scanCancel = false;
    scanFrames = 1;
    setBusyScanning(true);
    updateActionState();
    await ensureAudioGraph();
    if (scanCancel || !file) {
      scanFrames = 0;
      setBusyScanning(false);
      updateActionState();
      return;
    }
    video.pause();
    video.playbackRate = 3.5;
    video.currentTime = 0;
    const originalGain = gainNode ? gainNode.gain.value : Number(ui.audioLevel.value) / 100;
    if (gainNode && audioContext) gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.02);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const samples = [];
    let previousPixels = null;
    let nextSampleAt = 0;
    let rafId = 0;

    const finishScan = () => new Promise((resolve, reject) => {
      let finished = false;
      const complete = (error) => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(rafId);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
        video.pause();
        video.playbackRate = 1;
        if (gainNode && audioContext) gainNode.gain.setTargetAtTime(audioMuted ? 0 : originalGain, audioContext.currentTime, 0.05);
        scanFrames = 0;
        ui.scanPercent.textContent = "100%";
        ui.scanBar.style.width = "100%";
        setBusyScanning(false);
        updateActionState();
        if (error) reject(error); else resolve();
      };
      const onEnded = () => complete();
      const onError = () => complete(new Error("The clip could not be scanned."));
      video.addEventListener("ended", onEnded, { once: true });
      video.addEventListener("error", onError, { once: true });

      const frame = () => {
        if (scanCancel) return complete(new Error("Scan cancelled."));
        updateScanProgress();
        if (video.currentTime >= nextSampleAt && video.readyState >= 2) {
          const result = getMotion(previousPixels, canvas, context);
          previousPixels = result.pixels;
          samples.push({ time: video.currentTime, motion: result.motion, audio: getAudioRms() });
          nextSampleAt = video.currentTime + 0.58;
        }
        rafId = requestAnimationFrame(frame);
      };
      rafId = requestAnimationFrame(frame);
      video.play().catch(() => complete(new Error("Could not play this clip for analysis.")));
    });

    try {
      await finishScan();
      if (scanCancel) return;
      const suggestions = chooseMoments(samples, duration);
      segments.splice(0, segments.length, ...suggestions);
      renderTimeline();
      video.currentTime = 0;
      ui.scanStatus.textContent = "Your moments are ready.";
      ui.scanLabel.textContent = "Scan again";
      updateActionState();
      showToast(`${suggestions.length} strong moment${suggestions.length === 1 ? "" : "s"} found. Shape the cut to fit your story.`);
    } catch (error) {
      if (error.message !== "Scan cancelled.") showToast(error.message || "Something interrupted the scan.");
    }
  }

  function chooseMoments(samples, clipDuration) {
    if (samples.length < 2) {
      return [{ id: newId(), start: 0, end: Math.min(clipDuration, 4), score: 54, kind: "Hook", enabled: true }];
    }
    const minMotion = Math.min(...samples.map((sample) => sample.motion));
    const maxMotion = Math.max(...samples.map((sample) => sample.motion));
    const minAudio = Math.min(...samples.map((sample) => sample.audio));
    const maxAudio = Math.max(...samples.map((sample) => sample.audio));
    const norm = (value, low, high) => high - low < 0.0001 ? 0.35 : (value - low) / (high - low);
    const ranked = samples.map((sample, index) => {
      const motion = norm(sample.motion, minMotion, maxMotion);
      const audio = norm(sample.audio, minAudio, maxAudio);
      const neighbors = samples.slice(Math.max(0, index - 1), Math.min(samples.length, index + 2));
      const localMotion = Math.max(...neighbors.map((item) => item.motion));
      const localAudio = Math.max(...neighbors.map((item) => item.audio));
      const score = 0.64 * motion + 0.36 * audio;
      return { time: sample.time, score: 0.64 * norm(localMotion, minMotion, maxMotion) + 0.36 * norm(localAudio, minAudio, maxAudio) };
    }).filter((item) => item.time < clipDuration - 0.3);
    const idealLength = clipDuration < 9 ? Math.min(clipDuration, 3.8) : clipDuration < 24 ? 3.5 : 3.2;
    const targetCount = Math.max(1, Math.min(4, Math.floor(clipDuration / (idealLength * 1.1))));
    const chosen = [];
    const rankedHigh = ranked.slice().sort((a, b) => b.score - a.score);
    const separation = idealLength * 1.1;
    for (const peak of rankedHigh) {
      if (chosen.length >= targetCount) break;
      if (chosen.every((item) => Math.abs(item.time - peak.time) >= separation)) chosen.push(peak);
    }
    if (!chosen.length) chosen.push(rankedHigh[0]);
    chosen.sort((a, b) => a.time - b.time);
    const highest = chosen.reduce((best, item) => item.score > best.score ? item : best, chosen[0]);
    return chosen.map((peak, index) => {
      let start = Math.max(0, peak.time - idealLength * 0.42);
      let end = Math.min(clipDuration, start + idealLength);
      start = Math.max(0, end - idealLength);
      let kind = "Peak";
      if (index === 0 && peak.time < clipDuration * 0.4) kind = "Hook";
      if (index === chosen.length - 1 && peak.time > clipDuration * 0.64 && chosen.length > 1) kind = "Payoff";
      if (peak === highest) kind = peak.time < clipDuration * 0.3 ? "Hook" : peak.time > clipDuration * 0.68 ? "Payoff" : "Peak";
      return { id: newId(), start, end, score: Math.round(55 + peak.score * 43), kind, enabled: true };
    });
  }

  function renderTimeline() {
    ui.timelineTrack.innerHTML = "";
    const chosen = segments.filter((segment) => segment.enabled);
    const total = chosen.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
    ui.totalTime.textContent = `${formatTime(total)} final cut`;
    if (!segments.length) {
      ui.timelineEmpty.hidden = false;
      ui.timelineTrack.append(ui.timelineEmpty);
      updateActionState();
      return;
    }
    ui.timelineEmpty.hidden = true;
    segments.forEach((segment, index) => {
      const card = document.createElement("article");
      const tone = segment.kind.toLowerCase();
      card.className = `timeline-clip ${tone}${segment.enabled ? "" : " is-disabled"}`;
      card.dataset.id = segment.id;
      const startPercent = duration ? (segment.start / duration) * 100 : 0;
      const endPercent = duration ? (segment.end / duration) * 100 : 100;
      card.innerHTML = `
        <div class="clip-top"><span class="clip-kind">${escapeHtml(segment.kind.toUpperCase())} · ${String(index + 1).padStart(2, "0")}</span><span class="clip-score">${segment.score}%</span></div>
        <button type="button" class="clip-main" aria-label="Preview beat ${index + 1}, ${formatTime(segment.start)} to ${formatTime(segment.end)}"><strong>${formatTime(segment.start)} — ${formatTime(segment.end)}</strong></button>
        <div class="clip-bottom"><span class="clip-duration">${formatTime(segment.end - segment.start)}</span><button class="include-toggle" type="button" aria-pressed="${segment.enabled}" aria-label="${segment.enabled ? "Remove from" : "Add to"} final cut">${segment.enabled ? "✓" : "+"}</button><button class="clip-remove" type="button" aria-label="Delete beat">×</button></div>
        <div class="trim-row"><div class="trim-base"></div><div class="trim-fill" style="left:${startPercent}%;width:${Math.max(0, endPercent - startPercent)}%"></div><input type="range" class="trim-start" min="0" max="${duration}" step="0.05" value="${segment.start}" aria-label="Beat start time"><input type="range" class="trim-end" min="0" max="${duration}" step="0.05" value="${segment.end}" aria-label="Beat end time"></div>`;
      ui.timelineTrack.append(card);
    });
    updateActionState();
  }

  function editSegment(event) {
    const card = event.target.closest(".timeline-clip");
    if (!card) return;
    const segment = segments.find((item) => item.id === card.dataset.id);
    if (!segment) return;
    if (event.target.matches(".clip-main")) {
      seekTo(segment.start);
      return;
    }
    if (event.target.matches(".clip-remove")) {
      segments.splice(segments.indexOf(segment), 1);
      renderTimeline();
      return;
    }
    if (event.target.matches(".include-toggle")) {
      segment.enabled = !segment.enabled;
      renderTimeline();
      return;
    }
    if (event.target.matches(".trim-start")) {
      segment.start = Math.min(Number(event.target.value), segment.end - 0.7);
      updateTrimCard(card, segment);
      return;
    }
    if (event.target.matches(".trim-end")) {
      segment.end = Math.max(Number(event.target.value), segment.start + 0.7);
      updateTrimCard(card, segment);
    }
  }

  function updateTrimCard(card, segment) {
    const start = card.querySelector(".trim-start");
    const end = card.querySelector(".trim-end");
    start.max = String(Math.max(0, segment.end - 0.7));
    end.min = String(Math.min(duration, segment.start + 0.7));
    start.value = String(segment.start);
    end.value = String(segment.end);
    card.querySelector(".clip-main strong").textContent = `${formatTime(segment.start)} — ${formatTime(segment.end)}`;
    card.querySelector(".clip-duration").textContent = formatTime(segment.end - segment.start);
    const fill = card.querySelector(".trim-fill");
    const left = duration ? segment.start / duration * 100 : 0;
    const right = duration ? segment.end / duration * 100 : 100;
    fill.style.left = `${left}%`;
    fill.style.width = `${Math.max(0, right - left)}%`;
    ui.totalTime.textContent = `${formatTime(segments.filter((item) => item.enabled).reduce((sum, item) => sum + item.end - item.start, 0))} final cut`;
    updateActionState();
  }

  function seekTo(time) {
    video.pause();
    previewToken++;
    previewActive = false;
    video.playbackRate = 1;
    const next = Math.max(0, Math.min(duration, time));
    if (Math.abs(video.currentTime - next) < 0.05) return;
    video.currentTime = next;
  }

  function addManualBeat() {
    if (!file || !duration) return;
    const start = Math.max(0, Math.min(duration - 0.75, video.currentTime - 1.1));
    const end = Math.min(duration, start + Math.min(3.4, duration - start));
    segments.push({ id: newId(), start, end, score: 72, kind: "Peak", enabled: true });
    renderTimeline();
    showToast("Beat added to your cut.");
  }

  async function playSelectedPreview() {
    if (!file) return;
    if (previewActive) {
      previewToken++;
      previewActive = false;
      video.pause();
      video.playbackRate = 1;
      ui.playBtn.textContent = "▶";
      return;
    }
    const clips = segments.filter((segment) => segment.enabled);
    const token = ++previewToken;
    previewActive = true;
    ui.playBtn.textContent = "Ⅱ";
    await ensureAudioGraph();
    const queue = clips.length ? clips : [{ start: 0, end: duration }];
    for (const clip of queue) {
      if (token !== previewToken) break;
      await setVideoTime(clip.start);
      try { await video.play(); } catch { showToast("Could not play this video in the preview."); break; }
      const didFinish = await waitUntilEnd(clip.end, token);
      video.pause();
      if (!didFinish || token !== previewToken) break;
    }
    if (token === previewToken) {
      previewActive = false;
      video.playbackRate = 1;
      ui.playBtn.textContent = "▶";
    }
  }

  function setVideoTime(time) {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 0.06) return resolve();
      const finish = () => { video.removeEventListener("seeked", finish); resolve(); };
      video.addEventListener("seeked", finish, { once: true });
      video.currentTime = time;
    });
  }

  function waitUntilEnd(end, token) {
    return new Promise((resolve) => {
      const check = () => {
        if (token !== previewToken) return resolve(false);
        if (video.currentTime >= end || video.ended) return resolve(true);
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  function setFormat(ratio) {
    currentRatio = ratio;
    ui.ratioChip.textContent = ratio;
    previewFrame.classList.remove("vertical", "square", "wide");
    previewFrame.classList.add(ratio === "9:16" ? "vertical" : ratio === "1:1" ? "square" : "wide");
    document.querySelectorAll(".format-option").forEach((button) => button.classList.toggle("selected", button.dataset.ratio === ratio));
  }

  function drawCover(context, source, width, height) {
    const sourceWidth = source.videoWidth || width;
    const sourceHeight = source.videoHeight || height;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;
    context.drawImage(source, x, y, drawWidth, drawHeight);
  }

  function drawOverlay(context, width, height) {
    const style = ui.styleSelect.value;
    const title = ui.titleInput.value.trim() || "Make it count.";
    const bottomFade = context.createLinearGradient(0, height * 0.48, 0, height);
    bottomFade.addColorStop(0, "rgba(5,8,5,0)");
    bottomFade.addColorStop(1, "rgba(5,8,5,.66)");
    context.fillStyle = bottomFade;
    context.fillRect(0, 0, width, height);
    const isCinema = style === "cinema";
    const isClean = style === "clean";
    const lines = wrapCanvasText(context, title, width * 0.84, isCinema ? "400" : "800", Math.round(width * (width > height ? 0.043 : 0.072)), isCinema ? "Georgia" : "Segoe UI");
    const fontSize = Math.round(width * (width > height ? 0.043 : 0.072));
    const lineHeight = fontSize * 0.98;
    const top = height * (width > height ? 0.54 : 0.56);
    const label = "A MOMENT WORTH KEEPING";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "rgba(0,0,0,.52)";
    context.shadowBlur = 20;
    context.shadowOffsetY = 3;
    context.fillStyle = "rgba(255,255,255,.92)";
    context.font = `500 ${Math.round(width * 0.015)}px Consolas, monospace`;
    context.fillText(label, width / 2, top - fontSize * 1.25);
    context.font = `${isCinema ? "400" : "800"} ${fontSize}px ${isCinema ? "Georgia" : "Segoe UI"}, sans-serif`;
    const startY = top + Math.max(0, lines.length - 1) * lineHeight / 2;
    lines.forEach((line, index) => {
      context.fillStyle = !isClean && index === lines.length - 1 ? "#c9f078" : "#ffffff";
      context.fillText(line, width / 2, startY + index * lineHeight);
    });
    context.shadowBlur = 7;
    context.font = `800 ${Math.round(width * 0.022)}px 'Segoe UI', sans-serif`;
    context.fillStyle = "rgba(255,255,255,.88)";
    context.fillText("clipforge.", width / 2, height * 0.94);
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
  }

  function wrapCanvasText(context, text, maxWidth, weight, fontSize, family) {
    context.font = `${weight} ${fontSize}px ${family}, sans-serif`;
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (context.measureText(attempt).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = attempt;
    }
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  async function exportEdit() {
    const clips = segments.filter((segment) => segment.enabled && segment.end - segment.start > 0.35);
    if (!clips.length || !file) return;
    if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
      showToast("Video export is not available in this browser. Try a current version of Chrome or Edge.", 4500);
      return;
    }
    renderCancel = false;
    ui.renderModal.hidden = false;
    ui.renderTitle.textContent = "Building your cut…";
    ui.renderMessage.textContent = "Putting your selected moments in order.";
    ui.renderBar.style.width = "0%";
    ui.renderPercent.textContent = "0%";
    ui.renderTitle.textContent = `Exporting ${currentRatio} video…`;
    await ensureAudioGraph();
    const dimensions = currentRatio === "9:16" ? [1080, 1920] : currentRatio === "1:1" ? [1080, 1080] : [1920, 1080];
    const canvas = document.createElement("canvas");
    canvas.width = dimensions[0];
    canvas.height = dimensions[1];
    const context = canvas.getContext("2d", { alpha: false });
    const stream = canvas.captureStream(30);
    let audioTrack = null;
    if (audioDestination && audioDestination.stream.getAudioTracks().length) {
      audioTrack = audioDestination.stream.getAudioTracks()[0].clone();
      stream.addTrack(audioTrack);
    }
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      ui.renderModal.hidden = true;
      stream.getTracks().forEach((track) => track.stop());
      showToast("This browser does not support WebM export.", 4000);
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    const originalTime = video.currentTime;
    const originalRate = video.playbackRate;
    const originalGain = gainNode ? gainNode.gain.value : 1;
    const fullLength = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
    recorder.start(400);
    try {
      for (let index = 0; index < clips.length; index++) {
        if (renderCancel) throw new Error("Export cancelled.");
        const clip = clips[index];
        await setVideoTime(clip.start);
        video.playbackRate = 1;
        applyAudioLevel();
        await video.play();
        await renderSegment(clip, context, canvas.width, canvas.height, fullLength, clips.slice(0, index).reduce((sum, item) => sum + item.end - item.start, 0));
        video.pause();
      }
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      if (renderCancel) throw new Error("Export cancelled.");
      const blob = new Blob(chunks, { type: "video/webm" });
      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = `${file.name.replace(/\.[^.]+$/, "")}-clipforge.webm`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(fileUrl), 30000);
      ui.renderTitle.textContent = "Your edit is ready.";
      ui.renderMessage.textContent = "The WebM video has been saved to your downloads.";
      ui.renderPercent.textContent = "100%";
      ui.renderBar.style.width = "100%";
      setTimeout(() => { ui.renderModal.hidden = true; }, 1100);
      showToast("Export ready. Check your downloads.");
    } catch (error) {
      if (recorder.state !== "inactive") {
        recorder.stop();
        await stopped;
      }
      ui.renderModal.hidden = true;
      if (error.message !== "Export cancelled.") showToast("The video export could not finish. Try a shorter edit.", 4200);
    } finally {
      video.pause();
      video.playbackRate = originalRate;
      if (Number.isFinite(originalTime)) await setVideoTime(Math.min(originalTime, duration));
      if (gainNode && audioContext) gainNode.gain.setTargetAtTime(audioMuted ? 0 : originalGain, audioContext.currentTime, 0.05);
      stream.getTracks().forEach((track) => track.stop());
      if (audioTrack) audioTrack.stop();
    }
  }

  async function renderSegment(clip, context, width, height, fullLength, offset) {
    return new Promise((resolve, reject) => {
      let frameId = 0;
      const draw = () => {
        if (renderCancel) {
          cancelAnimationFrame(frameId);
          reject(new Error("Export cancelled."));
          return;
        }
        context.fillStyle = "#151a15";
        context.fillRect(0, 0, width, height);
        if (video.readyState >= 2) drawCover(context, video, width, height);
        drawOverlay(context, width, height);
        const progress = Math.min(1, (offset + Math.max(0, video.currentTime - clip.start)) / fullLength);
        const percent = Math.min(99, Math.round(progress * 100));
        ui.renderBar.style.width = `${percent}%`;
        ui.renderPercent.textContent = `${percent}%`;
        if (video.currentTime >= clip.end || video.ended) {
          cancelAnimationFrame(frameId);
          resolve();
          return;
        }
        frameId = requestAnimationFrame(draw);
      };
      frameId = requestAnimationFrame(draw);
      video.addEventListener("error", () => reject(new Error("Video decoding error.")), { once: true });
    });
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) previewFrame.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function showHelp() { ui.modal.hidden = false; }
  function hideHelp() { ui.modal.hidden = true; }

  $("#chooseFileBtn").addEventListener("click", (event) => { event.stopPropagation(); fileInput.click(); });
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener("change", () => { loadFile(fileInput.files[0]); fileInput.value = ""; });
  $("#replaceFileBtn").addEventListener("click", () => fileInput.click());
  $("#newProjectBtn").addEventListener("click", () => { resetProject(); showToast("A fresh edit is ready."); });
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("dragover"); }));
  dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
  ui.scanBtn.addEventListener("click", scanClip);
  ui.addCutBtn.addEventListener("click", addManualBeat);
  ui.timelineTrack.addEventListener("input", editSegment);
  ui.timelineTrack.addEventListener("click", editSegment);
  ui.timelineTrack.addEventListener("change", (event) => { if (event.target.matches(".trim-start, .trim-end")) renderTimeline(); });
  ui.playBtn.addEventListener("click", playSelectedPreview);
  video.addEventListener("timeupdate", setPreviewTime);
  video.addEventListener("ended", () => { if (!previewActive) ui.playBtn.textContent = "▶"; });
  video.addEventListener("pause", () => { if (!previewActive) ui.playBtn.textContent = "▶"; });
  ui.titleInput.addEventListener("input", () => { ui.titleCount.textContent = `${ui.titleInput.value.length}/38`; syncOverlay(); });
  ui.styleSelect.addEventListener("change", syncOverlay);
  ui.audioLevel.addEventListener("input", applyAudioLevel);
  ui.muteBtn.addEventListener("click", () => {
    audioMuted = !audioMuted;
    applyAudioLevel();
    ui.muteBtn.textContent = audioMuted ? "◖̸" : "◖";
    ui.muteBtn.setAttribute("aria-label", audioMuted ? "Unmute video" : "Mute video");
  });
  document.querySelectorAll(".format-option").forEach((button) => button.addEventListener("click", () => setFormat(button.dataset.ratio)));
  $("#fullscreenBtn").addEventListener("click", toggleFullscreen);
  [ui.exportBtn, ui.exportWideBtn].forEach((button) => button.addEventListener("click", exportEdit));
  $("#helpBtn").addEventListener("click", showHelp);
  $("#feedbackBtn").addEventListener("click", showHelp);
  $("#modalClose").addEventListener("click", hideHelp);
  $("#modalDone").addEventListener("click", hideHelp);
  ui.modal.addEventListener("click", (event) => { if (event.target === ui.modal) hideHelp(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { hideHelp(); if (!ui.renderModal.hidden) { renderCancel = true; ui.renderTitle.textContent = "Cancelling export…"; } } });
  $("#cancelRenderBtn").addEventListener("click", () => { renderCancel = true; ui.renderTitle.textContent = "Cancelling export…"; });

  syncOverlay();
  renderTimeline();
  applyAudioLevel();
})();
