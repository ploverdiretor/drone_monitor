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
let lastFlightSendTime = 0;
let flightThrottleTimeout = null;

// 💡 新設：20msのシリアル送信制限（スロットル）付きフライトデータ送信処理
function sendFlightDataThrottled() {
    const now = performance.now();
    const remaining = 20 - (now - lastFlightSendTime);

    if (flightThrottleTimeout) clearTimeout(flightThrottleTimeout);

    const executeFlightSend = () => {
        // UIのスライダーから最新の値を読み出して送信関数へ渡す
        const throttleVal = Number(document.getElementById('sliderAll').value); // 一括制御（スロットル）
        const pitchVal    = Number(sliderPitch.value);
        const rollVal     = Number(sliderRoll.value);
        const yawVal      = Number(sliderYaw.value);

        sendFlightControlData(throttleVal, pitchVal, rollVal, yawVal);
    };

    if (remaining <= 0) {
        lastFlightSendTime = now;
        executeFlightSend();
    } else {
        flightThrottleTimeout = setTimeout(() => {
            lastFlightSendTime = performance.now();
            executeFlightSend();
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
// 【重要】メモリ負荷を減らすため、TextDecoderは関数の外で1度だけ生成して使い回す
const globalDecoder = new TextDecoder("utf-8", { fatal: false });

// マイコンからのデータ受信関数（ブラウザ負荷極小化・とぎれとぎれ解消版）
async function readFromSerial() {
    const outputArea = document.getElementById('outputArea');
    let binaryBuffer = new Uint8Array(0); // バイナリ解析用の受信用バッファ

    while (port && port.readable && keepReading) {
        activeReader = port.readable.getReader();

        try {
            while (keepReading) {
                const { value, done } = await activeReader.read();
                if (done) break;
                if (!value) continue;

                // バッファの結合（高速化のため、バッファが大きくなりすぎたら制限をかける）
                if (binaryBuffer.length > 4096) {
                    binaryBuffer = new Uint8Array(0); // 溜まりすぎたバッファを強制クリア（ラグ防止）
                }
                
                let newBuffer = new Uint8Array(binaryBuffer.length + value.length);
                newBuffer.set(binaryBuffer);
                newBuffer.set(value, binaryBuffer.length);
                binaryBuffer = newBuffer;

                let i = 0;
                while (i < binaryBuffer.length) {
                    
                    // 🟪 パターン1: 姿勢データパケット (0x7A) の検出
                    if (binaryBuffer[i] === 0x7A) {
                        if (i + 10 > binaryBuffer.length) {
                            break; // データが揃うまで待つ
                        }

                        const packet = binaryBuffer.subarray(i, i + 10);
                        i += 10;

                        // 16bit整数への復元
                        let rawAngles = new Int16Array(3);
                        for (let axis = 0; axis < 3; axis++) {
                            const upper4 = packet[1 + axis * 3] & 0x0F;
                            const mid6   = packet[2 + axis * 3] & 0x3F;
                            const lower6 = packet[3 + axis * 3] & 0x3F;

                            let combined = (upper4 << 12) | (mid6 << 6) | lower6;
                            if (combined & 0x8000) combined |= 0xFFFF0000; 
                            rawAngles[axis] = combined;
                        }

                        // Canvasの描画（引数を渡してダイレクトに描画）
                        if (typeof drawAttitude === 'function') {
                            drawAttitude(rawAngles[1] / 100.0, rawAngles[2] / 100.0, rawAngles[0] / 100.0);
                        }
                        continue;
                    }
                    // 🟦 【新設】パターン3: モーターデータパケット (0x7E) のバイナリ検出
                    if (binaryBuffer[i] === 0x7E) {
                        // 9バイト揃うまで次回のデータ受信を待つ
                        if (i + 9 > binaryBuffer.length) {
                            break; 
                        }

                        // 9バイトのパケットを切り出し
                        const packet = binaryBuffer.subarray(i, i + 9);
                        i += 9; // 9バイト消費

                        // 2バイトずつ結合して元の4つのモーター値(0〜1000)を復元
                        let motorValues = [];
                        for (let m = 0; m < 4; m++) {
                            const val = (packet[1 + m * 2] << 8) | packet[2 + m * 2];
                            motorValues.push(String(val)); // 既存のメーター関数に合わせるため文字列型にして格納
                        }

                        // 中央下のグリーンのレベルメーターへダイレクトに超高速反映！
                        if (typeof window.updateMotorMeters === 'function') {
                            window.updateMotorMeters(motorValues);
                        }

                        // 右側テキストエリアへ16進数ログを出力（文字列処理をここだけに限定して軽量化）
                        if (outputArea) {
                            const hexLine = motorValues.map(v => "0x" + Math.trunc(Number(v)).toString(16).toUpperCase().padStart(3, '0')).join(', ');
                            outputArea.value += `[モーター出力] ${hexLine}\n`;
                            
                            if (outputArea.value.length > 5000) {
                                outputArea.value = outputArea.value.substring(2500);
                            }
                            outputArea.scrollTop = outputArea.scrollHeight;
                        }
                        continue;
                    }
                    // 🟩 パターン2: テキストログデータの検出（改行コード基準）
                    let nextNewLine = binaryBuffer.indexOf(0x0A, i); // 0x0A = '\n'
                    
                    if (nextNewLine !== -1) {
                        const lineBytes = binaryBuffer.subarray(i, nextNewLine);
                        i = nextNewLine + 1;

                        // 外で生成した globalDecoder を使うことでフリーズ（遅延）を防止
                        const cleanLine = globalDecoder.decode(lineBytes).trim();
                        
                        // 文字列判定の高速化（startsWithを使用）
                        if (cleanLine.startsWith("RECV:") || cleanLine.includes("RECV:")) {
                            const startIdx = cleanLine.indexOf("RECV:");
                            const rawValues = cleanLine.substring(startIdx).replace("RECV:", "").split(',');
                            
                            if (rawValues.length === 4) {
                                if (typeof window.updateMotorMeters === 'function') {
                                    window.updateMotorMeters(rawValues);
                                }

                                // ログエリアの更新（表示が追いつかない原因になるため、スクロール処理を軽量化）
                                if (outputArea) {
                                    const hexLine = rawValues.map(v => "0x" + Math.trunc(Number(v)).toString(16).toUpperCase().padStart(3, '0')).join(', ');
                                    outputArea.value += `[モーター] ${hexLine}\n`;
                                    
                                    // ログが長くなりすぎたら古いものを消す（ブラウザを重くさせない対策）
                                    if (outputArea.value.length > 5000) {
                                        outputArea.value = outputArea.value.substring(2500);
                                    }
                                    outputArea.scrollTop = outputArea.scrollHeight;
                                }
                            }
                        }
                        else if (cleanLine.startsWith("STR:") || cleanLine.includes("STR:")) {
                            const startIdx = cleanLine.indexOf("STR:");
                            const strMessage = cleanLine.substring(startIdx).replace("STR:", "").trim();
                            if (outputArea) {
                                outputArea.value += `[文字列] ${strMessage}\n`;
                                outputArea.scrollTop = outputArea.scrollHeight;
                            }
                        }
                        continue;
                    }

                    i++;
                }

                binaryBuffer = binaryBuffer.slice(i);
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


/**
 * 12個のPIDパラメータ(Float)を固定長バイナリにパックしてシリアル送信する関数
 * param {Object} pidMemory - pidDataMemory オブジェクト { pitch: {...}, roll: {...}, yaw: {...} }
 */
async function sendPidData(pidMemory) {
    if (!writer) {
        alert("シリアルポートが接続されていません。");
        return;
    }

    // パラメータを浮動小数点数から固定小数点（整数）に変換するための倍率
    // 例: 1.25 -> 1250 (1000倍)
    const MULTIPLIER = 1000; 

    // パケット構造: ヘッダー(1バイト) + 12パラメータ × 2バイト = 計25バイト
    const packet = new Uint8Array(25);
    packet[0] = 0x7D; // PID送信用の識別ヘッダー

    // パラメータをパケットへ格納する順番の定義
    const axes = ['pitch', 'roll', 'yaw'];
    const params = ['outer_p', 'inner_p', 'inner_i', 'inner_d'];
    
    let index = 1; // パケット書き込み開始位置

    for (const axis of axes) {
        for (const param of params) {
/*            // メモリから値を取得
            const floatVal = pidMemory[axis][param];
            
            // 固定小数点数（整数）に変換して四捨五入
            let intVal = Math.round(floatVal * MULTIPLIER);

            // 16bit符号付き整数(Int16)の範囲にクランプガード (-32768 〜 32767)
            if (intVal < -32768) intVal = -32768;
            if (intVal > 32767) intVal = 32767;

            // 上位バイトと下位バイトに分解してパケットに格納
            packet[index]     = (intVal >> 8) & 0xFF; // Upper byte
            packet[index + 1] = intVal & 0xFF;        // Lower byte
            
            index += 2;*/
            // メモリから値を取得し、念のため数値型に変換
            let val = Number(pidMemory[axis][param]);

            // ⚠️ 0〜1000の範囲内に安全ガード（クランプ）
            if (val < 0) val = 0;
            if (val > 1000) val = 1000;

            // 💡 データの分割ロジック
            // 0〜1000は最大10ビット必要なため、上位4ビット・下位6ビットに切り分ける
            const upper4 = (val >> 6) & 0x0F; // 6ビット右シフトして、下位4ビット分をマスク抽出
            const lower6 = val & 0x3F;        // 下位6ビット分(0x3F = 0b00111111)をマスク抽出

            // パケットに格納
            packet[index]     = upper4; // 上位4ビットデータ
            packet[index + 1] = lower6; // 下位6ビットデータ
            
            index += 2; // 次のパラメータへ（2バイト進める）
        }
    }

    try {
        await writer.write(packet);
        
        // ユーザー向けに送信ログを出力（任意）
        const outputArea = document.getElementById('outputArea');
        if (outputArea) {
            outputArea.value += `[送信] PIDパラメータを送信しました (${packet.length} bytes)\n`;
            outputArea.scrollTop = outputArea.scrollHeight;
        }
    } catch (error) {
        console.error('PID送信エラー:', error);
        alert('PIDパラメータの送信に失敗しました。');
    }
}
/**
 * 💡 新設：特定の1バイトデータ（コマンド）をダイレクトにシリアル送信する関数
 * @param {number} commandByte - 送信したい1バイトの数値 (例: 0x7C)
 */
async function sendSingleCommand(commandByte) {
    if (!writer) {
        alert("シリアルポートが接続されていません。");
        return;
    }

    // 1バイトの固定バッファを作成
    const packet = new Uint8Array(1);
    packet[0] = commandByte & 0xFF; // 安全のため1バイトマスク

    try {
        await writer.write(packet);
        
        // ログエリアに送信ログを表示
        const outputArea = document.getElementById('outputArea');
        if (outputArea) {
            const hexStr = "0x" + commandByte.toString(16).toUpperCase().padStart(2, '0');
            outputArea.value += `[送信] コマンド [${hexStr}] を送信しました\n`;
            outputArea.scrollTop = outputArea.scrollHeight;
        }
    } catch (error) {
        console.error('コマンド送信エラー:', error);
        alert('コマンドの送信に失敗しました。');
    }
}
/**
 * スロットル、ピッチ、ロール、ヨーのデータをパックしてシリアル送信する関数
 * @param {number} throttle - スロットル値 (0 〜 1000)
 * @param {number} pitch - ピッチ角 (-30 〜 30)
 * @param {number} roll - ロール角 (-30 〜 30)
 * @param {number} yaw - ヨー角 (-30 〜 30)
 */
async function sendFlightControlData(throttle, pitch, roll, yaw) {
    if (!writer) {
        console.error("シリアルポートが接続されていません。");
        return;
    }

    // --- 安全ガード（入力値のクランプ） ---
    let t = Math.max(0, Math.min(1000, Math.trunc(throttle)));
    let p = Math.max(-30, Math.min(30, Math.trunc(pitch)));
    let r = Math.max(-30, Math.min(30, Math.trunc(roll)));
    let y = Math.max(-30, Math.min(30, Math.trunc(yaw)));

    // --- パケット作成 (計6バイト or 7バイト) ---
    // ヘッダー(1) + スロットル(2) + 姿勢3軸(3) = 計6バイトで収まりますが、
    // 送信単位やアライメントを考慮して7バイト（末尾を0固定など）にしておくと扱いやすいです。
    const packet = new Uint8Array(7);
    
    packet[0] = 0x7B; // スタートコード

    // スロットルの分割 (0〜1000は最大10ビット)
    packet[1] = (t >> 6) & 0x0F; // 上位4ビットを抽出
    packet[2] = t & 0x3F;        // 下位6ビットをマスク抽出

    // 姿勢データの格納 (Uint8Arrayに負数を入れると自動で2の補数表現になります)
    packet[3] = p; // ピッチ (-30 〜 30)
    packet[4] = r; // ロール (-30 〜 30)
    packet[5] = y; // ヨー   (-30 〜 30)
    
    packet[6] = 0x00; // 予備/パディング用 (不要な場合はパケット長を6にしてください)

    try {
        await writer.write(packet);
    } catch (error) {
        console.error('フライトデータ送信エラー:', error);
    }
}
