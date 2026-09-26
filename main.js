// DOM要素の取得
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');
const outputArea = document.getElementById('outputArea');

const zeroBtn = document.getElementById('zeroBtn');
const resetAttitudeBtn = document.getElementById('resetAttitudeBtn');

const sliderAll = document.getElementById('sliderAll');
const valAllDisplay = document.getElementById('valAll');

const sliderPitch = document.getElementById('slider4');
const valPitchDisplay = document.getElementById('val4');

const sliderRoll = document.getElementById('slider5');
const valRollDisplay = document.getElementById('val5');

const sliderYaw = document.getElementById('slider6');
const valYawDisplay = document.getElementById('val6');

const canvas = document.getElementById('attitudeCanvas');
const ctx = canvas.getContext('2d');

const sendPidBtn = document.getElementById('sendPidBtn');

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
// 【追加】受信メーター用DOM要素の取得
const motorMeters = [
    document.getElementById('motorMeter0'),
    document.getElementById('motorMeter1'),
    document.getElementById('motorMeter2'),
    document.getElementById('motorMeter3')
];
const motorVals = [
    document.getElementById('motorVal0'),
    document.getElementById('motorVal1'),
    document.getElementById('motorVal2'),
    document.getElementById('motorVal3')
];

// 【追加】受信データをレベルメーターに反映させるグローバル関数
window.updateMotorMeters = function(rawValues) {
    rawValues.forEach((v, i) => {
        if (i > 3) return; // 4つ以上のデータは無視
        const num = Number(v.trim());
        if (isNaN(num)) return;

        // 16進数文字列の作成
        const hexStr = "0x" + Math.trunc(num).toString(16).toUpperCase().padStart(3, '0');
        if (motorVals[i]) motorVals[i].innerText = hexStr;

        // メーターのパーセンテージ計算 (最大値を1000として安全にガード)
        let percent = (num / 1000) * 100;
        if (percent < 0) percent = 0;
        if (percent > 100) percent = 100;

        if (motorMeters[i]) {
            motorMeters[i].style.width = `${percent}%`;
            
            // スロットル量に応じて色を変化させる（お好みで）
            if (percent > 85) {
                motorMeters[i].style.backgroundColor = 'var(--danger-color)'; // 高負荷は赤
                motorMeters[i].style.boxShadow = '0 0 8px var(--danger-color)';
            } else {
                motorMeters[i].style.backgroundColor = 'var(--accent-color)'; // 通常は緑
                motorMeters[i].style.boxShadow = '0 0 8px var(--accent-color)';
            }
        }
    });
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
    // 【追加】スライダー値が変わるたびにグラフィックを再描画
    drawAttitude();
}

// 例：UIのスライダー値を読み取って送信する場合
function sendCurrentSliders() {
    const throttleVal = Number(document.getElementById('sliderAll').value); // 全体スロットル
    const pitchVal    = Number(sliderPitch.value);
    const rollVal     = Number(sliderRoll.value);
    const yawVal      = Number(sliderYaw.value);

    // 20msスロットルなどのタイマー処理を挟んで呼び出すと安定します
    sendFlightControlData(throttleVal, pitchVal, rollVal, yawVal);
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
                totalVal = baseVal - pitchVal - rollVal + yawVal;
                break;
            case 1: // モーター1
                totalVal = baseVal + pitchVal - rollVal - yawVal;
                break;
            case 2: // モーター2
                totalVal = baseVal - pitchVal + rollVal - yawVal;
                break;
            case 3: // モーター3
                totalVal = baseVal + pitchVal + rollVal + yawVal;
                break;
        }
        // 下限・上限の安全ガード
        if (totalVal < 0) {
            totalVal = 0; 
        } else if (totalVal > 1000) {
            totalVal = 1000; // 送信データが11bit(0x7FF)を超えないよう上限もガード
        }
        sliderData[index] = totalVal;
    });
    syncAllDisplays();
    sendSliderDataThrottled();
}




// --- イベントリスナーの登録 ---

// 接続ボタン
connectBtn.addEventListener('click', () => {
    connectSerial(statusDiv, connectBtn, disconnectBtn);
});

