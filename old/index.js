let port = null;
let writer = null;
let activeReader = null; 
let keepReading = true;
let readerPromise = null; 
let closedPromise = null;
let receivedBuffer = ""; 

let lastSendTime = 0;
let throttleTimeout = null;

// DOM要素の取得
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');
const outputArea = document.getElementById('outputArea');

// 追加：定義が漏れていたボタンの取得
const zeroBtn = document.getElementById('zeroBtn');
const fortyEightBtn = document.getElementById('fortyEightBtn');

const sliderAll = document.getElementById('sliderAll');
const valAllDisplay = document.getElementById('valAll');

const sliderPitch = document.getElementById('slider4');
const valPitchDisplay = document.getElementById('val4');

const sliderRoll = document.getElementById('slider5');
const valRollDisplay = document.getElementById('val5');

const sliderYaw = document.getElementById('slider6');
const valYawDisplay = document.getElementById('val6');
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

// 初期データ (4モーター分)
const sliderData =[48,48,48,48]; // 初期値を48に設定

// 【修正】マイナス値にも対応した16進数表示関数
function updateSliderDisplay(displayElement, value) {
    const numValue = Math.trunc(Number(value));
    let hexStr = "";

    if (numValue < 0) {
        // マイナスの場合は「-0x05」のような表記にする場合
        hexStr = "-0x" + Math.abs(numValue).toString(16).toUpperCase().padStart(3, '0');
    } else {
        hexStr = "0x" + numValue.toString(16).toUpperCase().padStart(3, '0');
    }
    
    displayElement.innerText = `${numValue} (${hexStr})`;
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

// 切断処理
disconnectBtn.addEventListener('click', async () => {
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
});

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
// 全てのスライダーの画面表示（テキスト）を現在のつまみ位置に同期する関数
function syncAllDisplays() {
    updateSliderDisplay(valAllDisplay, sliderAll.value);
    updateSliderDisplay(valPitchDisplay, sliderPitch.value);
    updateSliderDisplay(valRollDisplay, sliderRoll.value);
    updateSliderDisplay(valYawDisplay, sliderYaw.value);
    sliders.forEach((slider, i) => {
        updateSliderDisplay(valDisplays[i], slider.value);
    });
}
// モーターデータを再計算して送信する共通処理
function calculateAndSendMotorData() {
    const pitchVal = Number(sliderPitch.value);
    const rollVal = Number(sliderRoll.value);
    const yawVal = Number(sliderYaw.value);

    sliders.forEach((slider, index) => {
        const baseVal = Number(slider.value);
        let totalVal = 0;
        switch (index) {
            case 0: // モーター0
                totalVal = baseVal - pitchVal + rollVal + yawVal;
                break;
            case 1: // モーター1
                totalVal = baseVal + pitchVal + rollVal - yawVal;
                break;
            case 2: // モーター2
                totalVal = baseVal + pitchVal - rollVal - yawVal;
                break;
            case 3: // モーター3
                totalVal = baseVal - pitchVal - rollVal + yawVal;
                break;
        }
        // 下限・上限の安全ガード
        if (totalVal < 48) {
            totalVal = 48; 
        } else if (totalVal > 2047) {
            totalVal = 2047; // 送信データが11bit(0x7FF)を超えないよう上限もガード
        }
        sliderData[index] = totalVal;
    //    updateSliderDisplay(valDisplays[index], baseVal); // 表示はスライダー単体の値
    });
    syncAllDisplays();
    sendSliderDataThrottled();
}

// 一括制御スライダーイベント
sliderAll.addEventListener('input', () => {
    const targetValue = Number(sliderAll.value);
    updateSliderDisplay(valAllDisplay, targetValue);
    
    if (targetValue >= 48) {
        sliders.forEach((slider) => {
            slider.value = targetValue;
        });
        // 一括変更後にピッチなどを加味して再計算・送信
        calculateAndSendMotorData();
    }
});

// 個別スライダーイベント
sliders.forEach((slider) => {
    slider.addEventListener('input', () => {
        calculateAndSendMotorData();
    });
});

// ピッチスライダーイベント
sliderPitch.addEventListener('input', () => {
    updateSliderDisplay(valPitchDisplay, sliderPitch.value);
    calculateAndSendMotorData();
});

// ロールスライダーイベント
sliderRoll.addEventListener('input', () => {
    updateSliderDisplay(valRollDisplay, sliderRoll.value);
    calculateAndSendMotorData();
});

// ヨースライダーイベント
sliderYaw.addEventListener('input', () => {
    updateSliderDisplay(valYawDisplay, sliderYaw.value);
    calculateAndSendMotorData();
});

clearBtn.addEventListener('click', () => { outputArea.value = ''; });

zeroBtn.addEventListener('click', () => {
    numSend(0);
});

fortyEightBtn.addEventListener('click', () => {
    numSend(48);
});

// 特定値の強制送信（9バイト固定）
async function numSend(input) {
    if (!writer) return;

    const packet = new Uint8Array(9);
    packet[0] = 0x7E; 

    sliders.forEach((slider, i) => {
        packet[1 + i * 2] = 0; 
        packet[2 + i * 2] = input & 0x3F; // 安全のため下位6bitにマスク
    });

    try {
        await writer.write(packet);
    } catch (error) {
        console.error('送信エラー:', error);
    }
}

// マイコンからのデータ受信関数
async function readFromSerial() {
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
                                        const num = Number(v.trim()); // parseIntから変更
                                        return isNaN(num) ? "0x???" : "0x" + Math.trunc(num).toString(16).toUpperCase().padStart(3, '0');
                                    }).join(', ');

                                    outputArea.value += `[モータースロットル] ${hexLine}\n`;
                                    outputArea.scrollTop = outputArea.scrollHeight;
                                }
                            }
                            else if (cleanLine.startsWith("STR:")) {
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
