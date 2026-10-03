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
                    
                    // 🟫【新設】パターン5: ドローンからのPIDパラメータ返送パケット (0x7D) のバイナリ検出
                    if (binaryBuffer[i] === 0x7D) {
                        // 識別コード(1B) + 12パラメータ × 2B = 計25バイト揃うまで待つ
                        if (i + 25 > binaryBuffer.length) {
                            break; 
                        }

                        // 25バイトのパケットを切り出し
                        const packet = binaryBuffer.subarray(i, i + 25);
                        i += 25; // 25バイト分バッファを消費

                        // データの並び順およびプロパティ名を定義（C++の構造体と完全一致）
                        const axes = ['pitch', 'roll', 'yaw']; //
                        const params = ['outer_p', 'inner_p', 'inner_i', 'inner_d']; //
                        
                        let pIdx = 1; // パケット読み込み位置 (1バイト目は0x7Dなので2バイト目から開始)

                        // 25バイトのバイナリから12個の数値を復元してメモリ(pidDataMemory)を更新
                        for (const axis of axes) {
                            for (const param of params) {
                                const upper4 = packet[pIdx];
                                const lower6 = packet[pIdx + 1];
                                
                                // 💡 上位4ビットと下位6ビットを結合して元の数値(0〜1000)を復元
                                const rawValue = (upper4 << 6) | lower6;

                                // main.js側のグローバルメモリ（pidDataMemory）に保存
                                if (typeof pidDataMemory !== 'undefined' && pidDataMemory[axis]) {
                                    // 💡【修正】再送信時のビットシフト不具合を防ぐため、
                                    // メモリには小数ではなく 0〜1000 の整数値のまま保存します。
                                    pidDataMemory[axis][param] = rawValue;
                                }

                                pIdx += 2;
                            }
                        }

                        // 💡 画面上のスライダーと数値表示へ自動反映
                        // main.js側に定義されている共通タブ切り替え関数を現在の軸で再実行し、画面を強制リフレッシュ
                        if (typeof window.switchPidTab === 'function' && typeof currentPidAxis !== 'undefined') {
                            window.switchPidTab(currentPidAxis); // 現在開いているタブのUI表示を最新にする
                        }

                        // 右側のテキストエリアログに完了通知を出力
                        if (outputArea) {
                            outputArea.value += `[受信] ドローン本体のPIDパラメータを読み込み、UIに同期しました。\n`;
                            
                            if (outputArea.value.length > 5000) {
                                outputArea.value = outputArea.value.substring(2500);
                            }
                            outputArea.scrollTop = outputArea.scrollHeight;
                        }
                        continue;
                    }







                    // 🟨【新設】パターン4: 校正ステータスパケット (0x7C) のバイナリ検出
                    if (binaryBuffer[i] === 0x7C) {
                        // 識別コード(1B) + 4つの方位進捗データ(4B) = 計5バイト揃うまで待つ
                        if (i + 5 > binaryBuffer.length) {
                            break; 
                        }

                        // 5バイトのパケットを切り出し
                        const packet = binaryBuffer.subarray(i, i + 5);
                        i += 5; // 5バイト分バッファを消費

                        // 2〜5バイト目から各校正データを抽出
                        const sys   = packet[1];
                        const gyro  = packet[2];
                        const accel = packet[3];
                        const mag   = packet[4];

                        // 💡【追加】mag が 0xFF だった場合はフラッシュへの保存完了ログを出力
                        if (mag === 0xFF) {
                            if (outputArea) {
                                outputArea.value += `[校正完了] データをフラッシュメモリに保存し、通常モードに復帰しました。\n`;
                                outputArea.scrollTop = outputArea.scrollHeight;
                            }
                            // UIの数値をすべて3（完了状態）にしておく
                            if (typeof window.updateCalibrationStatus === 'function') {
                                window.updateCalibrationStatus(3, 3, 3, 3);
                            }
                            continue;
                        }

                        // ① UI表示用の数値をリアルタイム更新
                        if (typeof window.updateCalibrationStatus === 'function') {
                            window.updateCalibrationStatus(sys, gyro, accel, mag);
                        }

                        // ② 右側のテキストエリアログに現在の状況を出力
                        if (outputArea) {
                            outputArea.value += `[校正進捗] Sys:${sys}, Gyro:${gyro}, Accel:${accel}, Mag:${mag}\n`;
                            
                            if (outputArea.value.length > 5000) {
                                outputArea.value = outputArea.value.substring(2500);
                            }
                            outputArea.scrollTop = outputArea.scrollHeight;
                        }
                        continue;
                    }
                    // 🟪 パターン1: 姿勢データパケット (0x7A) の検出
                    if (binaryBuffer[i] === 0x7A) {
                        if (i + 16 > binaryBuffer.length) {
                            break; // データが揃うまで待つ
                        }

                        const packet = binaryBuffer.subarray(i, i + 16);
                        i += 16;

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
                        const currentPitch = rawAngles[1] / 100.0;
                        const currentRoll  = rawAngles[2] / 100.0;
                        const currentYaw   = rawAngles[0] / 100.0;
                        
                        // Canvasの描画（引数を渡してダイレクトに描画）
                        if (typeof drawAttitude === 'function') {
                            drawAttitude(currentPitch, currentRoll, currentYaw);
                        }

                        // --- 2. 💡【新設】ドローンが返してきた目標姿勢角度の復元 ---
                        // 後半のバイト(10B〜15B)を2バイトずつ結合し、符号付き16bit整数(Int16)に戻す
                        let targetYawRaw   = (packet[10] << 8) | packet[11];
                        let targetPitchRaw = (packet[12] << 8) | packet[13];
                        let targetRollRaw  = (packet[14] << 8) | packet[15];

                        // JavaScript側で2の補数（負数）を正しくキャスト処理
                        if (targetYawRaw & 0x8000)   targetYawRaw |= 0xFFFF0000;
                        if (targetPitchRaw & 0x8000) targetPitchRaw |= 0xFFFF0000;
                        if (targetRollRaw & 0x8000)  targetRollRaw |= 0xFFFF0000;

                        const targetPitch = targetPitchRaw / 100.0;
                        const targetRoll  = targetRollRaw / 100.0;
                        const targetYaw   = targetYawRaw / 100.0;

                        // 💡【新設】復元したデータをグラフ描画エンジンにプール（蓄積）する
                        if (typeof window.pushGraphData === 'function') {
                            window.pushGraphData(
                                targetPitch, currentPitch,
                                targetRoll,  currentRoll,
                                targetYaw,   currentYaw
                            );
                        }
                        continue;
                    }
                    // 🟦 パターン3: モーターデータパケット (0x7E) のバイナリ検出処理内
                    if (binaryBuffer[i] === 0x7E) {
                        if (i + 9 > binaryBuffer.length) { break; }
                        const packet = binaryBuffer.subarray(i, i + 9);
                        i += 9;

                        let motorValues = [];
                        for (let m = 0; m < 4; m++) {
                            const val = (packet[1 + m * 2] << 8) | packet[2 + m * 2];
                            motorValues.push(String(val));
                        }

                        if (typeof window.updateMotorMeters === 'function') {
                            window.updateMotorMeters(motorValues);
                        }

                        // 💡【修正】モーター出力専用エリア（motorArea）へ出力
                        const motorArea = document.getElementById('motorArea');
                        if (motorArea) {
                            const hexLine = motorValues.map(v => "0x" + Math.trunc(Number(v)).toString(16).toUpperCase().padStart(3, '0')).join(', ');
                            motorArea.value += `[モーター出力] ${hexLine}\n`;
                            
                            if (motorArea.value.length > 5000) { motorArea.value = motorArea.value.substring(2500); }
                            motorArea.scrollTop = motorArea.scrollHeight;
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
                        
                        // 🟩 パターン2: テキストログデータ（改行コード基準）の検出処理内
                        if (cleanLine.startsWith("RECV:") || cleanLine.includes("RECV:")) {
                            const startIdx = cleanLine.indexOf("RECV:");
                            const rawValues = cleanLine.substring(startIdx).replace("RECV:", "").split(',');
                            
                            if (rawValues.length === 4) {
                                if (typeof window.updateMotorMeters === 'function') {
                                    window.updateMotorMeters(rawValues);
                                }

                                // 💡【修正】テキスト形式のモーターデータも motorArea へ出力
                                const motorArea = document.getElementById('motorArea');
                                if (motorArea) {
                                    const hexLine = rawValues.map(v => "0x" + Math.trunc(Number(v)).toString(16).toUpperCase().padStart(3, '0')).join(', ');
                                    motorArea.value += `[モーター] ${hexLine}\n`;
                                    
                                    if (motorArea.value.length > 5000) { motorArea.value = motorArea.value.substring(2500); }
                                    motorArea.scrollTop = motorArea.scrollHeight;
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
 * 💡【修正版】12個のPIDパラメータを固定長バイナリ(25B)にパックしてシリアル送信する関数
 */
async function sendPidData(pidMemory) {
    if (!writer) {
        alert("シリアルポートが接続されていません。");
        return;
    }

    // パケット構造: ヘッダー(1バイト) + 12パラメータ × 2バイト = 計25バイト
    const packet = new Uint8Array(25);
    packet[0] = 0x7D; // PID送信用の識別ヘッダー

    const axes = ['pitch', 'roll', 'yaw'];
    const params = ['outer_p', 'inner_p', 'inner_i', 'inner_d'];
    
    let index = 1; // パケット書き込み開始位置

    for (const axis of axes) {
        for (const param of params) {
            // メモリから値（0〜1000の整数）を取得
            let val = Number(pidMemory[axis][param]);

            // 0〜1000の範囲内に安全ガード（クランプ）
            if (isNaN(val) || val < 0) val = 0;
            if (val > 1000) val = 1000;

            // 💡 10ビットデータを上位4ビット・下位6ビットに正確に分割
            const upper4 = (val >> 6) & 0x0F; 
            const lower6 = val & 0x3F;        

            // パケットに格納
            packet[index]     = upper4; // 上位4ビットデータ
            packet[index + 1] = lower6; // 下位6ビットデータ
            
            index += 2; // 2バイト進める
        }
    }

    try {
        await writer.write(packet);
        
        // 受信側のテキストエリアに送信完了を出力
        const outputArea = document.getElementById('outputArea');
        if (outputArea) {
            outputArea.value += `[送信] PIDパラメータをドローンへ送信しました\n`;
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
