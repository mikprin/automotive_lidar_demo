#include <Arduino.h>
#include <WiFi.h>
#include <AsyncMqttClient.h>

// Include WiFi configuration
#include "wifi_config.h"  // Contains WIFI_SSID and WIFI_PASS

// ----- MQTT Settings -----
#define MQTT_HOST       IPAddress(192, 168, 8, 212)  // or use your broker IP
#define MQTT_PORT       1883
#define TOPIC_LIDAR     "/esp32/lidar/distance"

// ----- Lidar Settings -----
#define LIDAR_BAUD      115200
#define HEADER          0x59

// ----- UART for Lidar -----
// Adjust these pins based on your ESP32 board wiring
#define LIDAR_RX_PIN    16
#define LIDAR_TX_PIN    17

#define DATA_SEND_PERIOD_ms 400  // Send data every 200ms

// Create an instance for Lidar on UART2
HardwareSerial LidarSerial(2);  // Use UART2 on the ESP32

// ----- Global MQTT Client & Timers -----
AsyncMqttClient mqttClient;
TimerHandle_t mqttReconnectTimer;
TimerHandle_t wifiReconnectTimer;

// ----- Global variables for Lidar data -----
SemaphoreHandle_t lidarDataMutex;  // Mutex for protecting access to shared data
volatile uint16_t distance = 0;
volatile uint16_t strength = 0;
volatile float temperature = 0.0f;

// ----- Forward Declarations -----
void connectToMqtt();
void connectToWifi();
void lidarTask(void *parameter);
void sendLidarDataTask(void *parameter);

// ----- MQTT Callbacks -----
void onMqttConnect(bool sessionPresent) {
  Serial.println("[MQTT] Connected to broker!");
  // (Subscribe to topics here if needed)
}

void onMqttDisconnect(AsyncMqttClientDisconnectReason reason) {
  Serial.printf("[MQTT] Disconnected. Reason: %d\n", (int)reason);
  // Try reconnecting after a delay
  xTimerStart(mqttReconnectTimer, 0);
}

// ----- WiFi Event Handler -----
void WiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case SYSTEM_EVENT_STA_GOT_IP:
      Serial.println("[WiFi] Connected.");
      connectToMqtt();
      break;
    case SYSTEM_EVENT_STA_DISCONNECTED:
      Serial.println("[WiFi] Disconnected.");
      xTimerStart(wifiReconnectTimer, 0);
      break;
    default:
      break;
  }
}

bool readTF02ProData(uint16_t &distance, uint16_t &strength, float &temperature) {
  static uint8_t buf[9];

  // We need at least 9 bytes available to parse a full frame
  if (LidarSerial.available() < 9) {
    return false;
  }

  // Search for the frame header 0x59 0x59
  while (LidarSerial.available() >= 9) {
    if ((uint8_t)LidarSerial.peek() == 0x59) {
      buf[0] = LidarSerial.read();
      if (LidarSerial.peek() == 0x59) {
        buf[1] = LidarSerial.read();

        // Read the remaining 7 bytes
        for (int i = 2; i < 9; i++) {
          buf[i] = LidarSerial.read();
        }

        // Verify checksum (sum of bytes [0..7], then & 0xFF, should match buf[8])
        uint16_t sum = 0;
        for (int i = 0; i < 8; i++) {
          sum += buf[i];
        }
        sum &= 0xFF;

        if (sum == buf[8]) {
          // Parse distance (cm)
          distance = (uint16_t)(buf[2] | (buf[3] << 8));

          // Parse signal strength
          strength = (uint16_t)(buf[4] | (buf[5] << 8));

          // Parse temperature
          // According to your document: temperature(°C) = Temp / 8 - 256
          uint16_t tempRaw = (uint16_t)(buf[6] | (buf[7] << 8));
          temperature = (tempRaw / 8.0f) - 256.0f;

          return true;  // Successfully parsed a valid frame
        } else {
          // If checksum fails, continue searching
          continue;
        }
      }
    } else {
      // Discard this byte and keep looking for 0x59
      LidarSerial.read();
    }
  }

  return false;
}

