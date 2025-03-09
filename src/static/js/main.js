import { MultimodalLiveClient } from './core/websocket-client.js';
import { AudioStreamer } from './audio/audio-streamer.js';
import { AudioRecorder } from './audio/audio-recorder.js';
import { CONFIG } from './config/config.js';
import { Logger } from './utils/logger.js';
import { VideoManager } from './video/video-manager.js';
import { ScreenRecorder } from './video/screen-recorder.js';

/**
 * @fileoverview Main entry point for the application.
 * Initializes and manages the UI, audio, video, and WebSocket interactions.
 */

// DOM Elements
const logsContainer = document.getElementById('logs-container');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const micButton = document.getElementById('mic-button');
const micIcon = document.getElementById('mic-icon');
const audioVisualizer = document.getElementById('audio-visualizer');
const connectButton = document.getElementById('connect-button');
const cameraButton = document.getElementById('camera-button');
const cameraIcon = document.getElementById('camera-icon');
const stopVideoButton = document.getElementById('stop-video');
const screenButton = document.getElementById('screen-button');
const screenIcon = document.getElementById('screen-icon');
const screenContainer = document.getElementById('screen-container');
const screenPreview = document.getElementById('screen-preview');
const inputAudioVisualizer = document.getElementById('input-audio-visualizer');
const apiKeyInput = document.getElementById('api-key');
const voiceSelect = document.getElementById('voice-select');
const fpsInput = document.getElementById('fps-input');
const configToggle = document.getElementById('config-toggle');
const configContainer = document.getElementById('config-container');
const systemInstructionInput = document.getElementById('system-instruction');
systemInstructionInput.value = CONFIG.SYSTEM_INSTRUCTION.TEXT;
const applyConfigButton = document.getElementById('apply-config');
const responseTypeSelect = document.getElementById('response-type-select');

// Load saved values from localStorage
const savedApiKey = localStorage.getItem('gemini_api_key');
const savedVoice = localStorage.getItem('gemini_voice');
const savedFPS = localStorage.getItem('video_fps');
const savedSystemInstruction = localStorage.getItem('system_instruction');


if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
}
if (savedVoice) {
    voiceSelect.value = savedVoice;
}

if (savedFPS) {
    fpsInput.value = savedFPS;
}
if (savedSystemInstruction) {
    systemInstructionInput.value = savedSystemInstruction;
    CONFIG.SYSTEM_INSTRUCTION.TEXT = savedSystemInstruction;
}

// Handle configuration panel toggle
configToggle.addEventListener('click', () => {
    configContainer.classList.toggle('active');
    configToggle.classList.toggle('active');
});

applyConfigButton.addEventListener('click', () => {
    configContainer.classList.toggle('active');
    configToggle.classList.toggle('active');
});

// State variables
let isRecording = false;
let audioStreamer = null;
let audioCtx = null;
let isConnected = false;
let audioRecorder = null;
let isVideoActive = false;
let videoManager = null;
let isScreenSharing = false;
let screenRecorder = null;
let isUsingTool = false;

// Multimodal Client
const client = new MultimodalLiveClient();

/**
 * Logs a message to the UI.
 * @param {string} message - The message to log.
 * @param {string} [type='system'] - The type of the message (system, user, ai).
 */
function logMessage(message, type = 'system') {
    const logEntry = document.createElement('div');
    logEntry.classList.add('log-entry', type);

    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = new Date().toLocaleTimeString();
    logEntry.appendChild(timestamp);

    const emoji = document.createElement('span');
    emoji.classList.add('emoji');
    switch (type) {
        case 'system':
            emoji.textContent = '⚙️';
            break;
        case 'user':
            emoji.textContent = '🫵';
            break;
        case 'ai':
            emoji.textContent = '🤖';
            break;
    }
    logEntry.appendChild(emoji);

    const messageText = document.createElement('span');
    messageText.textContent = message;
    logEntry.appendChild(messageText);

    logsContainer.appendChild(logEntry);
    logsContainer.scrollTop = logsContainer.scrollHeight;

    // 语音合成
    if (type === 'ai' && responseTypeSelect.value === 'audio') {
        speak(message);
    }
}

/**
 * Updates the microphone icon based on the recording state.
 */
