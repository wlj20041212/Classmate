# 构建单文件 Christmas.html
# 读取原始文件 -> 修改上传地址和邀请码逻辑 -> 合并成单文件

$src = "d:\2252\christmas\zyj.stext.cn"
$out = "d:\2252\christmas\Christmas.html"

# 1. 读取 CSS
$css = [System.IO.File]::ReadAllText("$src\assets\css\christmas-tree.css", [System.Text.Encoding]::UTF8)

# 2. 读取 upload-helper.js 并修改上传地址
$uh = [System.IO.File]::ReadAllText("$src\assets\js\upload-helper.js", [System.Text.Encoding]::UTF8)
# 把照片上传从 api/upload.php 改到 Cloudflare Worker
$uh = $uh.Replace("fetch('api/upload.php'", "fetch((window.PHOTO_UPLOAD_URL||'')+'/upload'")
# 视频上传也指向同一接口（静态托管没有视频端，统一走照片接口）
$uh = $uh.Replace("fetch('api/upload_video.php'", "fetch((window.PHOTO_UPLOAD_URL||'')+'/upload'")

# 3. 读取 christmas-tree.js 并修改邀请码逻辑
$js = [System.IO.File]::ReadAllText("$src\assets\js\christmas-tree.js", [System.Text.Encoding]::UTF8)
# 独立部署：跳过邀请码验证（无 PHP 后端）
$js = $js.Replace("const isValid = await validateInviteCode();", "const isValid = true; // 独立部署：跳过邀请码验证")
# 邀请码缺省给个默认值，避免 capturePhotoAndUpload 里 !inviteCode 检查阻断
$js = $js.Replace("inviteCode = urlParams.get('code') || '';", "inviteCode = urlParams.get('code') || 'standalone';")

# 4. 组装单文件 HTML
$html = @"
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="format-detection" content="telephone=no">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="theme-color" content="#0b1026">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎄</text></svg>">
    <title>🎄魔法圣诞树🎄</title>

    <!-- ====== 三方库走 CDN（three r160 / gsap 3.12.2 / howler 2.2.4）====== -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.2/dist/gsap.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/howler@2.2.4/dist/howler.min.js"></script>
    <script type="importmap">
    {
        "imports": {
            "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
            "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
        }
    }
    </script>

    <!-- ====== 照片上传地址配置 ======
         把下面的 URL 换成你自己的 Cloudflare Worker 地址。
         Worker 部署后会得到类似 https://christmas-photo.xxx.workers.dev 的地址。
         如果你还没部署 Worker，可以先留空字符串 ''，游戏照样能玩，只是照片不会上传。
    -->
    <script>
      window.PHOTO_UPLOAD_URL = 'https://christmas-photo.YOUR-SUBDOMAIN.workers.dev';
    </script>

    <style>
$css
    </style>

    <!-- ====== 上传助手（已改为发往 Worker）====== -->
    <script>
$uh
    </script>
</head>
<body>
    <canvas id="output_canvas"></canvas>
    <video id="camera_video" autoplay playsinline webkit-playsinline x5-playsinline muted style="display: none;"></video>

    <div id="loading">
        <div class="spinner"></div>
        <p>正在初始化魔法引擎...</p>
        <p style="font-size: 12px; color: #aaa;">请允许摄像头权限<br>建议横屏体验最佳</p>
    </div>

    <div id="instruction-panel">
        <h3 id="panel-header">✨ 魔法指令集 ✨ <span id="toggle-icon">▼</span></h3>
        <ul id="instruction-list">
            <li><span class="key-icon">✋</span> <b>张开手掌</b>: 伯利恒之星</li>
            <li><span class="key-icon">✊</span> <b>握拳</b>: 时间静止</li>
            <li><span class="key-icon">✌️</span> <b>剪刀手</b>: 彩虹雪花模式</li>
            <li><span class="key-icon">👌</span> <b>OK手势</b>: 播放/暂停 音乐</li>
            <li><span class="key-icon">👍</span> <b>竖大拇指</b>: 圣诞树生长</li>
            <li><span class="key-icon">🤙</span> <b>666手势</b>: 切换主题配色</li>
            <li><span class="key-icon">👆</span> <b>单指食指</b>: 魔法光绘/轨迹</li>
            <li><span class="key-icon">🤟</span> <b>爱你的手势</b>: 漫天爱心雨</li>
            <li><span class="key-icon">🌪️</span> <b>暴风雪</b>: 召唤暴风雪</li>
        </ul>
    </div>

    <div id="status-feedback">等待魔法连接...</div>

    <!-- ====== 圣诞树主程序（已跳过邀请码验证）====== -->
    <script type="module">
$js
    </script>
</body>
</html>
"@

[System.IO.File]::WriteAllText($out, $html, [System.Text.Encoding]::UTF8)
$size = (Get-Item $out).Length
Write-Host "构建完成: $out"
Write-Host "文件大小: $size bytes ($([math]::Round($size/1024, 1)) KB)"