// ----- FreeRTOS Task: LIDAR Reader -----
void lidarTask(void *parameter) {
  uint16_t localDistance = 0;
  uint16_t localStrength = 0;
  float localTemperature = 0.0f;
  
  for (;;) {
    // Attempt to read data frame from TF02-Pro
    if (readTF02ProData(localDistance, localStrength, localTemperature)) {
      // Take mutex before updating shared variables
      if (xSemaphoreTake(lidarDataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        distance = localDistance;
        strength = localStrength;
        temperature = localTemperature;
        xSemaphoreGive(lidarDataMutex);
      }
    }
    
    // Short delay to allow other tasks to run, but keep reading frequently
    vTaskDelay(10 / portTICK_PERIOD_MS);
  }
}

// ----- FreeRTOS Task: Send Lidar Data -----
void sendLidarDataTask(void *parameter) {
  uint16_t localDistance = 0;
  uint16_t localStrength = 0;
  float localTemperature = 0.0f;
  
  for (;;) {
    // Get the latest data with mutex protection
    if (xSemaphoreTake(lidarDataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
      localDistance = distance;
      localStrength = strength;
      localTemperature = temperature;
      xSemaphoreGive(lidarDataMutex);
      
      // Print out the results to Serial
      Serial.print("Distance: ");
      Serial.print(localDistance);
      Serial.print(" cm, Strength: ");
      Serial.print(localStrength);
      Serial.print(", Temp: ");
      Serial.print(localTemperature);
      Serial.println(" °C");
      
      // Send to MQTT if connected
      if (mqttClient.connected()) {
        char payload[10];
        sprintf(payload, "%d", localDistance);
        mqttClient.publish(TOPIC_LIDAR, 0, false, payload);
      }
    }
    
    // Send data at a lower frequency (e.g., every 200ms)
    vTaskDelay(DATA_SEND_PERIOD_ms / portTICK_PERIOD_MS);
  }
}

// ----- Setup Function -----
void setup() {
  // Initialize debug serial
  Serial.begin(115200);
  Serial.println("ESP32 LIDAR MQTT Demo");

  // Initialize Lidar serial on UART2 with specified pins
  LidarSerial.begin(LIDAR_BAUD, SERIAL_8N1, LIDAR_RX_PIN, LIDAR_TX_PIN);

  // Create mutex for protecting shared data
  lidarDataMutex = xSemaphoreCreateMutex();
  
  // Setup WiFi events and connect
  WiFi.onEvent(WiFiEvent);
  connectToWifi();

  // Setup MQTT client
  mqttClient.onConnect(onMqttConnect);
  mqttClient.onDisconnect(onMqttDisconnect);
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);

  // Create FreeRTOS timers for reconnecting
  mqttReconnectTimer = xTimerCreate("mqttTimer", pdMS_TO_TICKS(2000), pdFALSE, (void*)0, 
    [](TimerHandle_t xTimer) { connectToMqtt(); });
  wifiReconnectTimer = xTimerCreate("wifiTimer", pdMS_TO_TICKS(2000), pdFALSE, (void*)0, 
    [](TimerHandle_t xTimer) { connectToWifi(); });

  // Create the FreeRTOS tasks
  xTaskCreate(
    lidarTask,           // Task function
    "Lidar Read Task",   // Task name
    4096,                // Stack size (in words)
    NULL,                // Parameter to pass
    2,                   // Priority (higher than send task)
    NULL                 // Task handle
  );
  
  xTaskCreate(
    sendLidarDataTask,   // Task function
    "Send Data Task",    // Task name
    4096,                // Stack size (in words)
    NULL,                // Parameter to pass
    1,                   // Priority (lower than read task)
    NULL                 // Task handle
  );
}

// ----- Loop Function -----
void loop() {
  // Nothing to do here—tasks and asynchronous events handle the work.
}

// ----- Helper Functions -----
void connectToMqtt() {
  Serial.println("[MQTT] Attempting connection...");
  mqttClient.connect();
}

void connectToWifi() {
  Serial.println("[WiFi] Connecting...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}