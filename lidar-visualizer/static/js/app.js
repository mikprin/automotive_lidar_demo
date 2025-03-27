/**
 * Lidar Data Visualizer - Frontend Application
 */

// Configuration
const config = {
    wsUrl: window.location.protocol === 'https:' 
      ? `wss://${window.location.host}/ws` 
      : `ws://${window.location.host}/ws`,
    apiUrl: '/api',
    maxDataPoints: 100,
    updateInterval: 1000,
    alertThresholds: {
      close: 30,    // cm - Alert when object is too close
      far: 300      // cm - Alert when object is too far
    }
  };
  
  // Application state
  const state = {
    connected: false,
    dataPoints: [],
    socket: null,
    lastDataTimestamp: null,
    statistics: {
      min: null,
      max: null,
      avg: null,
      count: 0
    }
  };
  
  // DOM elements
  const elements = {
    currentValue: document.getElementById('current-value'),
    lastUpdated: document.getElementById('last-updated'),
    minValue: document.getElementById('min-value'),
    maxValue: document.getElementById('max-value'),
    avgValue: document.getElementById('avg-value'),
    readingCount: document.getElementById('reading-count'),
    connectionStatus: document.getElementById('connection-status'),
    dataFlowStatus: document.getElementById('data-flow-status'),
    alertStatus: document.getElementById('alert-status'),
    dataTableBody: document.getElementById('data-table-body'),
    distanceChart: document.getElementById('distanceChart')
  };
  
  // Initialize Chart.js
  const ctx = elements.distanceChart.getContext('2d');
  const distanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Distance (cm)',
        data: [],
        borderColor: '#4f6df5',
        backgroundColor: 'rgba(79, 109, 245, 0.1)',
        borderWidth: 2,
        pointBackgroundColor: '#4f6df5',
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#a0a0a0'
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#1e1e1e',
          titleColor: '#e1e1e1',
          bodyColor: '#e1e1e1',
          borderColor: 'rgba(79, 109, 245, 0.3)',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#a0a0a0'
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#a0a0a0'
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          }
        }
      },
      interaction: {
        mode: 'nearest',
        intersect: false
      },
      animation: {
        duration: 300
      }
    }
  });
  
  // Connect to WebSocket
  function connectWebSocket() {
    if (state.socket) {
      state.socket.close();
    }
  
    state.socket = new WebSocket(config.wsUrl);
    
    // WebSocket event handlers
    state.socket.onopen = () => {
      console.log('WebSocket connected');
      state.connected = true;
      updateConnectionStatus(true);
    };
    
    state.socket.onclose = () => {
      console.log('WebSocket disconnected');
      state.connected = false;
      updateConnectionStatus(false);
      // Try to reconnect after a delay
      setTimeout(connectWebSocket, 3000);
    };
    
    state.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      state.connected = false;
      updateConnectionStatus(false);
    };
    
    state.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle different types of messages
        if (data.type === 'history') {
          // Received historical data
          processHistoricalData(data.data);
        } else {
          // Received a new data point
          processNewDataPoint(data);
        }
        
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };
  }
  
  // Process historical data
  function processHistoricalData(history) {
    if (!history || !history.length) return;
    
    // Store the data points
    state.dataPoints = history;
    
    // Update the chart with all data
    updateChart();
    
    // Update statistics
    calculateStatistics();
    
    // Update the table with recent entries
    updateDataTable();
    
    // Update the latest value display
    const latestData = history[history.length - 1];
    updateCurrentValueDisplay(latestData);
  }
  
  // Process a new data point
  function processNewDataPoint(data) {
    // Add to the data points array
    state.dataPoints.push(data);
    
    // Keep array size within limits
    if (state.dataPoints.length > config.maxDataPoints) {
      state.dataPoints.shift();
    }
    
    // Update last data timestamp
    state.lastDataTimestamp = new Date();
    
    // Update data flow status
    updateDataFlowStatus(true);
    
    // Update the current value display
    updateCurrentValueDisplay(data);
    
    // Update the chart
    updateChart();
    
    // Update statistics
    calculateStatistics();
    
    // Update the data table
    updateDataTable();
    
    // Check for alerts
    checkAlertConditions(data.value);
  }
  
  // Update the chart with current data
  function updateChart() {
    // Format chart data
    const chartData = {
      labels: state.dataPoints.map(d => {
        const date = new Date(d.timestamp);
        return moment(date).format('HH:mm:ss');
      }),
      values: state.dataPoints.map(d => d.value)
    };
    
    // Update chart datasets
    distanceChart.data.labels = chartData.labels;
    distanceChart.data.datasets[0].data = chartData.values;
    
    // Update chart
    distanceChart.update();
  }
  
  // Calculate statistics
  function calculateStatistics() {
    if (!state.dataPoints.length) return;
    
    const values = state.dataPoints.map(d => d.value);
    
    // Calculate min, max, avg
    state.statistics.min = Math.min(...values);
    state.statistics.max = Math.max(...values);
    state.statistics.avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    state.statistics.count = values.length;
    
    // Update DOM elements
    elements.minValue.textContent = state.statistics.min.toFixed(1);
    elements.maxValue.textContent = state.statistics.max.toFixed(1);
    elements.avgValue.textContent = state.statistics.avg.toFixed(1);
    elements.readingCount.textContent = state.statistics.count;
  }
  
  // Update the data table
  function updateDataTable() {
    // Get the 10 most recent data points
    const recentData = [...state.dataPoints].reverse().slice(0, 10);
    
    // Clear existing table
    elements.dataTableBody.innerHTML = '';
    
    // Add rows for recent data
    recentData.forEach(data => {
      const row = document.createElement('tr');
      
      // Format timestamp
      const timestamp = moment(new Date(data.timestamp)).format('HH:mm:ss');
      
      // Determine status
      let status = 'Normal';
      let statusClass = 'bg-gray-700 text-gray-300';
      
      if (data.value < config.alertThresholds.close) {
        status = 'Too Close';
        statusClass = 'bg-red-900 text-red-300';
      } else if (data.value > config.alertThresholds.far) {
        status = 'Too Far';
        statusClass = 'bg-yellow-900 text-yellow-300';
      }
      
      // Create row content
      row.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap">${timestamp}</td>
        <td class="px-6 py-4 whitespace-nowrap">${data.value.toFixed(1)}</td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
            ${status}
          </span>
        </td>
      `;
      
      elements.dataTableBody.appendChild(row);
    });
  }
  
  // Update the current value display
  function updateCurrentValueDisplay(data) {
    elements.currentValue.textContent = data.value.toFixed(1);
    elements.lastUpdated.textContent = moment(new Date(data.timestamp)).format('HH:mm:ss');
    
    // Add animation class and remove after animation completes
    elements.currentValue.classList.add('value-change');
    setTimeout(() => {
      elements.currentValue.classList.remove('value-change');
    }, 1500);
  }
  
  // Check for alert conditions
  function checkAlertConditions(value) {
    let alertStatus = 'Normal';
    let alertClass = 'bg-gray-700 text-gray-300';
    
    if (value < config.alertThresholds.close) {
      alertStatus = 'Object Too Close';
      alertClass = 'bg-red-900 text-red-300';
    } else if (value > config.alertThresholds.far) {
      alertStatus = 'Object Too Far';
      alertClass = 'bg-yellow-900 text-yellow-300';
    }
    
    // Update alert status display
    elements.alertStatus.textContent = alertStatus;
    elements.alertStatus.className = 'px-3 py-1 rounded-full text-sm';
    
    // Add appropriate classes
    const classes = alertClass.split(' ');
    classes.forEach(cls => elements.alertStatus.classList.add(cls));
  }
  
  // Update connection status display
  function updateConnectionStatus(connected) {
    if (connected) {
      elements.connectionStatus.textContent = 'Connected';
      elements.connectionStatus.className = 'px-3 py-1 rounded-full text-sm bg-green-900 text-green-300';
    } else {
      elements.connectionStatus.textContent = 'Disconnected';
      elements.connectionStatus.className = 'px-3 py-1 rounded-full text-sm bg-red-900 text-red-300';
    }
  }
  
  // Update data flow status display
  function updateDataFlowStatus(active) {
    const now = new Date();
    const dataAge = state.lastDataTimestamp ? now - state.lastDataTimestamp : null;
    
    if (active || (dataAge && dataAge < 5000)) {
      elements.dataFlowStatus.textContent = 'Active';
      elements.dataFlowStatus.className = 'px-3 py-1 rounded-full text-sm bg-blue-900 text-blue-300';
    } else {
      elements.dataFlowStatus.textContent = 'Inactive';
      elements.dataFlowStatus.className = 'px-3 py-1 rounded-full text-sm bg-yellow-900 text-yellow-300';
    }
  }
  
  // Check data flow status periodically
  function startDataFlowMonitor() {
    setInterval(() => {
      if (state.lastDataTimestamp) {
        const now = new Date();
        const dataAge = now - state.lastDataTimestamp;
        
        // If no data received for more than 5 seconds, mark as inactive
        if (dataAge > 5000) {
          updateDataFlowStatus(false);
        }
      }
    }, 2000);
  }
  
  // Initialize the application
  function init() {
    // Connect to WebSocket
    connectWebSocket();
    
    // Start monitoring data flow
    startDataFlowMonitor();
    
    // Fetch initial data via REST API
    fetch(`${config.apiUrl}/data/history`)
      .then(response => response.json())
      .then(data => {
        if (data && data.length) {
          processHistoricalData(data);
        }
      })
      .catch(error => {
        console.error('Error fetching initial data:', error);
      });
  }
  
  // Start the application when DOM is loaded
  document.addEventListener('DOMContentLoaded', init);