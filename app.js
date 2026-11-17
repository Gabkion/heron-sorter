'use strict';

// Shared globals (port is also referenced by serial.js)
var port = null;

(() => {
  const modelUrlInput = document.getElementById('model-url');
  const loadModelBtn = document.getElementById('load-model-btn');
  const uploadZipBtn = document.getElementById('upload-zip-btn');
  const zipFileInput = document.getElementById('zip-file-input');
  const dropOverlay = document.getElementById('drop-overlay');
  const instructionsBtn = document.getElementById('instructions-btn');

  const class1Box = document.getElementById('class1-box');
  const class2Box = document.getElementById('class2-box');
  const class1Label = document.getElementById('class1-label');
  const class2Label = document.getElementById('class2-label');

  const barLeft = document.getElementById('bar-left');
  const barRight = document.getElementById('bar-right');
  const thresholdLeft = document.getElementById('threshold-left');
  const thresholdRight = document.getElementById('threshold-right');
  const thresholdText = document.getElementById('threshold-text');
  const confidenceSlider = document.getElementById('confidence-slider');

  const leftGrid = document.getElementById('left-grid');
  const rightGrid = document.getElementById('right-grid');
  const videoEl = document.getElementById('webcam');

  const firmwareWarning = document.getElementById('firmware-warning');
  const firmwareWarningToggle = document.getElementById('firmware-warning-toggle');
  const firmwareWarningBody = document.getElementById('firmware-warning-body');
  const firmwareWarningClose = document.getElementById('firmware-warning-close');

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 80;
  thumbCanvas.height = 80;
  const thumbCtx = thumbCanvas.getContext('2d');

  let currentModel = null;
  let labels = [];
  let isModelLoaded = false;
  let classifyTimeout = null;
  let modelLoadGeneration = 0;
  let confidenceThreshold = 0.90;

  // Throttling / cooldown state (longer than Arduino's 3s sort cycle)
  let lastSendTime = 0;
  const sendCooldownMs = 3500;
  const classifyIntervalMs = 400;
  let lastLabel = '';
  let consecutiveCount = 0;
  const requiredConsecutive = 2;

  // Serial confirmation check for detecting wrong/missing Arduino code
  const serialAckTimeoutMs = 1500;
  let serialAckTimer = null;
  let pendingAckClass = null;
  let firmwareWarningDismissed = false;

  function clearSerialAckTimer() {
    if (serialAckTimer) {
      clearTimeout(serialAckTimer);
      serialAckTimer = null;
    }
    pendingAckClass = null;
  }

  function showFirmwareWarning() {
    if (!firmwareWarning || firmwareWarningDismissed) return;
    firmwareWarning.classList.remove('hidden');
  }

  function hideFirmwareWarning() {
    if (!firmwareWarning) return;
    firmwareWarning.classList.add('hidden');
    firmwareWarning.classList.remove('open');
    if (firmwareWarningToggle) firmwareWarningToggle.setAttribute('aria-expanded', 'false');
    if (firmwareWarningBody) firmwareWarningBody.setAttribute('aria-hidden', 'true');
  }

  async function initWebcam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 360 } },
        audio: false
      });
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (err) {
      console.error('Webcam access error:', err);
    }
  }

  function updateThresholdUI() {
    const value = Number(confidenceSlider.value);
    confidenceThreshold = value / 100;
    const percent = ((value - 50) / (99 - 50)) * 100;
    confidenceSlider.style.background =
      `linear-gradient(to right, #1967d2 0%, #1967d2 ${percent}%, #d2e3fc ${percent}%, #d2e3fc 100%)`;
    thresholdText.textContent = `Threshold: ${value}%`;

    const offsetPct = confidenceThreshold * 50;
    thresholdRight.style.left = `${50 + offsetPct}%`;
    thresholdLeft.style.left = `${50 - offsetPct}%`;
  }

  function updateClassLabelsUI() {
    if (isModelLoaded && labels.length >= 2) {
      class1Label.textContent = labels[0];
      class2Label.textContent = labels[1];
      class1Box.classList.remove('hidden');
      class2Box.classList.remove('hidden');
    } else {
      class1Box.classList.add('hidden');
      class2Box.classList.add('hidden');
    }
  }

  function setupRenameHandler(boxEl, labelIndex) {
    boxEl.addEventListener('click', () => {
      if (!isModelLoaded || labels.length <= labelIndex) return;
      const current = labels[labelIndex];
      const next = prompt(`Enter new name for "${current}":`, current);
      if (next !== null && next.trim() !== '') {
        labels[labelIndex] = next.trim();
        updateClassLabelsUI();
      }
    });
  }

  function triggerSplash(boxEl) {
    boxEl.classList.remove('splash');
    // Force reflow so rapid consecutive triggers restart the CSS animation
    void boxEl.offsetWidth;
    boxEl.classList.add('splash');
  }

  function addGridThumbnail(gridEl) {
    if (videoEl.readyState < 2 || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      return;
    }
    const cropSize = Math.min(videoEl.videoWidth, videoEl.videoHeight);
    const cropX = (videoEl.videoWidth - cropSize) / 2;
    const cropY = (videoEl.videoHeight - cropSize) / 2;

    thumbCtx.drawImage(videoEl, cropX, cropY, cropSize, cropSize, 0, 0, 80, 80);

    const card = document.createElement('div');
    card.className = 'photo-card';
    const img = document.createElement('img');
    img.src = thumbCanvas.toDataURL('image/jpeg', 0.85);
    img.alt = 'Detected object';
    card.appendChild(img);

    gridEl.appendChild(card);
    while (gridEl.children.length > 9) {
      gridEl.removeChild(gridEl.firstElementChild);
    }
  }

  function disposeCurrentModel() {
    const gen = ++modelLoadGeneration;
    clearTimeout(classifyTimeout);
    classifyTimeout = null;
    clearSerialAckTimer();
    hideFirmwareWarning();
    isModelLoaded = false;
    lastLabel = '';
    consecutiveCount = 0;

    if (currentModel && typeof currentModel.dispose === 'function') {
      try {
        currentModel.dispose();
      } catch (err) {
        console.warn('Error disposing old model:', err);
      }
    }
    currentModel = null;
    barLeft.style.width = '0%';
    barRight.style.width = '0%';
    updateClassLabelsUI();
    return gen;
  }

  async function loadUrlModel() {
    let url = modelUrlInput.value.trim();
    if (!url) {
      alert('Please paste a Teachable Machine model link first.');
      return;
    }
    if (!url.endsWith('/')) {
      url += '/';
    }

    uploadZipBtn.textContent = 'UPLOAD MODEL (.ZIP)';
    zipFileInput.value = '';
    const myGen = disposeCurrentModel();
    loadModelBtn.textContent = 'LOADING...';

    try {
      const metaRes = await fetch(url + 'metadata.json');
      if (myGen !== modelLoadGeneration) return;
      if (!metaRes.ok) {
        throw new Error('Could not fetch metadata.json');
      }
      const metadata = await metaRes.json();
      if (myGen !== modelLoadGeneration) return;
      if (!metadata.labels || metadata.labels.length <= 2) {
        alert('Train a model with at least three classes: one for each type of object you want to sort, and one for the empty sorter');
        loadModelBtn.textContent = 'LOAD MODEL';
        return;
      }

      const loadedModel = await tf.loadLayersModel(url + 'model.json');
      if (myGen !== modelLoadGeneration) {
        loadedModel.dispose();
        return;
      }
      currentModel = loadedModel;
      labels = metadata.labels.slice();
      isModelLoaded = true;
      updateClassLabelsUI();

      loadModelBtn.textContent = 'MODEL LOADED';
      setTimeout(() => {
        if (isModelLoaded) loadModelBtn.textContent = 'REFRESH MODEL';
      }, 3000);

      classifyLoop();
    } catch (err) {
      console.error('Error loading URL model:', err);
      alert('Invalid TM2 URL: could not load model or metadata.json');
      loadModelBtn.textContent = 'INVALID URL';
      setTimeout(() => {
        loadModelBtn.textContent = 'LOAD MODEL';
      }, 3000);
    }
  }

  async function handleZipFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('Please select a .zip file exported from Teachable Machine.');
      return;
    }

    modelUrlInput.value = '';
    loadModelBtn.textContent = 'LOAD MODEL';
    const myGen = disposeCurrentModel();
    uploadZipBtn.textContent = 'LOADING ZIP...';

    try {
      if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library is not loaded');
      }

      const zip = await JSZip.loadAsync(file);
      if (myGen !== modelLoadGeneration) return;
      let modelEntry = null;
      let metadataEntry = null;
      let weightsEntry = null;

      zip.forEach((relPath, entry) => {
        if (entry.dir) return;
        if (relPath.includes('__MACOSX') || relPath.startsWith('.')) return;

        const lower = relPath.toLowerCase();
        if (lower.endsWith('model.json')) {
          modelEntry = entry;
        } else if (lower.endsWith('metadata.json')) {
          metadataEntry = entry;
        } else if (lower.endsWith('.bin')) {
          weightsEntry = entry;
        }
      });

      if (!modelEntry || !metadataEntry || !weightsEntry) {
        throw new Error('ZIP file must contain model.json, metadata.json, and weights.bin');
      }

      const metadata = JSON.parse(await metadataEntry.async('text'));
      if (myGen !== modelLoadGeneration) return;
      if (!metadata.labels || metadata.labels.length <= 2) {
        alert('Train a model with at least three classes: one for each type of object you want to sort, and one for the empty sorter');
        uploadZipBtn.textContent = 'UPLOAD MODEL (.ZIP)';
        return;
      }

      const modelJsonText = await modelEntry.async('text');
      if (myGen !== modelLoadGeneration) return;
      const modelJson = JSON.parse(modelJsonText);

      let weightFileName = 'weights.bin';
      if (modelJson.weightsManifest && modelJson.weightsManifest[0] && modelJson.weightsManifest[0].paths) {
        weightFileName = modelJson.weightsManifest[0].paths[0] || 'weights.bin';
      }

      const weightsBuffer = await weightsEntry.async('arraybuffer');
      if (myGen !== modelLoadGeneration) return;
      const modelFile = new File([modelJsonText], 'model.json', { type: 'application/json' });
      const weightsFile = new File([weightsBuffer], weightFileName, { type: 'application/octet-stream' });

      const loadedModel = await tf.loadLayersModel(tf.io.browserFiles([modelFile, weightsFile]));
      if (myGen !== modelLoadGeneration) {
        loadedModel.dispose();
        return;
      }
      currentModel = loadedModel;
      labels = metadata.labels.slice();
      isModelLoaded = true;
      updateClassLabelsUI();

      uploadZipBtn.textContent = 'ZIP MODEL LOADED';
      setTimeout(() => {
        if (isModelLoaded) uploadZipBtn.textContent = 'REFRESH ZIP MODEL';
      }, 3000);

      classifyLoop();
    } catch (err) {
      console.error('Error loading ZIP model:', err);
      alert('Failed to load ZIP model: ' + err.message);
      uploadZipBtn.textContent = 'INVALID ZIP';
      setTimeout(() => {
        uploadZipBtn.textContent = 'UPLOAD MODEL (.ZIP)';
      }, 3000);
    } finally {
      zipFileInput.value = '';
    }
  }

  function handlePredictions(rawPredictions) {
    if (!labels || labels.length < 2) return;

    const conf1 = rawPredictions[0] || 0;
    const conf2 = rawPredictions[1] || 0;

    barRight.style.width = `${Math.min(50, Math.max(0, conf1 * 50))}%`;
    barLeft.style.width = `${Math.min(50, Math.max(0, conf2 * 50))}%`;

    let detectedClass = 0;
    if (conf1 > confidenceThreshold) {
      detectedClass = 1;
    } else if (conf2 > confidenceThreshold) {
      detectedClass = 2;
    }

    if (detectedClass === 0) {
      lastLabel = '';
      consecutiveCount = 0;
      return;
    }

    const detectedLabel = labels[detectedClass - 1];
    if (lastLabel === detectedLabel) {
      consecutiveCount++;
    } else {
      lastLabel = detectedLabel;
      consecutiveCount = 1;
    }

    const now = Date.now();
    if (consecutiveCount < requiredConsecutive || now - lastSendTime < sendCooldownMs) {
      return;
    }

    lastSendTime = now;
    consecutiveCount = 0;
    lastLabel = '';

    if (port && isModelLoaded) {
      const data = new TextEncoder().encode(String(detectedClass));
      const sentClass = detectedClass;
      try {
        Promise.resolve(port.send(data))
          .then(() => {
            if (!port || !isModelLoaded) return;
            clearSerialAckTimer();
            pendingAckClass = sentClass;
            serialAckTimer = setTimeout(() => {
              serialAckTimer = null;
              if (port && isModelLoaded && pendingAckClass === sentClass) {
                showFirmwareWarning();
              }
            }, serialAckTimeoutMs);
          })
          .catch(console.error);
      } catch (err) {
        console.error(err);
      }
    }

    if (detectedClass === 1) {
      triggerSplash(class1Box);
      addGridThumbnail(rightGrid);
    } else {
      triggerSplash(class2Box);
      addGridThumbnail(leftGrid);
    }
  }

  async function classifyLoop() {
    clearTimeout(classifyTimeout);
    if (!isModelLoaded || !currentModel) {
      return;
    }

    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      let pred = null;
      try {
        pred = tf.tidy(() => {
          const img = tf.browser.fromPixels(videoEl);
          const minDim = Math.min(img.shape[0], img.shape[1]);
          const startY = Math.floor((img.shape[0] - minDim) / 2);
          const startX = Math.floor((img.shape[1] - minDim) / 2);
          const cropped = img.slice([startY, startX, 0], [minDim, minDim, 3]);
          const resized = tf.image.resizeBilinear(cropped, [224, 224]);
          const normalized = resized.expandDims(0).toFloat().div(tf.scalar(127)).sub(tf.scalar(1));
          return currentModel.predict(normalized).as1D();
        });

        const rawPredictions = Array.from(await pred.data());
        if (isModelLoaded) {
          handlePredictions(rawPredictions);
        }
      } catch (err) {
        console.error('Classification error:', err);
      } finally {
        if (pred) {
          pred.dispose();
        }
      }
    }

    if (isModelLoaded) {
      classifyTimeout = setTimeout(classifyLoop, classifyIntervalMs);
    }
  }

  // Event bindings
  loadModelBtn.addEventListener('click', loadUrlModel);
  modelUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUrlModel();
  });

  uploadZipBtn.addEventListener('click', () => zipFileInput.click());
  zipFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleZipFile(e.target.files[0]);
    }
  });

  let dragDepth = 0;

  function isFileDrag(e) {
    return Boolean(e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files'));
  }

  function showDropOverlay() {
    if (dropOverlay) {
      dropOverlay.classList.remove('hidden');
    }
    uploadZipBtn.classList.add('drag-active');
  }

  function hideDropOverlay() {
    dragDepth = 0;
    if (dropOverlay) {
      dropOverlay.classList.add('hidden');
    }
    uploadZipBtn.classList.remove('drag-active');
  }

  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth += 1;
    showDropOverlay();
  });

  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      hideDropOverlay();
    }
  });

  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    hideDropOverlay();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleZipFile(e.dataTransfer.files[0]);
    }
  });

  window.addEventListener('blur', hideDropOverlay);
  document.addEventListener('dragend', hideDropOverlay);

  confidenceSlider.addEventListener('input', updateThresholdUI);

  instructionsBtn.addEventListener('click', () => {
    window.open('https://github.com/Gabkion/heron-sorter#readme', '_blank');
  });

  setupRenameHandler(class1Box, 0);
  setupRenameHandler(class2Box, 1);

  if (firmwareWarning && firmwareWarningToggle && firmwareWarningBody) {
    firmwareWarningToggle.addEventListener('click', () => {
      const isOpen = firmwareWarning.classList.toggle('open');
      firmwareWarningToggle.setAttribute('aria-expanded', String(isOpen));
      firmwareWarningBody.setAttribute('aria-hidden', String(!isOpen));
    });
  }

  if (firmwareWarningClose) {
    firmwareWarningClose.addEventListener('click', () => {
      firmwareWarningDismissed = true;
      hideFirmwareWarning();
    });
  }

  window.addEventListener('arduino-serial-line', (event) => {
    const line = String(event.detail || '').trim().toLowerCase();
    if (!line) return;

    const expectedLine = pendingAckClass !== null ? `class ${pendingAckClass} detected` : null;
    if (
      (expectedLine && line === expectedLine) ||
      (!expectedLine && (line === 'class 1 detected' || line === 'class 2 detected'))
    ) {
      clearSerialAckTimer();
      firmwareWarningDismissed = false;
      hideFirmwareWarning();
    }
  });

  window.addEventListener('arduino-serial-disconnected', () => {
    clearSerialAckTimer();
    firmwareWarningDismissed = false;
    hideFirmwareWarning();
  });

  updateThresholdUI();
  initWebcam();
})();
