const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Get all listening ports with process information
 * @returns {Promise<Array>} List of ports with PID, process name, port, protocol
 */
async function getOpenPorts() {
  try {
    // Use netstat to get all listening ports
    const { stdout } = await execAsync('netstat -ano', { encoding: 'utf8' });
    
    const lines = stdout.split('\n');
    const ports = [];
    const seenPorts = new Set();
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip headers and empty lines
      if (!trimmed || trimmed.startsWith('Active') || trimmed.startsWith('Proto')) {
        continue;
      }
      
      // Parse netstat output
      // Format: Proto  Local Address  Foreign Address  State  PID
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;
      
      const proto = parts[0];
      const localAddr = parts[1];
      const state = parts[3];
      const pid = parts[4];
      
      // Only get LISTENING connections
      if (state !== 'LISTENING') continue;
      
      // Parse port from local address
      const portMatch = localAddr.match(/:(\d+)$/);
      if (!portMatch) continue;
      
      const port = parseInt(portMatch[1], 10);
      if (isNaN(port) || port === 0) continue;
      
      // Create unique key for port+protocol
      const key = `${proto}-${port}`;
      if (seenPorts.has(key)) continue;
      seenPorts.add(key);
      
      // Get process name
      let processName = 'Unknown';
      try {
        const { stdout: taskOutput } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
        const taskMatch = taskOutput.match(/"([^"]+)"/);
        if (taskMatch) {
          processName = taskMatch[1];
        }
      } catch (error) {
        // If we can't get the process name, use PID
        processName = `Process ${pid}`;
      }
      
      ports.push({
        port,
        protocol: proto,
        pid: parseInt(pid, 10),
        processName,
        address: localAddr
      });
    }
    
    // Sort by port number
    ports.sort((a, b) => a.port - b.port);
    
    return ports;
  } catch (error) {
    console.error('Failed to get open ports:', error);
    throw new Error(`Không lấy được danh sách port: ${error.message}`);
  }
}

/**
 * Kill a process by PID
 * @param {number} pid - Process ID
 * @returns {Promise<Object>} Result with ok and message
 */
async function killProcess(pid) {
  try {
    // Use taskkill with force flag
    await execAsync(`taskkill /F /PID ${pid}`);
    return { ok: true, message: `Đã kill process PID ${pid}` };
  } catch (error) {
    console.error('Failed to kill process:', error);
    
    // Check if it's a permission error
    if (error.message.includes('Access is denied')) {
      throw new Error('Cần quyền Administrator để kill process này');
    }
    
    throw new Error(`Không kill được process: ${error.message}`);
  }
}

/**
 * Kill all processes using a specific port
 * @param {number} port - Port number
 * @returns {Promise<Object>} Result with ok, message, and killed count
 */
async function killPort(port) {
  try {
    const openPorts = await getOpenPorts();
    const matching = openPorts.filter(p => p.port === port);
    
    if (matching.length === 0) {
      return { ok: true, message: `Port ${port} không được sử dụng`, killed: 0 };
    }
    
    const uniquePIDs = [...new Set(matching.map(p => p.pid))];
    
    for (const pid of uniquePIDs) {
      await killProcess(pid);
    }
    
    return { 
      ok: true, 
      message: `Đã kill ${uniquePIDs.length} process(es) đang sử dụng port ${port}`,
      killed: uniquePIDs.length
    };
  } catch (error) {
    console.error('Failed to kill port:', error);
    throw error;
  }
}

/**
 * Find what process is using a specific port
 * @param {number} port - Port number
 * @returns {Promise<Array>} List of processes using this port
 */
async function findPortProcess(port) {
  try {
    const openPorts = await getOpenPorts();
    return openPorts.filter(p => p.port === port);
  } catch (error) {
    console.error('Failed to find port process:', error);
    throw new Error(`Không tìm được process cho port ${port}: ${error.message}`);
  }
}

module.exports = {
  getOpenPorts,
  killProcess,
  killPort,
  findPortProcess
};