function updateMicIcon() {
    micIcon.textContent = isRecording ? 'mic_off' : 'mic';
    micButton.style.backgroundColor = isRecording ? '#ea4335' : '#4285f4';
}

/**
 * Updates the audio visualizer based on the audio volume.
 * @param {number} volume - The audio volume (0.0 to 1.0).
 * @param {boolean} [isInput=false] - Whether the visualizer is for input audio.
 */
function updateAudioVisualizer(volume, isInput = false) {
    const visualizer = isInput ? inputAudioVisualizer : audioVisualizer;
    const audioBar = visualizer.querySelector('.audio-bar') || document.createElement('div');
    
    if (!visualizer.contains(audioBar)) {
        audioBar.classList.add('audio-bar');
        visualizer.appendChild(audioBar);
    }
    
    audioBar.style.width = `${volume * 100}%`;
    if (volume > 0) {
        audioBar.classList.add('active');
    } else {
        audioBar.classList.remove('active');
    }
}

/**
 * Initializes the audio context and streamer if not already initialized.
 * @returns {Promise<AudioStreamer>} The audio streamer instance.
 */
async function ensureAudioInitialized() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
    if (!audioStreamer) {
        audioStreamer = new AudioStreamer(audioCtx);
        await audioStreamer.addWorklet('vumeter-out', 'js/audio/worklets/vol-meter.js', (ev) => {
            updateAudioVisualizer(ev.data.volume);
        });
    }
    return audioStreamer;
}

/**
 * Handles the microphone toggle. Starts or stops audio recording.
 * @returns {Promise<void>}
 */
async function handleMicToggle() {
    if (!isRecording) {
        try {
            await ensureAudioInitialized();
            audioRecorder = new AudioRecorder();
            
            const inputAnalyser = audioCtx.createAnalyser();
            inputAnalyser.fftSize = 256;
            const inputDataArray = new Uint8Array(inputAnalyser.frequencyBinCount);
            
            await audioRecorder.start((base64Data) => {
                if (isUsingTool) {
                    client.sendRealtimeInput([{
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Data,
                        interrupt: true     // Model isn't interruptable when using tools, so we do it manually
                    }]);
                } else {
                    client.sendRealtimeInput([{
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Data
                    }]);
                }
                
                inputAnalyser.getByteFrequencyData(inputDataArray);
                const inputVolume = Math.max(...inputDataArray) / 255;
                updateAudioVisualizer(inputVolume, true);
            });

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(inputAnalyser);
            
            await audioStreamer.resume();
            isRecording = true;
            Logger.info('Microphone started');
            logMessage('Microphone started', 'system');
            updateMicIcon();
        } catch (error) {
            Logger.error('Microphone error:', error);
            logMessage(`Error: ${error.message}`, 'system');
            isRecording = false;
            updateMicIcon();
        }
    } else {
        if (audioRecorder && isRecording) {
            audioRecorder.stop();
        }
        isRecording = false;
        logMessage('Microphone stopped', 'system');
        updateMicIcon();
        updateAudioVisualizer(0, true);
    }
}

/**
 * Resumes the audio context if it's suspended.
 * @returns {Promise<void>}
 */
async function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
}

/**
 * Connects to the WebSocket server.
 * @returns {Promise<void>}
 */
async function connectToWebsocket() {
    if (!apiKeyInput.value) {
        logMessage('Please input API Key', 'system');
        return;
    }

    // Save values to localStorage
    localStorage.setItem('gemini_api_key', apiKeyInput.value);
    localStorage.setItem('gemini_voice', voiceSelect.value);
    localStorage.setItem('system_instruction', systemInstructionInput.value);

    const config = {
        model: CONFIG.API.MODEL_NAME,
        generationConfig: {
            responseModalities: responseTypeSelect.value,
            speechConfig: {
                voiceConfig: { 
                    prebuiltVoiceConfig: { 
                        voiceName: voiceSelect.value    // You can change voice in the config.js file
                    }
                }
            },

        },
        systemInstruction: {
            parts: [{
                text: systemInstructionInput.value     // You can change system instruction in the config.js file
            }],
        }
    };  

    try {
        await client.connect(config,apiKeyInput.value);
        isConnected = true;
        await resumeAudioContext();
        connectButton.textContent = 'Disconnect';
        connectButton.classList.add('connected');
        messageInput.disabled = false;
        sendButton.disabled = false;
        micButton.disabled = false;
        cameraButton.disabled = false;
        screenButton.disabled = false;
        logMessage('Connected to Gemini 2.0 Flash Multimodal Live API', 'system');
    } catch (error) {
        const errorMessage = error.message || 'Unknown error';
        Logger.error('Connection error:', error);
        logMessage(`Connection error: ${errorMessage}`, 'system');
        isConnected = false;
        connectButton.textContent = 'Connect';
        connectButton.classList.remove('connected');
        messageInput.disabled = true;
        sendButton.disabled = true;
        micButton.disabled = true;
        cameraButton.disabled = true;
        screenButton.disabled = true;
    }
}