// 切断ボタン
disconnectBtn.addEventListener('click', () => {
    disconnectSerial(statusDiv, connectBtn, disconnectBtn);
});

// 一括制御スライダーイベント
sliderAll.addEventListener('input', () => {
    const targetValue = Number(sliderAll.value);
    updateSliderDisplay(valAllDisplay, targetValue);
    
    if (targetValue >= 0) {
        sliders.forEach((slider) => {
            slider.value = targetValue;
        });
    //    calculateAndSendMotorData();
     //   sendCurrentSliders();
        syncAllDisplays();
        sendFlightDataThrottled();
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
    //calculateAndSendMotorData();
    //sendCurrentSliders();
    syncAllDisplays();
    sendFlightDataThrottled();
});

// ロールスライダーイベント
sliderRoll.addEventListener('input', () => {
    updateSliderDisplay(valRollDisplay, sliderRoll.value);
    //calculateAndSendMotorData();
    //sendCurrentSliders();
    syncAllDisplays();
    sendFlightDataThrottled();
});

// ヨースライダーイベント
sliderYaw.addEventListener('input', () => {
    updateSliderDisplay(valYawDisplay, sliderYaw.value);
    //calculateAndSendMotorData();
    //sendCurrentSliders();
    syncAllDisplays();
    sendFlightDataThrottled();
});

// ログ消去ボタン
clearBtn.addEventListener('click', () => { 
    if (outputArea) outputArea.value = ''; 
});

// 0強制送信ボタン
zeroBtn.addEventListener('click', () => {
    numSend(0);
});

// 姿勢（ピッチ、ロール、ヨー）を0にするボタンイベント
resetAttitudeBtn.addEventListener('click', () => {
    // 各スライダーの値を0に設定
    sliderPitch.value = 0;
    sliderRoll.value = 0;
    sliderYaw.value = 0;

    // 計算とデータ送信、画面表示の更新を同時に実行
    //calculateAndSendMotorData();
    syncAllDisplays();
    sendFlightDataThrottled();
});

// 方位目盛り（コンパス）付きアティチュード・インジケーターの描画関数
function drawAttitude() {
    // 画面のクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // スライダーの値を取得（度数法）
    const pitchDeg = Number(sliderPitch.value);
    const rollDeg = Number(sliderRoll.value);
    const yawDeg = Number(sliderYaw.value);

    // ラジアンに変換
    const rollRad = rollDeg * Math.PI / 180;
    const yawRad = yawDeg * Math.PI / 180;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 95;      // 水平儀（中央の円）の半径
    const compassRadius = 115; // コンパス（外周の円）の半径

    // ==========================================
    // 1. 動く背景（空と大地）の描画
    // ==========================================
    ctx.save();
    
    // 円形のマスクを作成（メーターの外枠からはみ出さないようにする）
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.clip();

    // 画面中心を回転・移動の基準にする
    ctx.translate(cx, cy);
    ctx.rotate(-rollRad); // ロール角に応じて背景を回転
    
    // ピッチ角に応じて背景を上下にシフト
    const pitchOffset = pitchDeg * 1.5; 
    ctx.translate(0, pitchOffset);

    // 空（上半分）を描画：鮮やかなスカイブルー
    ctx.fillStyle = '#007aff';
    ctx.fillRect(-radius * 2, -radius * 4, radius * 4, radius * 4);

    // 大地（下半分）を描画：落ち着いたブラウン
    ctx.fillStyle = '#543d2b';
    ctx.fillRect(-radius * 2, 0, radius * 4, radius * 4);

    // 水平線
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-radius * 1.5, 0);
    ctx.lineTo(radius * 1.5, 0);
    ctx.stroke();

    // ピッチ目盛り（ラダー）の描画
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.5;

    const pitchLines = [-30, -20, -10, 10, 20, 30];
    pitchLines.forEach(deg => {
        const y = -deg * 1.5;
        const width = deg % 20 === 0 ? 40 : 20;

        ctx.beginPath();
        ctx.moveTo(-width / 2, y);
        ctx.lineTo(width / 2, y);
        ctx.stroke();

        ctx.fillText(Math.abs(deg).toString(), -width / 2 - 12, y);
        ctx.fillText(Math.abs(deg).toString(), width / 2 + 12, y);
    });

    ctx.restore(); // 背景のクリッピングと変形をリセット

    // ==========================================
    // 2. 水平儀のベゼル（内枠）の描画
    // ==========================================
    ctx.strokeStyle = '#2d2d34';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // ==========================================
    // 3. 【新機能】外周コンパス（方位目盛り）の描画
    // ==========================================
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-yawRad); // ヨー角（方位）の反転回転を適用

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillStyle = '#e3e3e6';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 30度刻みで目盛りと方角（N, E, S, W）を描画
    for (let angle = 0; angle < 360; angle += 30) {
        const rad = (angle - 90) * Math.PI / 180; // 0度が真上（北）にくるように補正
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // 目盛り線の開始点と終了点
        const startX = cos * radius;
        const startY = sin * radius;
        const endX = cos * (compassRadius - 5);
        const endY = sin * (compassRadius - 5);

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.lineWidth = angle % 90 === 0 ? 2 : 1; // 東西南北は太い線にする
        ctx.stroke();

        // 文字の配置座標
        const textX = cos * (compassRadius + 8);
        const textY = sin * (compassRadius + 8);

        // 東西南北（N,E,S,W）と数値の出し分け
        if (angle === 0) {
            ctx.fillStyle = '#ff3b30'; // 北（N）だけ警告の赤色
            ctx.fillText('0', textX, textY);
        } else if (angle === 90) {
            ctx.fillStyle = '#e3e3e6';
            ctx.fillText('09', textX, textY);
        } else if (angle === 180) {
            ctx.fillStyle = '#e3e3e6';
            ctx.fillText('18', textX, textY);
        } else if (angle === 270) {
            ctx.fillStyle = '#e3e3e6';
            ctx.fillText('27', textX, textY);
        } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '9px monospace';
            ctx.fillText((angle / 10).toString().padStart(2, '0'), textX, textY); // 航空計器風に10の位で表示（例：300度→30）
            ctx.font = 'bold 11px sans-serif'; // フォントを元に戻す
        }
    }
    ctx.restore();

    // コンパスの最外周の細い円線
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, compassRadius + 16, 0, 2 * Math.PI);
    ctx.stroke();

    // ==========================================
    // 4. 固定ヘディングインジケーター（最上部の赤い三角）
    // ==========================================
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.moveTo(cx, cy - compassRadius - 14);
    ctx.lineTo(cx - 6, cy - compassRadius - 26);
    ctx.lineTo(cx + 6, cy - compassRadius - 26);
    ctx.closePath();
    ctx.fill();

    // ==========================================
    // 5. 自機マーク（画面中央に固定された黄色のシンボル）
    // ==========================================
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(cx - 40, cy);
    ctx.lineTo(cx - 15, cy);
    ctx.lineTo(cx - 15, cy + 8);
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 1.5, 0, 2 * Math.PI);
    ctx.moveTo(cx + 40, cy);
    ctx.lineTo(cx + 15, cy);
    ctx.lineTo(cx + 15, cy + 8);
    ctx.stroke();

    // ==========================================
    // 6. テキスト情報のオーバーレイ表示
    // ==========================================
    ctx.fillStyle = '#e3e3e6';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    
    // X座標: 15px (左端), Y座標: 25px / 40px に変更して上端の隅へ配置
    ctx.fillText(`PITCH: ${pitchDeg >= 0 ? '+' : ''}${pitchDeg}°`, 15, 25);
    ctx.fillText(`ROLL:  ${rollDeg >= 0 ? '+' : ''}${rollDeg}°`, 15, 40);
    
    // 【修正】右端に寄せる設定
    ctx.textAlign = 'right';
    // X座標: canvas.width - 15px (右端), Y座標: 25px に変更して上端の隅へ配置
    ctx.fillText(`YAW:   ${yawDeg}°`, canvas.width - 15, 25);
}

