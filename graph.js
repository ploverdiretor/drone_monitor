// ==============================================================
// 📈 リアルタイムPID追従性グラフ描画エンジン
// ==============================================================

// 1. 各軸のデータ蓄積バッファ（最大表示件数: 200件分）
const MAX_GRAPH_POINTS = 200;
const graphBuffer = {
    pitch: { target: [], current: [] },
    roll:  { target: [], current: [] },
    yaw:   { target: [], current: [] }
};

// 2. データをバッファにプッシュするグローバル関数（serial.jsから呼ばれる）
window.pushGraphData = function(tPitch, cPitch, tRoll, cRoll, tYaw, cYaw) {
    // 各軸の配列に末尾追加
    graphBuffer.pitch.target.push(tPitch);
    graphBuffer.pitch.current.push(cPitch);
    graphBuffer.roll.target.push(tRoll);
    graphBuffer.roll.current.push(cRoll);
    graphBuffer.yaw.target.push(tYaw);
    graphBuffer.yaw.current.push(cYaw);

    // 最大件数を超えたら一番古いデータ(先頭)を削除
    const axes = ['pitch', 'roll', 'yaw'];
    axes.forEach(axis => {
        if (graphBuffer[axis].target.length > MAX_GRAPH_POINTS) {
            graphBuffer[axis].target.shift();
            graphBuffer[axis].current.shift();
        }
    });

    // データの更新があったので即座に再描画を実行
    renderPidGraph();
};

// 3. Canvasへ波形を描写するメイン関数
function renderPidGraph() {
    const canvas = document.getElementById('graphCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // 💡 現在PC画面上で選択されているPIDの軸 ('pitch', 'roll', 'yaw') を安全に取得
    const activeAxis = (typeof currentPidAxis !== 'undefined') ? currentPidAxis : 'pitch';
    
    // タイトルの自動更新 (例: PID 追従性モニター (PITCH軸))
    const titleEl = document.getElementById('graphTitle');
    if (titleEl) {
        titleEl.innerText = `PID 追従性モニター (${activeAxis.toUpperCase()}軸)`;
    }

    // 画面クリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2; // 中央を「0度」の基準線とする
    const stepX = width / (MAX_GRAPH_POINTS - 1); // 横軸のプロット間隔

    // --- ① 背景補助線（グリッド）の描画 ---
    ctx.strokeStyle = 'rgba(45, 45, 52, 0.5)'; // var(--panel-border)に近い暗い色
    ctx.lineWidth = 1;
    
    // 縦グリッド（時間線）
    for (let x = 0; x < width; x += width / 5) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    // 横グリッド（度数線 ±15度、±30度ライン）
    // ドローンの操作限界が約±30度(0.52rad)のため、上下に最大35度程度のスケールで描画
    const scaleFactor = height / 70; // 1度あたりのピクセル高さ (全幅70度)

    const degreeLines = [-30, -15, 0, 15, 30];
    degreeLines.forEach(deg => {
        const y = centerY - (deg * scaleFactor);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.strokeStyle = (deg === 0) ? 'rgba(255, 255, 255, 0.25)' : 'rgba(45, 45, 52, 0.4)'; // 0度線だけ少し明るく
        ctx.stroke();

        // 簡易Y軸ラベルの描画
        ctx.fillStyle = 'var(--text-muted)';
        ctx.font = '9px monospace';
        ctx.fillText((deg >= 0 ? '+' : '') + deg + '°', 6, y - 3);
    });

    // アクティブな軸のデータ配列を抽出
    const data = graphBuffer[activeAxis];
    if (data.target.length === 0) return;

    // --- ② 目標角度（Target）の線描画：青色 ---
    ctx.strokeStyle = '#007aff'; // var(--primary-color)
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    data.target.forEach((val, index) => {
        const x = index * stepX;
        const y = centerY - (val * scaleFactor);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // --- ③ 現在の実際の角度（Actual）の線描画：赤色 ---
    ctx.strokeStyle = '#ff3b30'; // var(--danger-color)
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    data.current.forEach((val, index) => {
        const x = index * stepX;
        const y = centerY - (val * scaleFactor);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

// 4. 初回起動時に真っ白なグリッドだけを描画しておく処理
document.addEventListener('DOMContentLoaded', () => {
    renderPidGraph();
});
