#include <Servo.h>

int servoPin = 9;
int middlePos = 60;
int leftPos = 0;
int rightPos = 180;

Servo servo;

void setup()
{
  servo.attach(servoPin);
  servo.write(middlePos);
  Serial.begin(9600);
  while (!Serial)
  {
    ;
  }
  Serial.println("Sorter initialized.");
}

void loop()
{
  if (Serial.available() > 0)
  {
    char command = Serial.read();

    if (command == '1')
    {
      Serial.println("Class 1 detected");
      servo.write(leftPos);
      delay(2000);
      servo.write(middlePos);
      delay(1000);
    }
    else if (command == '2')
    {
      Serial.println("Class 2 detected");
      servo.write(rightPos);
      delay(2000);
      servo.write(middlePos);
      delay(1000);
    }
  }
}