/**
 * Disconnects from the WebSocket server.
 */
function disconnectFromWebsocket() {
    client.disconnect();
    isConnected = false;
    if (audioStreamer) {
        audioStreamer.stop();
        if (audioRecorder) {
            audioRecorder.stop();
            audioRecorder = null;
        }
        isRecording = false;
        updateMicIcon();
    }
    connectButton.textContent = 'Connect';
    connectButton.classList.remove('connected');
    messageInput.disabled = true;
    sendButton.disabled = true;
    micButton.disabled = true;
    cameraButton.disabled = true;
    screenButton.disabled = true;
    logMessage('Disconnected from server', 'system');
    
    if (videoManager) {
        stopVideo();
    }
    
    if (screenRecorder) {
        stopScreenSharing();
    }
}

/**
 * Handles sending a text message.
 */
function handleSendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        logMessage(message, 'user');
        client.send({ text: message });
        messageInput.value = '';
    }
}

// Event Listeners
client.on('open', () => {
    logMessage('WebSocket connection opened', 'system');
});

client.on('log', (log) => {
    logMessage(`${log.type}: ${JSON.stringify(log.message)}`, 'system');
});

client.on('close', (event) => {
    logMessage(`WebSocket connection closed (code ${event.code})`, 'system');
});

client.on('audio', async (data) => {
    try {
        await resumeAudioContext();
        const streamer = await ensureAudioInitialized();
        streamer.addPCM16(new Uint8Array(data));
    } catch (error) {
        logMessage(`Error processing audio: ${error.message}`, 'system');
    }
});

client.on('content', (content) => {
    logMessage('收到内容事件', 'system'); // 添加调试信息
    
    // 尝试从content参数中获取文本
    let messageText = '';
    
    if (content && typeof content === 'object') {
        // 如果content是对象，尝试提取text属性
        if (content.text) {
            messageText = content.text;
            logMessage('从content对象中提取文本: ' + messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''), 'system');
        } else if (Array.isArray(content.parts)) {
            // 尝试从parts数组中提取文本
            messageText = content.parts.map(part => part.text || '').join('');
            logMessage('从content.parts中提取文本: ' + messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''), 'system');
        }
    } else if (typeof content === 'string') {
        // 如果content直接是字符串
        messageText = content;
        logMessage('content是字符串: ' + messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''), 'system');
    }
    
    // 如果从content中无法获取文本，尝试从chatHistory中获取
    if (!messageText && client.chatHistory && client.chatHistory.turns) {
        const lastBotMessage = client.chatHistory.turns
            .filter(turn => turn.role === 'bot')
            .map(turn => turn.parts.map(part => part.text || '').join(''))
            .pop();
            
        if (lastBotMessage) {
            messageText = lastBotMessage;
            logMessage('从chatHistory中提取文本: ' + messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''), 'system');
        }
    }
    
    // 如果有文本内容且选择了音频响应模式，则播放语音
    if (messageText && responseTypeSelect.value === 'audio') {
        speak(messageText);
    } else if (!messageText) {
        logMessage('无法获取文本内容进行语音合成', 'system');
    }
});

client.on('interrupted', () => {
    audioStreamer?.stop();
    isUsingTool = false;
    Logger.info('Model interrupted');
    logMessage('Model interrupted', 'system');
});

client.on('setupcomplete', () => {
    logMessage('Setup complete', 'system');
});

client.on('turncomplete', () => {
    isUsingTool = false;
    logMessage('Turn complete', 'system');
});