// 初回描画の実行
drawAttitude();

const calibrationBtn = document.getElementById('calibrationBtn');

// キャリブレーションボタンのイベント
calibrationBtn.addEventListener('click', () => {
    if (confirm('機体を水平な場所に置きましたか？キャリブレーションを開始します。')) {
        // 新設した1バイト送信関数で 0x7C を直接送信
        if (typeof sendSingleCommand === 'function') {
            sendSingleCommand(0x7C); 
        } else {
            console.error("sendSingleCommand関数が定義されていません。");
        }
    }
});

// ==========================================
// 【新設】共通スライダー＆軸切り替えタブ制御
// ==========================================

// 現在選択されているPIDの軸管理 ('pitch', 'roll', 'yaw')
let currentPidAxis = 'pitch';

// 12個の数値をメモリ（オブジェクト）内で初期値として保持
const pidDataMemory = {
    pitch: { outer_p: 1.0, inner_p: 1.0, inner_i: 0.0, inner_d: 0.0 },
    roll:  { outer_p: 1.0, inner_p: 1.0, inner_i: 0.0, inner_d: 0.0 },
    yaw:   { outer_p: 1.0, inner_p: 1.0, inner_i: 0.0, inner_d: 0.0 }
};

// 共通UI操作子（4本のスライダー）の取得
const sharedSliders = {
    outer_p: document.getElementById('shared_outer_p'),
    inner_p: document.getElementById('shared_inner_p'),
    inner_i: document.getElementById('shared_inner_i'),
    inner_d: document.getElementById('shared_inner_d')
};

