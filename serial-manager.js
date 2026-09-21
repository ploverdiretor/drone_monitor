// 状態管理用変数
let port = null;
let writer = null;
let activeReader = null; 
let keepReading = true;
let readerPromise = null; 
let closedPromise = null;
let receivedBuffer = ""; 

let lastSendTime = 0;
let throttleTimeout = null;

// 初期データ (4モーター分)
const sliderData =[48, 48, 48, 48]; // 初期値を48に設定

// 【修正】マイナス値にも対応した16進数表示関数
function updateSliderDisplay(displayElement, value) {
    const numValue = Math.trunc(Number(value));
    let hexStr = "";

    if (numValue < 0) {
        hexStr = "-0x" + Math.abs(numValue).toString(16).toUpperCase().padStart(3, '0');
    } else {
        hexStr = "0x" + numValue.toString(16).toUpperCase().padStart(3, '0');
    }
    
    displayElement.innerText = `${numValue} (${hexStr})`;
}

// 接続処理
async function connectSerial(statusDiv, connectBtn, disconnectBtn) {
    if (!('serial' in navigator)) {
        alert('Web Serial API非対応のブラウザです。ChromeかEdgeを使用してください。');
        return;
    }
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        writer = port.writable.getWriter();

        statusDiv.innerText = 'ステータス: 接続済み (115200 bps)';
        statusDiv.style.color = 'green';
        
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;

        keepReading = true;
        readerPromise = readFromSerial();
    } catch (error) {
        console.error('接続エラー:', error);
        statusDiv.innerText = 'ステータス: 接続失敗';
        statusDiv.style.color = 'red';
    }
}

// 切断処理
async function disconnectSerial(statusDiv, connectBtn, disconnectBtn) {
    if (!port) return;

    try {
        statusDiv.innerText = 'ステータス: 切断中...';
        statusDiv.style.color = 'orange';

        keepReading = false;

        if (activeReader) {
            await activeReader.cancel().catch(() => {});
        }

        if (closedPromise) {
            await closedPromise.catch(() => {});
        }

        if (readerPromise) {
            await readerPromise;
        }

        if (writer) {
            await writer.close().catch(() => {});
            writer.releaseLock();
            writer = null;
        }

        await port.close();
        port = null;

        statusDiv.innerText = 'ステータス: 切断されました';
        statusDiv.style.color = 'gray';
        
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;

        activeReader = null;
        readerPromise = null;
        closedPromise = null;

    } catch (error) {
        console.error('切断エラー:', error);
        statusDiv.innerText = 'ステータス: 切断エラー';
        statusDiv.style.color = 'red';
    }
}

// 9バイト固定バイナリデータ送信（sliderDataの最新値を送信）
async function executeSend() {
    if (!writer) return;

    const packet = new Uint8Array(9);
    packet[0] = 0x7E; 

    sliderData.forEach((val, i) => {
        packet[1 + i * 2] = (val >> 6) & 0x3F; 
        packet[2 + i * 2] = val & 0x3F;        
    });

    try {
        await writer.write(packet);
    } catch (error) {
        console.error('送信エラー:', error);
    }
}

// 20msスロットル関数
function sendSliderDataThrottled() {
    const now = performance.now();
    const remaining = 20 - (now - lastSendTime);

    if (throttleTimeout) clearTimeout(throttleTimeout);

    if (remaining <= 0) {
        lastSendTime = now;
        executeSend();
    } else {
        throttleTimeout = setTimeout(() => {
            lastSendTime = performance.now();
            executeSend();
        }, remaining);
    }
}

// 特定値の強制送信（9バイト固定）
async function numSend(input) {
    if (!writer) return;

    const packet = new Uint8Array(9);
    packet[0] = 0x7E; 

    // main.js側のUIに依存させず固定4回ループでパケット作成
    for (let i = 0; i < 4; i++) {
        packet[1 + i * 2] = 0; 
        packet[2 + i * 2] = input & 0x3F; // 安全のため下位6bitにマスク
    }

    try {
        await writer.write(packet);
    } catch (error) {
        console.error('送信エラー:', error);
    }
}

// マイコンからのデータ受信関数
async function readFromSerial() {
    const outputArea = document.getElementById('outputArea');
    while (port && port.readable && keepReading) {
        const textDecoder = new TextDecoderStream();
        closedPromise = port.readable.pipeTo(textDecoder.writable);
        activeReader = textDecoder.readable.getReader();

        try {
            while (keepReading) {
                const { value, done } = await activeReader.read();
                if (done) break;
                if (value) {
                    receivedBuffer += value;
                    if (receivedBuffer.includes('\n')) {
                        const lines = receivedBuffer.split('\n');
                        receivedBuffer = lines.pop(); 

                        for (const line of lines) {
                            const cleanLine = line.trim();
                            
                            if (cleanLine.startsWith("RECV:")) {
                                const rawValues = cleanLine.replace("RECV:", "").split(',');
                                if (rawValues.length === 4) {
                                    const hexLine = rawValues.map(v => {
                                        const num = Number(v.trim());
                                        return isNaN(num) ? "0x???" : "0x" + Math.trunc(num).toString(16).toUpperCase().padStart(3, '0');
                                    }).join(', ');

                                    if (outputArea) {
                                        outputArea.value += `[モータースロットル] ${hexLine}\n`;
                                        outputArea.scrollTop = outputArea.scrollHeight;
                                    }
                                }
                            }
                            else if (cleanLine.startsWith("STR:")) {
                                const strMessage = cleanLine.replace("STR:", "").trim();
                                if (outputArea) {
                                    outputArea.value += `[文字列] ${strMessage}\n`;
                                    outputArea.scrollTop = outputArea.scrollHeight;
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            if (keepReading) console.error('受信エラー:', error);
        } finally {
            if (activeReader) {
                activeReader.releaseLock();
                activeReader = null;
            }
        }
    }
}
