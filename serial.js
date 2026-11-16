function waitForElement(selector, callback) {
  const interval = setInterval(() => {
    const element = document.querySelector(selector);
    if (element) {
      clearInterval(interval);
      callback(element);
    }
  }, 100);
}

(function () {
  'use strict';

  waitForElement("#connect", (connectButton) => {
    console.log("connectButton: ", connectButton);
    let isBusy = false;

    function resetButton() {
      connectButton.textContent = 'CONNECT ARDUINO';
    }

    function connect() {
      return port.connect().then(() => {
        connectButton.textContent = 'DISCONNECT';

        const textDecoder = new TextDecoder();
        port.onReceive = data => {
          console.log(textDecoder.decode(data, { stream: true }));
        };

        port.onReceiveError = error => {
          console.error(error);
        };
      }).catch(error => {
        console.error(error);
        alert('Could not connect to Arduino: ' + error.message + '\n\nMake sure no other program (such as Arduino IDE Serial Monitor) is using the port.');
        port = null;
        resetButton();
      });
    }

    if ('serial' in navigator) {
      navigator.serial.addEventListener('disconnect', (event) => {
        if (port && port.port_ === event.target) {
          port.disconnect().finally(() => {
            port = null;
            resetButton();
          });
        }
      });
    }

    try {
      connectButton.addEventListener('click', () => {
        if (isBusy) return;

        if (port) {
          isBusy = true;
          port.disconnect().finally(() => {
            port = null;
            resetButton();
            isBusy = false;
          });
        } else {
          isBusy = true;
          serial.requestPort().then(selectedPort => {
            port = selectedPort;
            return connect();
          }).catch(error => {
            if (error && error.name !== 'NotFoundError') {
              console.error(error);
            }
            port = null;
            resetButton();
          }).finally(() => {
            isBusy = false;
          });
        }
      });
    } catch (e) {
      console.log("p5 sketch not loaded yet: ", e);
    }
  });
})();

// Web Serial wrapper matching the serial.Port interface
var serial = {};

(function () {
  'use strict';

  serial.getPorts = function () {
    if (!('serial' in navigator)) {
      return Promise.resolve([]);
    }
    return navigator.serial.getPorts().then(ports => {
      return ports.map(port => new serial.Port(port));
    });
  };

  serial.requestPort = function () {
    if (!('serial' in navigator)) {
      alert('Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera over HTTPS (or localhost).');
      return Promise.reject(new Error('Web Serial API not supported'));
    }
    const filters = [
      { usbVendorId: 0x2341 }, // Arduino LLC / Arduino SA
      { usbVendorId: 0x2A03 }, // Arduino Srl
    ];
    return navigator.serial.requestPort({ filters: filters }).then(
      port => new serial.Port(port)
    );
  };

  serial.Port = function (port) {
    this.port_ = port;
    this.reader_ = null;
    this.writer_ = null;
    this.readLoopPromise_ = null;
    this.keepReading_ = false;
    this.isClosing_ = false;
    this.onReceive = null;
    this.onReceiveError = null;
  };

  serial.Port.prototype.connect = async function (baudRate = 9600) {
    try {
      await this.port_.open({ baudRate: baudRate });

      try {
        await this.port_.setSignals({ dataTerminalReady: true, requestToSend: false });
      } catch (e) {
        // Ignore if the serial adapter/driver does not support setting control signals
      }

      if (this.port_.writable) {
        this.writer_ = this.port_.writable.getWriter();
      }

      this.keepReading_ = true;
      this.readLoopPromise_ = this.readLoop_();
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  };

  serial.Port.prototype.readLoop_ = async function () {
    while (this.port_.readable && this.keepReading_) {
      this.reader_ = this.port_.readable.getReader();
      try {
        while (this.keepReading_) {
          const { value, done } = await this.reader_.read();
          if (done) {
            break;
          }
          if (value && this.onReceive) {
            this.onReceive(value);
          }
        }
      } catch (error) {
        if (this.keepReading_ && this.onReceiveError) {
          this.onReceiveError(error);
        }
        break;
      } finally {
        if (this.reader_) {
          this.reader_.releaseLock();
          this.reader_ = null;
        }
      }
    }
  };

  serial.Port.prototype.disconnect = async function () {
    if (this.isClosing_) return;
    this.isClosing_ = true;

    try {
      this.keepReading_ = false;

      if (this.reader_) {
        try {
          await this.reader_.cancel();
        } catch (e) {
          // Ignore errors if the readable stream is already closed or errored
        }
      }

      if (this.readLoopPromise_) {
        try {
          await Promise.race([
            this.readLoopPromise_,
            new Promise(resolve => setTimeout(resolve, 400))
          ]);
        } catch (e) {
          // Ignore read loop termination errors during disconnect
        }
        this.readLoopPromise_ = null;
      }

      if (this.reader_) {
        try {
          this.reader_.releaseLock();
        } catch (e) {
          // Ignore if reader lock is already released
        }
        this.reader_ = null;
      }

      if (this.writer_) {
        try {
          await this.writer_.close();
        } catch (e) {
          try {
            await this.writer_.abort();
          } catch (abortErr) {
            // Ignore abort errors on already-closed streams
          }
        } finally {
          try {
            this.writer_.releaseLock();
          } catch (releaseErr) {
            // Ignore if writer lock is already released
          }
          this.writer_ = null;
        }
      }

      try {
        await this.port_.close();
      } catch (e) {
        // Port may already be closed if physically unplugged
      }
    } finally {
      this.isClosing_ = false;
    }
  };

  serial.Port.prototype.send = function (data) {
    if (!this.writer_) {
      throw new Error('Serial port is not connected');
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return this.writer_.write(bytes);
  };
})();

