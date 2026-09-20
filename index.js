let port = null;
let writer = null;
let activeReader = null; 
let keepReading = true;
let readerPromise = null; 
let closedPromise = null;
let receivedBuffer = ""; 

let lastSendTime = 0;
let throttleTimeout = null;

const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');
const outputArea = document.getElementById('outputArea');

const sliderAll = document.getElementById('sliderAll');
const valAllDisplay = document.getElementById('valAll');

const sliders = [
    document.getElementById('slider0'),
    document.getElementById('slider1'),
    document.getElementById('slider2'),
    document.getElementById('slider3')
];
const valDisplays = [
    document.getElementById('val0'),
    document.getElementById('val1'),
    document.getElementById('val2'),
    document.getElementById('val3')
];

function updateSliderDisplay(displayElement, value) {
    const hexStr = "0x" + parseInt(value).toString(16).toUpperCase().padStart(3, '0');
    displayElement.innerText = `${value} (${hexStr})`;
}

// 接続処理
connectBtn.addEventListener('click', async () => {
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
});

// 完全に切断する処理 (TransformStreamのパイプライン競合対策を強化)
disconnectBtn.addEventListener('click', async () => {
    if (!port) return;

    try {
        statusDiv.innerText = 'ステータス: 切断中...';
        statusDiv.style.color = 'orange';

        keepReading = false;

        // 1. 受信リーダー側をキャンセルしてストリームのブロックを解く
        if (activeReader) {
            await activeReader.cancel().catch(() => {});
        }

        // 2. pipeTo経由のストリーム完全終了を待つ
        if (closedPromise) {
            await closedPromise.catch(() => {});
        }

        // 3. 受信関数の終了ループ自体を完全に待つ
        if (readerPromise) {
            await readerPromise;
        }

        // 4. 送信用ライターのロック解放と終了
        if (writer) {
            await writer.close().catch(() => {});
            writer.releaseLock();
            writer = null;
        }

        // 5. ポートを安全に閉じる
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
});

// 9バイト固定バイナリデータ送信
async function executeSend() {
    if (!writer) return;

    const packet = new Uint8Array(9);
    packet[0] = 0x7E; 

    sliders.forEach((slider, i) => {
        const val = parseInt(slider.value);
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

// マイコンからのデータ受信関数
/*
async function readFromSerial() {
    while (port && port.readable && keepReading) {
        const textDecoder = new TextDecoderStream();
        // pipeToの戻り値Promiseを保持することで、切断時にロック解放を待てるようにする
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
                                        const num = parseInt(v.trim());
                                        return isNaN(num) ? "0x???" : "0x" + num.toString(16).toUpperCase().padStart(3, '0');
                                    }).join(', ');

                                    outputArea.value += `[復元データ] ${hexLine}\n`;
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
*/
// マイコンからのデータ受信関数
async function readFromSerial() {
    while (port && port.readable && keepReading) {
        const textDecoder = new TextDecoderStream();
        // pipeToの戻り値Promiseを保持することで、切断時にロック解放を待てるようにする
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
                            
                            // 【既存機能】RECV: から始まる数値データの処理
                            if (cleanLine.startsWith("RECV:")) {
                                const rawValues = cleanLine.replace("RECV:", "").split(',');
                                if (rawValues.length === 4) {
                                    const hexLine = rawValues.map(v => {
                                        const num = parseInt(v.trim());
                                        return isNaN(num) ? "0x???" : "0x" + num.toString(16).toUpperCase().padStart(3, '0');
                                    }).join(', ');

                                    outputArea.value += `[モータースロットル] ${hexLine}\n`;
                                    outputArea.scrollTop = outputArea.scrollHeight;
                                }
                            }
                            
                            // 【追加機能】STR: から始まる文字列データの処理
                            else if (cleanLine.startsWith("STR:")) {
                                // "STR:" の文字を取り除き、前後の余白をカットしてそのまま表示
                                const strMessage = cleanLine.replace("STR:", "").trim();
                                outputArea.value += `[文字列] ${strMessage}\n`;
                                outputArea.scrollTop = outputArea.scrollHeight;
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

// 一括制御スライダーイベント
sliderAll.addEventListener('input', () => {
    const targetValue = sliderAll.value;
    updateSliderDisplay(valAllDisplay, targetValue);
    if(targetValue >= 48) {
        sliders.forEach((slider, index) => {
            slider.value = targetValue;
            updateSliderDisplay(valDisplays[index], targetValue);
        });
        sendSliderDataThrottled();
    }
});

// 個別スライダーイベント
sliders.forEach((slider, index) => {
    slider.addEventListener('input', () => {
        if(slider.value >= 48) {
            updateSliderDisplay(valDisplays[index], slider.value);
            sendSliderDataThrottled();
        }
    });
});

clearBtn.addEventListener('click', () => { outputArea.value = ''; });

zeroBtn.addEventListener('click', () => {
    zeroSend() 
});

fortyEightBtn.addEventListener('click', () => {
    fortyEightSend();
});

// 9バイト固定バイナリデータ送信
async function zeroSend() {
    if (!writer) return;

    const packet = new Uint8Array(9);
    packet[0] = 0x7E; 

    sliders.forEach((slider, i) => {
        const val = parseInt(slider.value);
        packet[1 + i * 2] = 0; 
        packet[2 + i * 2] = 0;        
    });

    try {
        await writer.write(packet);
    } catch (error) {
        console.error('送信エラー:', error);
    }
}
// 9バイト固定バイナリデータ送信
async function fortyEightSend() {
    if (!writer) return;

    const packet = new Uint8Array(9);
    packet[0] = 0x7E; 

    sliders.forEach((slider, i) => {
        const val = parseInt(slider.value);
        packet[1 + i * 2] = 0; 
        packet[2 + i * 2] = 48;        
    });

    try {
        await writer.write(packet);
    } catch (error) {
        console.error('送信エラー:', error);
    }
}