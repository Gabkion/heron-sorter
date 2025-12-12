class PhotoGrid {
  constructor(isLeft) {
    this.images = [];
    console.log(this.images.length);
    if (isLeft) {
      this.x = width / 2 - 480;
    } else {
      this.x = width / 2 + 300;
    }

    this.y = height / 2.5;
    this.numRows = 3;
    this.numCols = 2;
    this.imageSize = 120;
    this.padding = 20;
  }

  addImage(img) {
    this.images.push(img);
    if (this.images.length > 9) {
      this.images.shift();
    }
  }

  render() {
    for (let i = 0; i < this.images.length; i++) {
      let currImage = this.images[i];
      let row = i % 3;
      let col = int(i / 3);
      fill(255);
      noStroke();
      rectMode(CORNER);
      rect(this.x + (this.imageSize + this.padding) * col, this.y + (this.imageSize + this.padding) * row,
        this.imageSize, this.imageSize, 3, 3, 3, 3);

      image(currImage, this.x + (this.imageSize + this.padding) * col + 5, this.y + (this.imageSize + this.padding) * row + 5,
        this.imageSize - 10, this.imageSize - 10);
    }
  }
}

class Splash {
  constructor(isLeft) {
    if (isLeft) {
      this.x = width / 2 + 314;
    } else {
      this.x = width / 2 - 314;
    }
    this.y = height / 3.3;
    this.color = color(22, 79, 200);
    this.isExploding = false;
    this.isInbetweenUpdates = false;
    this.explosionRadius = 100;
    this.explosionIndex = 0;
    this.numRadius = 4;
    this.radiusOffset = 10;
    this.width = 243;
    this.height = 53;
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
  }

  trigger() {
    this.isExploding = true;
  }

  updateIndex() {
    this.explosionIndex++;
    this.isInbetweenUpdates = false;
  }

  render() {
    if (!this.isExploding) {
      fill(this.color);
    } else {
      noFill();
      strokeWeight(3);
      stroke(this.color);
      rect(this.x, this.y, this.width + (this.radiusOffset * this.explosionIndex),
        this.height + (this.radiusOffset * this.explosionIndex), 9, 9, 9, 9);
    }

    if (this.isExploding && !this.isInbetweenUpdates) {
      setTimeout(() => {
        this.updateIndex();
      }, 100);
      this.isInbetweenUpdates = true;
    }

    if (this.explosionIndex >= this.numRadius) {
      this.isExploding = false;
      this.isInbetweenUpdates = false;
      this.explosionIndex = 0;
    }
  }
}

class ClassificationBar {
  constructor() {
    this.width = min(width / 4, 341);
    this.height = 28;
    this.x = width / 2;
    this.y = height / 3.3;
    this.radius = 5;

    this.classificationLeft = 0;
    this.classificationMaxWidth = this.width / 2;
    this.classificationRight = 0.0;
    this.hasSetTimeout = false;
  }

  updateClassification(results) {
    const class1 = results.filter(objs => {
      if (objs.label === labels[0]) {
        return objs;
      }
    });

    const class2 = results.filter(objs => {
      if (objs.label === labels[1]) {
        return objs;
      }
    });

    this.classificationLeft = map(class1[0].confidence, 0, 1.0, 0, this.classificationMaxWidth);
    this.classificationRight = map(class2[0].confidence, 0, 1.0, 0, this.classificationMaxWidth);

    let view = new Uint8Array(1);

    if (class1[0].confidence > 0.90) {
      view[0] = 1;
      try {
        port.send(view);
        shouldFreezeFrame = true;
        splashLeft.trigger();
        isLeftPic = false;
      } catch (e) {
        console.error(e);
      }
    } else if (class2[0].confidence > 0.90) {
      view[0] = 2;
      try {
        port.send(view);
        shouldFreezeFrame = true;
        splashRight.trigger();
        isLeftPic = true;
      } catch (e) {}
    }
  }

