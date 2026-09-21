// DOM要素の取得
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');
const outputArea = document.getElementById('outputArea');

const zeroBtn = document.getElementById('zeroBtn');
const fortyEightBtn = document.getElementById('fortyEightBtn');
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
    
    if (targetValue >= 48) {
        sliders.forEach((slider) => {
            slider.value = targetValue;
        });
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

// ログ消去ボタン
clearBtn.addEventListener('click', () => { 
    if (outputArea) outputArea.value = ''; 
});

// 0強制送信ボタン
zeroBtn.addEventListener('click', () => {
    numSend(0);
});

// 48強制送信ボタン
fortyEightBtn.addEventListener('click', () => {
    numSend(48);
});
// 姿勢（ピッチ、ロール、ヨー）を0にするボタンイベント
resetAttitudeBtn.addEventListener('click', () => {
    // 各スライダーの値を0に設定
    sliderPitch.value = 0;
    sliderRoll.value = 0;
    sliderYaw.value = 0;

    // 計算とデータ送信、画面表示の更新を同時に実行
    calculateAndSendMotorData();
});
/*
// 3Dクロスフレーム（ドローン型）の描画関数
function drawAttitude() {
    // 画面のクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // スライダーの値（度数法）を取得し、ラジアンに変換
    const pitch = Number(sliderPitch.value) * Math.PI / 180;
    const roll = Number(sliderRoll.value) * Math.PI / 180;
    const yaw = Number(sliderYaw.value) * Math.PI / 180;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const armLength = 80;    // アームの長さ
    const propRadius = 25;   // プロペラの半径

    // 1. 基本となる構造の定義（ローカル座標系でのX, Y, Z）
    // 中心点
    const center = {x: 0, y: 0, z: 0};
    
    // 4つのモーター（プロペラ中心）の位置（X型ドローン配置）
    const motorPositions = [
        {x:  armLength, y: -armLength, z: 0}, // モーター0 (前右 / FR)
        {x: -armLength, y: -armLength, z: 0}, // モーター1 (前左 / FL)
        {x: -armLength, y:  armLength, z: 0}, // モーター2 (後左 / RL)
        {x:  armLength, y:  armLength, z: 0}  // モーター3 (後右 / RR)
    ];

    // 機体の「前方向」を示すガイド用（機首マーク）
    const nosePosition = {x: 0, y: -armLength * 1.2, z: 0};

    // 3D回転計算を行うヘルパー関数
    function rotatePoint(p) {
        // ロール (X軸回転)
        let y1 = p.y * Math.cos(roll) - p.z * Math.sin(roll);
        let z1 = p.y * Math.sin(roll) + p.z * Math.cos(roll);
        let x1 = p.x;

        // ピッチ (Y軸回転)
        let x2 = x1 * Math.cos(pitch) + z1 * Math.sin(pitch);
        let z2 = -x1 * Math.sin(pitch) + z1 * Math.cos(pitch);
        let y2 = y1;

        // ヨー (Z軸回転)
        let x3 = x2 * Math.cos(yaw) - y2 * Math.sin(yaw);
        let y3 = x2 * Math.sin(yaw) + y2 * Math.cos(yaw);

        // 2D座標（画面中心へのオフセット）を返す
        return { x: x3 + cx, y: y3 + cy };
    }

    // 各ポイントを3D回転
    const rCenter = rotatePoint(center);
    const rMotors = motorPositions.map(p => rotatePoint(p));
    const rNose = rotatePoint(nosePosition);

    // ==========================================
    // 描画処理
    // ==========================================

    // ① 機首方向（前方）を示すガイド（赤い矢印ライン）
    ctx.beginPath();
    ctx.moveTo(rCenter.x, rCenter.y);
    ctx.lineTo(rNose.x, rNose.y);
    ctx.strokeStyle = '#ff3b30'; // 前方は目立つ赤色
    ctx.lineWidth = 3;
    ctx.stroke();

    // ② アーム（クロスフレーム）の描画
    ctx.strokeStyle = '#e3e3e6'; // シャープなホワイトグレー
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';

    // モーター0と2を結ぶ線、モーター1と3を結ぶ線（X字アーム）
    ctx.beginPath();
    ctx.moveTo(rMotors[0].x, rMotors[0].y);
    ctx.lineTo(rMotors[2].x, rMotors[2].y);
    ctx.moveTo(rMotors[1].x, rMotors[1].y);
    ctx.lineTo(rMotors[3].x, rMotors[3].y);
    ctx.stroke();

    // ③ 4つのプロペラ（円）の描画
    rMotors.forEach((motor, index) => {
        ctx.beginPath();
        // 傾きに応じてプロペラが楕円に見えるように、半径を固定円で描画
        // (よりリアルな3D投影のため、今回はシンプルかつ軽量に真円で描画しています)
        ctx.arc(motor.x, motor.y, propRadius, 0, 2 * Math.PI);
        
        // 前方（0, 1）と後方（2, 3）で色分け
        if (index === 0 || index === 1) {
            ctx.fillStyle = 'rgba(255, 59, 48, 0.25)';  // 前方は赤の半透明
            ctx.strokeStyle = '#ff3b30';
        } else {
            ctx.fillStyle = 'rgba(0, 122, 255, 0.25)';  // 後方は青の半透明
            ctx.strokeStyle = '#007aff';
        }
        
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        // モーター中心のピン
        ctx.beginPath();
        ctx.arc(motor.x, motor.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = '#fff';
        ctx.fill();

        // モーター番号のテキスト描画
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`M${index}`, motor.x, motor.y - propRadius - 5);
    });

    // ④ 背景の十字ガイドライン（センタークロスマーク）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height);
    ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy);
    ctx.stroke();
}

// 初回描画の実行
drawAttitude();*/
/*
// アティチュード・インジケーター（人工水平儀）の描画関数
function drawAttitude() {
    // 画面のクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // スライダーの値を取得（度数法）
    const pitchDeg = Number(sliderPitch.value);
    const rollDeg = Number(sliderRoll.value);
    const yawDeg = Number(sliderYaw.value);

    // ラジアンに変換
    const rollRad = rollDeg * Math.PI / 180;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 120; // インジケーターの円の半径

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
    ctx.rotate(-rollRad); // ロール角に応じて背景を回転（航空機計器の標準仕様）
    
    // ピッチ角に応じて背景を上下にシフト（1度あたり1.5ピクセル移動と仮定）
    const pitchOffset = pitchDeg * 1.5; 
    ctx.translate(0, pitchOffset);

    // 空（上半分）を描画：鮮やかなスカイブルー
    ctx.fillStyle = '#007aff';
    ctx.fillRect(-radius * 2, -radius * 4, radius * 4, radius * 4);

    // 大地（下半分）を描画：落ち着いたブラウン/ダークグレー
    ctx.fillStyle = '#543d2b';
    ctx.fillRect(-radius * 2, 0, radius * 4, radius * 4);

    // 空と大地の境界線（水平線）
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-radius * 1.5, 0);
    ctx.lineTo(radius * 1.5, 0);
    ctx.stroke();

    // ピッチ目盛り（ラダー）の描画 (10度刻みで±30度まで)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.5;

    const pitchLines = [-30, -20, -10, 10, 20, 30];
    pitchLines.forEach(deg => {
        const y = -deg * 1.5; // シフト量と合わせる
        const width = deg % 20 === 0 ? 40 : 20; // 20度刻みは長い線

        ctx.beginPath();
        ctx.moveTo(-width / 2, y);
        ctx.lineTo(width / 2, y);
        ctx.stroke();

        // 目盛りの横に数字を表示
        ctx.fillText(Math.abs(deg).toString(), -width / 2 - 12, y);
        ctx.fillText(Math.abs(deg).toString(), width / 2 + 12, y);
    });

    ctx.restore(); // 背景のクリッピングと回転・移動を解除

    // ==========================================
    // 2. 固定マスク & 外枠の描画（背景の上に重なる）
    // ==========================================
    
    // 計器の外枠（ベゼル）
    ctx.strokeStyle = '#2d2d34';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // ==========================================
    // 3. 自機マーク（画面中央に固定された黄色のシンボル）
    // ==========================================
    ctx.strokeStyle = '#ffcc00'; // 目立つイエロー
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    // 左の翼
    ctx.moveTo(cx - 50, cy);
    ctx.lineTo(cx - 20, cy);
    ctx.lineTo(cx - 20, cy + 10);
    // 中央のドット（機首）
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 2, 0, 2 * Math.PI);
    // 右の翼
    ctx.moveTo(cx + 50, cy);
    ctx.lineTo(cx + 20, cy);
    ctx.lineTo(cx + 20, cy + 10);
    ctx.stroke();

    // ==========================================
    // 4. テキスト情報のオーバーレイ表示
    // ==========================================
    ctx.fillStyle = '#e3e3e6';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    
    // 左上にロールとピッチを表示
    ctx.fillText(`PITCH: ${pitchDeg >= 0 ? '+' : ''}${pitchDeg}°`, cx - radius + 10, cy - radius + 20);
    ctx.fillText(`ROLL:  ${rollDeg >= 0 ? '+' : ''}${rollDeg}°`, cx - radius + 10, cy - radius + 35);
    
    // 右上にヨー（方位角の代わり）を表示
    ctx.textAlign = 'right';
    ctx.fillText(`YAW:   ${yawDeg}°`, cx + radius - 10, cy - radius + 20);
}

// 初回描画の実行
drawAttitude();*/
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
            ctx.fillText('N', textX, textY);
        } else if (angle === 90) {
            ctx.fillStyle = '#e3e3e6';
            ctx.fillText('E', textX, textY);
        } else if (angle === 180) {
            ctx.fillStyle = '#e3e3e6';
            ctx.fillText('S', textX, textY);
        } else if (angle === 270) {
            ctx.fillStyle = '#e3e3e6';
            ctx.fillText('W', textX, textY);
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
    ctx.moveTo(cx, cy - compassRadius - 2);
    ctx.lineTo(cx - 6, cy - compassRadius - 14);
    ctx.lineTo(cx + 6, cy - compassRadius - 14);
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
    
    // 左上
    ctx.fillText(`PITCH: ${pitchDeg >= 0 ? '+' : ''}${pitchDeg}°`, cx - compassRadius, cy - compassRadius + 5);
    ctx.fillText(`ROLL:  ${rollDeg >= 0 ? '+' : ''}${rollDeg}°`, cx - compassRadius, cy - compassRadius + 20);
    
    // 右上
    ctx.textAlign = 'right';
    ctx.fillText(`YAW:   ${yawDeg}°`, cx + compassRadius, cy - compassRadius + 5);
}

// 初回描画の実行
drawAttitude();