client.on('error', (error) => {
    if (error instanceof ApplicationError) {
        Logger.error(`Application error: ${error.message}`, error);
    } else {
        Logger.error('Unexpected error', error);
    }
    logMessage(`Error: ${error.message}`, 'system');
});

client.on('message', (message) => {
    if (message.error) {
        Logger.error('Server error:', message.error);
        logMessage(`Server error: ${message.error}`, 'system');
    }
});

sendButton.addEventListener('click', handleSendMessage);
messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        handleSendMessage();
    }
});

micButton.addEventListener('click', handleMicToggle);

connectButton.addEventListener('click', () => {
    if (isConnected) {
        disconnectFromWebsocket();
    } else {
        connectToWebsocket();
    }
});

messageInput.disabled = true;
sendButton.disabled = true;
micButton.disabled = true;
connectButton.textContent = 'Connect';

/**
 * Handles the video toggle. Starts or stops video streaming.
 * @returns {Promise<void>}
 */
async function handleVideoToggle() {
    Logger.info('Video toggle clicked, current state:', { isVideoActive, isConnected });
    
    localStorage.setItem('video_fps', fpsInput.value);

    if (!isVideoActive) {
        try {
            Logger.info('Attempting to start video');
            if (!videoManager) {
                videoManager = new VideoManager();
            }
            
            await videoManager.start(fpsInput.value,(frameData) => {
                if (isConnected) {
                    client.sendRealtimeInput([frameData]);
                }
            });

            isVideoActive = true;
            cameraIcon.textContent = 'videocam_off';
            cameraButton.classList.add('active');
            Logger.info('Camera started successfully');
            logMessage('Camera started', 'system');

        } catch (error) {
            Logger.error('Camera error:', error);
            logMessage(`Error: ${error.message}`, 'system');
            isVideoActive = false;
            videoManager = null;
            cameraIcon.textContent = 'videocam';
            cameraButton.classList.remove('active');
        }
    } else {
        Logger.info('Stopping video');
        stopVideo();
    }
}

/**
 * Stops the video streaming.
 */
function stopVideo() {
    if (videoManager) {
        videoManager.stop();
        videoManager = null;
    }
    isVideoActive = false;
    cameraIcon.textContent = 'videocam';
    cameraButton.classList.remove('active');
    logMessage('Camera stopped', 'system');
}

cameraButton.addEventListener('click', handleVideoToggle);
stopVideoButton.addEventListener('click', stopVideo);

cameraButton.disabled = true;

/**
 * Handles the screen share toggle. Starts or stops screen sharing.
 * @returns {Promise<void>}
 */
async function handleScreenShare() {
    if (!isScreenSharing) {
        try {
            screenContainer.style.display = 'block';
            
            screenRecorder = new ScreenRecorder();
            await screenRecorder.start(screenPreview, (frameData) => {
                if (isConnected) {
                    client.sendRealtimeInput([{
                        mimeType: "image/jpeg",
                        data: frameData
                    }]);
                }
            });

            isScreenSharing = true;
            screenIcon.textContent = 'stop_screen_share';
            screenButton.classList.add('active');
            Logger.info('Screen sharing started');
            logMessage('Screen sharing started', 'system');

        } catch (error) {
            Logger.error('Screen sharing error:', error);
            logMessage(`Error: ${error.message}`, 'system');
            isScreenSharing = false;
            screenIcon.textContent = 'screen_share';
            screenButton.classList.remove('active');
            screenContainer.style.display = 'none';
        }
    } else {
        stopScreenSharing();
    }
}

/**
 * Stops the screen sharing.
 */
function stopScreenSharing() {
    if (screenRecorder) {
        screenRecorder.stop();
        screenRecorder = null;
    }
    isScreenSharing = false;
    screenIcon.textContent = 'screen_share';
    screenButton.classList.remove('active');
    screenContainer.style.display = 'none';
    logMessage('Screen sharing stopped', 'system');
}

screenButton.addEventListener('click', handleScreenShare);
screenButton.disabled = true;