  render() {
    rectMode(CENTER);
    fill('rgba(174, 203, 250, 0.4)');
    stroke(255);
    strokeWeight(5);
    rect(this.x, this.y, this.width, this.height, this.radius, this.radius, this.radius, this.radius);
    noStroke();

    fill('#1967d2');
    rect(this.x + this.classificationLeft / 2, this.y, this.classificationLeft, this.height, this.radius, this.radius, this.radius, this.radius);
    rect(this.x - this.classificationRight / 2, this.y, this.classificationRight, this.height, this.radius, this.radius, this.radius, this.radius);
    stroke(0);
    strokeWeight(7);
    strokeCap(ROUND);
    line(this.x, this.y - this.height / 2, this.x, this.y + this.height / 2);
  }
}

class ClassInput {
  constructor(isLeft) {
    this.width = 243;
    this.height = 53;
    this.radius = 9;
    this.textLineOffset = 40;
    this.isLeft = isLeft;
    this.hoverOne = false;
    this.hoverTwo = false;
    this.hoverThree = true;
    if (isLeft === true) {
      this.x = width / 2 + 314;
    } else {
      this.x = width / 2 - 314;
    }

    this.y = height / 3.3;
    this.isActive = false;
    this.currentValue = null;
  }

  onClick(x, y) {
    const leftBound = this.x - this.width / 2;
    const rightBound = this.x + this.width / 2;
    const bottomBound = this.y + this.height / 2;
    const topBound = this.y - this.height / 2;
    const isInside = (x >= leftBound && x <= rightBound && y <= bottomBound && y >= topBound);

    if (isInside) {
      const currentLabel = this.isLeft ? labels[0] : labels[1];
      const newLabel = prompt(`Enter new name for "${currentLabel}":`, currentLabel);
      
      if (newLabel !== null && newLabel.trim() !== '') {
        if (this.isLeft) {
          labels[0] = newLabel.trim();
        } else {
          labels[1] = newLabel.trim();
        }
      }
    }
  }

  onHover(x, y) {
    this.detectZone(x, y);
  }

  detectZone(x, y) {
    const leftBound = this.x - this.width / 2;
    const rightBound = this.x + this.width / 2;
    const bottomBound = this.y + this.height / 2;
    const topBound = this.y - this.height / 2;

    if (x >= leftBound && x <= rightBound && y <= bottomBound && y >= topBound) {
      this.hoverOne = true;
      cursor(HAND);
    } else {
      this.hoverOne = false;
    }
  }

  render() {
    if (isModelLoaded) {
      fill(255);
      rectMode(CENTER);
      noStroke();
      textFont(poppinsBold);
      textSize(24);
      rect(this.x, this.y, this.width, this.height, this.radius, this.radius, this.radius, this.radius);

      if (labels.length >= 2) {
        fill('#1967D2');
        if (this.isLeft) {
          textAlign(LEFT, CENTER);
          text(labels[0], this.x - this.width / 2 + 10, this.y - 4);
          
          // Tint pencil icon based on hover state
          if (this.hoverOne) {
            tint(25, 103, 210); // Blue tint when hovering
          } else {
            tint(180, 180, 180); // Gray tint when not hovering
          }
          image(pencil, this.x - this.width / 2 + 200, this.y - this.height / 2 + 10, pencil.width / 2, pencil.height / 2);
          noTint();
        } else {
          textAlign(RIGHT, CENTER);
          text(labels[1], this.x + this.width / 2 - 13, this.y - 4);
          
          // Tint pencil icon based on hover state
          if (this.hoverOne) {
            tint(25, 103, 210); // Blue tint when hovering
          } else {
            tint(180, 180, 180); // Gray tint when not hovering
          }
          image(pencil, this.x + this.width / 2 - 235, this.y - this.height / 2 + 10, pencil.width / 2, pencil.height / 2);
          noTint();
        }
      }
    }
  }
}
