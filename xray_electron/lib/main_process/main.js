const {app, BrowserWindow} = require('electron');
const {spawn} = require('child_process');
const path = require('path');
const url = require('url');
const net = require('net');

const SERVER_PATH = path.join(__dirname, '..', '..', '..', 'target', 'debug', 'xray_server');

const SOCKET_PATH = process.env.XRAY_SOCKET_PATH;
if (!SOCKET_PATH) {
  console.error('Missing XRAY_SOCKET_PATH environment variable');
  process.exit(1);
}

const INITIAL_MESSAGE = process.env.XRAY_INITIAL_MESSAGE;

class XrayApplication {
  constructor (serverPath, socketPath) {
    this.serverPath = serverPath;
    this.socketPath = socketPath;
    this.currentMessageFragments = [];
    this.windowsByWorkspaceId = new Map();
    this.readyPromise = new Promise(resolve => app.on('ready', resolve));
  }

  async start (initialMessage) {
    const serverProcess = spawn(this.serverPath, [], {stdio: ['ignore', 'pipe', 'inherit']});
    app.on('before-quit', () => serverProcess.kill());

    let serverStdout = '';
    this.serverSocket = await new Promise((resolve, reject) => {
      serverProcess.stdout.on('data', data => {
        serverStdout += data.toString('utf8');
        if (serverStdout.includes('Listening\n')) {
          const socket = net.connect(SOCKET_PATH, () => resolve(socket));
          socket.on('error', reject);
        }
      });
    })

    serverProcess.on('error', console.error);
    serverProcess.on('exit', () => app.quit());

    this.serverSocket.on('data', this._handleInput.bind(this));
    this._sendMessage({type: 'StartApplication'});

    if (initialMessage) {
      this._sendMessage(JSON.parse(initialMessage));
    }
  }

  _sendMessage (message) {
    this.serverSocket.write(JSON.stringify(message));
    this.serverSocket.write('\n');
  }

  async _handleMessage (message) {
    await this.readyPromise;
    switch (message.type) {
      case 'OpenWindow': {
        const workspaceId = message.workspaceId;
        this._createWindow(workspaceId);
        break;
      }
    }
  }

  _handleInput (input) {
    let searchStartIndex = 0;
    while (searchStartIndex < input.length) {
      const newlineIndex = input.indexOf('\n', searchStartIndex);
      if (newlineIndex !== -1) {
        this.currentMessageFragments.push(input.slice(searchStartIndex, newlineIndex));
        this._handleMessage(JSON.parse(Buffer.concat(this.currentMessageFragments)));
        this.currentMessageFragments.length = 0;
        searchStartIndex = newlineIndex + 1;
      } else {
        this.currentMessageFragments.push(input.slice(searchStartIndex));
        break;
      }
    }
  }

  _createWindow (workspaceId) {
    const window = new BrowserWindow({width: 800, height: 600});
    window.loadURL(url.format({
      pathname: path.join(__dirname, `../../index.html?workspaceId=${workspaceId}&socketPath=${this.socketPath}`),
      protocol: 'file:',
      slashes: true
    }));
    this.windowsByWorkspaceId.set(workspaceId, window);
    window.on('closed', () => this.windowsByWorkspaceId.delete(workspaceId));
  }
}

app.commandLine.appendSwitch("enable-experimental-web-platform-features");

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const application = new XrayApplication(SERVER_PATH, SOCKET_PATH);
application.start(INITIAL_MESSAGE);
