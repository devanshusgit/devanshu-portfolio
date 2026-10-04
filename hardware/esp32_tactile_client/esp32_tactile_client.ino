/*
 * NeuroGrip - ESP32 tactile sensor client (REFERENCE SKETCH, NOT VALIDATED HARDWARE)
 *
 * Shows how a real fingertip sensor node would feed the existing software stack:
 *
 *   Real sensors -> ESP32 (this sketch) -> POST /api/sensors/data -> LiveSensorProvider
 *   -> same validation / preprocessing / random forest / grip engine as the simulator
 *
 * Only the sensor provider changes; the ML, grip and 3D layers stay untouched.
 *
 * The read*() functions below are placeholders. Mapping raw ADC values to kPa, °C,
 * Hz, S/m and seconds requires calibrating the actual transducers (e.g. FSR or
 * capacitive pressure array, NTC thermistor, MEMS accelerometer FFT, electrode
 * conductance, contact-onset timer). Driving real motors would additionally require
 * a hardware safety layer (current limiting, watchdog, mechanical end stops).
 *
 * Libraries: WiFi.h, HTTPClient.h (ESP32 Arduino core), ArduinoJson >= 7.
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";
const char* API_URL = "http://192.168.1.50:8000/api/sensors/data";
const char* DEVICE_KEY = "change-me";          // must equal SENSOR_DEVICE_KEY on the server
const char* DEVICE_ID = "esp32-fingertip-01";
const uint32_t SAMPLE_PERIOD_MS = 250;         // 4 Hz

// ---- placeholder sensor reads: replace with calibrated measurements ----------
float readPressureKPa()        { return analogRead(34) * 0.1f; }      // FSR via divider
float readTemperatureC()       { return 20.0f + analogRead(35) * 0.004f; } // NTC
float readVibrationHz()        { return 0.0f; }   // dominant FFT bin of accelerometer burst
float readConductivitySm()     { return 1e-12f; } // electrode conductance -> S/m (log-scale!)
float readContactDurationS()   { return 0.0f; }   // time for pressure to settle within 2 %

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print('.'); }
  Serial.println("\nWiFi connected");
}

void loop() {
  static uint32_t last = 0;
  if (millis() - last < SAMPLE_PERIOD_MS) return;
  last = millis();

  float pressure = readPressureKPa();
  if (pressure < 5.0f) return;  // no contact: do not stream idle readings

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  JsonObject s = doc["samples"].add<JsonObject>();
  s["pressure"] = pressure;
  s["temperature"] = readTemperatureC();
  s["vibration"] = readVibrationHz();
  s["conductivity"] = readConductivitySm();
  s["contact_duration"] = readContactDurationS();

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = http.POST(body);
  if (code == 200) {
    JsonDocument resp;
    deserializeJson(resp, http.getString());
    // The server returns the grip decision; a future motor controller would act on it
    // only after its own independent safety checks.
    float grip = resp["results"][0]["prediction"]["grip_percent"] | -1.0f;
    Serial.printf("grip command: %.1f %% (normalised)\n", grip);
  } else {
    Serial.printf("POST failed: %d\n", code);
  }
  http.end();
}