// 共通UI数値表示要素の取得
const sharedDisplays = {
    outer_p: document.getElementById('shared_val_op'),
    inner_p: document.getElementById('shared_val_ip'),
    inner_i: document.getElementById('shared_val_ii'),
    inner_d: document.getElementById('shared_val_id')
};

// 軸タブを切り替えるグローバル関数 (HTMLのonclickから呼ばれます)
window.switchPidTab = function(axis) {
    currentPidAxis = axis;

    // タブボタンのアクティブ状態（見た目）を切り替え
    ['pitch', 'roll', 'yaw'].forEach(a => {
        const btn = document.getElementById(`btn_tab_${a}`);
        if (btn) {
            if (a === axis) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });

    // メモリから切り替えた軸の数値を読み込んで、4本のスライダー・数値を画面に同期
    Object.keys(sharedSliders).forEach(param => {
        const savedValue = pidDataMemory[axis][param];
        if (sharedSliders[param]) sharedSliders[param].value = savedValue;
        if (sharedDisplays[param]) sharedDisplays[param].innerText = Number(savedValue).toFixed(2);
    });
};

// 4本のスライダーを動かしたとき、現在選択中の軸メモリへ即座に値を上書き保存する処理
Object.keys(sharedSliders).forEach(param => {
    const slider = sharedSliders[param];
    if (slider) {
        slider.addEventListener('input', () => {
            const val = Number(slider.value);
            // 現在選択されている軸のメモリデータを更新
            pidDataMemory[currentPidAxis][param] = val;
            // 画面の数値テキストを更新
            if (sharedDisplays[param]) sharedDisplays[param].innerText = val.toFixed(2);
        });
    }
});

// 送信ボタンが押された時、12個の数値をまとめてシリアル送信関数へ渡す処理
if (sendPidBtn) {
    sendPidBtn.addEventListener('click', () => {
        // メモリに保存されている現在の12個のPIDデータを送信関数に渡す
        if (typeof sendPidData === 'function') {
            sendPidData(pidDataMemory); 
        } else {
            console.error("sendPidData関数が定義されていません。");
        }
    });
}
// 追加したトグルボタンとPIDパネルのDOMを取得
const togglePidBtn = document.getElementById('togglePidBtn');
const pidPanel = document.getElementById('pidPanel');

// 表示・非表示を切り替えるイベントリスナー
if (togglePidBtn && pidPanel) {
    togglePidBtn.addEventListener('click', () => {
        if (pidPanel.style.display === 'none') {
            // 非表示なら表示する (CSSでflex指定されている親要素に合わせるため空文字にするか 'block' にする)
            pidPanel.style.display = ''; 
            togglePidBtn.style.backgroundColor = 'var(--primary-color)'; // アクティブ時に色を変える（任意）
        } else {
            // 表示されているなら非表示にする
            pidPanel.style.display = 'none';
            togglePidBtn.style.backgroundColor = ''; // 色を元に戻す
        }
    });
}