// 语音合成函数
function speak(text) {
    if (!text) {
        logMessage('没有文本内容可以朗读', 'system');
        return;
    }
    
    logMessage('准备朗读文本: ' + text.substring(0, 50) + (text.length > 50 ? '...' : ''), 'system');
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN'; // 设置为中文
    
    // 添加事件处理函数
    utterance.onerror = function(event) {
        logMessage('语音合成错误: ' + event.error, 'system');
    };
    
    utterance.onstart = function() {
        logMessage('语音播放开始', 'system');
    };
    
    utterance.onend = function() {
        logMessage('语音播放结束', 'system');
    };
    
    // 获取所有可用的语音
    const voices = window.speechSynthesis.getVoices();
    logMessage('检测到 ' + voices.length + ' 个可用语音', 'system');
    
    // 如果语音列表为空，等待语音列表加载完成
    if (voices.length === 0) {
        logMessage('等待语音列表加载...', 'system');
        window.speechSynthesis.onvoiceschanged = function() {
            // 语音列表加载完成后重新调用speak函数
            speak(text);
        };
        return;
    }
    
    // 记录所有可用的中文语音
    const chineseVoices = voices.filter(voice => voice.lang.includes('zh'));
    logMessage('可用的中文语音数量: ' + chineseVoices.length, 'system');
    chineseVoices.forEach(voice => {
        logMessage('中文语音: ' + voice.name + ', 语言: ' + voice.lang, 'system');
    });
    
    // 根据 voiceSelect.value 选择语音
    const selectedVoice = voiceSelect.value;
    let voiceFound = false;
    
    if (selectedVoice === 'chinese_voice_1' || selectedVoice === 'chinese_voice_2') {
        // 首先尝试精确匹配配置的语音名称
        const configVoiceName = selectedVoice === 'chinese_voice_1' ? 
            CONFIG.CHINESE_VOICES.CHINESE_VOICE_1.name : 
            CONFIG.CHINESE_VOICES.CHINESE_VOICE_2.name;
        
        // 尝试找到匹配的语音
        for (const voice of voices) {
            if (voice.lang.includes('zh') && voice.name === configVoiceName) {
                utterance.voice = voice;
                logMessage('已选择语音: ' + voice.name, 'system');
                voiceFound = true;
                break;
            }
        }
        
        // 如果没有找到精确匹配的语音，尝试使用任何中文语音
        if (!voiceFound && chineseVoices.length > 0) {
            utterance.voice = chineseVoices[0];
            logMessage('未找到指定语音，使用替代中文语音: ' + chineseVoices[0].name, 'system');
            voiceFound = true;
        }
    }
    
    // 如果没有找到中文语音，使用默认语音
    if (!voiceFound) {
        logMessage('未找到中文语音，使用默认语音', 'system');
    }
    
    // 清空语音合成队列
    speechSynthesis.cancel();
    
    // 设置语音参数
    utterance.rate = 1.0;  // 语速 (0.1 到 10)
    utterance.pitch = 1.0; // 音调 (0 到 2)
    utterance.volume = 1.0; // 音量 (0 到 1)
    
    // 播放语音
    window.speechSynthesis.speak(utterance);
}

function handleServerMessage(event) {
    const message = event.data;
    logMessage('handleServerMessage被调用', 'system'); // 添加调试信息
    logMessage('服务器消息: ' + message, 'system');
    
    // 尝试解析消息内容
    let messageText = '';
    try {
        // 尝试将消息解析为JSON
        const parsedMessage = JSON.parse(message);
        if (parsedMessage && parsedMessage.text) {
            messageText = parsedMessage.text;
            logMessage('从JSON消息中提取文本: ' + messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''), 'system');
        }
    } catch (e) {
        // 如果不是JSON格式，直接使用消息内容
        if (typeof message === 'string') {
            messageText = message;
            logMessage('使用原始消息文本: ' + messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''), 'system');
        }
    }
    
    // 如果无法从消息中获取文本，尝试从chatHistory中获取
    if (!messageText && client.chatHistory && client.chatHistory.turns) {
        const lastBotMessage = client.chatHistory.turns
            .filter(turn => turn.role === 'bot')
            .map(turn => turn.parts.map(part => part.text || '').join(''))
            .pop();
            
        if (lastBotMessage) {
            messageText = lastBotMessage;
            logMessage('从chatHistory中提取文本: ' + messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''), 'system');
        }
    }
    
    // 如果有文本内容且选择了音频响应模式，则播放语音
    if (messageText && responseTypeSelect.value === 'audio') {
        speak(messageText);
    } else if (!messageText) {
        logMessage('无法获取文本内容进行语音合成', 'system');
    }
}
  
