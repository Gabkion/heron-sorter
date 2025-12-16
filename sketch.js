function debounce(func, wait, immediate) {
  var timeout;
  return function() {
    var context = this,
      args = arguments;
    var later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    var callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

class StyledButton {
  constructor(text, x, y, width, height, isFixed = false) {
    this.button = createButton(text);
    this.button.position(x, y);
    
    if (isFixed) {
      this.button.style('position', 'fixed');
    }
    
    this.button.style('height', height + 'px');
    this.button.style('width', width + 'px');
    this.button.style('border-width', '0px');
    this.button.style('background-color', '#d2e3fc');
    this.button.style('font-family', 'Poppins');
    this.button.style('font-size', '15px');
    this.button.style('font-weight', '600');
    this.button.style('color', '#1967D2');
    this.button.style('cursor', 'pointer');
    this.button.style('border-radius', '8px');
    this.button.style('transition', 'all 0.3s ease');
    
    this.button.mouseOver(() => {
      this.button.style('background-color', '#f0f7ff');
      this.button.style('box-shadow', '0 2px 8px rgba(25, 103, 210, 0.2)');
      this.button.style('transform', 'translateY(-1px)');
    });
    
    this.button.mouseOut(() => {
      this.button.style('background-color', '#d2e3fc');
      this.button.style('box-shadow', 'none');
      this.button.style('transform', 'translateY(0)');
    });
  }
  
  html(text) {
    this.button.html(text);
  }
  
  mousePressed(callback) {
    this.button.mousePressed(callback);
  }
  
  id(idName) {
    this.button.id(idName);
  }
}

let classifier;
let video;
let videoSize;
let classificationIndicator;

let leftGrid;
let leftAdd;
let rightGrid;
let rightAdd;

let isLeftPic;

let leftClassSelector;
let rightClassSelector;

let cameraBorder;
let splashLeft;
let splashRight;
let selectPic;

let connect;
let pencil;
let bgColor = '#e8f0fe';
let port;
let shouldFreezeFrame;
let modeInput;
let loadModel;
let labels = [];
let isLeftClassSelected = false;
let isRightClassSelected = false;
let confidenceThreshold = 0.90;
let confidenceSlider;

// Throttling / cooldown globals
let lastSendTime = 0;
const sendCooldownMs = 2000;
let classifyIntervalMs = 400;
let lastLabel = "";
let consecutiveCount = 0;
const requiredConsecutive = 2;

let poppinsRegular;
let poppinsBold;
let hasSetPauseTimer;
let label = "";
let isModelLoaded = false;
let enteredText = "";

function myInputEvent() {
  enteredText = this.value();
}

function setup() {
  createCanvas(window.innerWidth, window.innerHeight);
  
  videoSize = 250;
  video = createCapture(VIDEO);
  video.hide();
  video.elt.style.transform = 'scaleX(-1)';

  cameraBorder = loadImage('./assets/camera_border.png');

  loadModel = new StyledButton('LOAD MODEL', 297, 20, 155, 45);
  loadModel.mousePressed(() => {
    try {
      console.log(enteredText + 'metadata.json');
      classifier = ml5.imageClassifier(enteredText + 'model.json');

      httpGet(enteredText + 'metadata.json', 'json', false, (response) => {
        if (response.labels.length <= 2) {
          alert("Train a model with at least three classes: one for each type of object you want to sort, and one for the empty sorter");
        } else {
          labels = response.labels;
          isModelLoaded = true;
          loadModel.html('MODEL LOADED');
          setTimeout(() => {
            loadModel.html('REFRESH MODEL');
          }, 3000);
          classifyVideo();
        }

      }, (error) => alert("invalid TM2 url"));
    } catch (e) {
      loadModel.html('INVALID URL');
    }
  });

  leftGrid = new PhotoGrid(true);
  pencil = loadImage('./assets/pencil_icon.png');
  classificationIndicator = new ClassificationBar();
  leftClassSelector = new ClassInput(true);
  rightClassSelector = new ClassInput(false);
  splashRight = new Splash(false);
  splashLeft = new Splash(true);
  rightGrid = new PhotoGrid(false);
  poppinsRegular = loadFont('./assets/Poppins-Regular.ttf');
  poppinsBold = loadFont('./assets/Poppins-Bold.ttf');

  loadModel.textFont = poppinsRegular;
  shouldFreezeFrame = false;
  hasSetPauseTimer = false;

  modelInput = createInput();
  modelInput.input(myInputEvent);
  modelInput.position(20, 20);
  modelInput.style('height', '45px');
  modelInput.style('width', '267px');
  modelInput.style('border-width', '0px');
  modelInput.style('border-radius', '8px');
  modelInput.style('border', '2px solid #1967d2');
  modelInput.style('font-family', 'Poppins');
  modelInput.style('font-size', '16px');
  modelInput.style('padding-left', '10px');
  modelInput.style('color', '#669df6');
  modelInput.style('background-color', 'white');
  modelInput.style('transition', 'all 0.3s ease');
  modelInput.style('box-sizing', 'border-box');
  modelInput.attribute('placeholder', "Paste model link here");
  
  modelInput.elt.addEventListener('focus', () => {
    modelInput.elt.style.backgroundColor = '#f0f7ff';
    modelInput.elt.style.boxShadow = '0 2px 8px rgba(25, 103, 210, 0.2)';
  });
  
  modelInput.elt.addEventListener('blur', () => {
    modelInput.elt.style.backgroundColor = 'white';
    modelInput.elt.style.boxShadow = 'none';
  });


  connect = new StyledButton('CONNECT ARDUINO', width - 230, 20, 210, 45);
  connect.id('connect');
  
  // Instructions button
  let instructionsBtn = new StyledButton('INSTRUCTIONS', 20, 20, 130, 40, true);
  instructionsBtn.button.style('bottom', '20px');
  instructionsBtn.button.style('right', '20px');
  instructionsBtn.button.style('top', 'auto');
  instructionsBtn.button.style('left', 'auto');
  instructionsBtn.button.style('font-size', '13px');
  instructionsBtn.mousePressed(() => {
    window.open('https://github.com/Gabkion/heron-sorter#readme', '_blank');
  });
  
  // Confidence threshold slider
  confidenceSlider = createSlider(50, 99, 90, 1);
  confidenceSlider.position(width / 2 - 125, height / 3.3 + 50);
  confidenceSlider.style('width', '250px');
  confidenceSlider.input(() => {
    confidenceThreshold = confidenceSlider.value() / 100;
    updateSliderGradient();
  });
  
  // Add custom slider styling
  let style = document.createElement('style');
  style.innerHTML = `
    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      height: 8px;
      background: linear-gradient(to right, #1967d2 0%, #1967d2 ${(90-50)/(99-50)*100}%, #d2e3fc ${(90-50)/(99-50)*100}%, #d2e3fc 100%);
      border-radius: 4px;
      outline: none;
      opacity: 0.9;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      background: #1967d2;
      border: 3px solid white;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    input[type="range"]::-moz-range-thumb {
      width: 18px;
      height: 18px;
      background: #1967d2;
      border: 3px solid white;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
  `;
  document.head.appendChild(style);
  
  function updateSliderGradient() {
    let percent = (confidenceSlider.value() - 50) / (99 - 50) * 100;
    confidenceSlider.elt.style.background = `linear-gradient(to right, #1967d2 0%, #1967d2 ${percent}%, #d2e3fc ${percent}%, #d2e3fc 100%)`;
  }
  
  leftAdd = debounce(() => {
    leftGrid.addImage(selectPic);
  }, 500, true);
  
  rightAdd = debounce(() => {
    rightGrid.addImage(selectPic);
  }, 500, true);

  if (isModelLoaded) {
    classifyVideo();
  }
}

function draw() {
  if (width > 700) {
    background(bgColor);
    
    // Draw title
    if (poppinsBold && poppinsRegular) {
      noStroke();
      fill('#1967d2');
      textFont(poppinsBold);
      textAlign(CENTER, TOP);
      textSize(28);
      text('AI Sorter', width / 2, 90);
      
      textFont(poppinsRegular);
      textSize(16);
      fill(100);
      text('Arduino + Teachable Machine', width / 2, 125);
    }
    
    video.get();
    
    if (shouldFreezeFrame && !hasSetPauseTimer) {
      video.pause();
      let cropSize = videoSize / 1.6;
      let cropX = (video.width - cropSize) / 2;
      let cropY = (video.height - cropSize) / 2 + 50;
      selectPic = video.get(cropX, cropY, cropSize, cropSize);
      if (isLeftPic) {
        leftAdd();
      } else {
        rightAdd();
      }
      setTimeout(() => {
        video.play();
        hasSetPauseTimer = false;
        shouldFreezeFrame = false;
      }, 2000);
    }
    
    noStroke();
    textFont(poppinsBold);
    textAlign(CENTER, CENTER);
    textSize(14);
    text("enable webcam access", width / 2, height / 1.6);
    text("and refresh page to use", width / 2, height / 1.5);
    
    push();
    translate(width / 2 + videoSize / 2, height / 1.6 - videoSize / 2);
    scale(-1, 1);
    let cropX = (video.width - video.height) / 2;
    image(video, 0, 0, videoSize, videoSize, cropX, 0, video.height, video.height);
    pop();
    image(cameraBorder, width / 2 - videoSize / 2 - 3, height / 1.6 - videoSize / 2 - 3, videoSize + 6, videoSize + 6);

    leftGrid.render();
    rightGrid.render();
    rectMode(CORNER);
    classificationIndicator.render();
    leftClassSelector.render();
    rightClassSelector.render();
    splashLeft.render();
    splashRight.render();
  } else {
    background(bgColor);
    noStroke();
    textFont(poppinsBold);
    textAlign(CENTER, CENTER);
    textSize(14);
    text("expand page or", width / 2, height / 1.6);
    text("load on a computer to use", width / 2, height / 1.5);
  }
}

function classifyVideo() {
  if (shouldFreezeFrame) {
    setTimeout(classifyVideo, classifyIntervalMs);
    return;
  }
  classifier.classify(video, gotResult);
}

function gotResult(error, results) {
  if (error) {
    console.error(error);
    return;
  }
  
  classificationIndicator.updateClassification(results);
  label = results[0].label;
  setTimeout(classifyVideo, classifyIntervalMs);
}

function mousePressed() {
  leftClassSelector.onClick(mouseX, mouseY);
  rightClassSelector.onClick(mouseX, mouseY);
}

function mouseMoved() {
  cursor(ARROW); // Reset cursor first
  leftClassSelector.onHover(mouseX, mouseY);
  rightClassSelector.onHover(mouseX, mouseY);
}
