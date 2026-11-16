#include <Servo.h>

#define SERVO_PIN 9
Servo myservo;

int pos = 0;  // variable to store the servo position

int color[3];
int colorIndex;

void setup() {
  colorIndex = 0;
  myservo.attach(SERVO_PIN);
  myservo.write(60);

  Serial.begin(9600);
  while (!Serial) {
    ;
  }
  Serial.write("Sketch begins.\r\n");
  Serial.flush();
}

void loop() {

  if (Serial && Serial.available()) {
    color[colorIndex++] = Serial.read();
    if (colorIndex == 1) {
      if (color[0] == 1) {
        myservo.write(0);
        delay(2000);
        for (pos = 0; pos <= 60; pos += 1) {
          myservo.write(pos);  // tell servo to go to position in variable 'pos'
          delay(5);            // waits 15ms for the servo to reach the position
        }
        delay(1000);
        Serial.write("ceral detected.\r\n");
      }

      else if (color[0] == 2) {
        myservo.write(180);
        delay(2000);
        for (pos = 180; pos >= 60; pos -= 1) {
          myservo.write(pos);  // tell servo to go to position in variable 'pos'
          delay(5);            // waits 15ms for the servo to reach the position
        }
        delay(1000);
        Serial.write("mallow detected.\r\n");
      }
      while (Serial.available()) {
        int throwaway = Serial.read();
        Serial.write("Throwing away.\r\n");
      }

      Serial.flush();
      colorIndex = 0;
    }
  }
}
